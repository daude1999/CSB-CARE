"use server";

import { handle, str } from "./action-kit";
import { createAssessment, createImprovementAction, decideAssessment, recordResult, saveSnapshot, submitAssessment, updateAssessmentComment } from "@/server/cqc/assessments";
import { discoverEvidence, linkEvidence, proposeSuggestion, reviewEvidence } from "@/server/cqc/evidence";
import { activeFramework } from "@/server/cqc/framework";
import { addFinding, addRcaAction, addSource, addTimelineEntry, attachRcaEvidence, closeRca, createRca, effectivenessReview, EFFECTIVENESS_CHECKS, FACTOR_AREAS, linkRcaToCqc, managerReview, recordEscalation, removeTimelineEntry, reopenRca, saveConclusions, saveFactors, saveWhatHappened, startEffectivenessReview, submitForReview, type Factors } from "@/server/cqc/rca";

/**
 * Server actions for CQC Inspection & Evidence. Each reads FormData, calls one function in src/server/cqc (which checks
 * permissions, organisation and branch on the server) and redirects back with ?ok= or ?error=. Organisation and branch
 * come from the session, never from the form; ids on the form are re-checked against the caller's organisation.
 */
const num = (fd: FormData, k: string) => (str(fd, k) ? Number(str(fd, k)) : undefined);
const date = (fd: FormData, k: string) => new Date(`${str(fd, k)}T12:00:00Z`);

async function fileFrom(fd: FormData, key = "file") {
  const f = fd.get(key);
  if (!(f instanceof File) || f.size === 0) return null;
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

// ───────── assessments
export async function createAssessmentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const a = await createAssessment(ctx, { title: str(fd, "title") || undefined, branchId: str(fd, "branchId") || undefined, serviceTypeCode: str(fd, "serviceTypeCode") || undefined, periodFrom: str(fd, "periodFrom"), periodTo: str(fd, "periodTo"), nextDueAt: str(fd, "nextDueAt") || undefined, copyFromId: str(fd, "copyFromId") || undefined });
    return { to: `/compliance/cqc/assessments/${a.id}`, ok: `Assessment ${a.reference} started` };
  }, "Assessment started");
}

export async function recordResultAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await recordResult(ctx, str(fd, "assessmentId"), str(fd, "criterionId"), { result: str(fd, "result"), rationale: str(fd, "rationale"), findings: str(fd, "findings") || undefined, naReason: str(fd, "naReason") || undefined, expectedVersion: num(fd, "version") })), "Result saved; the change is kept in the history");
}

export async function assessmentCommentAction(fd: FormData) {
  return handle(fd, (ctx) => updateAssessmentComment(ctx, str(fd, "assessmentId"), { managementComment: str(fd, "managementComment"), nextDueAt: str(fd, "nextDueAt") || undefined }), "Comments saved");
}

export async function submitAssessmentAction(fd: FormData) {
  return handle(fd, (ctx) => submitAssessment(ctx, str(fd, "assessmentId"), num(fd, "lockVersion")), "Submitted for approval");
}

export async function decideAssessmentAction(fd: FormData) {
  const decision = str(fd, "decision") === "RETURN" ? "RETURN" : "APPROVE";
  return handle(fd, (ctx) => decideAssessment(ctx, str(fd, "assessmentId"), { decision, note: str(fd, "note"), expectedLock: num(fd, "lockVersion") }), decision === "APPROVE" ? "Assessment approved and a readiness snapshot saved" : "Assessment returned to the assessor");
}

export async function snapshotAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await saveSnapshot(ctx, str(fd, "assessmentId"), str(fd, "reason"))), "Readiness snapshot saved");
}

export async function improvementActionAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await createImprovementAction(ctx, str(fd, "assessmentId"), str(fd, "criterionId"), { title: str(fd, "title"), description: str(fd, "description") || undefined, ownerId: str(fd, "ownerId"), dueDate: date(fd, "dueDate"), priority: str(fd, "priority") || undefined, evidenceRequired: str(fd, "evidenceRequired") || undefined })), "Improvement action created and the owner told");
}

