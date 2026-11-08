import type { CustomerStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { requireCustomerOrg, requirePlatform } from "./access";
import { storageByOrg, tenantUsage } from "./usage";
import { entitlementsFor } from "./modules";
import { currentSubscription } from "./subscriptions";

/**
 * Customer organisations as Evantix sees them (Admin Centre → Customers). The Organisation id is the tenant identity;
 * CustomerAccount adds the commercial profile. Nothing here reads care records: service users and visits are only
 * counted, for operational metering.
 */

/** Gives every organisation without a customer account one (organisations created before the Admin Centre, or by seed). */
export async function ensureCustomerAccounts() {
  await db.$executeRawUnsafe(`
    INSERT INTO "CustomerAccount" ("organisationId", "reference", "status", "legalName", "updatedAt")
    SELECT o."id", 'EVX-' || lpad(nextval('customer_reference_seq')::text, 4, '0'), 'ACTIVE', o."name", CURRENT_TIMESTAMP
    FROM (SELECT "id", "name" FROM "Organisation" WHERE NOT EXISTS (SELECT 1 FROM "CustomerAccount" c WHERE c."organisationId" = "Organisation"."id") ORDER BY "createdAt", "id") o
    ON CONFLICT DO NOTHING`);
}

export const CUSTOMER_STATUSES: CustomerStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"];
const SORTS = ["name", "reference", "users", "renewal", "created"] as const;
export type ClientSort = (typeof SORTS)[number];
export const CLIENT_PAGE_SIZE = 25;

/** The client directory with search, status and plan filters, sorting and pagination. */
export async function listClients(ctx: Ctx, f: { q?: string; status?: string; plan?: string; sort?: string; page?: number } = {}) {
  requirePlatform(ctx, "platform.view");
  await ensureCustomerAccounts();
  const q = f.q?.trim().slice(0, 100);
  const status = CUSTOMER_STATUSES.includes(f.status as CustomerStatus) ? (f.status as CustomerStatus) : undefined;
  const where: Prisma.OrganisationWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customerAccount: { OR: [{ reference: { contains: q, mode: "insensitive" } }, { legalName: { contains: q, mode: "insensitive" } }, { tradingName: { contains: q, mode: "insensitive" } }, { companyNumber: { contains: q, mode: "insensitive" } }] } }] } : {}),
    ...(status ? { customerAccount: { status } } : {}),
    ...(f.plan ? (f.plan === "none" ? { subscriptions: { none: { isCurrent: true } } } : { subscriptions: { some: { isCurrent: true, planId: f.plan } } }) : {}),
  };
  const [orgs, storage] = await Promise.all([
    db.organisation.findMany({
      where,
      select: {
        id: true, name: true, isDemo: true, createdAt: true,
        customerAccount: { select: { reference: true, status: true, tradingName: true } },
        subscriptions: { where: { isCurrent: true }, select: { status: true, renewsAt: true, trialEndsAt: true, plan: { select: { name: true } } } },
        _count: { select: { branches: true, serviceUsers: true, memberships: { where: { deactivatedAt: null } } } },
      },
    }),
    storageByOrg(),
  ]);
  const rows = orgs.map((o) => {
    const sub = o.subscriptions[0] ?? null;
    return {
      id: o.id,
      name: o.name,
      isDemo: o.isDemo,
      reference: o.customerAccount?.reference ?? "—",
      status: o.customerAccount?.status ?? ("ACTIVE" as CustomerStatus),
      plan: sub?.plan.name ?? null,
      renewal: sub ? (sub.status === "TRIAL" ? sub.trialEndsAt : sub.renewsAt) : null,
      renewalKind: sub?.status === "TRIAL" ? ("trial ends" as const) : ("renews" as const),
      branches: o._count.branches,
      users: o._count.memberships,
      serviceUsers: o._count.serviceUsers,
      storageBytes: storage.get(o.id)?.bytes ?? 0,
      createdAt: o.createdAt,
    };
  });
  const sort: ClientSort = SORTS.includes(f.sort as ClientSort) ? (f.sort as ClientSort) : "name";
  rows.sort((a, b) => {
    switch (sort) {
      case "reference": return a.reference.localeCompare(b.reference);
      case "users": return b.users - a.users || a.name.localeCompare(b.name);
      case "renewal": return (a.renewal?.getTime() ?? Infinity) - (b.renewal?.getTime() ?? Infinity);
      case "created": return b.createdAt.getTime() - a.createdAt.getTime();
      default: return a.name.localeCompare(b.name);
    }
  });
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return { total: rows.length, page, sort, rows: rows.slice((page - 1) * CLIENT_PAGE_SIZE, page * CLIENT_PAGE_SIZE) };
}

/** One client's administration profile header and overview. */
export async function getClient(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.view");
  const org = await requireCustomerOrg(organisationId);
  await ensureCustomerAccounts();
  const [account, subscription, usage, modules, admins, pendingAdminInvites] = await Promise.all([
    db.customerAccount.findUniqueOrThrow({ where: { organisationId } }),
    currentSubscription(organisationId),
    tenantUsage(organisationId),
    entitlementsFor(organisationId),
    db.membership.findMany({ where: { organisationId, deactivatedAt: null, roles: { has: "ORG_ADMIN" } }, select: { id: true, user: { select: { id: true, name: true, email: true } } } }),
    db.accountToken.count({ where: { organisationId, kind: "INVITE", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, roles: { has: "ORG_ADMIN" } } }),
  ]);
  return { org, account, subscription, usage, modules, admins, pendingAdminInvites };
}

