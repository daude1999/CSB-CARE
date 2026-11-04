import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { caseScope, recordReason, requireOpen } from "../missed-calls";
import { rotaScope } from "../scope";

/**
 * The coordinator's decision on a suggestion. Accepting it records the reason through the normal investigation step,
 * with the coordinator's own findings, the same validation and the same optimistic lock; recording any reason there
 * also settles a pending suggestion (accepted if it matches, a different reason if not). Dismissing it changes nothing
 * on the case.
 */

async function pendingDraft(ctx: Ctx, caseId: string, draftId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const c = await db.missedCallCase.findFirst({ where: { ...caseScope(scope), id: caseId } });
  if (!c) throw new NotFoundError("Missed call");
  const d = await db.missedCallInvestigationDraft.findFirst({ where: { id: draftId, caseId: c.id, organisationId: c.organisationId } });
  if (!d) throw new NotFoundError("Suggestion");
  if (d.reviewStatus !== "PENDING") throw new ConflictError("This suggestion has already been dealt with or replaced by a newer one. Reload the page.");
  return { c, d };
}

const acceptSchema = z.object({ findings: z.string(), lockVersion: z.number().int().optional() });
export async function acceptSuggestion(ctx: Ctx, caseId: string, draftId: string, input: z.input<typeof acceptSchema>) {
  const p = acceptSchema.parse(input);
  const { d } = await pendingDraft(ctx, caseId, draftId);
  if (!d.suggestedReason) throw new ValidationError("There is no suggested reason to accept. Choose a reason yourself.");
  await recordReason(ctx, caseId, { reasonCode: d.suggestedReason, findings: p.findings, lockVersion: p.lockVersion });
}

export async function dismissSuggestion(ctx: Ctx, caseId: string, draftId: string, note: string) {
  if (note.trim().length < 5) throw new ValidationError("Say why the suggestion does not fit (at least 5 characters)");
  const { c, d } = await pendingDraft(ctx, caseId, draftId);
  requireOpen(c);
  await db.$transaction(async (tx) => {
    const r = await tx.missedCallInvestigationDraft.updateMany({ where: { id: d.id, reviewStatus: "PENDING" }, data: { reviewStatus: "DISMISSED", reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note.trim().slice(0, 1000) } });
    if (!r.count) throw new ConflictError("Someone else has just dealt with this suggestion. Reload the page.");
    await audit({ organisationId: c.organisationId, actorId: ctx.userId, action: "rota.missed.auto.suggestion_dismissed", entityType: "MissedCallCase", entityId: c.id, data: { draftId: d.id, suggestedReason: d.suggestedReason, note: note.trim() } }, tx);
  });
}
