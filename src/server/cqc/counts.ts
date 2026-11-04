import { db } from "@/lib/db";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { branchScope } from "./common";
import { OPEN_RCA, rcaVisibleWhere } from "./rca";

/** The counts beside the CQC Inspection & Evidence tabs: what needs attention on each, for this person only. */
export async function cqcTabCounts(ctx: Ctx, now = new Date()): Promise<Record<string, number>> {
  const organisationId = ctx.organisationId!;
  const out: Record<string, number> = {};
  if (hasOrgPermission(ctx, "cqc.view")) {
    out.assessments = await db.cqcAssessment.count({ where: { organisationId, AND: [branchScope(ctx)], status: { in: ["IN_PROGRESS", "AWAITING_APPROVAL"] } } });
    out.evidence = await db.cqcEvidenceLink.count({ where: { organisationId, AND: [branchScope(ctx)], status: { in: ["SUGGESTED", "AWAITING_REVIEW"] } } });
  }
  if (hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate")) {
    out.rca = await db.rcaInvestigation.count({ where: { AND: [rcaVisibleWhere(ctx), { status: { in: OPEN_RCA } }] } });
    out.actions = await db.complianceAction.count({ where: { organisationId, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] }, OR: [{ rca: rcaVisibleWhere(ctx) }, ...(hasOrgPermission(ctx, "cqc.view") ? [{ cqcAssessment: { organisationId } }] : [])] } });
  }
  void now;
  return out;
}