// ───────── evidence
export async function linkEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const [sourceType, sourceId] = str(fd, "source").split(":");
    await linkEvidence(ctx, { criterionId: str(fd, "criterionId"), sourceType: sourceType ?? "", sourceId: sourceId ?? "", note: str(fd, "note") || undefined });
  }, "Evidence linked. It counts once a reviewer verifies it.");
}

export async function reviewEvidenceAction(fd: FormData) {
  return handle(fd, (ctx) => reviewEvidence(ctx, str(fd, "linkId"), { to: str(fd, "to"), note: str(fd, "note") || undefined, expectedUpdatedAt: str(fd, "updatedAt") || undefined }), "Evidence decision recorded");
}

export async function proposeSuggestionAction(fd: FormData) {
  return handle(fd, (ctx) => proposeSuggestion(ctx, str(fd, "linkId")), "Sent for review");
}

export async function discoverEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const fw = await activeFramework();
    const r = await discoverEvidence(ctx, { frameworkId: fw.id, branchId: str(fd, "branchId") || null });
    return { ok: r.added ? `${r.added} possible piece${r.added === 1 ? "" : "s"} of evidence suggested. A reviewer decides whether each one counts.` : "No new suggestions found" };
  }, "Done");
}

// ───────── root cause analysis
export async function createRcaAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const sources = (["INCIDENT", "MISSED_CALL", "AUDIT_FINDING", "RISK"] as const).flatMap((type) => fd.getAll(type).filter((v): v is string => typeof v === "string" && v.length > 0).map((id) => ({ type, id })));
    const r = await createRca(ctx, { title: str(fd, "title"), category: str(fd, "category") as never, severity: str(fd, "severity") as never, eventDate: str(fd, "eventDate"), eventTime: str(fd, "eventTime") || undefined, dueDate: str(fd, "dueDate"), ownerId: str(fd, "ownerId"), managerId: str(fd, "managerId"), branchId: str(fd, "branchId") || undefined, serviceUserId: str(fd, "serviceUserId") || undefined, restricted: str(fd, "restricted") === "on", externalRef: str(fd, "externalRef") || undefined, sources });
    return { to: `/compliance/cqc/rca/${r.id}`, ok: `Investigation ${r.reference} opened` };
  }, "Investigation opened");
}

export async function whatHappenedAction(fd: FormData) {
  return handle(fd, (ctx) => saveWhatHappened(ctx, str(fd, "rcaId"), { summary: str(fd, "summary"), peopleInvolved: str(fd, "peopleInvolved") || undefined, immediateImpact: str(fd, "immediateImpact") || undefined, harm: str(fd, "harm") as never, immediateActions: str(fd, "immediateActions") || undefined, expectedLock: num(fd, "lockVersion") }), "Saved");
}

export async function timelineAction(fd: FormData) {
  return handle(fd, (ctx) => addTimelineEntry(ctx, str(fd, "rcaId"), { date: str(fd, "date"), time: str(fd, "time"), text: str(fd, "text"), kind: str(fd, "kind") }), "Timeline entry added");
}

export async function removeTimelineAction(fd: FormData) {
  return handle(fd, (ctx) => removeTimelineEntry(ctx, str(fd, "rcaId"), str(fd, "at"), str(fd, "text")), "Timeline entry removed; it is kept in the history");
}

export async function factorsAction(fd: FormData) {
  return handle(fd, (ctx) => {
    const factors: Factors = {};
    for (const k of Object.keys(FACTOR_AREAS) as (keyof typeof FACTOR_AREAS)[]) factors[k] = { relevant: str(fd, `f_${k}`) === "on", notes: str(fd, `n_${k}`) };
    return saveFactors(ctx, str(fd, "rcaId"), { factors, fiveWhys: [1, 2, 3, 4, 5].map((i) => str(fd, `why${i}`)), causeEffectNotes: str(fd, "causeEffectNotes") || undefined, expectedLock: num(fd, "lockVersion") });
  }, "Contributing factors saved");
}

export async function conclusionsAction(fd: FormData) {
  return handle(fd, (ctx) => saveConclusions(ctx, str(fd, "rcaId"), { immediateCause: str(fd, "immediateCause"), underlyingCauses: str(fd, "underlyingCauses"), uncertainties: str(fd, "uncertainties"), conclusions: str(fd, "conclusions"), expectedLock: num(fd, "lockVersion") }), "Findings saved");
}

