import type { OrgRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { sha256 } from "@/lib/text";
import { audit } from "@/server/audit-log";
import { hashPassword } from "@/server/auth/password";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";

/**
 * Administration of an organisation's members: invite, change roles and branches, deactivate and reactivate, and
 * password reset links. Nothing is emailed: an invite or reset produces a one-time link that the administrator
 * gives to the person themselves (it is shown once and stored only as a hash). Every change is audited.
 */

export const ROLE_LABEL: Record<OrgRole, string> = {
  ORG_ADMIN: "Organisation admin",
  POLICY_AUTHOR: "Policy author",
  POLICY_REVIEWER: "Policy reviewer",
  POLICY_APPROVER: "Policy approver",
  COMPLIANCE_LEAD: "Compliance lead",
  STAFF: "Staff",
  CARE_MANAGER: "Care manager",
  CARE_COORDINATOR: "Care coordinator",
  CARER: "Carer",
  FINANCE_OFFICER: "Finance officer",
};
const ROLES = Object.keys(ROLE_LABEL) as [OrgRole, ...OrgRole[]];
const INVITE_DAYS = 7;
const RESET_HOURS = 24;

const memberSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1, "Give at least one role"),
  branchIds: z.array(z.string().min(1)).default([]),
  jobTitle: z.string().trim().max(120).optional(),
});
/** Form input before validation: roles arrive as plain strings and are checked against the role list. */
type MemberInput = { roles: string[]; branchIds?: string[]; jobTitle?: string };
const inviteSchema = memberSchema.extend({
  email: z.string().trim().toLowerCase().email("Give a valid email address").max(200),
  name: z.string().trim().min(2, "Give the person's name").max(120),
});

