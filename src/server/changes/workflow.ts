import type { ChangeStatus, Urgency } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, hasPlatformPermission, requirePlatformPermission, type Ctx } from "../auth/rbac";
import { identifyCandidates } from "../impact/candidates";
import { analyseChangeWithAi, assessPolicyImpact } from "../impact/assess";
import { enqueue } from "../jobs/queue";
import { notify, notifyPlatformAdmins, usersWithOrgRoles } from "../notifications/notify";

/** Job: identify candidate policies, run AI comparison, propose impact assessments, notify. */
export async function analyseChange(changeId: string) {
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });
  const candidates = await identifyCandidates(changeId);
  const refreshed = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });

  // Audit questions linked to affected requirements are flagged for review (never auto-edited).
  if (refreshed.affectedRequirementIds.length) {
    const questions = await db.auditQuestion.findMany({ where: { requirements: { some: { requirementId: { in: refreshed.affectedRequirementIds } } } }, select: { templateId: true } });
    const ids = [...new Set(questions.map((q) => q.templateId))];
    if (ids.length) {
      await db.auditTemplate.updateMany({ where: { id: { in: ids } }, data: { needsReview: true, reviewReason: `Linked requirement affected by regulatory change "${change.title}" (${change.id})` } });
    }
  }

  let aiError: string | null = null;
  try {
    await analyseChangeWithAi(changeId);
  } catch (e) {
    aiError = (e as Error).message;
    await db.changeStatusEvent.create({ data: { changeId, to: change.status, reason: `AI analysis failed: ${aiError}. Manual analysis required.` } });
  }

  if (change.classification !== "EDITORIAL") {
    const policyIds = [...new Set(candidates.map((c) => c.policyId))];
    for (const policyId of policyIds) {
      try {
        await assessPolicyImpact(changeId, policyId);
      } catch (e) {
        await db.changeStatusEvent.create({ data: { changeId, to: change.status, reason: `Impact assessment for policy ${policyId} failed: ${(e as Error).message}` } });
      }
    }
  }

  const label = change.isSimulated ? "[SIMULATED] " : "";
  await notifyPlatformAdmins(
    {
      type: "change.detected",
      title: `${label}Regulatory change detected: ${change.title}`,
      body: `${change.summary} Classification (rules): ${change.classification}. Suggested urgency: ${change.suggestedUrgency}.`,
      reason: "You triage regulatory changes for Evantix master content.",
      links: [{ label: "Review change", url: `/changes/${change.id}` }, { label: "Official source", url: change.canonicalUrl }],
      actionUrl: `/changes/${change.id}`,
      dedupeKey: `change-detected:${change.id}`,
    },
    ["REGULATORY_REVIEWER"],
  );
  const orgIds = [...new Set(candidates.map((c) => c.organisationId).filter((x): x is string => !!x))];
  for (const orgId of orgIds) {
    const n = candidates.filter((c) => c.organisationId === orgId).length;
    await notify({
      organisationId: orgId,
      userIds: await usersWithOrgRoles(orgId, ["COMPLIANCE_LEAD", "POLICY_REVIEWER"]),
      type: "policies.potentially_affected",
      title: `${label}${n} of your policies may be affected by a regulatory change`,
      body: `"${change.title}" changed. Evantix has flagged policies for assessment. Nothing has been changed in your policies.`,
      reason: "You review compliance impacts for your organisation.",
      links: [{ label: "View change and flagged policies", url: `/changes/${change.id}` }, { label: "Official source", url: change.canonicalUrl }],
      actionUrl: `/changes/${change.id}`,
      dedupeKey: `change-affects:${change.id}:${orgId}`,
    });
  }
  return { candidates: candidates.length, aiError };
}

export const TRIAGE: Partial<Record<ChangeStatus, ChangeStatus[]>> = {
  NEWLY_DETECTED: ["AWAITING_CLASSIFICATION", "UNDER_REVIEW"],
  AWAITING_CLASSIFICATION: ["POTENTIALLY_SUBSTANTIVE", "EDITORIAL_OR_IMMATERIAL", "UNDER_REVIEW"],
  POTENTIALLY_SUBSTANTIVE: ["UNDER_REVIEW", "EDITORIAL_OR_IMMATERIAL", "CONFIRMED_RELEVANT", "CONFIRMED_NOT_APPLICABLE"],
  EDITORIAL_OR_IMMATERIAL: ["UNDER_REVIEW", "POTENTIALLY_SUBSTANTIVE", "CLOSED"],
  UNDER_REVIEW: ["CONFIRMED_RELEVANT", "CONFIRMED_NOT_APPLICABLE", "EDITORIAL_OR_IMMATERIAL"],
  CONFIRMED_RELEVANT: ["UNDER_REVIEW", "IMPACT_ASSESSMENT_COMPLETED"],
  CONFIRMED_NOT_APPLICABLE: ["CLOSED", "UNDER_REVIEW"],
  IMPACT_ASSESSMENT_COMPLETED: ["POLICY_REVISION_REQUIRED", "NO_POLICY_REVISION_REQUIRED"],
  POLICY_REVISION_REQUIRED: ["CLOSED"],
  NO_POLICY_REVISION_REQUIRED: ["CLOSED"],
  CLOSED: ["UNDER_REVIEW"],
};

export const POST_CONFIRMATION: ChangeStatus[] = ["CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED", "NO_POLICY_REVISION_REQUIRED"];

