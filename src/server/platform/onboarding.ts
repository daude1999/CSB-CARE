import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { MODULE_KEYS } from "@/lib/platform-modules";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { inviteDays, newToken, ROLES } from "@/server/admin/users";
import { requirePlatform } from "./access";
import { parseCompany, type CompanyInput } from "./customers";
import { applyModuleSelection } from "./modules";
import { nextCustomerReference } from "./reference";
import { startSubscriptionPeriod, subscriptionSchema } from "./subscriptions";

/**
 * Add New Client: one transaction creates the organisation, its customer account and reference, branches, the
 * subscription period, module entitlements and a single-use invitation for the first organisation administrator.
 * No password is ever set by Evantix. A retried submission (same onboarding key) returns the client already created
 * instead of creating a second one, and a client with the same legal name or company number is refused.
 */
const adminSchema = z.object({
  name: z.string().trim().min(2, "Give the administrator's name").max(120),
  email: z.string().trim().toLowerCase().email("Give a valid email address for the administrator").max(200),
  jobTitle: z.string().trim().max(120).nullable(),
  roles: z.array(z.enum(ROLES)).min(1),
});

const inputSchema = z.object({
  onboardingKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This form has expired. Reload the page and try again."),
  subscription: subscriptionSchema.omit({ applyPlanModules: true }),
  modules: z.array(z.enum(MODULE_KEYS)),
  admin: adminSchema,
  branches: z.array(z.string().trim().min(2, "Each branch needs a name of at least 2 characters").max(80)).max(30),
});

export type OnboardingInput = z.input<typeof inputSchema> & { company: CompanyInput };
export type OnboardingResult = { organisationId: string; reference: string; token: string | null; inviteExpiresInDays: number | null; reused: boolean };

function slugFrom(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "client";
}