async function checkBranches(organisationId: string, branchIds: string[]) {
  const ids = [...new Set(branchIds)];
  if (ids.length && (await db.branch.count({ where: { organisationId, id: { in: ids } } })) !== ids.length) throw new NotFoundError("Branch");
  return ids;
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

/** Members and open invitations of the organisation, for the Users page. */
export async function listMembers(ctx: Ctx, f: { q?: string; status?: string } = {}) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const q = f.q?.trim().slice(0, 100);
  const [members, invites, branches] = await Promise.all([
    db.membership.findMany({
      where: { organisationId, ...(f.status === "deactivated" ? { deactivatedAt: { not: null } } : f.status === "all" ? {} : { deactivatedAt: null }), ...(q ? { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}) },
      include: { user: { select: { id: true, name: true, email: true, deactivatedAt: true, passwordHash: true, sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 } } }, branches: { select: { branchId: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.accountToken.findMany({ where: { organisationId, kind: "INVITE", usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.branch.findMany({ where: { organisationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, roles: m.roles, jobTitle: m.jobTitle, branchIds: m.branches.map((b) => b.branchId), deactivatedAt: m.deactivatedAt, hasPassword: !!m.user.passwordHash, lastSeenAt: m.user.sessions[0]?.lastSeenAt ?? null })),
    invites,
    branches,
  };
}

/** Creates an invitation and returns the one-time link token. An existing user is added when they accept. */
export async function inviteMember(ctx: Ctx, input: MemberInput & { email: string; name: string }) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const p = inviteSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the invitation");
  const branchIds = await checkBranches(organisationId, p.data.branchIds);
  const existing = await db.user.findUnique({ where: { email: p.data.email }, include: { memberships: { where: { organisationId } } } });
  if (existing?.memberships.length) throw new ConflictError("This person is already a member. Change their roles instead.");
  const { token, tokenHash } = newToken();
  await db.$transaction(async (tx) => {
    await tx.accountToken.updateMany({ where: { organisationId, email: p.data.email, kind: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const row = await tx.accountToken.create({ data: { organisationId, kind: "INVITE", email: p.data.email, name: p.data.name, roles: p.data.roles, branchIds, jobTitle: p.data.jobTitle || null, tokenHash, createdById: ctx.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
    await audit({ organisationId, actorId: ctx.userId, action: "admin.member.invited", entityType: "AccountToken", entityId: row.id, data: { email: p.data.email, roles: p.data.roles, branches: branchIds.length } }, tx);
  });
  return { token, expiresInDays: INVITE_DAYS };
}

export async function revokeInvite(ctx: Ctx, inviteId: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const done = await db.accountToken.updateMany({ where: { id: inviteId, organisationId, kind: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!done.count) throw new NotFoundError("Invitation");
  await audit({ organisationId, actorId: ctx.userId, action: "admin.member.invite.revoked", entityType: "AccountToken", entityId: inviteId });
}

/** At least one active organisation admin must remain, so nobody can lock the organisation out of its own settings. */
async function assertAdminRemains(tx: Pick<typeof db, "membership">, organisationId: string, exceptMembershipId: string) {
  const others = await tx.membership.count({ where: { organisationId, id: { not: exceptMembershipId }, deactivatedAt: null, roles: { has: "ORG_ADMIN" }, user: { deactivatedAt: null } } });
  if (!others) throw new ConflictError("The organisation must keep at least one active admin");
}

async function memberOf(organisationId: string, membershipId: string) {
  const m = await db.membership.findFirst({ where: { id: membershipId, organisationId }, include: { branches: true } });
  if (!m) throw new NotFoundError("Member");
  return m;
}

/** Changes a member's roles, job title and branch grants. Their sessions keep working; scope applies on the next request. */
export async function updateMember(ctx: Ctx, membershipId: string, input: MemberInput) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const p = memberSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the roles");
  const m = await memberOf(organisationId, membershipId);
  if (m.deactivatedAt) throw new ConflictError("Reactivate this member first");
  const branchIds = await checkBranches(organisationId, p.data.branchIds);
  return db.$transaction(async (tx) => {
    if (m.roles.includes("ORG_ADMIN") && !p.data.roles.includes("ORG_ADMIN")) await assertAdminRemains(tx, organisationId, m.id);
    await tx.membership.update({ where: { id: m.id }, data: { roles: p.data.roles, jobTitle: p.data.jobTitle || null } });
    const before = m.branches.map((b) => b.branchId).sort();
    if (before.join() !== [...branchIds].sort().join()) {
      await tx.membershipBranch.deleteMany({ where: { membershipId: m.id } });
      if (branchIds.length) await tx.membershipBranch.createMany({ data: branchIds.map((branchId) => ({ membershipId: m.id, branchId, grantedById: ctx.userId })) });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "admin.member.updated", entityType: "Membership", entityId: m.id, data: { userId: m.userId, before: { roles: m.roles, branches: before }, after: { roles: p.data.roles, branches: branchIds } } }, tx);
  });
}

/**
 * Deactivates a member: their roles are cleared (so no list, alert or rota counts them), their sessions end, and they
 * can no longer use this organisation. Their records and history stay. Nobody deactivates themselves.
 */
export async function deactivateMember(ctx: Ctx, membershipId: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  if (reason.trim().length < 3) throw new ValidationError("Say why this member is being deactivated");
  const m = await memberOf(organisationId, membershipId);
  if (m.userId === ctx.userId) throw new ForbiddenError("You cannot deactivate yourself");
  if (m.deactivatedAt) throw new ConflictError("This member is already deactivated");
  return db.$transaction(async (tx) => {
    if (m.roles.includes("ORG_ADMIN")) await assertAdminRemains(tx, organisationId, m.id);
    await tx.membership.update({ where: { id: m.id }, data: { deactivatedAt: new Date(), rolesBeforeDeactivation: m.roles, roles: [] } });
    await tx.session.deleteMany({ where: { userId: m.userId, activeOrgId: organisationId } });
    await audit({ organisationId, actorId: ctx.userId, action: "admin.member.deactivated", entityType: "Membership", entityId: m.id, data: { userId: m.userId, roles: m.roles, reason: reason.trim() } }, tx);
  });
}

export async function reactivateMember(ctx: Ctx, membershipId: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const m = await memberOf(organisationId, membershipId);
  if (!m.deactivatedAt) throw new ConflictError("This member is active");
  const roles = m.rolesBeforeDeactivation.length ? m.rolesBeforeDeactivation : (["STAFF"] as OrgRole[]);
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { deactivatedAt: null, roles, rolesBeforeDeactivation: [] } });
    await audit({ organisationId, actorId: ctx.userId, action: "admin.member.reactivated", entityType: "Membership", entityId: m.id, data: { userId: m.userId, roles } }, tx);
  });
}

/** A one-time password reset link for a member. Their current sessions end when the new password is set. */
export async function createResetLink(ctx: Ctx, membershipId: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const m = await memberOf(organisationId, membershipId);
  if (m.deactivatedAt) throw new ConflictError("Reactivate this member first");
  const user = await db.user.findUniqueOrThrow({ where: { id: m.userId } });
  if (user.isDemo) throw new ForbiddenError("Demo accounts keep the shared demo password");
  // A member of other organisations too is reset by the platform team, so one organisation cannot take over another's user.
  if ((await db.membership.count({ where: { userId: m.userId } })) > 1) throw new ForbiddenError("This person belongs to more than one organisation; ask CSB support to reset their password");
  const { token, tokenHash } = newToken();
  await db.$transaction(async (tx) => {
    await tx.accountToken.updateMany({ where: { userId: m.userId, kind: "RESET", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const row = await tx.accountToken.create({ data: { organisationId, kind: "RESET", userId: m.userId, email: user.email, name: user.name, tokenHash, createdById: ctx.userId, expiresAt: new Date(Date.now() + RESET_HOURS * 3600_000) } });
    await audit({ organisationId, actorId: ctx.userId, action: "admin.member.reset_link", entityType: "AccountToken", entityId: row.id, data: { userId: m.userId } }, tx);
  });
  return { token, expiresInHours: RESET_HOURS };
}

/** What a one-time link is for, without using it. Expired, used or revoked links are not described. */
export async function describeToken(token: string) {
  const t = await db.accountToken.findUnique({ where: { tokenHash: sha256(token) }, include: { organisation: { select: { name: true } } } });
  if (!t || t.usedAt || t.revokedAt || t.expiresAt < new Date()) return null;
  return { kind: t.kind, email: t.email, name: t.name, organisation: t.organisation.name, needsName: t.kind === "INVITE" && !(await db.user.findUnique({ where: { email: t.email } })) };
}

const passwordSchema = z.string().min(12, "Use at least 12 characters").max(200);

/** Uses a one-time link: sets the password (new users) and joins the organisation, or resets the password. */
export async function redeemToken(token: string, input: { password: string; name?: string }) {
  const pw = passwordSchema.safeParse(input.password);
  if (!pw.success) throw new ValidationError(pw.error.issues[0]?.message ?? "Choose a longer password");
  const hash = await hashPassword(pw.data);
  return db.$transaction(async (tx) => {
    const t = await tx.accountToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!t || t.usedAt || t.revokedAt || t.expiresAt < new Date()) throw new ValidationError("This link has expired or has already been used. Ask your administrator for a new one.");
    const used = await tx.accountToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new ValidationError("This link has already been used");
    let userId: string;
    if (t.kind === "RESET") {
      if (!t.userId) throw new ValidationError("This link is not valid");
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash: hash } });
      await tx.session.deleteMany({ where: { userId: t.userId } });
      userId = t.userId;
    } else {
      const existing = await tx.user.findUnique({ where: { email: t.email } });
      if (existing?.deactivatedAt) throw new ForbiddenError("This account is closed. Ask CSB support.");
      // An existing account keeps its password: the invitation only adds the membership.
      const user = existing ?? (await tx.user.create({ data: { email: t.email, name: (input.name?.trim() || t.name || t.email).slice(0, 120), passwordHash: hash } }));
      if (await tx.membership.findFirst({ where: { userId: user.id, organisationId: t.organisationId } })) throw new ConflictError("You are already a member of this organisation");
      const m = await tx.membership.create({ data: { userId: user.id, organisationId: t.organisationId, roles: t.roles, jobTitle: t.jobTitle } });
      if (t.branchIds.length) await tx.membershipBranch.createMany({ data: t.branchIds.map((branchId) => ({ membershipId: m.id, branchId, grantedById: t.createdById })) });
      userId = user.id;
    }
    await audit({ organisationId: t.organisationId, actorId: userId, action: t.kind === "RESET" ? "auth.password.reset" : "admin.member.joined", entityType: "AccountToken", entityId: t.id }, tx);
    return { kind: t.kind, email: t.email };
  });
}

// ── Setting up a new organisation (command line only) ─────────────────────

const provisionSchema = z.object({
  name: z.string().trim().min(3, "Give the organisation's name").max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "The short name may use letters, numbers and hyphens").max(60),
  branches: z.array(z.string().trim().min(2).max(120)).min(1, "Give at least one branch"),
  adminEmail: z.string().trim().toLowerCase().email("Give a valid email address for the first admin").max(200),
  adminName: z.string().trim().min(2, "Give the first admin's name").max(120),
});

/**
 * Creates a real (non-demo) organisation with its branches and an invitation for its first admin, who becomes
 * organisation admin, compliance lead and care manager. Run from the command line by whoever installs the platform
 * (`npm run org:create`); there is no screen for it, because no one inside an organisation may create another.
 * Returns the one-time link token, which is shown once and stored only as a hash.
 */
export async function provisionOrganisation(input: z.input<typeof provisionSchema>) {
  const p = provisionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  const d = p.data;
  if (new Set(d.branches.map((b) => b.toLowerCase())).size !== d.branches.length) throw new ValidationError("Two branches have the same name");
  if (await db.organisation.findUnique({ where: { slug: d.slug } })) throw new ConflictError(`An organisation with the short name "${d.slug}" already exists`);
  const { token, tokenHash } = newToken();
  const org = await db.$transaction(async (tx) => {
    const o = await tx.organisation.create({ data: { name: d.name, slug: d.slug, isDemo: false } });
    for (const name of d.branches) await tx.branch.create({ data: { organisationId: o.id, name, services: { create: [{ serviceTypeCode: "DOMICILIARY" }] } } });
    const t = await tx.accountToken.create({ data: { organisationId: o.id, kind: "INVITE", email: d.adminEmail, name: d.adminName, roles: ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER"], tokenHash, createdById: "system", expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
    await audit({ organisationId: o.id, actorId: null, action: "admin.organisation.created", entityType: "Organisation", entityId: o.id, data: { branches: d.branches, firstAdmin: d.adminEmail, inviteId: t.id } }, tx);
    return o;
  });
  return { organisation: org, token };
}
