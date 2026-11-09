import type { OrgRole, PlatformRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { ORG_PERMISSIONS, type Ctx } from "@/server/auth/rbac";
import { deactivateMemberIn, inviteMemberIn, issueResetLink, memberOf, reactivateMemberIn, updateMemberIn, type Actor, type MemberInput } from "@/server/admin/users";
import { emailProvider } from "@/server/notifications/email";
import { confirmOwnPassword, requireCustomerOrg, requirePlatform, requireReason } from "./access";
import { notifyPlatformAdmins } from "./alerts";

/**
 * Users & Accounts across every customer (Admin Centre → Accounts & Security). Changes go through the same services
 * as the customer's own Users & Logins page (src/server/admin/users.ts), with the platform level recorded in the
 * audit. A person may belong to several organisations: membership changes are made per organisation and never touch
 * the person's other memberships. Platform administrators never see or set a password.
 */
const platform = (ctx: Ctx): Actor => ({ userId: ctx.userId, level: "platform" });
export const PAGE_SIZE = 25;

export async function listAccounts(ctx: Ctx, f: { q?: string; org?: string; role?: string; status?: string; page?: number } = {}) {
  requirePlatform(ctx, "platform.accounts");
  const q = f.q?.trim().slice(0, 100);
  const isPlatformRole = (r: string): r is PlatformRole => ["PLATFORM_ADMIN", "CONTENT_EDITOR", "REGULATORY_REVIEWER"].includes(r);
  const isOrgRole = (r: string): r is OrgRole => r in ORG_ROLE_NAMES;
  const memberWhere: Prisma.MembershipWhereInput = { ...(f.org ? { organisationId: f.org } : {}), ...(f.role && isOrgRole(f.role) ? { roles: { has: f.role } } : {}) };
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(f.org || (f.role && isOrgRole(f.role)) ? { memberships: { some: memberWhere } } : {}),
    ...(f.role && isPlatformRole(f.role) ? { platformRoles: { has: f.role } } : {}),
    ...(f.status === "deactivated" ? { deactivatedAt: { not: null } } : f.status === "reset-required" ? { passwordResetRequired: true } : f.status === "active" ? { deactivatedAt: null } : {}),
  };
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, email: true, platformRoles: true, isDemo: true, createdAt: true, deactivatedAt: true, passwordResetRequired: true,
        memberships: { select: { id: true, roles: true, deactivatedAt: true, organisation: { select: { id: true, name: true } } } },
        sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
    }),
  ]);
  const lastSignIns = await lastSignInFor(users.map((u) => u.id));
  return { total, page, users: users.map((u) => ({ ...u, platformRoles: u.platformRoles.filter((r) => r !== "NONE"), lastActive: u.sessions[0]?.lastSeenAt ?? null, lastSignIn: lastSignIns.get(u.id) ?? null })) };
}

/** Last successful sign-in per person, from the audit log. */
async function lastSignInFor(userIds: string[]) {
  if (!userIds.length) return new Map<string, Date>();
  const rows = await db.auditLog.groupBy({ by: ["actorId"], where: { action: "auth.login", actorId: { in: userIds } }, _max: { createdAt: true } });
  return new Map(rows.filter((r) => r.actorId && r._max.createdAt).map((r) => [r.actorId as string, r._max.createdAt as Date]));
}

/** Who someone is, where they belong, how they sign in and what has happened to their account. Never a password. */
export async function getAccount(ctx: Ctx, userId: string) {
  requirePlatform(ctx, "platform.accounts");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, platformRoles: true, isDemo: true, createdAt: true, deactivatedAt: true, passwordResetRequired: true, passwordHash: true,
      memberships: { orderBy: { createdAt: "asc" }, select: { id: true, roles: true, jobTitle: true, deactivatedAt: true, createdAt: true, organisation: { select: { id: true, name: true, customerAccount: { select: { reference: true, status: true } } } }, branches: { select: { branchId: true } } } },
      sessions: { orderBy: { lastSeenAt: "desc" }, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true, activeOrgId: true } },
    },
  });
  if (!user) throw new NotFoundError("Account");
  const [tokens, history, branches, lastSignIn] = await Promise.all([
    db.accountToken.findMany({ where: { OR: [{ userId }, { email: user.email }] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, organisationId: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true, createdById: true } }),
    securityHistory(userId, user.email),
    db.branch.findMany({ where: { organisationId: { in: user.memberships.map((m) => m.organisation.id) } }, select: { id: true, name: true, organisationId: true }, orderBy: { name: "asc" } }),
    lastSignInFor([userId]),
  ]);
  const { passwordHash, ...safe } = user;
  return {
    ...safe,
    platformRoles: user.platformRoles.filter((r) => r !== "NONE"),
    hasPassword: Boolean(passwordHash),
    lastSignIn: lastSignIn.get(userId) ?? null,
    sessions: user.sessions.map((s) => ({ ...s, ip: maskIp(s.ip), userAgent: s.userAgent?.slice(0, 80) ?? null })),
    tokens: tokens.map((t) => ({ ...t, state: tokenState(t) })),
    history,
    branches,
    multiOrg: user.memberships.length > 1,
  };
}