export async function provisionClient(ctx: Ctx, input: OnboardingInput): Promise<OnboardingResult> {
  requirePlatform(ctx, "platform.customers");
  requirePlatform(ctx, "platform.commercial");
  const p = inputSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the client details");
  const company = parseCompany(input.company);
  const d = p.data;

  // A retried submission: the client already exists, so show it instead of creating it twice.
  const already = await db.customerAccount.findUnique({ where: { onboardingKey: d.onboardingKey } });
  if (already) return { organisationId: already.organisationId, reference: already.reference, token: null, inviteExpiresInDays: null, reused: true };

  if (!d.admin.roles.includes("ORG_ADMIN")) throw new ValidationError("The first administrator must have the Organisation admin role");
  if (d.subscription.status === "TRIAL" && !d.subscription.trialEndsAt) throw new ValidationError("Give the date the trial ends");
  if (!d.modules.length) throw new ValidationError("Choose at least one module");
  const branches = d.branches.length ? d.branches : ["Main office"];
  if (new Set(branches.map((b) => b.toLowerCase())).size !== branches.length) throw new ValidationError("Two branches have the same name");
  const plan = await db.subscriptionPlan.findUnique({ where: { id: d.subscription.planId } });
  if (!plan || !plan.active) throw new ValidationError("Choose an active plan. Plans are set up under Commercial → Plans & Pricing.");

  const sameName = await db.customerAccount.findFirst({ where: { OR: [{ legalName: { equals: company.legalName, mode: "insensitive" } }, ...(company.tradingName ? [{ tradingName: { equals: company.tradingName, mode: "insensitive" as const } }] : [])] } });
  if (sameName) throw new ConflictError(`This client already exists as ${sameName.reference}. Open it from All Clients instead of adding it again.`);
  if (company.companyNumber) {
    const sameNumber = await db.customerAccount.findFirst({ where: { companyNumber: { equals: company.companyNumber, mode: "insensitive" } } });
    if (sameNumber) throw new ConflictError(`Company number ${company.companyNumber} already belongs to client ${sameNumber.reference}.`);
  }
  if (await db.organisation.findFirst({ where: { name: { equals: company.tradingName ?? company.legalName, mode: "insensitive" } } })) throw new ConflictError("An organisation with this name already exists. Open it from All Clients instead of adding it again.");

  let slug = slugFrom(company.tradingName ?? company.legalName);
  for (let n = 2; await db.organisation.findUnique({ where: { slug } }); n++) slug = `${slugFrom(company.tradingName ?? company.legalName)}-${n}`;

  const { token, tokenHash } = newToken();
  const days = await inviteDays();
  try {
    const result = await db.$transaction(async (tx) => {
      const org = await tx.organisation.create({ data: { name: company.tradingName ?? company.legalName, slug, isDemo: false, jurisdiction: "ENG" } });
      const reference = await nextCustomerReference(tx);
      await tx.customerAccount.create({ data: { organisationId: org.id, reference, status: d.subscription.status, statusChangedAt: new Date(), ...company, onboardingKey: d.onboardingKey, createdById: ctx.userId } });
      for (const name of branches) await tx.branch.create({ data: { organisationId: org.id, name, services: { create: [{ serviceTypeCode: "DOMICILIARY" }] } } });
      const { row: sub } = await startSubscriptionPeriod(tx, org.id, ctx.userId, { ...d.subscription, changeReason: "Client onboarding" });
      await applyModuleSelection(tx, org.id, d.modules, ctx.userId);
      const invite = await tx.accountToken.create({ data: { organisationId: org.id, kind: "INVITE", email: d.admin.email, name: d.admin.name, roles: d.admin.roles, jobTitle: d.admin.jobTitle, tokenHash, createdById: ctx.userId, expiresAt: new Date(Date.now() + days * 86400_000) } });
      await audit({ organisationId: org.id, actorId: ctx.userId, action: "platform.customer.created", entityType: "Organisation", entityId: org.id, data: { reference, legalName: company.legalName, plan: plan.code, status: d.subscription.status, modules: d.modules, branches, subscriptionId: sub.id } }, tx);
      await audit({ organisationId: org.id, actorId: ctx.userId, action: "platform.member.invited", entityType: "AccountToken", entityId: invite.id, data: { email: d.admin.email, roles: d.admin.roles, firstAdministrator: true } }, tx);
      return { organisationId: org.id, reference };
    });
    return { ...result, token, inviteExpiresInDays: days, reused: false };
  } catch (e) {
    // Two submissions of the same form at once: the second one finds the first one's client.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.customerAccount.findUnique({ where: { onboardingKey: d.onboardingKey } });
      if (existing) return { organisationId: existing.organisationId, reference: existing.reference, token: null, inviteExpiresInDays: null, reused: true };
      throw new ConflictError("This client was just created by someone else. Open it from All Clients.");
    }
    throw e;
  }
}

/** Onboarding progress for every client: has the first administrator accepted, are branches and a plan in place. */
export async function onboardingStatus(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const orgs = await db.organisation.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, createdAt: true,
      customerAccount: { select: { reference: true, status: true, createdById: true } },
      subscriptions: { where: { isCurrent: true }, select: { id: true } },
      _count: { select: { branches: true, memberships: { where: { deactivatedAt: null, roles: { has: "ORG_ADMIN" } } } } },
      accountTokens: { where: { kind: "INVITE", roles: { has: "ORG_ADMIN" } }, orderBy: { createdAt: "desc" }, take: 1, select: { email: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } },
    },
  });
  return orgs.map((o) => {
    const inv = o.accountTokens[0] ?? null;
    const steps = { company: true, subscription: o.subscriptions.length > 0, branches: o._count.branches > 0, administrator: o._count.memberships > 0 };
    const invite = inv ? { email: inv.email, state: inv.usedAt ? "accepted" : inv.revokedAt ? "revoked" : inv.expiresAt < new Date() ? "expired" : "waiting", createdAt: inv.createdAt, expiresAt: inv.expiresAt } : null;
    return { id: o.id, name: o.name, reference: o.customerAccount?.reference ?? "—", status: o.customerAccount?.status ?? "ACTIVE", createdAt: o.createdAt, steps, complete: Object.values(steps).every(Boolean), invite };
  });
}
