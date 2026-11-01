import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { signoffByGroup, signoffRows } from "../policies/assignment";
import { policyStatus, STATUS_LABELS } from "../policies/library-view";
import { toCsv } from "../reports/tables";
import type { ExportTable } from "../reports/export-files";
import { auditProgress, auditScore } from "./audits";
import { LINK_TYPES, linkFor, resolveLinks } from "./evidence";
import { BAND_LABEL, CONTROL_EFFECTIVENESS, RISK_CATEGORIES, RISK_STATUS, riskBand, riskReviewOverdue } from "./risks";

/**
 * Policy & Compliance reports. Each report is computed from the organisation's own records when it is opened, within
 * the caller's branches, for the chosen period. Every summary figure states what it counts (its denominator and
 * exclusions). Internal scores are never presented as CQC ratings or certification. The Reporting & Analytics
 * portal's /reports keeps its own registers; these reuse the same services and export utilities.
 */

export const REPORT_GROUPS = [
  { name: "Policy Management", kinds: ["policies", "publications"] },
  { name: "Staff Sign-off", kinds: ["signoff", "signoff-groups"] },
  { name: "Audits", kinds: ["audits", "findings"] },
  { name: "Corrective Actions", kinds: ["actions"] },
  { name: "Risk Management", kinds: ["risks"] },
  { name: "Evidence", kinds: ["evidence"] },
] as const;
export type ComplianceReportKind = (typeof REPORT_GROUPS)[number]["kinds"][number];
export const REPORT_TITLES: Record<ComplianceReportKind, string> = {
  policies: "Policy register",
  publications: "Publications and version history",
  signoff: "Sign-off by policy",
  "signoff-groups": "Sign-off by branch and role",
  audits: "Audits",
  findings: "Audit findings",
  actions: "Corrective actions",
  risks: "Risk register",
  evidence: "Evidence",
};
const KINDS = Object.keys(REPORT_TITLES) as ComplianceReportKind[];
export const isReportKind = (k: string): k is ComplianceReportKind => (KINDS as string[]).includes(k);

