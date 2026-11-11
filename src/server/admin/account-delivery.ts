import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit-log";
import { emailProvider } from "@/server/notifications/email";
import { invitationEmail, passwordResetEmail } from "@/server/notifications/account-emails";
import type { Actor } from "@/server/admin/users";

/**
 * Emails an invitation or password reset link to the person it was made for.
 *
 * The copy-link route always stays: the administrator is shown the one-time link whatever happens here, so a missing
 * email provider, a full limit or a failed send never leaves anyone locked out. This function only reports whether
 * the email went, and why not.
 *
 * - The address, name and organisation come from the stored token row, never from the form.
 * - Limits (per hour): 5 account emails to one address, 30 sent by one administrator. Over a limit nothing is sent.
 * - The link is not stored and not logged. The audit entry records that an email was sent, not its content.
 */
export const ACCOUNT_EMAIL_LIMITS = { perRecipientPerHour: 5, perSenderPerHour: 30 } as const;

export type Delivery = { emailed: true } | { emailed: false; why: "not-configured" | "limit" | "failed" };

const SENT = "account.email.sent";

export async function deliverAccountLink(o: { tokenId: string; token: string; origin: string; actor: Actor }): Promise<Delivery> {
  const provider = emailProvider();
  if (provider.name !== "smtp") return { emailed: false, why: "not-configured" };

  const row = await db.accountToken.findUnique({ where: { id: o.tokenId }, include: { organisation: { select: { name: true } } } });
  if (!row || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) return { emailed: false, why: "failed" };
  const kind = row.kind === "INVITE" ? "invite" : "reset";
  const base = { organisationId: row.organisationId, actorId: o.actor.userId, entityType: "AccountToken", entityId: row.id };

  const hourAgo = new Date(Date.now() - 3_600_000);
  const [toRecipient, bySender] = await Promise.all([
    db.auditLog.count({ where: { action: SENT, createdAt: { gte: hourAgo }, data: { path: ["recipient"], equals: row.email } } }),
    db.auditLog.count({ where: { action: SENT, createdAt: { gte: hourAgo }, actorId: o.actor.userId } }),
  ]);
  if (toRecipient >= ACCOUNT_EMAIL_LIMITS.perRecipientPerHour || bySender >= ACCOUNT_EMAIL_LIMITS.perSenderPerHour) {
    await audit({ ...base, action: "account.email.blocked", data: { kind, by: o.actor.level, reason: toRecipient >= ACCOUNT_EMAIL_LIMITS.perRecipientPerHour ? "recipient limit" : "sender limit" } });
    return { emailed: false, why: "limit" };
  }

  const origin = o.origin.replace(/\/$/, "");
  const link = `${origin}/account/${o.token}`;
  const message =
    row.kind === "INVITE"
      ? invitationEmail({ name: row.name ?? "colleague", organisation: row.organisation?.name ?? "the CSB platform", link, origin, expiresInDays: Math.max(1, Math.round((row.expiresAt.getTime() - Date.now()) / 86_400_000)) })
      : passwordResetEmail({ name: row.name ?? "colleague", link, origin, expiresInHours: Math.max(1, Math.round((row.expiresAt.getTime() - Date.now()) / 3_600_000)) });
  try {
    await provider.send({ to: row.email, ...message });
  } catch (e) {
    // The provider's own message only: never the address, the link or the body.
    logger.error({ kind, tokenId: row.id, errorName: e instanceof Error ? e.name : "unknown" }, "account email could not be sent");
    await audit({ ...base, action: "account.email.failed", data: { kind, by: o.actor.level } });
    return { emailed: false, why: "failed" };
  }
  await audit({ ...base, action: SENT, data: { kind, by: o.actor.level, recipient: row.email } });
  return { emailed: true };
}

/** What the administrator is told. The link is shown beneath in every case. */
export function deliveryMessage(kind: "invite" | "reset", d: Delivery, email?: string): string {
  const made = kind === "invite" ? "Invitation created" : "Password reset link created";
  if (d.emailed) return `${made} and emailed${email ? ` to ${email}` : ""}. You can also copy the link below.`;
  if (d.why === "limit") return `${made}. It was not emailed because the hourly email limit has been reached. Copy the link below.`;
  if (d.why === "failed") return `${made}. The email could not be sent. Copy the link below.`;
  return `${made}. Copy the link below.`;
}
