import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, hasPlatformPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { confirmOwnPassword, requireCustomerOrg, requirePlatform, requireReason } from "./access";
import { notifyOrgAdmins, notifyPlatformAdmins } from "./alerts";

/**
 * Controlled support access. Evantix asks a customer for time-limited access, for a stated purpose, to a restricted
 * scope; one of the customer's administrators approves or declines it on their own Settings page. In an emergency a
 * platform administrator may open it themselves for at most 4 hours, with their password and a reason, and the
 * customer's administrators are told at once. Either side can revoke it. It never lets anyone sign in as a customer
 * user and never opens service user or care records: the scopes cover configuration and the activity log only.
 */
export const SUPPORT_SCOPES = {
  CONFIGURATION: "Organisation configuration (settings, branches, module setup)",
  ACTIVITY_LOG: "The organisation's full activity log",
} as const;
export type SupportScope = keyof typeof SUPPORT_SCOPES;

const requestSchema = z.object({
  purpose: z.string().trim().min(10, "Describe the purpose in at least 10 characters").max(500),
  scopes: z.array(z.enum(["CONFIGURATION", "ACTIVITY_LOG"])).min(1, "Choose what support needs to see"),
  hours: z.number().int().min(1).max(72),
});

export async function requestSupportAccess(ctx: Ctx, organisationId: string, input: { purpose: string; scopes: string[]; hours: number }) {
  requirePlatform(ctx, "platform.support");
  const org = await requireCustomerOrg(organisationId);
  const p = requestSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the request");
  if (await db.supportAccessGrant.findFirst({ where: { organisationId, status: "REQUESTED" } })) throw new ConflictError("There is already a support access request waiting for this client");
  const g = await db.$transaction(async (tx) => {
    const g = await tx.supportAccessGrant.create({ data: { organisationId, requestedById: ctx.userId, purpose: p.data.purpose, scopes: p.data.scopes, durationHours: p.data.hours, authorisation: "CUSTOMER", status: "REQUESTED" } });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.support.requested", entityType: "SupportAccessGrant", entityId: g.id, data: { purpose: p.data.purpose, scopes: p.data.scopes, hours: p.data.hours } }, tx);
    return g;
  });
  const told = await notifyOrgAdmins(organisationId, "Evantix support is asking for access", `${ctx.userName} from Evantix support asks for ${p.data.hours} hours of access to: ${p.data.scopes.map((s) => SUPPORT_SCOPES[s]).join("; ")}. Purpose: ${p.data.purpose}. Approve or decline it in Settings.`, "/settings#support-access", `support-request:${g.id}`);
  return { grant: g, organisation: org.name, administratorsTold: told };
}

/** Emergency access without the customer's prior approval: 4 hours at most, own password, reason, customer told. */
export async function emergencySupportAccess(ctx: Ctx, organisationId: string, input: { purpose: string; scopes: string[]; hours: number }, password: string) {
  requirePlatform(ctx, "platform.support");
  const org = await requireCustomerOrg(organisationId);
  const p = requestSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the request");
  if (p.data.hours > 4) throw new ValidationError("Emergency access lasts at most 4 hours");
  await confirmOwnPassword(ctx, password);
  const now = new Date();
  const g = await db.$transaction(async (tx) => {
    const g = await tx.supportAccessGrant.create({ data: { organisationId, requestedById: ctx.userId, purpose: p.data.purpose, scopes: p.data.scopes, durationHours: p.data.hours, authorisation: "EMERGENCY", status: "ACTIVE", decidedById: ctx.userId, decidedAt: now, startsAt: now, expiresAt: new Date(now.getTime() + p.data.hours * 3600_000) } });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.support.emergency", entityType: "SupportAccessGrant", entityId: g.id, data: { purpose: p.data.purpose, scopes: p.data.scopes, hours: p.data.hours } }, tx);
    return g;
  });
  await notifyOrgAdmins(organisationId, "Evantix support opened emergency access", `${ctx.userName} from Evantix support opened emergency access for ${p.data.hours} hours to: ${p.data.scopes.map((s) => SUPPORT_SCOPES[s]).join("; ")}. Purpose: ${p.data.purpose}. You can revoke it in Settings.`, "/settings#support-access", `support-emergency:${g.id}`);
  await notifyPlatformAdmins(ctx, `Emergency support access: ${org.name}`, `${ctx.userName} opened emergency support access to ${org.name} for ${p.data.hours} hours. Purpose: ${p.data.purpose}`, `/platform-admin/clients/${organisationId}?tab=security`);
  return g;
}

