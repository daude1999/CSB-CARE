import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/text";
import { verifyPassword } from "./password";
import type { Ctx } from "./rbac";
import { AppError } from "@/lib/errors";

export const SESSION_COOKIE = "evx_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function isRateLimited(key: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await db.loginAttempt.count({ where: { key, success: false, createdAt: { gte: since } } });
  return failures >= MAX_FAILED;
}

/** Validates credentials and creates a server-side session. Returns the raw token for the cookie. */
export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string } = {}) {
  const key = email.trim().toLowerCase();
  if (await isRateLimited(key)) throw new AppError("Too many failed attempts. Try again in 15 minutes.", "RATE_LIMITED", 429);
  const user = await db.user.findUnique({ where: { email: key }, include: { memberships: { where: { deactivatedAt: null } } } });
  const ok = user && !user.deactivatedAt ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, null);
  await db.loginAttempt.create({ data: { key, success: Boolean(ok) } });
  if (!user || !ok) throw new AppError("Invalid email or password", "INVALID_CREDENTIALS", 401);
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      activeOrgId: user.memberships[0]?.organisationId ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 200),
    },
  });
  await db.auditLog.create({ data: { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id } });
  return { token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export async function logout(token: string) {
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Resolves a session token to an authorisation context, or null if invalid/expired. */
export async function ctxFromToken(token: string | undefined | null): Promise<Ctx | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { memberships: { where: { deactivatedAt: null }, include: { branches: { select: { branchId: true } } } } } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.deactivatedAt) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  const membership =
    session.user.memberships.find((m) => m.organisationId === session.activeOrgId) ?? session.user.memberships[0];
  return {
    userId: session.user.id,
    userName: session.user.name,
    organisationId: membership?.organisationId ?? null,
    branchId: membership?.branchId ?? null,
    branchIds: membership?.branches.length ? membership.branches.map((b) => b.branchId) : null,
    orgRoles: membership?.roles ?? [],
    platformRoles: session.user.platformRoles.filter((r) => r !== "NONE"),
    hrUserId: membership?.hrUserId ?? null,
  };
}

export async function switchOrganisation(token: string, organisationId: string) {
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { memberships: { where: { deactivatedAt: null } } } } } });
  if (!session) throw new AppError("Not signed in", "UNAUTHENTICATED", 401);
  if (!session.user.memberships.some((m) => m.organisationId === organisationId))
    throw new AppError("You are not a member of that organisation", "FORBIDDEN", 403);
  await db.session.update({ where: { id: session.id }, data: { activeOrgId: organisationId } });
}

/** Builds a context directly for a user (used by workers and tests). */
export async function ctxForUser(userId: string, organisationId?: string | null): Promise<Ctx> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { where: { deactivatedAt: null }, include: { branches: { select: { branchId: true } } } } } });
  const m = organisationId === null ? undefined : user.memberships.find((x) => x.organisationId === organisationId) ?? (organisationId ? undefined : user.memberships[0]);
  if (organisationId && !m) throw new AppError("Not a member of organisation", "FORBIDDEN", 403);
  return {
    userId: user.id,
    userName: user.name,
    organisationId: m?.organisationId ?? null,
    branchId: m?.branchId ?? null,
    branchIds: m?.branches.length ? m.branches.map((b) => b.branchId) : null,
    orgRoles: m?.roles ?? [],
    platformRoles: user.platformRoles.filter((r) => r !== "NONE"),
    hrUserId: m?.hrUserId ?? null,
  };
}
