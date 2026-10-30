import { outstandingAckWhere } from "@/server/policies/assignment";
import { db } from "@/lib/db";
import type { Ctx } from "../auth/rbac";
import { freshness } from "../sources/engine";

/** All dashboard figures are computed from the database at request time. */
export async function dashboardMetrics(ctx: Ctx) {
  const orgId = ctx.organisationId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sources = await db.regulatorySource.findMany({ where: { active: true, isSimulated: false } });
  const fresh = sources.filter((s) => freshness(s, now).state === "fresh").length;
  const failing = sources.filter((s) => s.retrievalStatus === "FAILING" || s.retrievalStatus === "DEGRADED").length;
  const stale = sources.filter((s) => ["stale", "never"].includes(freshness(s, now).state)).length;
  const manual = sources.filter((s) => s.coverage === "MANUAL_REVIEW_ONLY").length;
  const orgScope = orgId ? { organisationId: orgId } : { organisationId: null };
  const [newChanges, awaitingAssessment, policiesAwaitingRevision, draftsAwaitingApproval, publishedThisMonth, overdueReviews, outstandingAcks, overdueAcks, overdueActions] = await Promise.all([
    db.regulatoryChange.count({ where: { status: { in: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE"] } } }),
    db.impactAssessment.count({ where: { status: "PROPOSED", ...orgScope } }),
    db.impactAssessment.count({ where: { status: "CONFIRMED_REVISION_REQUIRED", ...orgScope, revisions: { none: {} } } }),
    db.policyRevision.count({ where: { ...orgScope, closedAt: null, draftVersion: { status: "UNDER_REVIEW" } } }),
    db.policyPublication.count({ where: { ...orgScope, status: "PUBLISHED", publishedAt: { gte: monthStart } } }),
    db.policy.count({ where: { ...orgScope, status: "ACTIVE", nextReviewDate: { lt: now } } }),
    orgId ? db.acknowledgement.count({ where: { organisationId: orgId, ...outstandingAckWhere } }) : 0,
    orgId ? db.acknowledgement.count({ where: { organisationId: orgId, ...outstandingAckWhere, dueAt: { lt: now } } }) : 0,
    orgId ? db.complianceAction.count({ where: { organisationId: orgId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now } } }) : 0,
  ]);
  return {
    sources: { total: sources.length, fresh, failing, stale, manual },
    newChanges,
    awaitingAssessment,
    policiesAwaitingRevision,
    draftsAwaitingApproval,
    publishedThisMonth,
    overdueReviews,
    outstandingAcks,
    overdueAcks,
    overdueActions,
  };
}
