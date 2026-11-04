import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isIsoDate } from "@/lib/london";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { readinessFor } from "../readiness";
import { computeReadiness } from "./assessments";
import { branchScope, startOfToday } from "./common";
import { OPEN_RCA, rcaDashboard } from "./rca";

/**
 * The CQC Inspection & Evidence overview. Every figure is counted from the organisation's own current records, within
 * the caller's branches and the chosen filters, and each links to the list it was counted from. The readiness scores
 * come from the latest assessment for the chosen scope and are recalculated now from current evidence and actions.
 * Warnings are worked out separately and are always shown, whatever the score.
 */
export interface OverviewFilters { branch?: string; service?: string; from?: string; to?: string; manager?: string }

export function parseOverviewFilters(sp: Record<string, string | undefined>): OverviewFilters {
  return { branch: sp.branch || undefined, service: sp.service || undefined, from: sp.from && isIsoDate(sp.from) ? sp.from : undefined, to: sp.to && isIsoDate(sp.to) ? sp.to : undefined, manager: sp.manager || undefined };
}

export interface Warning { level: "critical" | "high"; text: string; href: string | null }

const OPEN_ACTION = ["OPEN", "IN_PROGRESS", "COMPLETED"];

export async function cqcOverview(ctx: Ctx, f: OverviewFilters, now = new Date()) {
  const organisationId = requireOrgPermission(ctx, "cqc.view");
  const today = startOfToday();
  // A branch filter outside the caller's grants is ignored, never trusted.
  const branch = f.branch && (!ctx.branchIds || ctx.branchIds.includes(f.branch)) && (await db.branch.findFirst({ where: { id: f.branch, organisationId }, select: { id: true } })) ? f.branch : undefined;
  const serviceBranches = f.service ? (await db.branchServiceType.findMany({ where: { serviceTypeCode: f.service, branch: { organisationId } }, select: { branchId: true } })).map((b) => b.branchId) : null;
  const branchIds: string[] | null = branch ? [branch] : serviceBranches ? serviceBranches.filter((b) => !ctx.branchIds || ctx.branchIds.includes(b)) : ctx.branchIds;
  const period = f.from || f.to ? { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } : undefined;
  const suWhere: Prisma.ServiceUserWhereInput = branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {};

  // The assessment the scores come from: the latest for this exact scope, else the latest the person can see.
  const scoped = { organisationId, AND: [branchScope(ctx)], ...(f.manager ? { assessorId: f.manager } : {}), ...(f.service ? { serviceTypeCode: f.service } : {}) };
  const assessment = (await db.cqcAssessment.findFirst({ where: { ...scoped, branchId: branch ?? null, status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" }, include: { framework: { select: { version: true } } } }))
    ?? (await db.cqcAssessment.findFirst({ where: { ...scoped, status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" }, include: { framework: { select: { version: true } } } }));
  const live = assessment ? await computeReadiness(ctx, organisationId, assessment, now) : null;
  const lastApproved = await db.cqcAssessment.findFirst({ where: { ...scoped, ...(branch ? { branchId: branch } : {}), status: { in: ["APPROVED", "SUPERSEDED"] } }, orderBy: { approvedAt: "desc" }, select: { id: true, reference: true, approvedAt: true, nextDueAt: true } });

  const actionBranch: Prisma.ComplianceActionWhereInput = branchIds
    ? { OR: [{ rca: { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } }, { cqcAssessment: { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } }, { finding: { audit: { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } } }, { risk: { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } }, { rcaId: null, cqcAssessmentId: null, findingId: null, riskId: null }] }
    : {};
  const incidentWhere: Prisma.IncidentWhereInput = { organisationId, status: { not: "CLOSED" }, ...(period ? { occurredAt: period } : {}), ...(branchIds ? { OR: [{ serviceUser: suWhere }, { serviceUserId: null }] } : {}) };
  const [openActions, overdueActions, incidents, safeguarding, seriousIncidents, criticalSafeguarding, carePlanReviews, riskReviews, risks, findings, staff] = await Promise.all([
    db.complianceAction.count({ where: { organisationId, status: { in: OPEN_ACTION }, ...actionBranch } }),
    db.complianceAction.count({ where: { organisationId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: today }, ...actionBranch } }),
    db.incident.count({ where: incidentWhere }),
    db.incident.count({ where: { ...incidentWhere, safeguarding: true } }),
    db.incident.count({ where: { ...incidentWhere, severity: { in: ["HIGH", "CRITICAL"] } } }),
    db.incident.count({ where: { ...incidentWhere, safeguarding: true, severity: { in: ["HIGH", "CRITICAL"] } } }),
    db.carePlan.count({ where: { organisationId, status: "ACTIVE", reviewDue: { lt: today }, serviceUser: { status: { in: ["ACTIVE", "PAUSED"] }, ...suWhere } } }),
    db.riskAssessment.count({ where: { organisationId, status: "ACTIVE", reviewDue: { lt: today }, serviceUser: { status: { in: ["ACTIVE", "PAUSED"] }, ...suWhere } } }),
    db.complianceRisk.findMany({ where: { organisationId, status: { not: "CLOSED" }, ...(branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {}) }, select: { residualLikelihood: true, residualImpact: true } }),
    db.auditFinding.count({ where: { organisationId, riskRating: { in: ["HIGH", "CRITICAL"] }, actions: { some: { status: { in: OPEN_ACTION } } }, audit: branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {} } }),
    db.staffMember.findMany({ where: { organisationId, employmentStatus: "ACTIVE", ...(branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {}) }, select: { id: true } }),
  ]);
  const readiness = staff.length ? await readinessFor(db, organisationId, staff.map((s) => s.id)) : new Map();
  const trainingGaps = [...readiness.values()].filter((r) => r.status !== "READY" && r.status !== "READY_WITH_RESTRICTIONS").length;
  const highRisks = risks.filter((r) => r.residualLikelihood * r.residualImpact >= 15).length;
  const rca = hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate") ? await rcaDashboard(ctx, { branch, service: f.service, from: f.from, to: f.to, owner: f.manager }) : null;

  const links = live?.links ?? [];
  const r = live?.readiness ?? null;
  const essentialGaps = r ? r.criteria.filter((c) => c.essentialGap).length : 0;
  const notMet = live ? [...live.results.values()].filter((x) => x.result === "NOT_MET").length : 0;
  const figures = {
    applicable: r?.overall.applicable ?? 0,
    evidenceTotal: links.length,
    verified: links.filter((l) => l.effective === "VERIFIED").length,
    awaiting: links.filter((l) => l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW").length,
    missing: r ? r.overall.applicable - r.overall.withVerifiedEvidence : 0,
    outdated: links.filter((l) => l.effective === "OUTDATED").length,
    openActions,
    overdueActions,
    openRcas: rca ? rca.total - rca.closed : null,
    safeguarding,
    incidents,
    carePlanReviews,
    riskReviews,
    trainingGaps,
  };

  const canIncidents = hasOrgPermission(ctx, "incident.manage");
  const warnings: Warning[] = [];
  if (criticalSafeguarding) warnings.push({ level: "critical", text: `${criticalSafeguarding} open safeguarding concern${criticalSafeguarding === 1 ? "" : "s"} rated high or critical`, href: canIncidents ? "/rota/incidents?safeguarding=1" : null });
  if (rca?.critical) warnings.push({ level: "critical", text: `${rca.critical} critical investigation${rca.critical === 1 ? "" : "s"} still open`, href: "/compliance/cqc/rca?status=CRITICAL" });
  if (seriousIncidents) warnings.push({ level: "critical", text: `${seriousIncidents} serious incident${seriousIncidents === 1 ? "" : "s"} unresolved`, href: canIncidents ? "/rota/incidents?severity=HIGH" : null });
  if (highRisks) warnings.push({ level: "high", text: `${highRisks} organisational risk${highRisks === 1 ? "" : "s"} rated 15 or more after controls`, href: hasOrgPermission(ctx, "risk.view") ? "/compliance/risks?band=HIGH_PLUS" : null });
  if (findings) warnings.push({ level: "high", text: `${findings} high-risk audit finding${findings === 1 ? "" : "s"} with open actions`, href: "/actions" });
  if (rca?.overdue) warnings.push({ level: "high", text: `${rca.overdue} investigation${rca.overdue === 1 ? " is" : "s are"} overdue`, href: "/compliance/cqc/rca?status=OVERDUE" });
  if (overdueActions) warnings.push({ level: "high", text: `${overdueActions} corrective action${overdueActions === 1 ? " is" : "s are"} overdue`, href: "/compliance/cqc/actions?status=OVERDUE" });
  if (essentialGaps) warnings.push({ level: "high", text: `${essentialGaps} essential area${essentialGaps === 1 ? " has" : "s have"} no verified, in-date evidence`, href: "/compliance/cqc/evidence?status=GAPS" });
  if (notMet) warnings.push({ level: "high", text: `${notMet} assessment area${notMet === 1 ? "" : "s"} recorded as Not met`, href: assessment ? `/compliance/cqc/assessments/${assessment.id}?result=NOT_MET` : null });
  if (trainingGaps) warnings.push({ level: "high", text: `${trainingGaps} active staff member${trainingGaps === 1 ? " is" : "s are"} not fully ready (training, competency or checks)`, href: hasOrgPermission(ctx, "readiness.view") ? "/rota/readiness" : null });

  return { assessment, live, lastApproved, figures, warnings, rca, branch: branch ?? null };
}

export { OPEN_RCA };
