"use server";

import { handle, str } from "./action-kit";
import { addRestriction, clearReview, grantException, liftRestriction, raiseReview, recordAssessment, recordTraining, retireRequirement, revokeException, saveRequirement, verifyTraining, type RequirementInput } from "@/server/readiness";

/** Server actions for staff readiness. Each reads FormData, calls one function in src/server/readiness and redirects back. */

const ids = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && x.length > 0);
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const opt = (fd: FormData, k: string) => str(fd, k) || undefined;

/** The matrix form sends who a requirement applies to as several lists; each becomes one scope. */
function scopesFrom(fd: FormData): RequirementInput["scopes"] {
  const scopes: RequirementInput["scopes"] = [];
  if (bool(fd, "scopeAll")) scopes.push({ kind: "ALL" });
  const titles = new Set([...ids(fd, "jobTitles"), ...str(fd, "otherJobTitles").split(",").map((t) => t.trim()).filter(Boolean)]);
  for (const jobTitle of titles) scopes.push({ kind: "JOB_TITLE", jobTitle });
  for (const branchId of ids(fd, "branchIds")) scopes.push({ kind: "BRANCH", branchId });
  for (const careTaskId of ids(fd, "careTaskIds")) scopes.push({ kind: "CARE_TASK", careTaskId });
  for (const serviceUserId of ids(fd, "serviceUserIds")) scopes.push({ kind: "SERVICE_USER", serviceUserId });
  return scopes;
}

export async function saveRequirementAction(fd: FormData) {
  const id = str(fd, "requirementId") || undefined;
  return handle(fd, async (ctx) => {
    const months = str(fd, "renewalMonths");
    await saveRequirement(ctx, {
      id,
      key: str(fd, "key"),
      name: str(fd, "name"),
      description: opt(fd, "description"),
      category: str(fd, "category") as RequirementInput["category"],
      classification: (str(fd, "classification") || "MANDATORY_ROLE") as RequirementInput["classification"],
      sourceAuthority: opt(fd, "sourceAuthority"),
      sourceRef: opt(fd, "sourceRef"),
      sourceVersion: opt(fd, "sourceVersion"),
      requiresPractical: bool(fd, "requiresPractical"),
      renewalMonths: months ? Number(months) : null,
      warningDays: Number(str(fd, "warningDays") || 30),
      hardStop: bool(fd, "hardStop"),
      exceptionAllowed: bool(fd, "exceptionAllowed"),
      policyId: str(fd, "policyId") || null,
      effectiveFrom: str(fd, "effectiveFrom"),
      scopes: scopesFrom(fd),
    });
    return "/admin/readiness";
  }, id ? "New version saved; the previous version is retired and its evidence still counts" : "Requirement added");
}

export async function retireRequirementAction(fd: FormData) {
  return handle(fd, (ctx) => retireRequirement(ctx, str(fd, "requirementId"), str(fd, "reason")).then(() => undefined), "Requirement retired");
}

export async function recordTrainingAction(fd: FormData) {
  return handle(fd, (ctx) => recordTraining(ctx, str(fd, "staffId"), {
    requirementId: str(fd, "requirementId"),
    provider: opt(fd, "provider"),
    completedAt: str(fd, "completedAt"),
    expiresAt: opt(fd, "expiresAt"),
    result: opt(fd, "result"),
    evidenceNote: opt(fd, "evidenceNote"),
    assessor: opt(fd, "assessor"),
    supersedesId: opt(fd, "supersedesId"),
  }).then(() => undefined), "Training recorded. It counts once someone else verifies it");
}

export async function verifyTrainingAction(fd: FormData) {
  const decision = str(fd, "decision") === "REJECTED" ? "REJECTED" : "VERIFIED";
  return handle(fd, (ctx) => verifyTraining(ctx, str(fd, "recordId"), decision, str(fd, "note")).then(() => undefined), decision === "VERIFIED" ? "Evidence verified" : "Evidence rejected");
}

export async function recordAssessmentAction(fd: FormData) {
  return handle(fd, (ctx) => recordAssessment(ctx, str(fd, "staffId"), {
    requirementId: str(fd, "requirementId"),
    careTaskId: opt(fd, "careTaskId"),
    method: str(fd, "method"),
    observedEvidence: str(fd, "observedEvidence"),
    outcome: str(fd, "outcome"),
    restrictions: opt(fd, "restrictions"),
    remedialAction: opt(fd, "remedialAction"),
    assessedAt: str(fd, "assessedAt"),
    reviewDue: opt(fd, "reviewDue"),
    assessorRole: opt(fd, "assessorRole"),
  }).then(() => undefined), "Competency assessment recorded");
}

export async function addRestrictionAction(fd: FormData) {
  return handle(fd, (ctx) => addRestriction(ctx, str(fd, "staffId"), {
    kind: str(fd, "kind"),
    careTaskId: opt(fd, "careTaskId"),
    serviceUserId: opt(fd, "serviceUserId"),
    reason: str(fd, "reason"),
    startsAt: str(fd, "startsAt"),
    endsAt: opt(fd, "endsAt"),
  }).then(() => undefined), "Restriction added");
}

export async function liftRestrictionAction(fd: FormData) {
  return handle(fd, (ctx) => liftRestriction(ctx, str(fd, "restrictionId"), str(fd, "reason")).then(() => undefined), "Restriction lifted");
}

export async function grantExceptionAction(fd: FormData) {
  return handle(fd, (ctx) => grantException(ctx, str(fd, "staffId"), {
    requirementId: str(fd, "requirementId"),
    reason: str(fd, "reason"),
    compensatingControls: str(fd, "compensatingControls"),
    expiresAt: str(fd, "expiresAt"),
  }).then(() => undefined), "Exception granted");
}

export async function revokeExceptionAction(fd: FormData) {
  return handle(fd, (ctx) => revokeException(ctx, str(fd, "exceptionId"), str(fd, "reason")).then(() => undefined), "Exception revoked");
}

export async function raiseReviewAction(fd: FormData) {
  return handle(fd, (ctx) => raiseReview(ctx, str(fd, "staffId"), str(fd, "reason")).then(() => undefined), "Review raised");
}

export async function clearReviewAction(fd: FormData) {
  return handle(fd, (ctx) => clearReview(ctx, str(fd, "flagId"), str(fd, "outcome")).then(() => undefined), "Review cleared");
}
