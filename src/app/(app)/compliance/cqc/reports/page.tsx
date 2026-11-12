import { notFound } from "next/navigation";
import { DownloadSimple, FileText } from "@phosphor-icons/react/dist/ssr";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { Panel } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ASSESSMENT_STATUS, listAssessments } from "@/server/cqc/assessments";
import { canSeeRcas, listRcas, RCA_STATUS } from "@/server/cqc/rca";

export const dynamic = "force-dynamic";

/** The three CQC reports, each as PDF or CSV, generated from current records with the "not an official rating" label. */
export default async function CqcReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const canCqc = hasOrgPermission(ctx, "cqc.view");
  const canRca = canSeeRcas(ctx);
  if (!ctx.organisationId || !(canCqc || canRca)) notFound();
  const canExport = hasOrgPermission(ctx, "report.export");
  const [assessments, rcas] = await Promise.all([canCqc ? listAssessments(ctx) : Promise.resolve([]), canRca ? listRcas(ctx) : Promise.resolve([])]);
  const visibleRcas = rcas.filter((r) => !r.hidden);

  return (
    <>
      <CompliancePageHeader tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="reports" />} title="Reports" subtitle="Download readiness, investigation and improvement reports for management meetings, the board or inspection preparation. Each download is recorded in the activity log." />
      <Flash searchParams={sp} />
      {!canExport ? <p className="mb-4 rounded-[10px] border border-[#eaecf0] bg-white px-4 py-3 text-body text-[#475467]">Your role cannot export reports. Ask a compliance lead or administrator.</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="cqc-reports">
        {canCqc ? (
          <Panel title={<span className="inline-flex items-center gap-2"><FileText size={18} aria-hidden="true" />CQC inspection readiness</span>}>
            <p className="px-5 pt-3 text-meta text-[#475467]">Scores by key question, confidence, evidence status, gaps, open actions and the approval record for one assessment. Marked “Internal CQC Readiness Assessment – Not an Official CQC Rating”.</p>
            <ul className="divide-y divide-[#eaecf0] pt-2">
              {assessments.slice(0, 12).map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-5 py-2 text-body">
                  <span className="min-w-0 flex-1"><strong>{a.reference}</strong> {a.title}<span className="block text-caption text-[#667085]">{ASSESSMENT_STATUS[a.status as keyof typeof ASSESSMENT_STATUS]} · {fmtDate(a.periodTo)}</span></span>
                  {canExport ? <><a href={`/api/cqc-reports/readiness?id=${a.id}&format=pdf`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${a.reference} readiness report PDF`}><DownloadSimple size={14} aria-hidden="true" />PDF</a><a href={`/api/cqc-reports/readiness?id=${a.id}&format=csv`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${a.reference} readiness report CSV`}>CSV</a></> : null}
                </li>
              ))}
              {!assessments.length ? <li className="px-5 py-3 text-meta text-[#667085]">No assessments yet.</li> : null}
            </ul>
          </Panel>
        ) : null}
        {canRca ? (
          <Panel title={<span className="inline-flex items-center gap-2"><FileText size={18} aria-hidden="true" />RCA investigation</span>}>
            <p className="px-5 pt-3 text-meta text-[#475467]">Summary, timeline, contributing factors, findings, escalation decisions, actions, reviews and closure for one investigation. Restricted cases are only listed for people allowed to see them.</p>
            <ul className="divide-y divide-[#eaecf0] pt-2">
              {visibleRcas.slice(0, 12).map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-5 py-2 text-body">
                  <span className="min-w-0 flex-1"><strong>{r.reference}</strong> {r.title}<span className="block text-caption text-[#667085]">{RCA_STATUS[r.status as keyof typeof RCA_STATUS]}</span></span>
                  {canExport ? <><a href={`/api/cqc-reports/rca?id=${r.id}&format=pdf`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${r.reference} report PDF`}><DownloadSimple size={14} aria-hidden="true" />PDF</a><a href={`/api/cqc-reports/rca?id=${r.id}&format=csv`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${r.reference} report CSV`}>CSV</a></> : null}
                </li>
              ))}
              {!visibleRcas.length ? <li className="px-5 py-3 text-meta text-[#667085]">No investigations yet.</li> : null}
            </ul>
          </Panel>
        ) : null}
        <Panel title={<span className="inline-flex items-center gap-2"><FileText size={18} aria-hidden="true" />Improvement actions</span>}>
          <p className="px-5 pt-3 text-meta text-[#475467]">Reference, source, action, type, priority, responsible person, due date, progress and verification outcome.</p>
          {canExport ? (
            <ul className="divide-y divide-[#eaecf0] pt-2">
              {[["OPEN", "All open actions"], ["OVERDUE", "Overdue actions"], ["", "All actions"]].map(([status, label]) => (
                <li key={label} className="flex items-center gap-2 px-5 py-2 text-body">
                  <span className="flex-1">{label}</span>
                  <a href={`/api/cqc-reports/actions?status=${status}&format=pdf`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${label} PDF`}><DownloadSimple size={14} aria-hidden="true" />PDF</a>
                  <a href={`/api/cqc-reports/actions?status=${status}&format=csv`} data-no-progress="" className="pc-btn-secondary pc-btn-sm" aria-label={`${label} CSV`}>CSV</a>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
