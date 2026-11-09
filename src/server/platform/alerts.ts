import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import { getSetting } from "./settings";

/**
 * In-app notifications (the bell) for platform security events and support access. Nothing is emailed or sent
 * outside the platform. Bodies never include passwords, links or care content.
 */
export async function notifyPlatformAdmins(ctx: Ctx, title: string, body: string, actionUrl: string) {
  if (!(await getSetting("notifications.securityAlerts"))) return 0;
  const admins = await db.user.findMany({ where: { platformRoles: { has: "PLATFORM_ADMIN" }, deactivatedAt: null, id: { not: ctx.userId } }, select: { id: true } });
  if (!admins.length) return 0;
  const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  await db.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, type: "PLATFORM_SECURITY", title: title.slice(0, 200), body: body.slice(0, 1000), reason: "You are an Evantix platform administrator and security alerts are switched on in Platform Settings.", actionUrl, dedupeKey: `platform-security:${stamp}:${a.id}` })),
    skipDuplicates: true,
  });
  return admins.length;
}

/** Tells a customer's active organisation administrators about support access to their organisation. */
export async function notifyOrgAdmins(organisationId: string, title: string, body: string, actionUrl: string, key: string) {
  const admins = await db.membership.findMany({ where: { organisationId, deactivatedAt: null, roles: { has: "ORG_ADMIN" }, user: { deactivatedAt: null } }, select: { userId: true } });
  if (!admins.length) return 0;
  await db.notification.createMany({
    data: admins.map((a) => ({ organisationId, userId: a.userId, type: "SUPPORT_ACCESS", title: title.slice(0, 200), body: body.slice(0, 1000), reason: "You are an administrator of this organisation.", actionUrl, dedupeKey: `${key}:${a.userId}` })),
    skipDuplicates: true,
  });
  return admins.length;
}