/** Platform triage: confirm whether a change is substantive/relevant. Reviewers may amend AI/rule assessments with reasons. */
export async function triageChange(
  ctx: Ctx,
  changeId: string,
  input: { to: ChangeStatus; reason: string; urgency?: Urgency; affectedCategories?: string[]; affectedServiceTypes?: string[] },
) {
  requirePlatformPermission(ctx, "changes.triage");
  if (!input.reason?.trim()) throw new ValidationError("A reason is required for every review decision");
  const change = await db.regulatoryChange.findUnique({ where: { id: changeId } });
  if (!change) throw new NotFoundError("Change");
  if (input.to !== change.status && !TRIAGE[change.status]?.includes(input.to)) {
    throw new ConflictError(`Cannot move a change from ${change.status} to ${input.to}`);
  }
  const amendments: string[] = [];
  if (input.urgency && input.urgency !== change.suggestedUrgency) amendments.push(`urgency ${change.suggestedUrgency} → ${input.urgency}`);
  if (input.affectedCategories) amendments.push(`categories → ${input.affectedCategories.join(", ")}`);
  if (input.affectedServiceTypes) amendments.push(`service types → ${input.affectedServiceTypes.join(", ")}`);
  const updated = await db.regulatoryChange.update({
    where: { id: changeId },
    data: {
      status: input.to,
      reviewerId: ctx.userId,
      reviewNotes: input.reason,
      suggestedUrgency: input.urgency,
      affectedCategories: input.affectedCategories,
      affectedServiceTypes: input.affectedServiceTypes,
      classificationBasis: amendments.length || ["EDITORIAL_OR_IMMATERIAL", "POTENTIALLY_SUBSTANTIVE"].includes(input.to) ? "reviewer" : change.classificationBasis,
      events: { create: { from: change.status, to: input.to, actorId: ctx.userId, reason: [input.reason, amendments.length ? `Amended: ${amendments.join("; ")}` : ""].filter(Boolean).join(" | ") } },
    },
  });
  await audit({ actorId: ctx.userId, action: "change.triage", entityType: "RegulatoryChange", entityId: changeId, data: { from: change.status, to: input.to, reason: input.reason, amendments } });
  if (input.to === "CONFIRMED_RELEVANT") {
    const assessments = await db.impactAssessment.count({ where: { changeId } });
    if (!assessments) await enqueue("change.analyse", { changeId }, { idempotencyKey: `change.analyse:${changeId}:after-confirm` });
  }
  return updated;
}

function canReviewAssessment(ctx: Ctx, a: { organisationId: string | null }) {
  if (a.organisationId === null) return hasPlatformPermission(ctx, "master.review");
  return a.organisationId === ctx.organisationId && hasOrgPermission(ctx, "impact.review");
}

/**
 * Human decision on whether a policy requires revision. Requires the change to
 * have been confirmed relevant first (stages are never skipped).
 */
export async function reviewAssessment(
  ctx: Ctx,
  assessmentId: string,
  input: { decision: "REVISION_REQUIRED" | "NO_REVISION" | "DISMISS"; reason: string; affectedSectionKeys?: string[]; applicability?: "APPLIES" | "DOES_NOT_APPLY" | "UNCERTAIN" },
) {
  const a = await db.impactAssessment.findUnique({ where: { id: assessmentId }, include: { change: true } });
  if (!a) throw new NotFoundError("Impact assessment");
  if (!canReviewAssessment(ctx, a)) throw new ForbiddenError("You cannot review this impact assessment");
  if (!input.reason?.trim()) throw new ValidationError("A reason is required");
  if (!POST_CONFIRMATION.includes(a.change.status)) {
    throw new ConflictError(`The change must be confirmed relevant before deciding on policy revisions (current status: ${a.change.status})`);
  }
  if (a.status !== "PROPOSED") throw new ConflictError(`Assessment already ${a.status}`);
  const status = input.decision === "REVISION_REQUIRED" ? "CONFIRMED_REVISION_REQUIRED" : input.decision === "NO_REVISION" ? "CONFIRMED_NO_REVISION" : "DISMISSED";
  const updated = await db.impactAssessment.update({
    where: { id: assessmentId },
    data: {
      status,
      reviewerId: ctx.userId,
      reviewerReason: input.reason,
      reviewedAt: new Date(),
      affectedSectionKeys: input.affectedSectionKeys ?? undefined,
      applicability: input.applicability ?? undefined,
    },
  });
  await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "impact.review", entityType: "ImpactAssessment", entityId: a.id, data: { decision: input.decision, reason: input.reason } });
  await recomputeChangeStatus(a.changeId, ctx.userId);
  return updated;
}

/** Derives the change's aggregate status from its human-reviewed assessments. */
export async function recomputeChangeStatus(changeId: string, actorId?: string) {
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId }, include: { assessments: true } });
  if (!POST_CONFIRMATION.includes(change.status) || change.assessments.length === 0) return change.status;
  const masters = change.assessments.filter((a) => a.organisationId === null);
  const relevant = masters.length ? masters : change.assessments;
  const pending = relevant.some((a) => a.status === "PROPOSED");
  const anyRevision = change.assessments.some((a) => a.status === "CONFIRMED_REVISION_REQUIRED");
  let to: ChangeStatus = change.status;
  if (anyRevision) to = "POLICY_REVISION_REQUIRED";
  else if (!pending) to = "NO_POLICY_REVISION_REQUIRED";
  if (to !== change.status) {
    const events: { from: ChangeStatus; to: ChangeStatus; actorId?: string; reason: string }[] = [];
    let from = change.status;
    if (!pending && from === "CONFIRMED_RELEVANT") {
      events.push({ from, to: "IMPACT_ASSESSMENT_COMPLETED", actorId, reason: "All impact assessments reviewed" });
      from = "IMPACT_ASSESSMENT_COMPLETED";
    }
    events.push({ from, to, actorId, reason: anyRevision ? "At least one policy confirmed as requiring revision" : "All assessments concluded no revision is required" });
    await db.regulatoryChange.update({ where: { id: changeId }, data: { status: to, events: { create: events } } });
  }
  return to;
}