export function tokenState(t: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  return t.usedAt ? "used" : t.revokedAt ? "revoked" : t.expiresAt < new Date() ? "expired" : "active";
}

/** Shows enough of a network address to recognise it, not the whole address. */
export function maskIp(ip: string | null) {
  if (!ip) return null;
  const first = ip.split(",")[0]!.trim();
  if (first.includes(".")) return first.split(".").slice(0, 2).join(".") + ".x.x";
  if (first.includes(":")) return first.split(":").slice(0, 3).join(":") + ":…";
  return "hidden";
}

async function securityHistory(userId: string, email: string) {
  return db.auditLog.findMany({
    where: { OR: [{ entityId: userId }, { actorId: userId, action: { startsWith: "auth." } }, { data: { path: ["userId"], equals: userId } }, { data: { path: ["email"], equals: email } }] },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, action: true, actorId: true, organisationId: true, createdAt: true, data: true },
  });
}

async function targetUser(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new NotFoundError("Account");
  return u;
}

// ── Passwords and sessions ─────────────────────────────────────────────

/**
 * Platform-level account recovery: a one-time reset link for anyone, including a person who belongs to several
 * organisations (whom their own organisations' administrators cannot reset). The link is shown once to the platform
 * administrator, or emailed to the person when a real email provider is configured. Existing sessions end when the
 * new password is set.
 */
export async function platformResetLink(ctx: Ctx, userId: string, opts: { delivery?: "show" | "email" } = {}) {
  requirePlatform(ctx, "platform.accounts");
  const u = await targetUser(userId);
  if (u.isDemo) throw new ForbiddenError("Demo accounts keep the shared demo password");
  if (u.deactivatedAt) throw new ConflictError("Reactivate this account first");
  const r = await issueResetLink({ userId: u.id, email: u.email, name: u.name }, null, platform(ctx));
  if (opts.delivery === "email") {
    if (emailProvider().name !== "smtp") throw new ConflictError("Email is not configured on this platform, so the link cannot be emailed. Show it once instead.");
    return { ...r, emailed: true };
  }
  return { ...r, emailed: false };
}

/** Sends a reset link by email (only with a configured email provider). The link itself is never stored or logged. */
export async function emailResetLink(email: string, name: string, link: string, hours: number) {
  await emailProvider().send({ to: email, subject: "Reset your CSB password", text: `Hello ${name},\n\nA password reset was requested for your account. Use this link within ${hours} hours to choose a new password:\n\n${link}\n\nIf you did not expect this, contact your administrator.` });
}

/** Signs a person out everywhere. */
export async function revokeAllSessions(ctx: Ctx, userId: string, reasonRaw: string) {
  requirePlatform(ctx, "platform.accounts");
  const reason = requireReason(reasonRaw, "signing this person out");
  await targetUser(userId);
  return db.$transaction(async (tx) => {
    const n = await tx.session.deleteMany({ where: { userId } });
    await audit({ actorId: ctx.userId, action: "platform.sessions.revoked", entityType: "User", entityId: userId, data: { userId, sessions: n.count, reason } }, tx);
    return n.count;
  });
}

/** Ends one session (Login Sessions). */
export async function revokeSession(ctx: Ctx, sessionId: string) {
  requirePlatform(ctx, "platform.accounts");
  const s = await db.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true } });
  if (!s) throw new NotFoundError("Session");
  await db.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: s.id } });
    await audit({ actorId: ctx.userId, action: "platform.session.revoked", entityType: "Session", entityId: s.id, data: { userId: s.userId } }, tx);
  });
}

