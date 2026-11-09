import { db } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { verifyPassword } from "@/server/auth/password";
import { requirePlatformPermission, type Ctx, type PlatformPermission } from "@/server/auth/rbac";

/**
 * Authorisation for the Evantix Platform Admin Centre. Every function in src/server/platform starts with
 * requirePlatform(), whatever the page or action that called it. Organisation administrators never pass: platform
 * permissions come only from User.platformRoles, which no organisation-level screen can change.
 */
export function requirePlatform(ctx: Ctx, perm: PlatformPermission = "platform.view") {
  requirePlatformPermission(ctx, perm);
}

/** A customer organisation the platform administrator names (route parameter or form field), checked to exist. */
export async function requireCustomerOrg(organisationId: string) {
  if (!organisationId || organisationId.length > 64) throw new NotFoundError("Client");
  const org = await db.organisation.findUnique({ where: { id: organisationId } });
  if (!org) throw new NotFoundError("Client");
  return org;
}

const REAUTH_WINDOW_MS = 15 * 60 * 1000;
const REAUTH_MAX_FAILED = 5;

/**
 * Re-authentication for sensitive security changes: the platform administrator types their own password again.
 * Five wrong attempts in 15 minutes block further attempts, like sign-in.
 */
export async function confirmOwnPassword(ctx: Ctx, password: string | undefined | null) {
  if (!password) throw new ValidationError("Enter your own password to confirm this change");
  const key = `reauth:${ctx.userId}`;
  const since = new Date(Date.now() - REAUTH_WINDOW_MS);
  if ((await db.loginAttempt.count({ where: { key, success: false, createdAt: { gte: since } } })) >= REAUTH_MAX_FAILED)
    throw new AppError("Too many wrong passwords. Try again in 15 minutes.", "RATE_LIMITED", 429);
  const me = await db.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
  const ok = await verifyPassword(password, me?.passwordHash ?? null);
  await db.loginAttempt.create({ data: { key, success: ok } });
  if (!ok) throw new ForbiddenError("That password is not correct. Nothing was changed.");
}

/** A reason is required for changes that affect a customer's access. */
export function requireReason(reason: string | undefined | null, what = "this change"): string {
  const r = (reason ?? "").trim();
  if (r.length < 5) throw new ValidationError(`Give a reason for ${what} (at least 5 characters)`);
  return r.slice(0, 500);
}