export async function clientBranches(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.view");
  await requireCustomerOrg(organisationId);
  return db.branch.findMany({ where: { organisationId }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true, cqcLocationId: true, createdAt: true, services: { select: { serviceTypeCode: true } }, _count: { select: { grants: true, areas: true } } } });
}

const companySchema = z.object({
  legalName: z.string().trim().min(2, "Give the legal company name").max(160),
  tradingName: z.string().trim().max(160).nullable(),
  companyNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,10}$/, "A company registration number has 6 to 10 letters and numbers").nullable(),
  address: z.string().trim().max(400).nullable(),
  contactEmail: z.string().trim().toLowerCase().email("Give a valid contact email").max(200).nullable(),
  contactPhone: z.string().trim().regex(/^[0-9 +()-]{6,30}$/, "Give a valid telephone number").nullable(),
  country: z.string().trim().min(2).max(60),
  mainContactName: z.string().trim().max(120).nullable(),
  serviceTypes: z.array(z.string().trim().min(1).max(60)).max(10),
  cqcProviderId: z.string().trim().regex(/^[0-9]-[0-9]{6,12}$/, "A CQC provider ID looks like 1-123456789").nullable(),
  cqcLocationIds: z.array(z.string().trim().regex(/^[0-9]-[0-9]{6,12}$/, "A CQC location ID looks like 1-123456789")).max(50),
});
export type CompanyInput = z.input<typeof companySchema>;

export function parseCompany(input: CompanyInput) {
  const p = companySchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the company details");
  return p.data;
}

/** Updates a client's company details. A changed CQC provider ID clears the "checked" mark. */
export async function updateCompanyDetails(ctx: Ctx, organisationId: string, input: CompanyInput) {
  requirePlatform(ctx, "platform.customers");
  await requireCustomerOrg(organisationId);
  const d = parseCompany(input);
  await ensureCustomerAccounts();
  const before = await db.customerAccount.findUniqueOrThrow({ where: { organisationId } });
  if (d.companyNumber) {
    const clash = await db.customerAccount.findFirst({ where: { companyNumber: { equals: d.companyNumber, mode: "insensitive" }, organisationId: { not: organisationId } } });
    if (clash) throw new ConflictError(`Another client (${clash.reference}) already has company number ${d.companyNumber}`);
  }
  const cqcChanged = (before.cqcProviderId ?? null) !== d.cqcProviderId;
  await db.$transaction(async (tx) => {
    await tx.customerAccount.update({ where: { organisationId }, data: { ...d, ...(cqcChanged ? { cqcCheckedAt: null, cqcCheckedById: null } : {}) } });
    const changed = (Object.keys(d) as (keyof typeof d)[]).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(d[k] ?? null));
    await audit({ organisationId, actorId: ctx.userId, action: "platform.customer.details_updated", entityType: "Organisation", entityId: organisationId, data: { changed, before: Object.fromEntries(changed.map((k) => [k, (before[k] ?? null) as Prisma.InputJsonValue])), after: Object.fromEntries(changed.map((k) => [k, (d[k] ?? null) as Prisma.InputJsonValue])) } }, tx);
  });
}

/** Records that someone checked the CQC provider ID against the CQC register. The platform does not check it itself. */
export async function markCqcChecked(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.customers");
  await requireCustomerOrg(organisationId);
  const a = await db.customerAccount.findUnique({ where: { organisationId } });
  if (!a?.cqcProviderId) throw new ValidationError("Add the CQC provider ID first");
  await db.$transaction(async (tx) => {
    await tx.customerAccount.update({ where: { organisationId }, data: { cqcCheckedAt: new Date(), cqcCheckedById: ctx.userId } });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.customer.cqc_checked", entityType: "Organisation", entityId: organisationId, data: { cqcProviderId: a.cqcProviderId } }, tx);
  });
}

const branchSchema = z.object({ name: z.string().trim().min(2, "Name the branch").max(80), address: z.string().trim().max(300).nullable(), cqcLocationId: z.string().trim().max(40).nullable() });

/** Adds a branch to a client (onboarding help). Day-to-day branch changes stay with the customer's own administrators. */
export async function addClientBranch(ctx: Ctx, organisationId: string, input: z.input<typeof branchSchema>) {
  requirePlatform(ctx, "platform.customers");
  await requireCustomerOrg(organisationId);
  const p = branchSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the branch");
  if (await db.branch.findFirst({ where: { organisationId, name: { equals: p.data.name, mode: "insensitive" } } })) throw new ConflictError("This client already has a branch with that name");
  return db.$transaction(async (tx) => {
    const b = await tx.branch.create({ data: { organisationId, name: p.data.name, address: p.data.address, cqcLocationId: p.data.cqcLocationId, services: { create: [{ serviceTypeCode: "DOMICILIARY" }] } } });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.branch.created", entityType: "Branch", entityId: b.id, data: { name: b.name } }, tx);
    return b;
  });
}