export async function revokeResetLinks(ctx: Ctx, userId: string) {
  requirePlatform(ctx, "platform.accounts");
  await targetUser(userId);
  return db.$transaction(async (tx) => {
    const n = await tx.accountToken.updateMany({ where: { userId, kind: "RESET", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: ctx.userId, action: "platform.reset_links.revoked", entityType: "User", entityId: userId, data: { userId, links: n.count } }, tx);
    return n.count;
  });
}

/**
 * Requires a new password: the person is signed out everywhere, cannot sign in with their old password, and gets a
 * fresh one-time reset link (shown once).
 */
export async function requirePasswordReset(ctx: Ctx, userId: string, reasonRaw: string) {
  requirePlatform(ctx, "platform.accounts");
  const reason = requireReason(reasonRaw, "requiring a new password");
  const u = await targetUser(userId);
  if (u.isDemo) throw new ForbiddenError("Demo accounts keep the shared demo password");
  if (u.deactivatedAt) throw new ConflictError("Reactivate this account first");
  if (u.id === ctx.userId) throw new ForbiddenError("Change your own password from your own reset link instead");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordResetRequired: true } });
    const n = await tx.session.deleteMany({ where: { userId } });
    await audit({ actorId: ctx.userId, action: "platform.password.reset_required", entityType: "User", entityId: userId, data: { userId, reason, sessionsEnded: n.count } }, tx);
  });
  return issueResetLink({ userId: u.id, email: u.email, name: u.name }, null, platform(ctx));
}

/** Open, used and expired reset links across the platform (Password Management). Never the link itself. */
export async function passwordOverview(ctx: Ctx) {
  requirePlatform(ctx, "platform.accounts");
  const since = new Date(Date.now() - 30 * 86400_000);
  const [links, required] = await Promise.all([
    db.accountToken.findMany({ where: { kind: "RESET", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, userId: true, email: true, name: true, organisationId: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true, createdById: true, organisation: { select: { name: true } } } }),
    db.user.findMany({ where: { passwordResetRequired: true }, select: { id: true, name: true, email: true } }),
  ]);
  return { links: links.map((l) => ({ ...l, state: tokenState(l) })), required };
}

/** Revokes one unused reset link. */
export async function revokeResetLink(ctx: Ctx, tokenId: string) {
  requirePlatform(ctx, "platform.accounts");
  const t = await db.accountToken.findUnique({ where: { id: tokenId } });
  if (!t || t.kind !== "RESET") throw new NotFoundError("Reset link");
  if (t.usedAt || t.revokedAt) throw new ConflictError("This link has already been used or revoked");
  await db.$transaction(async (tx) => {
    await tx.accountToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
    await audit({ organisationId: t.organisationId, actorId: ctx.userId, action: "platform.reset_link.revoked", entityType: "AccountToken", entityId: t.id, data: { userId: t.userId } }, tx);
  });
}

// ── Account status and platform roles ──────────────────────────────────

async function assertPlatformAdminRemains(exceptUserId: string) {
  const others = await db.user.count({ where: { id: { not: exceptUserId }, deactivatedAt: null, platformRoles: { has: "PLATFORM_ADMIN" } } });
  if (!others) throw new ConflictError("The platform must keep at least one active platform administrator");
}

/**
 * Deactivates a whole account (every organisation): sessions end, links are revoked, sign-in stops. Memberships and
 * history are kept. Refused when the person is the last active administrator of an organisation or of the platform.
 */
export async function deactivateAccount(ctx: Ctx, userId: string, reasonRaw: string, password: string) {
  requirePlatform(ctx, "platform.accounts");
  const reason = requireReason(reasonRaw, "deactivating this account");
  const u = await targetUser(userId);
  if (u.id === ctx.userId) throw new ForbiddenError("You cannot deactivate your own account");
  if (u.deactivatedAt) throw new ConflictError("This account is already deactivated");
  await confirmOwnPassword(ctx, password);
  if (u.platformRoles.includes("PLATFORM_ADMIN")) await assertPlatformAdminRemains(u.id);
  const adminOf = await db.membership.findMany({ where: { userId, deactivatedAt: null, roles: { has: "ORG_ADMIN" } }, select: { organisationId: true, organisation: { select: { name: true } } } });
  for (const m of adminOf) {
    const others = await db.membership.count({ where: { organisationId: m.organisationId, userId: { not: userId }, deactivatedAt: null, roles: { has: "ORG_ADMIN" }, user: { deactivatedAt: null } } });
    if (!others) throw new ConflictError(`${u.name} is the only active administrator of ${m.organisation.name}. Give someone else the Organisation admin role there first.`);
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } });
    const s = await tx.session.deleteMany({ where: { userId } });
    await tx.accountToken.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: ctx.userId, action: "platform.account.deactivated", entityType: "User", entityId: userId, data: { userId, reason, sessionsEnded: s.count } }, tx);
  });
  await notifyPlatformAdmins(ctx, `Account deactivated: ${u.name}`, `${ctx.userName} deactivated the account of ${u.name}. Reason: ${reason}`, `/platform-admin/users/${userId}`);
}

