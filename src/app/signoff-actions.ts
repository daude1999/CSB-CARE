"use server";

import { handle, str } from "./action-kit";
import { correctAcknowledgement, createRule, exemptRow, recordAckAssessment, withdrawRule, type RuleInput } from "@/server/policies/assignment";

/** Server actions for Staff Sign-off. Each reads FormData, calls one function in src/server/policies/assignment and redirects back. */

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
