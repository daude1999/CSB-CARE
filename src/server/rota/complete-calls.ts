import type { Prisma, Visit, VisitStatus } from "@prisma/client";
import { ConflictError, ValidationError } from "@/lib/errors";
import { londonDate, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { lockVisit } from "./assign";
import { effectiveClocks } from "./attendance";
import type { Scope } from "./scope";

type Tx = Prisma.TransactionClient;

/**
 * Complete Calls: the office confirms, after the event, that the care on a visit was delivered (for example a carer
 * whose phone failed, confirmed by the carer and the family). It is a record correction, not attendance evidence:
 * no clock-in, clock-out, MAR or other record is created, the visit is marked as completed by the office so it is
 * never mistaken for a clocked visit, and the original status stays in the visit's history.
 */

/** Statuses the office may confirm as delivered. Cancelled and not-delivered visits need a separate, authorised correction. */
export const COMPLETABLE: readonly VisitStatus[] = ["SCHEDULED", "IN_PROGRESS", "MISSED"];

export interface CompleteInput {
  reason: string;
  verifiedBy: string;
  /** The coordinator ticked "I confirm the care on these visits was delivered". */
  confirmed: boolean;
  /** Actual times the office genuinely knows, as HH:MM on the visit's own day. Left empty when not known. */
  actualStart?: string;
  actualEnd?: string;
  /** The visit version shown on the review screen; a visit changed since then is refused for a fresh review. */
  lockVersion?: number;
}

export function checkCompleteInput(i: Pick<CompleteInput, "reason" | "verifiedBy" | "confirmed">, opts: { preview?: boolean } = {}) {
  if (i.reason.trim().length < 3) throw new ValidationError("Give the reason for completing these visits (at least 3 letters)");
  if (i.reason.trim().length > 500) throw new ValidationError("Keep the reason under 500 characters");
  if (i.verifiedBy.trim().length < 3) throw new ValidationError("Say who confirmed the care was delivered");
  if (i.verifiedBy.trim().length > 200) throw new ValidationError("Keep who confirmed it under 200 characters");
  if (!opts.preview && !i.confirmed) throw new ValidationError("Tick to confirm the care on these visits was delivered");
}

function actualAt(v: Visit, hhmm: string | undefined, label: string): Date | null {
  if (!hhmm) return null;
  const m = parseHhmm(hhmm);
  if (m === null) throw new ValidationError(`${label} is not a time`);
  const at = londonToUtc(londonDate(v.scheduledStart), m);
  if (at.getTime() > Date.now() + 60_000) throw new ValidationError(`${label} ${hhmm} is in the future`);
  if (Math.abs(at.getTime() - v.scheduledStart.getTime()) > 12 * 3600_000) throw new ValidationError(`${label} ${hhmm} is more than 12 hours from the planned start`);
  return at;
}

/**
 * Completes one visit on the office's confirmation. Returns false (and changes nothing) when the visit is already
 * completed; throws a plain-language refusal when it cannot be completed this way. Warnings are things the coordinator
 * should know but that do not stop the completion (for example only one of two carers was booked).
 */
export async function completeVisitInTx(tx: Tx, scope: Scope, actorId: string, visitId: string, input: CompleteInput, opts: { preview?: boolean } = {}): Promise<{ changed: boolean; message?: string; warnings: string[] }> {
  checkCompleteInput(input, opts);
  const v = await lockVisit(tx, scope, visitId);
  if (v.status === "COMPLETED") return { changed: false, message: v.completionSource === "OFFICE_CONFIRMED" ? "Already completed by the office" : "Already completed (clocked)", warnings: [] };
  if (input.lockVersion !== undefined && input.lockVersion !== v.lockVersion) throw new ConflictError("This visit changed after you reviewed it. Review it again.");
  if (v.status === "CANCELLED") throw new ValidationError("Cancelled visits are not completed here. If the care went ahead, a care manager must correct the cancellation first.");
  if (v.status === "NOT_DELIVERED") throw new ValidationError("This visit was recorded as not delivered. If that was wrong, a care manager must correct it first.");
  if (!COMPLETABLE.includes(v.status)) throw new ValidationError(`A ${v.status.toLowerCase()} visit cannot be completed`);
  if (v.scheduledStart.getTime() > Date.now()) throw new ValidationError("This visit has not started yet, so it cannot be completed");

  const booked = await tx.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null }, select: { staffId: true, slot: true } });
  const carers = booked.filter((a) => a.slot !== "SHADOW");
  if (!carers.length) throw new ValidationError("Nobody is booked on this visit. Book the carer who delivered it, then complete it.");

  const clocks = effectiveClocks(await tx.visitClock.findMany({ where: { visitId: v.id }, select: { id: true, supersedesId: true, kind: true, at: true } }));
  const clockIn = clocks.filter((c) => c.kind === "IN").sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const enteredStart = actualAt(v, input.actualStart, "Actual start");
  const enteredEnd = actualAt(v, input.actualEnd, "Actual end");
  if (enteredStart && enteredEnd && enteredEnd <= enteredStart) throw new ValidationError("The actual end must be after the actual start");
  const actualStart = enteredStart ?? clockIn?.at ?? v.actualStart ?? null;
  if (actualStart && enteredEnd && enteredEnd <= actualStart) throw new ValidationError(`The actual end must be after the start (${londonTime(actualStart)})`);

  const warnings: string[] = [];
  if (carers.length < v.carersRequired) warnings.push(`Only ${carers.length} of ${v.carersRequired} carers were booked`);
  if (v.status === "MISSED") warnings.push("Recorded as missed: the missed-call record and its investigation are kept");
  if (v.medicationRequired) warnings.push("Medication support: no medicine record is created. Record any medicines given in the MAR");
  if (!clockIn) warnings.push("No clock-in or clock-out is recorded. It will show as completed by the office");
  if (opts.preview) return { changed: true, warnings };

  const now = new Date();
  const data = {
    statusChangedAt: now,
    actualStart,
    actualEnd: enteredEnd,
    completionSource: "OFFICE_CONFIRMED" as const,
    completionReason: input.reason.trim(),
    completionVerifiedBy: input.verifiedBy.trim(),
    completedById: actorId,
    completedAt: now,
    completedFromStatus: v.status,
  };
  // The database's state machine allows Scheduled → In progress → Completed and Missed → Completed, so a scheduled
  // visit takes both steps in this transaction. Nothing else about the visit changes.
  if (v.status === "SCHEDULED") await tx.visit.update({ where: { id: v.id }, data: { status: "IN_PROGRESS", statusChangedAt: now } });
  await tx.visit.update({ where: { id: v.id }, data: { status: "COMPLETED", ...data, lockVersion: { increment: 1 } } });
  await tx.visitEvent.create({
    data: {
      organisationId: scope.organisationId, visitId: v.id, type: "STATUS", fromStatus: v.status, toStatus: "COMPLETED", actorId, reason: input.reason.trim(),
      data: { source: "office.complete", verifiedBy: input.verifiedBy.trim(), actualStart: actualStart?.toISOString() ?? null, actualEnd: enteredEnd?.toISOString() ?? null, actualTimesEntered: !!(enteredStart || enteredEnd), clockedIn: !!clockIn, carersBooked: carers.length, carersRequired: v.carersRequired },
    },
  });
  // The late alert is answered; a missed alert stays with its missed-call investigation, which a manager still signs off.
  await tx.rotaAlert.updateMany({ where: { organisationId: scope.organisationId, visitId: v.id, kind: "LATE", resolvedAt: null }, data: { resolvedAt: now, resolvedById: actorId, resolution: "The office confirmed the care was delivered" } });
  const missedCase = v.status === "MISSED" ? await tx.missedCallCase.findUnique({ where: { visitId: v.id }, select: { id: true } }) : null;
  if (missedCase) {
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: missedCase.id, authorId: actorId, kind: "SYSTEM", body: `The office confirmed the care was delivered and marked the visit completed (confirmed by ${input.verifiedBy.trim()}): ${input.reason.trim()}. The missed-call record is kept. Record the outcome and sign-off as usual.` } });
  }
  await audit({ organisationId: scope.organisationId, actorId, action: "visit.completed.office", entityType: "Visit", entityId: v.id, data: { before: { status: v.status, actualStart: v.actualStart, actualEnd: v.actualEnd }, after: { status: "COMPLETED", actualStart, actualEnd: enteredEnd }, reason: input.reason.trim(), verifiedBy: input.verifiedBy.trim() } }, tx);
  return { changed: true, warnings };
}