export async function reactivateAccount(ctx: Ctx, userId: string, reasonRaw: string) {
  requirePlatform(ctx, "platform.accounts");
  const reason = requireReason(reasonRaw, "reactivating this account");
  const u = await targetUser(userId);
  if (!u.deactivatedAt) throw new ConflictError("This account is active");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { deactivatedAt: null } });
    await audit({ actorId: ctx.userId, action: "platform.account.reactivated", entityType: "User", entityId: userId, data: { userId, reason } }, tx);
  });
}

export const PLATFORM_ROLE_NAMES: Record<Exclude<PlatformRole, "NONE">, string> = {
  PLATFORM_ADMIN: "Platform administrator",
  REGULATORY_REVIEWER: "Regulatory reviewer",
  CONTENT_EDITOR: "Content editor",
};
const platformRoleSchema = z.array(z.enum(["PLATFORM_ADMIN", "REGULATORY_REVIEWER", "CONTENT_EDITOR"]));

/**
 * Grants or removes platform roles. Only platform administrators reach this; it needs their own password, keeps at
 * least one platform administrator, signs the person out when a role is removed, and alerts the other administrators.
 */
export async function setPlatformRoles(ctx: Ctx, userId: string, rolesRaw: string[], password: string, reasonRaw: string) {
  requirePlatform(ctx, "platform.accounts");
  const p = platformRoleSchema.safeParse([...new Set(rolesRaw)]);
  if (!p.success) throw new ValidationError("Choose platform roles from the list");
  const reason = requireReason(reasonRaw, "this platform role change");
  const u = await targetUser(userId);
  if (u.deactivatedAt) throw new ConflictError("Reactivate this account first");
  await confirmOwnPassword(ctx, password);
  const before = u.platformRoles.filter((r): r is Exclude<PlatformRole, "NONE"> => r !== "NONE");
  const after = p.data;
  if (before.slice().sort().join() === after.slice().sort().join()) throw new ConflictError("Nothing changed");
  if (before.includes("PLATFORM_ADMIN") && !after.includes("PLATFORM_ADMIN")) await assertPlatformAdminRemains(u.id);
  const removed = before.filter((r) => !after.includes(r));
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { platformRoles: after } });
    const s = removed.length ? await tx.session.deleteMany({ where: { userId } }) : { count: 0 };
    await audit({ actorId: ctx.userId, action: "platform.roles.changed", entityType: "User", entityId: userId, data: { userId, before, after, reason, sessionsEnded: s.count } }, tx);
  });
  await notifyPlatformAdmins(ctx, `Platform roles changed for ${u.name}`, `${ctx.userName} changed ${u.name}'s platform roles from ${before.join(", ") || "none"} to ${after.join(", ") || "none"}. Reason: ${reason}`, `/platform-admin/users/${userId}`);
}

// ── Memberships (one organisation at a time) ───────────────────────────

export async function updateMembershipAsPlatform(ctx: Ctx, organisationId: string, membershipId: string, input: MemberInput) {
  requirePlatform(ctx, "platform.accounts");
  await requireCustomerOrg(organisationId);
  const m = await memberOf(organisationId, membershipId);
  await updateMemberIn(organisationId, platform(ctx), membershipId, input);
  // Losing the organisation admin role ends the person's sessions in that organisation, so the change applies at once.
  if (m.roles.includes("ORG_ADMIN") && !input.roles.includes("ORG_ADMIN")) await db.session.deleteMany({ where: { userId: m.userId, activeOrgId: organisationId } });
}

export async function deactivateMembershipAsPlatform(ctx: Ctx, organisationId: string, membershipId: string, reason: string) {
  requirePlatform(ctx, "platform.accounts");
  await requireCustomerOrg(organisationId);
  return deactivateMemberIn(organisationId, platform(ctx), membershipId, reason);
}

export async function reactivateMembershipAsPlatform(ctx: Ctx, organisationId: string, membershipId: string) {
  requirePlatform(ctx, "platform.accounts");
  await requireCustomerOrg(organisationId);
  return reactivateMemberIn(organisationId, platform(ctx), membershipId);
}