export async function findingAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await addFinding(ctx, str(fd, "rcaId"), { kind: str(fd, "kind"), factorArea: str(fd, "factorArea") || undefined, text: str(fd, "text"), evidence: str(fd, "evidence") })), "Finding added. A manager confirms it at review.");
}

export async function escalationAction(fd: FormData) {
  return handle(fd, (ctx) => recordEscalation(ctx, str(fd, "rcaId"), { kind: str(fd, "kind"), decision: str(fd, "decision"), rationale: str(fd, "rationale"), externalRef: str(fd, "externalRef") || undefined, notifiedOn: str(fd, "notifiedOn") || undefined }), "Decision recorded");
}

export async function rcaSourceAction(fd: FormData) {
  return handle(fd, (ctx) => addSource(ctx, str(fd, "rcaId"), { type: str(fd, "type") as never, id: str(fd, "sourceId"), externalRef: str(fd, "externalRef") || undefined }), "Record linked");
}

export async function rcaActionAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await addRcaAction(ctx, str(fd, "rcaId"), { title: str(fd, "title"), description: str(fd, "description") || undefined, ownerId: str(fd, "ownerId"), dueDate: date(fd, "dueDate"), actionType: str(fd, "actionType"), priority: str(fd, "priority"), evidenceRequired: str(fd, "evidenceRequired"), findingId: str(fd, "findingId") || undefined })), "Action allocated and the owner told");
}

export async function rcaEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const file = await fileFrom(fd);
    if (!file) return { ok: "Choose a file to attach" };
    await attachRcaEvidence(ctx, str(fd, "rcaId"), file, str(fd, "description") || undefined);
  }, "File attached to the investigation");
}

export async function submitRcaAction(fd: FormData) {
  return handle(fd, (ctx) => submitForReview(ctx, str(fd, "rcaId"), num(fd, "lockVersion")), "Sent for management review");
}

export async function managerReviewAction(fd: FormData) {
  const decision = str(fd, "decision") === "MORE_INVESTIGATION" ? "MORE_INVESTIGATION" : "APPROVE";
  return handle(fd, (ctx) => managerReview(ctx, str(fd, "rcaId"), { decision, note: str(fd, "note"), confirmFindingIds: fd.getAll("confirm").filter((v): v is string => typeof v === "string"), expectedLock: num(fd, "lockVersion") }), decision === "APPROVE" ? "Findings and action plan approved" : "Sent back for more investigation");
}

export async function startEffectivenessAction(fd: FormData) {
  return handle(fd, (ctx) => startEffectivenessReview(ctx, str(fd, "rcaId")), "Effectiveness review is now due; the responsible manager has been told");
}

export async function effectivenessAction(fd: FormData) {
  return handle(fd, (ctx) => effectivenessReview(ctx, str(fd, "rcaId"), { decision: str(fd, "decision"), note: str(fd, "note"), checks: Object.fromEntries(Object.keys(EFFECTIVENESS_CHECKS).map((k) => [k, str(fd, k) === "on"])), expectedLock: num(fd, "lockVersion") }), "Effectiveness review recorded");
}

export async function closeRcaAction(fd: FormData) {
  return handle(fd, (ctx) => closeRca(ctx, str(fd, "rcaId"), { note: str(fd, "note"), exception: str(fd, "exception") === "on", exceptionReason: str(fd, "exceptionReason") || undefined, expectedLock: num(fd, "lockVersion") }), "Investigation closed. Linked incidents and risks were not changed.");
}

export async function reopenRcaAction(fd: FormData) {
  return handle(fd, (ctx) => reopenRca(ctx, str(fd, "rcaId"), str(fd, "reason")), "Investigation reopened; its history is kept");
}

export async function linkRcaCqcAction(fd: FormData) {
  return handle(fd, (ctx) => linkRcaToCqc(ctx, str(fd, "rcaId"), fd.getAll("criterionId").filter((v): v is string => typeof v === "string" && v.length > 0), str(fd, "note") || undefined), "Offered as CQC evidence. It counts once a reviewer verifies it.");
}
