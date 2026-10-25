import { db } from "@/lib/db";
import { enqueue } from "../jobs/queue";
import { emailProvider } from "./email";

export interface NotifyInput {
  organisationId?: string | null;
  userIds: string[];
  type: string;
  title: string;
  body: string;
  reason: string;
  links?: { label: string; url: string }[];
  actionUrl?: string;
  dueAt?: Date | null;
  /** Combined with the user id; repeated calls with the same key never create duplicates. */
  dedupeKey: string;
  email?: boolean;
}

export async function notify(input: NotifyInput): Promise<number> {
  const userIds = [...new Set(input.userIds)];
  let created = 0;
  for (const userId of userIds) {
    const key = `${input.dedupeKey}:${userId}`;
    const exists = await db.notification.findUnique({ where: { dedupeKey: key } });
    if (exists) continue;
    try {
      const n = await db.notification.create({
        data: {
          organisationId: input.organisationId ?? null,
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          reason: input.reason,
          links: input.links ?? [],
          actionUrl: input.actionUrl,
          dueAt: input.dueAt ?? null,
          dedupeKey: key,
          deliveries: input.email === false ? undefined : { create: { channel: "EMAIL" } },
        },
        include: { deliveries: true },
      });
      created++;
      for (const d of n.deliveries) await enqueue("notification.deliver", { deliveryId: d.id }, { idempotencyKey: `deliver:${d.id}`, maxAttempts: 5 });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  return created;
}

export async function usersWithOrgRoles(organisationId: string, roles: string[], branchId?: string | null) {
  const ms = await db.membership.findMany({
    where: { organisationId, roles: { hasSome: roles as never }, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
    select: { userId: true },
  });
  return ms.map((m) => m.userId);
}

export async function notifyPlatformAdmins(input: Omit<NotifyInput, "userIds" | "organisationId">, roles: string[] = ["PLATFORM_ADMIN"]) {
  const admins = await db.user.findMany({ where: { platformRoles: { hasSome: roles as never }, deactivatedAt: null }, select: { id: true } });
  return notify({ ...input, organisationId: null, userIds: admins.map((a) => a.id) });
}

/** Job handler: delivers one email; throws to trigger retry with backoff. */
export async function deliverNotification(deliveryId: string, attempt: number, maxAttempts: number) {
  const d = await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { notification: { include: { user: true } } } });
  if (d.status === "SENT") return { skipped: "already sent" };
  const n = d.notification;
  const links = (n.links as { label: string; url: string }[]).map((l) => `${l.label}: ${l.url.startsWith("/") ? `${process.env.APP_URL ?? ""}${l.url}` : l.url}`);
  const text = [n.body, "", `Why you are receiving this: ${n.reason}`, n.dueAt ? `Due: ${n.dueAt.toDateString()}` : "", ...links].filter((x) => x !== "").join("\n");
  try {
    const res = await emailProvider().send({ to: n.user.email, subject: `[Evantix Care] ${n.title}`, text });
    await db.notificationDelivery.update({ where: { id: d.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, providerMessageId: res.messageId, lastError: null } });
    return { sent: true };
  } catch (e) {
    await db.notificationDelivery.update({
      where: { id: d.id },
      data: { status: attempt >= maxAttempts ? "DEAD" : "FAILED", attempts: { increment: 1 }, lastError: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }
}