export async function inviteAsPlatform(ctx: Ctx, organisationId: string, input: MemberInput & { email: string; name: string }) {
  requirePlatform(ctx, "platform.accounts");
  await requireCustomerOrg(organisationId);
  return inviteMemberIn(organisationId, platform(ctx), input);
}

/** Members and open invitations of one client (Client profile → Users & Permissions). */
export async function clientMembers(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.accounts");
  await requireCustomerOrg(organisationId);
  const [members, invites, branches] = await Promise.all([
    db.membership.findMany({ where: { organisationId }, orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { user: { name: "asc" } }], select: { id: true, roles: true, jobTitle: true, deactivatedAt: true, user: { select: { id: true, name: true, email: true, deactivatedAt: true, _count: { select: { memberships: true } } } }, branches: { select: { branchId: true } } } }),
    db.accountToken.findMany({ where: { organisationId, kind: "INVITE", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, roles: true, createdAt: true, expiresAt: true } }),
    db.branch.findMany({ where: { organisationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { members, invites, branches };
}

export async function revokeInviteAsPlatform(ctx: Ctx, organisationId: string, inviteId: string) {
  requirePlatform(ctx, "platform.accounts");
  const done = await db.accountToken.updateMany({ where: { id: inviteId, organisationId, kind: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!done.count) throw new NotFoundError("Invitation");
  await audit({ organisationId, actorId: ctx.userId, action: "platform.member.invite.revoked", entityType: "AccountToken", entityId: inviteId });
}

/** Every client's organisation administrators and open administrator invitations (Client Administrators). */
export async function clientAdministrators(ctx: Ctx) {
  requirePlatform(ctx, "platform.accounts");
  const [admins, invites] = await Promise.all([
    db.membership.findMany({ where: { roles: { has: "ORG_ADMIN" } }, orderBy: [{ organisation: { name: "asc" } }, { user: { name: "asc" } }], select: { id: true, deactivatedAt: true, jobTitle: true, organisation: { select: { id: true, name: true, customerAccount: { select: { reference: true } } } }, user: { select: { id: true, name: true, email: true, deactivatedAt: true, sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 } } } } }),
    db.accountToken.findMany({ where: { kind: "INVITE", roles: { has: "ORG_ADMIN" }, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, createdAt: true, expiresAt: true, organisation: { select: { id: true, name: true } } } }),
  ]);
  return { admins, invites };
}

/** Active sessions across the platform (Login Sessions). Addresses are masked. */
export async function listSessions(ctx: Ctx, f: { q?: string; page?: number } = {}) {
  requirePlatform(ctx, "platform.accounts");
  const q = f.q?.trim().slice(0, 100);
  const where: Prisma.SessionWhereInput = { expiresAt: { gt: new Date() }, ...(q ? { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}) };
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const [total, sessions] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({ where, orderBy: { lastSeenAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true, activeOrgId: true, user: { select: { id: true, name: true, email: true, platformRoles: true } } } }),
  ]);
  const orgIds = [...new Set(sessions.map((s) => s.activeOrgId).filter((x): x is string => !!x))];
  const orgs = new Map((await db.organisation.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  return { total, page, sessions: sessions.map((s) => ({ ...s, ip: maskIp(s.ip), userAgent: s.userAgent?.slice(0, 80) ?? null, organisation: s.activeOrgId ? (orgs.get(s.activeOrgId) ?? null) : null })) };
}

/** Platform staff (people with any platform role). */
export async function platformStaff(ctx: Ctx) {
  requirePlatform(ctx, "platform.accounts");
  const users = await db.user.findMany({ where: { platformRoles: { hasSome: ["PLATFORM_ADMIN", "REGULATORY_REVIEWER", "CONTENT_EDITOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, platformRoles: true, deactivatedAt: true } });
  return users.map((u) => ({ ...u, platformRoles: u.platformRoles.filter((r) => r !== "NONE") }));
}

export const ORG_ROLE_NAMES: Record<OrgRole, string> = {
  ORG_ADMIN: "Organisation admin",
  CARE_MANAGER: "Care manager",
  CARE_COORDINATOR: "Care coordinator",
  COMPLIANCE_LEAD: "Compliance lead",
  POLICY_AUTHOR: "Policy author",
  POLICY_REVIEWER: "Policy reviewer",
  POLICY_APPROVER: "Policy approver",
  FINANCE_OFFICER: "Finance officer",
  STAFF: "Staff",
  CARER: "Carer",
};
export { ORG_PERMISSIONS };
