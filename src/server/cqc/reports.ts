import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { toCsv } from "@/lib/csv";
import { audit } from "../audit-log";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import type { ExportCell, PdfSection } from "../reports/export-files";
import { getAssessment } from "./assessments";
import { cqcOverview } from "./dashboard";
import { improvementActions } from "./improvements";
import { ESCALATION_DECISIONS, ESCALATIONS, EFFECTIVENESS, FACTOR_AREAS, FINDING_KINDS, getRca, HARM, RCA_STATUS, SEVERITIES, TIMELINE_KINDS, type Factors, type TimelineEntry } from "./rca";
import { KEY_QUESTIONS, KQ_LABEL, RESULT_LABEL, SCORING_METHOD } from "./scoring";
import { LINK_STATUS } from "./evidence";
import { ASSESSMENT_STATUS } from "./assessments";

/**
 * The three management reports of CQC Inspection & Evidence, built from current records when generated, after the same
 * permission and branch checks as the screens. Each report states that it is an internal document, not a CQC
 * inspection report or rating. Every generation and download is recorded in the audit log.
 */
export const NOT_OFFICIAL = "Internal CQC Readiness Assessment – Not an Official CQC Rating";
const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
const pct = (n: number) => `${Math.round(n * 100)}%`;

export interface ReportDoc { title: string; subtitle: string; sections: PdfSection[]; csv: { columns: string[]; rows: ExportCell[][] } }

