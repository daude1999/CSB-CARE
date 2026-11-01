import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "../auth/rbac";
import { outstandingAckWhere } from "../policies/assignment";
import { riskBand } from "./risks";
import { auditBranchWhere } from "./audits";
import { readinessFor } from "../readiness";
import { dbDate, londonDate } from "@/lib/london";

/**
 * The Compliance Dashboard's figures: "what needs compliance attention today?". Every number is counted from the
 * caller's own organisation at request time, and each item links to the page that lists exactly those records.
 * People only see items for the work their role can act on; everyone sees their own overdue reading.
 */

export interface AttentionItem { key: string; label: string; count: number; href: string; tone: "rose" | "amber"; detail: string }
export interface ActivityItem { at: Date; kind: string; text: string; href: string | null }

const DAY = 86_400_000;

export async function complianceDashboard(ctx: Ctx, now = new Date()) {
  const orgId = ctx.organisationId;
  const scope = { organisationId: orgId ?? null };
  const manager = hasOrgPermission(ctx, "staff.view");
  const canQueue = hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.review");
  const canAudit = hasOrgPermission(ctx, "audit.conduct");
  const canRisk = hasOrgPermission(ctx, "risk.view");
  const canActions = hasOrgPermission(ctx, "action.manage");
  const policyWhere: Prisma.PolicyWhereInput = orgId ? { organisationId: orgId, kind: "CUSTOMER", status: "ACTIVE" } : { organisationId: null, kind: "MASTER", status: "ACTIVE" };
  const ackScope: Prisma.AcknowledgementWhereInput = orgId ? (manager ? { organisationId: orgId } : { organisationId: orgId, userId: ctx.userId }) : { id: { in: [] } };
  const actionScope: Prisma.ComplianceActionWhereInput = orgId ? (canActions ? { organisationId: orgId } : { organisationId: orgId, ownerId: ctx.userId }) : { id: { in: [] } };

  const [activePolicies, overdueReviews, awaitingApproval, outstandingAcks, overdueMandatory, overdueActions, awaitingVerification, triage, significantFindings, risks] = await Promise.all([
    db.policy.count({ where: policyWhere }),
    db.policy.count({ where: { ...policyWhere, nextReviewDate: { lt: now } } }),
    db.policyRevision.count({ where: { ...scope, closedAt: null, draftVersion: { status: "UNDER_REVIEW" } } }),
    db.acknowledgement.count({ where: { ...ackScope, ...outstandingAckWhere, publication: { status: "PUBLISHED" } } }),
    db.acknowledgement.count({ where: { ...ackScope, ...outstandingAckWhere, mandatory: true, dueAt: { lt: now }, publication: { status: "PUBLISHED" } } }),
    db.complianceAction.count({ where: { ...actionScope, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now } } }),
    canActions ? db.complianceAction.count({ where: { ...actionScope, status: "COMPLETED" } }) : 0,
    db.regulatoryChange.count({ where: { status: { in: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW"] } } }),
    // A high or critical finding stays significant until at least one of its actions has been independently verified.
    orgId && canAudit ? db.auditFinding.count({ where: { organisationId: orgId, riskRating: { in: ["HIGH", "CRITICAL"] }, audit: auditBranchWhere(ctx), actions: { none: { status: { in: ["VERIFIED", "CLOSED"] } } } } }) : 0,
    orgId && canRisk ? db.complianceRisk.findMany({ where: { organisationId: orgId, status: { not: "CLOSED" }, ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}) }, select: { residualLikelihood: true, residualImpact: true, reviewDate: true } }) : [],
  ]);
  const care = orgId ? await careOperationsLinks(ctx, orgId) : { signoffBlocking: 0, safeguarding: 0, plansOverdue: 0, show: { readiness: false, incidents: false, plans: false } };
  const highRisks = risks.filter((r) => ["HIGH", "EXTREME"].includes(riskBand(r.residualLikelihood * r.residualImpact))).length;
  const overdueRiskReviews = risks.filter((r) => r.reviewDate < now).length;

  const attention: AttentionItem[] = [
    { key: "reviews", label: "Policy reviews overdue", count: overdueReviews, href: "/policies?quick=overdue", tone: "rose" as const, detail: "Past their review date", show: Boolean(orgId) || hasPlatformPermission(ctx, "master.author") },
    { key: "approvals", label: "Revisions awaiting approval", count: awaitingApproval, href: "/queue", tone: "amber" as const, detail: "Submitted for review and approval", show: canQueue },
    { key: "acks", label: manager ? "Mandatory reading overdue" : "Your reading overdue", count: overdueMandatory, href: manager ? "/staff?view=rows&status=overdue" : "/acknowledgements", tone: "rose" as const, detail: manager ? "Staff past the due date" : "Policies past their due date", show: Boolean(orgId) },
    { key: "findings", label: "Significant audit findings open", count: significantFindings, href: "/audits", tone: "rose" as const, detail: "High or critical, no verified action yet", show: canAudit },
    { key: "actions", label: canActions ? "Corrective actions overdue" : "Your actions overdue", count: overdueActions, href: "/actions?view=overdue", tone: "rose" as const, detail: "Open past the due date", show: Boolean(orgId) },
    { key: "verify", label: "Actions awaiting verification", count: awaitingVerification, href: "/actions?view=check", tone: "amber" as const, detail: "Completed, need an independent check", show: canActions },
    { key: "risks", label: "High or Extreme risks", count: highRisks, href: "/compliance/risks?band=HIGH_PLUS", tone: "rose" as const, detail: "Residual rating, with controls", show: canRisk },
    { key: "riskReviews", label: "Risk reviews overdue", count: overdueRiskReviews, href: "/compliance/risks?overdue=1", tone: "amber" as const, detail: "Past their review date", show: canRisk },
    { key: "signoffReadiness", label: "Staff not ready because of policy sign-off", count: care.signoffBlocking, href: "/rota/readiness?status=NOT_READY", tone: "rose" as const, detail: "A required policy is not acknowledged, so they cannot be booked", show: care.show.readiness },
    { key: "safeguarding", label: "Safeguarding incidents open", count: care.safeguarding, href: "/rota/incidents?safeguarding=1", tone: "rose" as const, detail: "Reported in Care Management, not yet closed", show: care.show.incidents },
    { key: "carePlans", label: "Care plans overdue review", count: care.plansOverdue, href: "/rota/care-plans?filter=overdue", tone: "amber" as const, detail: "Plan in use past its review date", show: care.show.plans },
    { key: "triage", label: "Regulatory updates to triage", count: triage, href: "/changes?group=triage", tone: "amber" as const, detail: "Detected, not yet decided", show: true },
  ].filter((x) => x.show).map(({ show: _s, ...x }) => x);

  return {
    kpis: { activePolicies, overdueReviews, awaitingApproval, outstandingAcks },
    manager,
    attention,
    activity: await recentActivity(ctx, now),
  };
}

/** The last fortnight's governance events in the caller's scope, newest first. */
export async function recentActivity(ctx: Ctx, now = new Date(), take = 10): Promise<ActivityItem[]> {
  const orgId = ctx.organisationId;
  const since = new Date(now.getTime() - 14 * DAY);
  const scope = { organisationId: orgId ?? null };
  const manager = hasOrgPermission(ctx, "staff.view");
  const [pubs, revisions, acks, audits, verified, triaged, reviews] = await Promise.all([
    db.policyPublication.findMany({ where: { ...scope, status: "PUBLISHED", publishedAt: { gte: since } }, orderBy: { publishedAt: "desc" }, take, select: { publishedAt: true, policy: { select: { id: true, ref: true, title: true } }, version: { select: { label: true } } } }),
    // Drafts are visible to authors, reviewers and approvers only, so only they see revisions here.
    canSeeDrafts(ctx) ? db.policyRevision.findMany({ where: { ...scope, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take, select: { id: true, createdAt: true, title: true, policy: { select: { ref: true, title: true } } } }) : [],
    orgId && manager ? db.acknowledgement.findMany({ where: { organisationId: orgId, acknowledgedAt: { gte: since } }, orderBy: { acknowledgedAt: "desc" }, take: 500, select: { acknowledgedAt: true, user: { select: { name: true } }, staffMember: { select: { displayName: true } }, publication: { select: { policyId: true, policy: { select: { ref: true } } } } } }) : [],
    orgId && hasOrgPermission(ctx, "audit.conduct") ? db.audit.findMany({ where: { organisationId: orgId, ...auditBranchWhere(ctx), completedAt: { gte: since } }, orderBy: { completedAt: "desc" }, take, select: { id: true, title: true, completedAt: true } }) : [],
    orgId ? db.complianceAction.findMany({ where: { organisationId: orgId, verifiedAt: { gte: since }, ...(hasOrgPermission(ctx, "action.manage") ? {} : { ownerId: ctx.userId }) }, orderBy: { verifiedAt: "desc" }, take, select: { id: true, title: true, verifiedAt: true } }) : [],
    db.changeStatusEvent.findMany({ where: { createdAt: { gte: since }, actorId: { not: null }, to: { in: ["CONFIRMED_RELEVANT", "CONFIRMED_NOT_APPLICABLE", "EDITORIAL_OR_IMMATERIAL", "POLICY_REVISION_REQUIRED", "NO_POLICY_REVISION_REQUIRED", "IMPACT_ASSESSMENT_COMPLETED"] } }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, to: true, change: { select: { id: true, title: true } } } }),
    orgId && hasOrgPermission(ctx, "risk.view") ? db.riskEvent.findMany({ where: { kind: "REVIEWED", createdAt: { gte: since }, risk: { organisationId: orgId } }, orderBy: { createdAt: "desc" }, take, select: { createdAt: true, risk: { select: { id: true, ref: true, title: true } } } }) : [],
  ]);
  const clean = (t: string) => t.replace(/^SIMULATED:\s*/, "");
  const items: ActivityItem[] = [
    ...pubs.map((p) => ({ at: p.publishedAt!, kind: "Published", text: `${p.policy.ref} ${p.policy.title}, ${p.version.label}`, href: `/policies/${p.policy.id}` })),
    ...revisions.map((r) => ({ at: r.createdAt, kind: "Revision started", text: `${r.policy.ref} ${r.policy.title}: ${r.title}`, href: `/revisions/${r.id}` })),
    ...groupAcks(acks),
    ...audits.map((a) => ({ at: a.completedAt!, kind: "Audit completed", text: a.title, href: `/audits/${a.id}` })),
    ...verified.map((a) => ({ at: a.verifiedAt!, kind: "Action verified", text: a.title, href: `/actions/${a.id}` })),
    ...triaged.map((e) => ({ at: e.createdAt, kind: "Update triaged", text: `${clean(e.change.title)}: ${e.to.replace(/_/g, " ").toLowerCase()}`, href: `/changes/${e.change.id}` })),
    ...reviews.map((r) => ({ at: r.createdAt, kind: "Risk reviewed", text: `${r.risk.ref} ${r.risk.title}`, href: `/compliance/risks/${r.risk.id}` })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}

function canSeeDrafts(ctx: Ctx) {
  return ctx.organisationId ? hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.approve") : hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author");
}

type AckRow = { acknowledgedAt: Date | null; user: { name: string } | null; staffMember: { displayName: string } | null; publication: { policyId: string; policy: { ref: string } } };

/** Sign-offs of the same policy on the same day are one line ("5 staff signed …"), so a busy day does not crowd out other events. */
function groupAcks(acks: AckRow[]): ActivityItem[] {
  const groups = new Map<string, AckRow[]>();
  for (const a of acks) {
    const k = `${a.publication.policyId}:${a.acknowledgedAt!.toISOString().slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.values()].map((rs) => {
    const first = rs[0]!;
    const who = rs.length === 1 ? (first.staffMember?.displayName ?? first.user?.name ?? "A member") : `${rs.length} staff`;
    return { at: first.acknowledgedAt!, kind: "Acknowledged", text: `${who} signed ${first.publication.policy.ref}`, href: `/staff/policy/${first.publication.policyId}` };
  });
}

/**
 * Links from compliance into care operations: staff whose readiness fails only because of a policy acknowledgement,
 * open safeguarding incidents and overdue care-plan reviews. Counted from the same records as the Rota screens they
 * open, within the member's branches.
 */
async function careOperationsLinks(ctx: Ctx, orgId: string) {
  const show = { readiness: hasOrgPermission(ctx, "readiness.view"), incidents: hasOrgPermission(ctx, "incident.manage"), plans: hasOrgPermission(ctx, "serviceUser.view") };
  const branch = ctx.branchIds ? { in: ctx.branchIds } : undefined;
  const suWhere: Prisma.ServiceUserWhereInput = branch ? { area: { branchId: branch } } : {};
  const [staff, safeguarding, plansOverdue] = await Promise.all([
    show.readiness ? db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE", hrMissing: false, ...(branch ? { branchId: branch } : {}) }, select: { id: true } }) : Promise.resolve([]),
    show.incidents ? db.incident.count({ where: { organisationId: orgId, safeguarding: true, status: { not: "CLOSED" }, ...(branch ? { serviceUser: suWhere } : {}) } }) : Promise.resolve(0),
    show.plans ? db.carePlan.count({ where: { organisationId: orgId, status: "ACTIVE", reviewDue: { lt: dbDate(londonDate()) }, serviceUser: suWhere } }) : Promise.resolve(0),
  ]);
  let signoffBlocking = 0;
  if (staff.length) {
    const r = await readinessFor(db, orgId, staff.map((x) => x.id));
    signoffBlocking = [...r.values()].filter((x) => x.status === "NOT_READY" && x.components.some((c) => c.category === "POLICY" && c.hardStop && !c.taskLevel && c.state !== "MET" && c.state !== "DUE_SOON")).length;
  }
  return { signoffBlocking, safeguarding, plansOverdue, show };
}
