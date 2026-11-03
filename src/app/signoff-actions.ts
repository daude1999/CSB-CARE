"use server";

import { handle, str } from "./action-kit";
import { bulkSignoff, correctAcknowledgement, createRule, exemptRow, recordAckAssessment, withdrawRule, type RuleInput } from "@/server/policies/assignment";

/** Server actions for Policy Sign-off. Each reads FormData, calls one function in src/server/policies/assignment and redirects back. */

const ids = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && x.length > 0);

export async function createRuleAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await createRule(ctx, {
      policyId: str(fd, "policyId"),
      scope: str(fd, "scope") as RuleInput["scope"],
      branchId: str(fd, "branchId") || undefined,
      orgRole: (str(fd, "orgRole") || undefined) as RuleInput["orgRole"],
      jobTitle: str(fd, "jobTitle") || undefined,
      staffMemberIds: ids(fd, "staffMemberIds"),
      mandatory: fd.get("mandatory") === "on",
      priority: Number(str(fd, "priority") || 2),
      dueDays: Number(str(fd, "dueDays") || 14),
      requiresAssessment: fd.get("requiresAssessment") === "on",
    });
    return { ok: `Assignment added; ${r.assigned} ${r.assigned === 1 ? "person" : "people"} asked to read the current version` };
  }, "Assignment added");
}

export async function withdrawRuleAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await withdrawRule(ctx, str(fd, "ruleId"), str(fd, "reason"));
    return { ok: `Assignment withdrawn; ${r.withdrawn} outstanding ${r.withdrawn === 1 ? "item" : "items"} withdrawn. Acknowledgements already given are kept.` };
  }, "Assignment withdrawn");
}

/** Send reminder, extend the due date or exempt, for the rows ticked in the Staff Sign-off register. */
export async function bulkSignoffAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const op = str(fd, "op");
    const rowIds = ids(fd, "ids");
    const r = op === "remind"
      ? await bulkSignoff(ctx, { op, ids: rowIds })
      : op === "extend"
        ? await bulkSignoff(ctx, { op, ids: rowIds, dueAt: new Date(str(fd, "dueAt")), reason: str(fd, "reason") })
        : await bulkSignoff(ctx, { op: "exempt", ids: rowIds, reason: str(fd, "reason") });
    const what = op === "remind" ? "Reminder sent to" : op === "extend" ? "New due date set for" : "Exemption recorded for";
    const skipped = r.skipped ? ` ${r.skipped} skipped: ${op === "remind" ? "already done, no sign-in to remind, or already reminded today" : "not outstanding or not yours to manage"}.` : "";
    return { ok: `${what} ${r.done} ${r.done === 1 ? "assignment" : "assignments"}.${skipped}` };
  }, "Done");
}

export async function exemptAckAction(fd: FormData) {
  return handle(fd, (ctx) => exemptRow(ctx, str(fd, "acknowledgementId"), str(fd, "reason")), "Exemption recorded");
}

export async function recordAckAssessmentAction(fd: FormData) {
  const passed = str(fd, "passed") === "true";
  return handle(fd, (ctx) => recordAckAssessment(ctx, str(fd, "acknowledgementId"), { method: str(fd, "method") as "DISCUSSION", score: str(fd, "score") ? Number(str(fd, "score")) : undefined, passMark: str(fd, "passMark") ? Number(str(fd, "passMark")) : undefined, passed, note: str(fd, "note") }), passed ? "Assessment recorded as passed" : "Assessment recorded as not passed");
}

export async function correctAckAction(fd: FormData) {
  return handle(fd, (ctx) => correctAcknowledgement(ctx, str(fd, "acknowledgementId"), str(fd, "reason")).then(() => undefined), "Correction recorded; the original is kept and the person has been asked to acknowledge again");
}
