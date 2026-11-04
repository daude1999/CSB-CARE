import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "../auth/rbac";
import { outstandingAckWhere, signoffRows } from "../policies/assignment";
import { auditBranchWhere } from "./audits";
import { riskBranchWhere } from "./risks";

/**
 * The count beside each Policy & Compliance workspace tab. Every number is counted at request time from the caller's
 * own organisation (and branches, where the tab's page limits them), and only for tabs the caller can open, so a tab
 * never shows a figure its page would not. A tab with nothing to count has no entry and shows no pill.
 */
export type WorkspaceId = "library" | "regulatory" | "signoff" | "improvements";

const DAY = 86_400_000;
const OPEN_CHANGE = ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW", "CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED"] as const;

export async function workspaceCounts(ctx: Ctx, ws: WorkspaceId, now = new Date()): Promise<Record<string, number>> {
  const orgId = ctx.organisationId;
  switch (ws) {
    case "library": {
      const own: Prisma.PolicyWhereInput = orgId ? { organisationId: orgId, kind: "CUSTOMER" } : { id: { in: [] } };
      const canQueue = hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author");
      const [policies, templates, archived, calendar, queue] = await Promise.all([
        db.policy.count({ where: { ...own, status: "ACTIVE" } }),
        db.policy.count({ where: { kind: "MASTER", organisationId: null, status: "ACTIVE" } }),
        db.policy.count({ where: { ...own, status: "ARCHIVED" } }),
        // The review calendar's figure is what needs a review soon: overdue or due within the library's 60-day window.
        db.policy.count({ where: { ...own, status: "ACTIVE", nextReviewDate: { lt: new Date(now.getTime() + 60 * DAY) } } }),
        canQueue ? db.policyRevision.count({ where: { organisationId: orgId ?? null, closedAt: null, draftVersion: { status: "UNDER_REVIEW" } } }) : Promise.resolve(0),
      ]);
      return { policies, templates, archived, calendar, ...(canQueue ? { queue } : {}) };
    }
    case "regulatory": {
      const [updates, requirements, sources] = await Promise.all([
        db.regulatoryChange.count({ where: { status: { in: [...OPEN_CHANGE] } } }),
        db.regulatoryRequirement.count(),
        db.regulatorySource.count(),
      ]);
      return { updates, requirements, sources };
    }
    case "signoff": {
      if (!orgId) return {};
      const reading = await db.acknowledgement.count({ where: { organisationId: orgId, userId: ctx.userId, ...outstandingAckWhere, publication: { status: "PUBLISHED" } } });
      if (!hasOrgPermission(ctx, "staff.view")) return { reading };
      const [rows, rules] = await Promise.all([
        signoffRows(ctx),
        db.policyAssignmentRule.count({ where: { organisationId: orgId, withdrawnAt: null } }),
      ]);
      const live = rows.filter((r) => r.b.bucket !== "withdrawn");
      return {
        overview: live.length,
        people: new Set(live.map((r) => r.staffMemberId ?? r.userId ?? r.id)).size,
        policies: new Set(live.map((r) => r.publication.policyId)).size,
        overdue: live.filter((r) => r.b.overdue).length,
        rules,
        reading,
      };
    }
    case "improvements": {
      if (!orgId) return {};
      const canActions = hasOrgPermission(ctx, "action.manage");
      const [audits, actions, risks, evidence] = await Promise.all([
        hasOrgPermission(ctx, "audit.conduct") ? db.audit.count({ where: { organisationId: orgId, ...auditBranchWhere(ctx) } }) : Promise.resolve(null),
        db.complianceAction.count({ where: { organisationId: orgId, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] }, ...(canActions ? {} : { ownerId: ctx.userId }) } }),
        hasOrgPermission(ctx, "risk.view") ? db.complianceRisk.count({ where: { organisationId: orgId, status: { not: "CLOSED" }, ...riskBranchWhere(ctx) } }) : Promise.resolve(null),
        hasOrgPermission(ctx, "evidence.read") ? db.evidenceDocument.count({ where: { organisationId: orgId } }) : Promise.resolve(null),
      ]);
      const out: Record<string, number> = { actions };
      if (audits !== null) out.audits = audits;
      if (risks !== null) out.risks = risks;
      if (evidence !== null) out.evidence = evidence;
      return out;
    }
  }
}