export interface ReportFilters { from: string; to: string; branch?: string }
export interface ComplianceReport extends ExportTable {
  kind: ComplianceReportKind;
  /** What each summary figure counts. */
  notes: string[];
  /** Which date the period applies to, or null when the report shows the current position. */
  periodBasis: string | null;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const d = (x: Date | null | undefined) => (x ? iso(x) : "");
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

/** Reads the period and branch from the query; defaults to the last 12 months. Unrecognised values are dropped. */
export function parseReportFilters(sp: Record<string, string | undefined>, now = new Date()): ReportFilters {
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const to = ok(sp.to) ?? iso(now);
  const from = ok(sp.from) ?? iso(new Date(Date.parse(to) - 365 * DAY));
  if (from > to) throw new ValidationError("The start of the period must be before its end");
  return { from, to, branch: sp.branch && /^[a-z0-9]{8,40}$/i.test(sp.branch) ? sp.branch : undefined };
}

async function scopeFor(ctx: Ctx, f: ReportFilters) {
  if (!hasOrgPermission(ctx, "report.view")) throw new ForbiddenError("You cannot view compliance reports");
  const orgId = ctx.organisationId!;
  const branches = await db.branch.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  // A branch from the address bar is only honoured if it is one of the caller's own branches in this organisation.
  if (f.branch && !branches.some((b) => b.id === f.branch)) throw new NotFoundError("Branch");
  const branchIds = f.branch ? [f.branch] : ctx.branchIds;
  const range = { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T23:59:59.999Z`) };
  return { orgId, branches, branchIds, range, branchName: f.branch ? branches.find((b) => b.id === f.branch)!.name : ctx.branchIds ? "Your branches" : "All branches" };
}

export async function complianceReport(ctx: Ctx, kind: string, f: ReportFilters, now = new Date()): Promise<ComplianceReport> {
  if (!isReportKind(kind)) throw new NotFoundError("Report");
  const s = await scopeFor(ctx, f);
  const subtitle = (basis: string | null) => `${basis ? `${f.from} to ${f.to} (by ${basis})` : `Position on ${iso(now)}`} · ${s.branchName} · generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC from live records. Internal management information, not a regulatory rating.`;
  const auditBranch: Prisma.AuditWhereInput = s.branchIds ? { OR: [{ branchId: { in: s.branchIds } }, ...(f.branch ? [] : [{ branchId: null }])] } : {};
  const make = (r: Omit<ComplianceReport, "kind" | "title" | "subtitle">): ComplianceReport => ({ kind, title: `${REPORT_TITLES[kind]}`, subtitle: subtitle(r.periodBasis), ...r });

  switch (kind) {
    case "policies": {
      const ps = await db.policy.findMany({
        where: { organisationId: s.orgId, kind: "CUSTOMER" },
        orderBy: { ref: "asc" },
        include: { category: true, currentPublishedVersion: { select: { label: true, publishedAt: true, approvals: { where: { decision: "APPROVE" }, select: { id: true }, take: 1 } } }, revisions: { where: { closedAt: null }, take: 1, orderBy: { createdAt: "desc" }, select: { submittedAt: true, draftVersion: { select: { status: true } } } } },
      });
      const owners = new Map((await db.user.findMany({ where: { id: { in: ps.map((p) => p.ownerId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const rows = ps.map((p) => {
        const open = p.revisions[0];
        const status = policyStatus({ currentPublishedVersion: p.currentPublishedVersion ? { approved: p.currentPublishedVersion.approvals.length > 0 } : null, openRevision: open ? { submittedAt: open.submittedAt, draftStatus: open.draftVersion.status } : null, nextReviewDate: p.nextReviewDate, archived: p.status === "ARCHIVED" }, now);
        return { p, status, open };
      });
      const active = rows.filter((r) => r.p.status === "ACTIVE");
      return make({
        periodBasis: null,
        summary: [
          ["Active policies", active.length],
          ["Published and approved", active.filter((r) => r.p.currentPublishedVersion?.approvals.length).length],
          ["Drafts in progress", active.filter((r) => r.open && !r.open.submittedAt).length],
          ["Awaiting approval", active.filter((r) => r.status === "under_review").length],
          ["Reviews overdue", active.filter((r) => r.p.nextReviewDate && r.p.nextReviewDate < now).length],
          ["Archived", rows.length - active.length],
        ],
        notes: ["Active policies: your organisation's policies that are not archived (CSB starter templates are not counted).", "Published and approved: the live version carries at least one recorded approval.", "Reviews overdue: active policies whose next review date has passed."],
        columns: ["Reference", "Title", "Category", "Status", "Live version", "Published", "Next review", "Owner"],
        rows: rows.map(({ p, status }) => [p.ref, p.title, p.category.name, STATUS_LABELS[status], p.currentPublishedVersion?.label ?? "", d(p.currentPublishedVersion?.publishedAt), d(p.nextReviewDate), p.ownerId ? (owners.get(p.ownerId) ?? "") : ""]),
        widths: [1, 3, 2, 1.4, 1, 1, 1, 1.4],
      });
    }
    case "publications": {
      const pubs = await db.policyPublication.findMany({ where: { organisationId: s.orgId, publishedAt: s.range }, orderBy: { publishedAt: "desc" }, include: { policy: { select: { ref: true, title: true } }, version: { select: { label: true, origin: true, changeSummary: true, approvals: { where: { decision: "APPROVE" }, select: { id: true } } } } } });
      return make({
        periodBasis: "publication date",
        summary: [["Versions published", pubs.length], ["Material revisions", pubs.filter((p) => p.materialRevision).length], ["Policies affected", new Set(pubs.map((p) => p.policyId)).size]],
        notes: ["Every publication in the period, including versions since superseded.", "Material revisions are those that asked staff to acknowledge the new version."],
        columns: ["Published", "Reference", "Title", "Version", "Origin", "Material", "Approvals", "Status", "What changed"],
        rows: pubs.map((p) => [d(p.publishedAt), p.policy.ref, p.policy.title, p.version.label, p.version.origin.replace(/_/g, " ").toLowerCase(), p.materialRevision ? "Yes" : "No", p.version.approvals.length, p.status.toLowerCase(), p.version.changeSummary ?? ""]),
        widths: [1, 1, 2.4, 0.8, 1, 0.7, 0.7, 0.9, 3],
      });
    }
    case "signoff":
    case "signoff-groups": {
      if (!hasOrgPermission(ctx, "staff.view")) throw new ForbiddenError("Sign-off reports need access to Staff Sign-off");
      const all = (await signoffRows(ctx, f.branch ? { branch: f.branch } : {})).filter((r) => r.createdAt >= s.range.gte && r.createdAt <= s.range.lte);
      const live = all.filter((r) => r.b.bucket !== "withdrawn" && r.b.bucket !== "superseded");
      const required = live.filter((r) => r.b.bucket !== "exempted");
      const done = live.filter((r) => r.b.bucket === "acknowledged").length;
      const summary: [string, string | number][] = [["Assigned", live.length], ["Acknowledged", done], ["Outstanding", live.filter((r) => r.b.outstanding).length], ["Overdue", live.filter((r) => r.b.overdue).length], ["Completion", pct(done, required.length)], ["Cannot sign (no login)", live.filter((r) => r.b.cannotSign && r.b.outstanding).length]];
      const notes = ["Assignments made in the period, current version only. Withdrawn assignments are left out.", "Completion: acknowledged out of everyone still required to read; exempted people are left out of the denominator.", "Acknowledging a policy is not training and does not show competence."];
      if (kind === "signoff-groups") {
        const groups = [...signoffByGroup(live, "branch").map((g) => ["Branch", g] as const), ...signoffByGroup(live, "role").map((g) => ["Role", g] as const)];
        return make({ periodBasis: "assignment date", summary, notes, columns: ["Grouped by", "Name", "Assigned", "Acknowledged", "Outstanding", "Overdue", "Cannot sign", "Completion"], rows: groups.map(([by, g]) => [by, g.name, g.assigned, g.acknowledged, g.outstanding, g.overdue, g.cannotSign, g.completion === null ? "—" : `${g.completion}%`]), widths: [0.8, 2.4, 1, 1, 1, 1, 1, 1] });
      }
      const byPolicy = new Map<string, typeof live>();
      for (const r of live) byPolicy.set(r.publication.policyId, [...(byPolicy.get(r.publication.policyId) ?? []), r]);
      return make({
        periodBasis: "assignment date", summary, notes,
        columns: ["Reference", "Policy", "Version", "Assigned", "Acknowledged", "Opened, not signed", "Overdue", "Exempted", "Completion"],
        rows: [...byPolicy.values()].map((rs) => {
          const p = rs[0]!.publication;
          const ack = rs.filter((r) => r.b.bucket === "acknowledged").length;
          return [p.policy.ref, p.policy.title, p.version.label, rs.length, ack, rs.filter((r) => r.b.bucket === "opened").length, rs.filter((r) => r.b.overdue).length, rs.filter((r) => r.b.bucket === "exempted").length, pct(ack, rs.filter((r) => r.b.bucket !== "exempted").length)];
        }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        widths: [1, 2.6, 0.8, 0.9, 1, 1, 0.8, 0.8, 0.9],
      });
    }
    case "audits":
    case "findings": {
      if (!hasOrgPermission(ctx, "audit.conduct")) throw new ForbiddenError("Audit reports need access to audits");
      const audits = await db.audit.findMany({ where: { organisationId: s.orgId, ...auditBranch, startedAt: s.range }, orderBy: { startedAt: "desc" }, include: { answers: { select: { questionId: true, response: true } }, template: { select: { title: true, questions: { select: { id: true } } } }, findings: { include: { actions: { select: { status: true } } } } } });
      const branchName = new Map(s.branches.map((b) => [b.id, b.name]));
      const where = (a: (typeof audits)[number]) => (a.branchId ? (branchName.get(a.branchId) ?? "Branch") : "Whole organisation");
      if (kind === "findings") {
        const fs = audits.flatMap((a) => a.findings.map((f) => ({ a, f })));
        const resolved = (f: (typeof fs)[number]["f"]) => f.actions.some((x) => x.status === "VERIFIED" || x.status === "CLOSED");
        return make({
          periodBasis: "audit start date",
          summary: [["Findings", fs.length], ["High or critical", fs.filter(({ f }) => ["HIGH", "CRITICAL"].includes(f.riskRating)).length], ["With no action", fs.filter(({ f }) => !f.actions.length).length], ["With a verified action", fs.filter(({ f }) => resolved(f)).length]],
          notes: ["Findings recorded on audits started in the period.", "A finding counts as having a verified action once at least one of its actions has been independently verified or closed."],
          columns: ["Audit", "Branch", "Raised", "Rating", "Finding", "Actions", "Verified action"],
          rows: fs.map(({ a, f }) => [a.title, where(a), d(f.createdAt), f.riskRating.toLowerCase(), f.description, f.actions.length, resolved(f) ? "Yes" : "No"]),
          widths: [1.6, 1.2, 0.9, 0.8, 3.4, 0.7, 0.9],
        });
      }
      const done = audits.filter((a) => a.status === "COMPLETED");
      const scores = done.map((a) => auditScore(a.answers, a.template.questions.length)).filter((x): x is number => x !== null);
      return make({
        periodBasis: "audit start date",
        summary: [["Audits", audits.length], ["Completed", done.length], ["In progress", audits.length - done.length], ["Findings", audits.reduce((n, a) => n + a.findings.length, 0)], ["Average internal score", scores.length ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : "—"]],
        notes: ["Audits started in the period.", "Internal score: met answers out of applicable questions (partially met counts half), for completed, fully answered audits only. It is an internal indicator, not a CQC rating."],
        columns: ["Audit", "Template", "Branch", "Started", "Status", "Answered", "Internal score", "Findings", "Completed"],
        rows: audits.map((a) => {
          const p = auditProgress(a.template.questions.map((q) => q.id), a.answers);
          const sc = auditScore(a.answers, p.total);
          return [a.title, a.template.title, where(a), d(a.startedAt), a.status === "COMPLETED" ? "Completed" : "In progress", `${p.answered} of ${p.total}`, sc === null ? "—" : `${sc}%`, a.findings.length, d(a.completedAt)];
        }),
        widths: [1.8, 1.8, 1.2, 0.9, 0.9, 0.9, 0.9, 0.7, 0.9],
      });
    }
    case "actions": {
      const actions = await db.complianceAction.findMany({ where: { organisationId: s.orgId, createdAt: s.range, ...(s.branchIds ? { OR: [{ finding: { audit: auditBranch } }, { risk: { OR: [{ branchId: { in: s.branchIds } }, ...(f.branch ? [] : [{ branchId: null }])] } }, ...(f.branch ? [] : [{ findingId: null, riskId: null }])] } : {}) }, orderBy: { dueDate: "asc" }, include: { finding: { select: { audit: { select: { title: true } } } }, risk: { select: { ref: true } } } });
      const names = new Map((await db.user.findMany({ where: { id: { in: [...actions.map((a) => a.ownerId), ...actions.map((a) => a.verifiedById).filter((x): x is string => Boolean(x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const evidence = new Set((await db.evidenceDocument.findMany({ where: { organisationId: s.orgId, linkedType: "ACTION", linkedId: { in: actions.map((a) => a.id) } }, select: { linkedId: true } })).map((e) => e.linkedId));
      const hasEvidence = (a: (typeof actions)[number]) => evidence.has(a.id) || Boolean(a.completionEvidenceId);
      const open = actions.filter((a) => ["OPEN", "IN_PROGRESS"].includes(a.status));
      return make({
        periodBasis: "date raised",
        summary: [["Raised", actions.length], ["Open", open.length], ["Overdue", open.filter((a) => a.dueDate < now).length], ["Awaiting verification", actions.filter((a) => a.status === "COMPLETED").length], ["Verified or closed", actions.filter((a) => ["VERIFIED", "CLOSED"].includes(a.status)).length], ["Done without evidence", actions.filter((a) => ["COMPLETED", "VERIFIED", "CLOSED"].includes(a.status) && !hasEvidence(a)).length]],
        notes: ["Actions raised in the period.", "Overdue: open or in progress past the due date.", "Done without evidence: completed, verified or closed with no file attached (the completion note may still describe the evidence)."],
        columns: ["Action", "Came from", "Owner", "Due", "Status", "Completed", "Verified by", "Verified", "Evidence"],
        rows: actions.map((a) => [a.title, a.finding ? `Audit: ${a.finding.audit.title}` : a.risk ? `Risk ${a.risk.ref}` : "Raised directly", names.get(a.ownerId) ?? "", d(a.dueDate), a.status.replace(/_/g, " ").toLowerCase(), d(a.completedAt), a.verifiedById ? (names.get(a.verifiedById) ?? "") : "", d(a.verifiedAt), hasEvidence(a) ? "Yes" : "No"]),
        widths: [2.4, 1.6, 1.2, 0.9, 0.9, 0.9, 1.2, 0.9, 0.7],
      });
    }
    case "risks": {
      if (!hasOrgPermission(ctx, "risk.view")) throw new ForbiddenError("Risk reports need access to the risk register");
      const risks = await db.complianceRisk.findMany({ where: { organisationId: s.orgId, ...(s.branchIds ? { OR: [{ branchId: { in: s.branchIds } }, ...(f.branch ? [] : [{ branchId: null }])] } : {}) }, orderBy: { ref: "asc" }, include: { actions: { select: { status: true } } } });
      const names = new Map((await db.user.findMany({ where: { id: { in: risks.map((r) => r.ownerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const branchName = new Map(s.branches.map((b) => [b.id, b.name]));
      const live = risks.filter((r) => r.status !== "CLOSED");
      const residual = (r: (typeof risks)[number]) => r.residualLikelihood * r.residualImpact;
      return make({
        periodBasis: null,
        summary: [["Active risks", live.length], ["High or Extreme", live.filter((r) => ["HIGH", "EXTREME"].includes(riskBand(residual(r)))).length], ["Reviews overdue", live.filter((r) => riskReviewOverdue(r, now)).length], ["With open mitigation", live.filter((r) => r.actions.some((a) => ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(a.status))).length], ["Closed", risks.length - live.length]],
        notes: ["Active risks: open or monitoring. Ratings are residual (with existing controls), likelihood x impact on a 5 x 5 matrix: Low 1 to 3, Moderate 4 to 6, High 8 to 12, Extreme 15 to 25.", "With open mitigation: at least one linked action not yet verified."],
        columns: ["Ref", "Risk", "Category", "Scope", "Inherent", "Residual", "Controls", "Owner", "Next review", "Status", "Open actions"],
        rows: risks.map((r) => [r.ref, r.title, RISK_CATEGORIES[r.category as keyof typeof RISK_CATEGORIES] ?? r.category, r.branchId ? (branchName.get(r.branchId) ?? "Branch") : "Whole organisation", `${r.likelihood * r.impact} ${BAND_LABEL[riskBand(r.likelihood * r.impact)]}`, `${residual(r)} ${BAND_LABEL[riskBand(residual(r))]}`, CONTROL_EFFECTIVENESS[r.controlEffectiveness as keyof typeof CONTROL_EFFECTIVENESS] ?? r.controlEffectiveness, names.get(r.ownerId) ?? "", `${d(r.reviewDate)}${riskReviewOverdue(r, now) ? " (overdue)" : ""}`, RISK_STATUS[r.status as keyof typeof RISK_STATUS] ?? r.status, r.actions.filter((a) => ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(a.status)).length]),
        widths: [0.6, 2.4, 1.4, 1.2, 0.9, 0.9, 1.1, 1.2, 1.1, 0.9, 0.7],
      });
    }
    case "evidence": {
      if (!hasOrgPermission(ctx, "evidence.read")) throw new ForbiddenError("Evidence reports need access to the Evidence Library");
      const docs = await db.evidenceDocument.findMany({ where: { organisationId: s.orgId, createdAt: s.range, linkedType: { not: "MISSED_CALL" } }, orderBy: { createdAt: "desc" } });
      const links = await resolveLinks(s.orgId, docs);
      const uploaders = new Map((await db.user.findMany({ where: { id: { in: docs.map((x) => x.uploadedById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const [completedNoEvidence, completedAudits] = await Promise.all([
        db.complianceAction.findMany({ where: { organisationId: s.orgId, status: { in: ["COMPLETED", "VERIFIED", "CLOSED"] }, completionEvidenceId: null, completedAt: s.range }, select: { id: true } }),
        db.audit.findMany({ where: { organisationId: s.orgId, ...auditBranch, status: "COMPLETED", completedAt: s.range }, select: { id: true, answers: { select: { id: true } }, findings: { select: { id: true } } } }),
      ]);
      const linkedIds = new Set((await db.evidenceDocument.findMany({ where: { organisationId: s.orgId, linkedType: { in: ["ACTION", "AUDIT", "AUDIT_ANSWER", "FINDING"] } }, select: { linkedId: true } })).map((x) => x.linkedId));
      const missingActions = completedNoEvidence.filter((a) => !linkedIds.has(a.id)).length;
      const auditsWithout = completedAudits.filter((a) => !linkedIds.has(a.id) && !a.answers.some((x) => linkedIds.has(x.id)) && !a.findings.some((x) => linkedIds.has(x.id))).length;
      return make({
        periodBasis: "upload date",
        summary: [["Files uploaded", docs.length], ["Linked to a record", docs.filter((x) => linkFor(links, x)).length], ["Not malware-scanned", docs.filter((x) => x.scanStatus === "NOT_SCANNED" || x.scanStatus === "PENDING").length], ["Actions done without a file", missingActions], ["Completed audits without evidence", auditsWithout]],
        notes: ["Files uploaded in the period (missed-call evidence is reported in Rostering).", "Not malware-scanned: no scanner was configured when the file was uploaded, so only its type and size were checked.", "Actions done without a file: completed in the period with no evidence attached. Completed audits without evidence: no file on the audit, its questions or its findings."],
        columns: ["Uploaded", "File", "Type", "Linked to", "Record", "Uploaded by", "Scan state"],
        rows: docs.map((x) => {
          const l = linkFor(links, x);
          return [d(x.createdAt), x.filename, x.contentType.split("/").pop() ?? x.contentType, l ? l.typeLabel : x.linkedType ? (LINK_TYPES[x.linkedType as keyof typeof LINK_TYPES] ?? x.linkedType) : "Not linked", l?.label ?? "", uploaders.get(x.uploadedById) ?? "", x.scanStatus.replace(/_/g, " ").toLowerCase()];
        }),
        widths: [0.9, 2.2, 0.8, 1.1, 2.4, 1.2, 1],
      });
    }
  }
}

/** The report as a file. Needs report.export; every export is audited with its filters. */
export async function complianceReportFile(ctx: Ctx, kind: string, f: ReportFilters, format: "csv" | "xlsx" | "pdf") {
  if (!hasOrgPermission(ctx, "report.export")) throw new ForbiddenError("You cannot export reports");
  const r = await complianceReport(ctx, kind, f);
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "report.compliance.exported", entityType: "Report", entityId: kind, data: { format, from: f.from, to: f.to, branch: f.branch ?? null, rows: r.rows.length } });
  const name = `csb-${kind}-${f.from}-to-${f.to}.${format}`;
  if (format === "csv") return { name, type: "text/csv; charset=utf-8", body: Buffer.from(toCsv(r.columns, r.rows)) };
  const { toPdf, toXlsx } = await import("../reports/export-files");
  const table: ExportTable = { title: r.title, subtitle: r.subtitle, columns: r.columns, rows: r.rows, summary: r.summary, widths: r.widths, accent: "#1f5fd1" };
  if (format === "xlsx") return { name, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx(table) };
  return { name, type: "application/pdf", body: await toPdf(table) };
}


