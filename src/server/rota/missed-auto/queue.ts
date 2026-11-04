import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueue } from "@/server/jobs/queue";

/**
 * Asking for an evidence run. Kept apart from the run itself (and its imports) so the attendance, correction and
 * detection code can call it without an import cycle. Every call is best-effort: a failure is logged and never undoes
 * or blocks the change that prompted it. Runs for the same case and reason within one minute share one job.
 */
export type RunReason = "DETECTED" | "CLOCK" | "CORRECTION" | "CARER_RESPONSE" | "ROTA_CHANGE" | "COVER" | "MANUAL" | "CATCH_UP";

export async function queueInvestigation(caseId: string, reason: RunReason, opts: { requestedById?: string; now?: Date; bucketMinutes?: number } = {}) {
  const now = opts.now ?? new Date();
  const bucket = Math.floor(now.getTime() / ((opts.bucketMinutes ?? 1) * 60000));
  const key = reason === "DETECTED" ? `missed-inv:${caseId}:DETECTED` : `missed-inv:${caseId}:${reason}:${opts.bucketMinutes ?? 1}:${bucket}`;
  try {
    const { job } = await enqueue("missed.investigate", { caseId, reason, requestedById: opts.requestedById ?? null }, { idempotencyKey: key, maxAttempts: 4 });
    return job.id;
  } catch (e) {
    logger.warn({ caseId, reason, err: (e as Error).message }, "missed-call evidence run could not be queued");
    return null;
  }
}

/** After a clock, correction or other change on a visit: refresh its missed-call evidence, if it has an open case. */
export async function queueRefreshForVisit(visitId: string, reason: RunReason) {
  try {
    const c = await db.missedCallCase.findUnique({ where: { visitId }, select: { id: true, stage: true, organisationId: true } });
    if (!c || c.stage === "CLOSED") return null;
    const s = await db.rotaSettings.findUnique({ where: { organisationId: c.organisationId }, select: { missedAutoEvidenceAt: true } });
    if (!s?.missedAutoEvidenceAt) return null;
    return queueInvestigation(c.id, reason);
  } catch (e) {
    logger.warn({ visitId, reason, err: (e as Error).message }, "missed-call evidence refresh could not be queued");
    return null;
  }
}
