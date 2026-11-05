import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { canOnPolicy, type Ctx } from "@/server/auth/rbac";

/**
 * A person's own markers on a policy, set from the Policy Reader's "Policy Actions" panel.
 *
 * IMPORTANT pins a policy for the person; READING_LIST saves it to read later and shows it on My Reading List. Both
 * are private to the person who set them. Neither is an assignment or an acknowledgement: assigning stays with the
 * Staff Sign-off rules and signing stays with Read & Sign, so a bookmark never changes compliance figures.
 */
export const BOOKMARK_KINDS = ["IMPORTANT", "READING_LIST"] as const;
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number];
export const BookmarkKindSchema = z.enum(BOOKMARK_KINDS);

/** Which of the signed-in person's markers are set on a policy. */
export async function bookmarksFor(ctx: Ctx, policyId: string): Promise<Record<BookmarkKind, boolean>> {
  const rows = ctx.organisationId ? await db.policyBookmark.findMany({ where: { organisationId: ctx.organisationId, userId: ctx.userId, policyId }, select: { kind: true } }) : [];
  const set = new Set(rows.map((r) => r.kind));
  return { IMPORTANT: set.has("IMPORTANT"), READING_LIST: set.has("READING_LIST") };
}

/**
 * Turns a marker on or off for the signed-in person. The policy must be one they can read in their organisation
 * (CSB templates included). Returns the new state.
 */
export async function toggleBookmark(ctx: Ctx, policyId: string, kind: BookmarkKind): Promise<boolean> {
  if (!ctx.organisationId) throw new ForbiddenError("Bookmarks are kept per organisation. Choose an organisation first.");
  const policy = await db.policy.findUnique({ where: { id: policyId }, select: { id: true, kind: true, organisationId: true, ref: true } });
  if (!policy || !canOnPolicy(ctx, policy, "read")) throw new NotFoundError("Policy");
  const where = { userId: ctx.userId, policyId, kind };
  return db.$transaction(async (tx) => {
    const existing = await tx.policyBookmark.findUnique({ where: { userId_policyId_kind: where } });
    if (existing) await tx.policyBookmark.delete({ where: { id: existing.id } });
    else await tx.policyBookmark.create({ data: { ...where, organisationId: ctx.organisationId! } });
    await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: existing ? "policy.bookmark.removed" : "policy.bookmark.added", entityType: "Policy", entityId: policyId, data: { kind, ref: policy.ref } }, tx);
    return !existing;
  });
}

/** The policies the signed-in person saved to read later, newest first. Only policies they can still read are listed. */
export async function savedReading(ctx: Ctx) {
  if (!ctx.organisationId) return [];
  const rows = await db.policyBookmark.findMany({ where: { organisationId: ctx.organisationId, userId: ctx.userId, kind: "READING_LIST" }, orderBy: { createdAt: "desc" } });
  if (!rows.length) return [];
  const policies = await db.policy.findMany({
    where: { id: { in: rows.map((r) => r.policyId) }, status: "ACTIVE" },
    select: { id: true, ref: true, title: true, kind: true, organisationId: true, category: { select: { name: true } }, currentPublishedVersion: { select: { label: true } } },
  });
  const byId = new Map(policies.filter((p) => canOnPolicy(ctx, p, "read")).map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const p = byId.get(r.policyId);
    return p ? [{ ...p, savedAt: r.createdAt }] : [];
  });
}
