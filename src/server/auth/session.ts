import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { withIdentityScope } from "@/server/tenancy/scope";
import { withDbRetry } from "@/lib/db-retry";
import { sha256 } from "@/lib/text";
import { verifyPassword } from "./password";
import type { Ctx } from "./rbac";
import { AppError } from "@/lib/errors";
import type { OrgRole } from "@prisma/client";

export const SESSION_COOKIE = "evx_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** However active a session is, it ends 7 days after sign-in and the person signs in again. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED = 5;
/** Failed sign-ins from one network address across any email addresses, so one address cannot try many accounts. */
const MAX_FAILED_PER_IP = 30;
const WINDOW_MS = 15 * 60 * 1000;

/** What a membership brings into the context: its branch grants, and the organisation's customer status and switched-off modules. */
const MEMBERSHIP_SCOPE = {
  branches: { select: { branchId: true } },
  organisation: { select: { customerAccount: { select: { status: true } }, moduleEntitlements: { where: { enabled: false }, select: { moduleKey: true } } } },
} as const;

type ScopedMembership = {
  organisationId: string;
  branchId: string | null;
  roles: OrgRole[];
  hrUserId: string | null;
  branches: { branchId: string }[];
  organisation: { customerAccount: { status: string } | null; moduleEntitlements: { moduleKey: string }[] };
};

/** The organisation part of a context. A suspended or closed customer keeps its records but grants no permission. */
function orgScope(m: ScopedMembership | undefined) {
  const status = m?.organisation.customerAccount?.status;
  const suspended = status === "SUSPENDED" || status === "CLOSED";
  const disabledModules = m?.organisation.moduleEntitlements.map((e) => e.moduleKey) ?? [];
  return {
    organisationId: m?.organisationId ?? null,
    branchId: m?.branchId ?? null,
    branchIds: m?.branches.length ? m.branches.map((b) => b.branchId) : null,
    orgRoles: m?.roles ?? [],
    hrUserId: suspended || disabledModules.includes("HR") ? null : (m?.hrUserId ?? null),
    suspended,
    disabledModules,
  };
}

export async function isRateLimited(key: string): Promise<boolean> {
  return withIdentityScope(async () => {
    const since = new Date(Date.now() - WINDOW_MS);
    const failures = await db.loginAttempt.count({ where: { key, success: false, createdAt: { gte: since } } });
    return failures >= MAX_FAILED;
  });
}

/** Validates credentials and creates a server-side session. Returns the raw token for the cookie. */
export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string } = {}) {
  return withIdentityScope(async () => {
    const key = email.trim().toLowerCase();
    const ip = meta.ip?.split(",")[0]?.trim();
    const ipKey = ip ? `ip:${ip.slice(0, 64)}` : null;
    if (await isRateLimited(key)) throw new AppError("Too many failed attempts. Try again in 15 minutes.", "RATE_LIMITED", 429);
    if (ipKey && (await db.loginAttempt.count({ where: { key: ipKey, success: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } })) >= MAX_FAILED_PER_IP)
      throw new AppError("Too many failed attempts. Try again in 15 minutes.", "RATE_LIMITED", 429);
    const user = await db.user.findUnique({ where: { email: key }, include: { memberships: { where: { deactivatedAt: null } } } });
    const ok = user && !user.deactivatedAt ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, null);
    await db.loginAttempt.create({ data: { key, success: Boolean(ok) } });
    if (ipKey && !ok) await db.loginAttempt.create({ data: { key: ipKey, success: false } });
    if (!user || !ok) throw new AppError("Invalid email or password", "INVALID_CREDENTIALS", 401);
    // Set by an Evantix platform administrator: the person must choose a new password with their one-time link first.
    if (user.passwordResetRequired) throw new AppError("Your password must be changed before you can sign in. Use the password reset link you were given, or ask your administrator for a new one.", "PASSWORD_RESET_REQUIRED", 403);
    const token = randomBytes(32).toString("base64url");
    // The start time comes from the same clock as the expiry checks, so the 7-day cap is measured consistently.
    const now = Date.now();
    await db.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        activeOrgId: user.memberships[0]?.organisationId ?? null,
        createdAt: new Date(now),
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + SESSION_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 200),
      },
    });
    await db.auditLog.create({ data: { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id } });
    // Evantix platform administrators start in the Admin Centre; everyone else starts in the care platform.
    const home = user.platformRoles.includes("PLATFORM_ADMIN") ? "/platform-admin" : "/overview";
    return { token, expiresAt: new Date(now + SESSION_TTL_MS), home };
  });
}

export async function logout(token: string) {
  return withIdentityScope(async () => {
    await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  });
}

/** Resolves a session token to an authorisation context, or null if invalid/expired. */
export async function ctxFromToken(token: string | undefined | null): Promise<Ctx | null> {
  return withIdentityScope(async () => {
    if (!token) return null;
    // The first query of nearly every request: a connection that cannot be opened yet (just after a deployment) is
    // retried briefly instead of failing the whole page.
    const session = await withDbRetry(() =>
      db.session.findUnique({
        where: { tokenHash: sha256(token) },
        include: { user: { include: { memberships: { where: { deactivatedAt: null }, include: MEMBERSHIP_SCOPE } } } },
      }),
    );
    const hardEnd = session ? session.createdAt.getTime() + SESSION_MAX_AGE_MS : 0;
    if (!session || session.expiresAt < new Date() || hardEnd <= Date.now() || session.user.deactivatedAt) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Math.min(Date.now() + SESSION_TTL_MS, hardEnd)) },
      });
    }
    const membership =
      session.user.memberships.find((m) => m.organisationId === session.activeOrgId) ?? session.user.memberships[0];
    return {
      userId: session.user.id,
      userName: session.user.name,
      ...orgScope(membership),
      platformRoles: session.user.platformRoles.filter((r) => r !== "NONE"),
    };
  });
}

export async function switchOrganisation(token: string, organisationId: string) {
  return withIdentityScope(async () => {
    const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { memberships: { where: { deactivatedAt: null } } } } } });
    if (!session) throw new AppError("Not signed in", "UNAUTHENTICATED", 401);
    if (!session.user.memberships.some((m) => m.organisationId === organisationId))
      throw new AppError("You are not a member of that organisation", "FORBIDDEN", 403);
    await db.session.update({ where: { id: session.id }, data: { activeOrgId: organisationId } });
  });
}

/** Builds a context directly for a user (used by workers and tests). */
export async function ctxForUser(userId: string, organisationId?: string | null): Promise<Ctx> {
  return withIdentityScope(async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { where: { deactivatedAt: null }, include: MEMBERSHIP_SCOPE } } });
    const m = organisationId === null ? undefined : user.memberships.find((x) => x.organisationId === organisationId) ?? (organisationId ? undefined : user.memberships[0]);
    if (organisationId && !m) throw new AppError("Not a member of organisation", "FORBIDDEN", 403);
    return {
      userId: user.id,
      userName: user.name,
      ...orgScope(m),
      platformRoles: user.platformRoles.filter((r) => r !== "NONE"),
    };
  });
}