export async function readinessReport(ctx: Ctx, assessmentId: string): Promise<ReportDoc> {
  const a = await getAssessment(ctx, assessmentId);
  const r = a.readiness;
  const ov = await cqcOverview(ctx, { branch: a.assessment.branchId ?? undefined });
  const resultBy = a.results;
  const evidence = new Map<string, { verified: string[]; awaiting: number }>();
  for (const l of a.links) {
    const e = evidence.get(l.criterionId) ?? { verified: [], awaiting: 0 };
    if (l.effective === "VERIFIED") e.verified.push(l.info.label);
    if (l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW") e.awaiting++;
    evidence.set(l.criterionId, e);
  }
  const scoreBy = new Map(r.criteria.map((c) => [c.id, c]));
  const openActions = a.actions.filter((x) => ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(x.status));
  const rows: ExportCell[][] = a.criteria.map((c) => {
    const res = resultBy.get(c.id);
    const e = evidence.get(c.id);
    const s = scoreBy.get(c.id);
    return [KQ_LABEL[c.keyQuestion as keyof typeof KQ_LABEL], c.code, c.title, res ? RESULT_LABEL[res.result] ?? res.result : "Not assessed", res?.result === "NOT_APPLICABLE" ? `Not applicable: ${res.naReason}` : (res?.rationale ?? ""), e?.verified.length ? e.verified.join("; ") : "None verified", e?.awaiting ?? 0, s?.score ?? "", openActions.filter((x) => x.cqcCriterionId === c.id).length];
  });
  const columns = ["Key question", "Code", "Assessment area", "Result", "Rationale", "Verified evidence", "Evidence awaiting review", "Area score", "Open actions"];
  const summary: [string, ExportCell][] = [
    ["Overall readiness", r.overall.score !== null ? `${r.overall.score} (high confidence)` : r.overall.confidence === "LOW" ? `Held back: low confidence (${r.overall.assessed} of ${r.overall.applicable} areas assessed)` : "Not assessed"],
    ...KEY_QUESTIONS.map((k): [string, ExportCell] => [KQ_LABEL[k], r.byQuestion[k].score !== null ? r.byQuestion[k].score : r.byQuestion[k].confidence === "LOW" ? `Low confidence (${r.byQuestion[k].assessed}/${r.byQuestion[k].applicable})` : "Not assessed"]),
    ["Applicable areas", r.overall.applicable],
    ["Areas with verified, in-date evidence", `${r.overall.withVerifiedEvidence} (${pct(r.overall.evidenceCoverage)})`],
    ["Areas missing verified evidence", r.overall.applicable - r.overall.withVerifiedEvidence],
    ["Open improvement actions", openActions.length],
  ];
  const title = NOT_OFFICIAL;
  const subtitle = `${a.assessment.reference} ${a.assessment.title} · ${a.branchName} · ${a.serviceName} · period ${d(a.assessment.periodFrom)} to ${d(a.assessment.periodTo)} · framework ${a.assessment.framework.version} · status ${ASSESSMENT_STATUS[a.assessment.status as keyof typeof ASSESSMENT_STATUS] ?? a.assessment.status} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return {
    title,
    subtitle,
    sections: [
      { heading: "Readiness scores", note: `Internal management scores (method ${SCORING_METHOD}). They do not reproduce or predict a CQC rating.`, summary },
      { heading: "Critical findings and warnings", note: "Shown whatever the scores.", table: { columns: ["Level", "Warning"], rows: ov.warnings.map((w) => [w.level === "critical" ? "Critical" : "High", w.text]), widths: [1, 6] }, empty: "No warnings at the time of generation." },
      { heading: "Assessment areas", table: { columns, rows, widths: [1.1, 0.6, 2, 1, 3, 3, 0.9, 0.7, 0.7] } },
      { heading: "Open improvement actions", table: { columns: ["Action", "Due", "Status"], rows: openActions.map((x) => [x.title, d(x.dueDate), x.status]), widths: [5, 1, 1.2] }, empty: "No open improvement actions." },
      { heading: "Management comments", definitions: [["Comment", a.assessment.managementComment || "None recorded"], ["Approved", a.assessment.approvedAt ? `${d(a.assessment.approvedAt)}` : "Not yet approved"]] },
    ],
    csv: { columns, rows },
  };
}

export async function rcaReport(ctx: Ctx, rcaId: string): Promise<ReportDoc> {
  const x = await getRca(ctx, rcaId);
  const r = x.rca;
  const name = (id: string | null | undefined) => (id ? (x.names.get(id) ?? "Unknown") : "");
  const timeline = (r.timeline as unknown as TimelineEntry[]).map((t): ExportCell[] => [t.at.slice(0, 16).replace("T", " "), TIMELINE_KINDS[t.kind], t.text]);
  const factors = Object.entries(r.factors as Factors).filter(([, v]) => v?.relevant || v?.notes).map(([k, v]): ExportCell[] => [FACTOR_AREAS[k as keyof typeof FACTOR_AREAS] ?? k, v!.relevant ? "Contributed" : "Considered", v!.notes]);
  const findings = x.findings.map((f): ExportCell[] => [FINDING_KINDS[f.kind as keyof typeof FINDING_KINDS] ?? f.kind, f.text, f.evidence, f.status === "CONFIRMED" ? `Confirmed by ${name(f.confirmedById)}` : f.status === "NOT_SUPPORTED" ? "Not supported" : "Proposed (not confirmed)"]);
  const actions = x.actions.map((a): ExportCell[] => [a.actionType === "PREVENTATIVE" ? "Preventative" : "Corrective", a.title, name(a.ownerId), d(a.dueDate), a.status, a.verifiedAt ? `Verified ${d(a.verifiedAt)} by ${name(a.verifiedById)}` : "Not verified"]);
  const reviews = x.reviews.map((v): ExportCell[] => [d(v.createdAt), v.stage, EFFECTIVENESS[v.decision as keyof typeof EFFECTIVENESS] ?? v.decision, name(v.reviewerId), v.note]);
  const escalations = x.escalations.map((e): ExportCell[] => [ESCALATIONS[e.kind as keyof typeof ESCALATIONS] ?? e.kind, ESCALATION_DECISIONS[e.decision as keyof typeof ESCALATION_DECISIONS] ?? e.decision, e.rationale, e.externalRef ?? "", name(e.decidedById), d(e.decidedAt)]);
  const sources = x.sources.map((s) => `${s.sourceRef}${s.externalRef ? ` (external ref ${s.externalRef})` : ""}`).join("; ") || "None";
  const csvRows: ExportCell[][] = [
    ...timeline.map((t) => ["Timeline", ...t]),
    ...factors.map((t) => ["Contributing factor", ...t]),
    ...findings.map((t) => ["Finding", ...t]),
    ...actions.map((t) => ["Action", ...t]),
    ...reviews.map((t) => ["Review", ...t]),
    ...escalations.map((t) => ["Escalation", ...t]),
  ];
  return {
    title: `Root cause analysis ${r.reference}`,
    subtitle: `Internal investigation report, not an official CQC report · ${x.branchName} · status ${RCA_STATUS[r.status as keyof typeof RCA_STATUS]} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC${r.restricted ? " · RESTRICTED: safeguarding confidential" : ""}`,
    sections: [
      { heading: "Summary", summary: [["Title", r.title], ["Source records", sources], ["Category", r.category], ["Severity", SEVERITIES[r.severity as keyof typeof SEVERITIES]], ["Date of event", d(r.eventDate)], ["Opened", d(r.openedAt)], ["Investigator", name(r.ownerId)], ["Responsible manager", name(r.managerId)], ["Due", d(r.dueDate)], ["Harm", r.harm ? HARM[r.harm as keyof typeof HARM] : "Not recorded"]], definitions: [["What happened", r.summary ?? "Not recorded"], ["Immediate actions", r.immediateActions ?? "Not recorded"]] },
      { heading: "Timeline", note: "Facts, witness accounts and assumptions are kept apart.", table: { columns: ["When", "Kind", "Entry"], rows: timeline, widths: [1.2, 1.1, 5] }, empty: "No timeline entries." },
      { heading: "Contributing factors", table: { columns: ["Area", "Assessment", "Notes"], rows: factors, widths: [1.5, 1, 5] }, empty: "No factors recorded.", definitions: (r.fiveWhys as string[]).map((w, i): [string, string] => [`Why ${i + 1}`, w]) },
      { heading: "Root cause findings", definitions: [["Immediate cause", r.immediateCause ?? "Not recorded"], ["Underlying causes", r.underlyingCauses ?? "Not recorded"], ["Uncertainties", r.uncertainties ?? "None recorded"], ["Conclusions", r.conclusions ?? "Not recorded"]], table: { columns: ["Kind", "Finding", "Supporting evidence", "Status"], rows: findings, widths: [1.2, 3, 3, 1.5] } },
      { heading: "Corrective and preventative actions", table: { columns: ["Type", "Action", "Responsible", "Due", "Status", "Verification"], rows: actions, widths: [1, 3, 1.3, 0.9, 1, 1.8] }, empty: "No actions." },
      { heading: "Escalation decisions", note: "Recorded by managers. The platform does not decide or send statutory notifications.", table: { columns: ["Question", "Decision", "Rationale", "External ref", "Decided by", "On"], rows: escalations, widths: [2, 1.3, 3, 1, 1.2, 0.8] }, empty: "No escalation decisions recorded." },
      { heading: "Approvals, effectiveness reviews and closure", table: { columns: ["Date", "Stage", "Decision", "By", "Note"], rows: reviews, widths: [0.9, 1.3, 1.3, 1.3, 4] }, empty: "No reviews yet.", definitions: r.closedAt ? [["Closure", `${d(r.closedAt)} by ${name(r.closedById)}${r.closureException ? ` as an approved exception: ${r.exceptionReason}` : ""}. ${r.closureNote ?? ""}`]] : [] },
    ],
    csv: { columns: ["Section", "A", "B", "C", "D", "E", "F"], rows: csvRows },
  };
}

export async function improvementReport(ctx: Ctx, f: { status?: string; source?: string } = {}): Promise<ReportDoc> {
  const rows = await improvementActions(ctx, f);
  const columns = ["Action reference", "Source", "Action", "Type", "Priority", "Responsible", "Due date", "Progress", "Verification outcome", "Overdue"];
  const data: ExportCell[][] = rows.map((a) => [a.reference, a.sourceLabel, a.title, a.typeLabel, a.priorityLabel, a.ownerName, d(a.dueDate), a.statusLabel, a.verification, a.overdue ? "Overdue" : ""]);
  return {
    title: "Improvement action report",
    subtitle: `Actions from root cause analyses and internal CQC readiness assessments · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · internal document`,
    sections: [
      { heading: "Summary", summary: [["Actions", rows.length], ["Open", rows.filter((a) => ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(a.status)).length], ["Overdue", rows.filter((a) => a.overdue).length], ["Verified", rows.filter((a) => a.status === "VERIFIED" || a.status === "CLOSED").length]] },
      { heading: "Actions", table: { columns, rows: data, widths: [1.3, 1.3, 3, 1, 0.8, 1.3, 0.9, 1.1, 1.4, 0.7] }, empty: "No actions." },
    ],
    csv: { columns, rows: data },
  };
}

export const CQC_REPORTS = { readiness: "CQC inspection readiness report", rca: "RCA investigation report", actions: "Improvement action report" } as const;

export async function cqcReportFile(ctx: Ctx, kind: string, params: { id?: string; status?: string; source?: string }, format: "csv" | "pdf") {
  if (!hasOrgPermission(ctx, "report.export")) throw new ForbiddenError("You cannot export reports");
  if (!(kind in CQC_REPORTS)) throw new NotFoundError("Report");
  if ((kind === "readiness" || kind === "rca") && !params.id) throw new ValidationError("Choose the assessment or investigation");
  const doc = kind === "readiness" ? await readinessReport(ctx, params.id!) : kind === "rca" ? await rcaReport(ctx, params.id!) : await improvementReport(ctx, params);
  const ref = kind === "readiness" ? (await db.cqcAssessment.findUnique({ where: { id: params.id! }, select: { reference: true } }))?.reference : kind === "rca" ? (await db.rcaInvestigation.findUnique({ where: { id: params.id! }, select: { reference: true } }))?.reference : "actions";
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "report.cqc.generated", entityType: "Report", entityId: kind, data: { format, id: params.id ?? null, reference: ref ?? null } });
  const name = `csb-${kind}-${ref ?? "report"}-${new Date().toISOString().slice(0, 10)}.${format}`;
  if (format === "csv") return { name, type: "text/csv; charset=utf-8", body: Buffer.from(toCsv(doc.csv.columns, doc.csv.rows)) };
  const { toPdfReport } = await import("../reports/export-files");
  return { name, type: "application/pdf", body: await toPdfReport({ title: doc.title, subtitle: doc.subtitle, sections: doc.sections }) };
}

export { LINK_STATUS };