/** A customer administrator approves or declines a waiting request for their own organisation. */
export async function decideSupportAccess(ctx: Ctx, grantId: string, approve: boolean) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const g = await db.supportAccessGrant.findFirst({ where: { id: grantId, organisationId } });
  if (!g) throw new NotFoundError("Support access request");
  if (g.status !== "REQUESTED") throw new ConflictError("This request has already been answered");
  const now = new Date();
  await db.$transaction(async (tx) => {
    const done = await tx.supportAccessGrant.updateMany({
      where: { id: g.id, status: "REQUESTED" },
      data: approve ? { status: "ACTIVE", decidedById: ctx.userId, decidedAt: now, startsAt: now, expiresAt: new Date(now.getTime() + g.durationHours * 3600_000) } : { status: "DECLINED", decidedById: ctx.userId, decidedAt: now },
    });
    if (!done.count) throw new ConflictError("This request has already been answered");
    await audit({ organisationId, actorId: ctx.userId, action: approve ? "admin.support.approved" : "admin.support.declined", entityType: "SupportAccessGrant", entityId: g.id, data: { scopes: g.scopes, hours: g.durationHours } }, tx);
  });
}

/** Ends support access early. A customer administrator may revoke access to their organisation; a platform administrator any. */
export async function revokeSupportAccess(ctx: Ctx, grantId: string, reasonRaw: string) {
  const g = await db.supportAccessGrant.findUnique({ where: { id: grantId } });
  if (!g) throw new NotFoundError("Support access");
  const asPlatform = hasPlatformPermission(ctx, "platform.support");
  const asCustomer = ctx.organisationId === g.organisationId && hasOrgPermission(ctx, "org.manage");
  if (!asPlatform && !asCustomer) throw new ForbiddenError("You cannot change this support access");
  const reason = requireReason(reasonRaw, "revoking support access");
  if (g.status !== "ACTIVE" && g.status !== "REQUESTED") throw new ConflictError("This support access has already ended");
  await db.$transaction(async (tx) => {
    await tx.supportAccessGrant.update({ where: { id: g.id }, data: { status: "REVOKED", revokedById: ctx.userId, revokedAt: new Date(), revokeReason: reason } });
    await audit({ organisationId: g.organisationId, actorId: ctx.userId, action: asCustomer ? "admin.support.revoked" : "platform.support.revoked", entityType: "SupportAccessGrant", entityId: g.id, data: { reason } }, tx);
  });
}

/** The active, unexpired grant covering a scope, or null. Expiry needs no job: an expired grant simply stops counting. */
export async function activeSupportGrant(organisationId: string, scope: SupportScope) {
  return db.supportAccessGrant.findFirst({ where: { organisationId, status: "ACTIVE", expiresAt: { gt: new Date() }, scopes: { has: scope } }, orderBy: { expiresAt: "desc" } });
}

/** Refuses unless support access covering the scope is active now; the use is audited. */
export async function requireSupportScope(ctx: Ctx, organisationId: string, scope: SupportScope) {
  requirePlatform(ctx, "platform.support");
  const g = await activeSupportGrant(organisationId, scope);
  if (!g) throw new ForbiddenError("Support access to this is not active. Ask the client for access first.");
  await audit({ organisationId, actorId: ctx.userId, action: "platform.support.used", entityType: "SupportAccessGrant", entityId: g.id, data: { scope } });
  return g;
}

export function grantState(g: { status: string; expiresAt: Date | null }) {
  if (g.status === "ACTIVE" && g.expiresAt && g.expiresAt <= new Date()) return "EXPIRED";
  return g.status;
}

export async function listSupportGrants(ctx: Ctx, organisationId?: string) {
  requirePlatform(ctx, "platform.view");
  if (organisationId) await requireCustomerOrg(organisationId);
  const rows = await db.supportAccessGrant.findMany({ where: organisationId ? { organisationId } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { organisation: { select: { id: true, name: true } } } });
  const names = await namesOf([...rows.map((r) => r.requestedById), ...rows.map((r) => r.decidedById), ...rows.map((r) => r.revokedById)]);
  return rows.map((r) => ({ ...r, state: grantState(r), requestedBy: names.get(r.requestedById) ?? "Unknown", decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null, revokedBy: r.revokedById ? (names.get(r.revokedById) ?? null) : null }));
}

/** For the customer's own Settings page: waiting requests and access that is active now. */
export async function customerSupportAccess(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const rows = await db.supportAccessGrant.findMany({ where: { organisationId, OR: [{ status: "REQUESTED" }, { status: "ACTIVE", expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } });
  const names = await namesOf(rows.map((r) => r.requestedById));
  return rows.map((r) => ({ ...r, requestedBy: names.get(r.requestedById) ?? "Evantix support" }));
}

async function namesOf(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  return new Map((await db.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

/** What support can see with an active CONFIGURATION grant: settings and branch set-up, never care records. */
export async function supportConfigurationView(ctx: Ctx, organisationId: string) {
  await requireSupportScope(ctx, organisationId, "CONFIGURATION");
  const [org, branches, rota] = await Promise.all([
    db.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true, jurisdiction: true, settings: true } }),
    db.branch.findMany({ where: { organisationId }, select: { name: true, address: true, cqcLocationId: true, hrBranchKey: true, services: { select: { serviceTypeCode: true } }, _count: { select: { areas: true } } }, orderBy: { name: "asc" } }),
    db.rotaSettings.findFirst({ where: { organisationId } }),
  ]);
  return { org, branches, rotaSettings: rota };
}
