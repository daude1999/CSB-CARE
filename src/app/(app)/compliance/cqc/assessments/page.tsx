import { notFound } from "next/navigation";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcTableWrap } from "@/components/compliance-ui";
import { ASSESSMENT_TONE, NotOfficialBanner, Panel } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { createAssessmentAction } from "@/app/cqc-actions";
import { londonDate, addDays } from "@/lib/london";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ASSESSMENT_STATUS, listAssessments } from "@/server/cqc/assessments";
import { visibleBranches, visibleServiceTypes } from "@/server/cqc/common";
import { activeFramework } from "@/server/cqc/framework";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** CQC Assessment: every readiness assessment in the person's branches, and the form to start one. */
export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "cqc.view")) notFound();
  const [rows, branches, services, fw] = await Promise.all([listAssessments(ctx, { status: sp.status, branchId: sp.branch }), visibleBranches(ctx), visibleServiceTypes(ctx), activeFramework()]);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.assessorId, r.approvedById].filter((x): x is string => Boolean(x))))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const serviceName = new Map(services.map((s) => [s.code, s.name]));
  const canAssess = hasOrgPermission(ctx, "cqc.assess");
  const today = londonDate();
  const previous = rows.filter((r) => r.status === "APPROVED" || r.status === "SUPERSEDED");
  return (
    <>
      <CompliancePageHeader tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="assessments" />} title="CQC Assessment" subtitle={<>Internal readiness assessments against the five key questions, using framework <Link href="/compliance/cqc/framework" className="pc-link">{fw.version}</Link>. Each is approved by someone other than the assessor, and earlier versions are kept.</>} />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <NotOfficialBanner>Results and scores are a management tool and are not shared with CQC.</NotOfficialBanner>
        <Panel title="Assessments" testId="assessment-list" actions={
          <form method="get" className="flex flex-wrap items-center gap-2" aria-label="Filter assessments">
            <select name="status" defaultValue={sp.status ?? ""} className="input h-9 py-0 text-body" aria-label="Status"><option value="">Any status</option>{Object.entries(ASSESSMENT_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {branches.length > 1 ? <select name="branch" defaultValue={sp.branch ?? ""} className="input h-9 py-0 text-body" aria-label="Branch"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
            <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          </form>
        }>
          {rows.length ? (
            <PcTableWrap label="Assessments">
              <table className="pc-table">
                <thead><tr><th>Assessment</th><th>Branch and service</th><th>Period</th><th>Assessor</th><th>Progress</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid={`assessment-${r.reference}`}>
                      <td className="min-w-[220px]"><Link href={`/compliance/cqc/assessments/${r.id}`} className="pc-strong"><span className="mr-1.5 font-normal text-[#667085]">{r.reference}</span>{r.title}</Link><span className="pc-sub">Framework {r.framework.version}</span></td>
                      <td>{r.branchId ? (branchName.get(r.branchId) ?? "Branch") : "Whole organisation"}<span className="pc-sub">{r.serviceTypeCode ? (serviceName.get(r.serviceTypeCode) ?? r.serviceTypeCode) : "All services"}</span></td>
                      <td className="whitespace-nowrap">{fmtDate(r.periodFrom)} to {fmtDate(r.periodTo)}</td>
                      <td className="whitespace-nowrap">{users.get(r.assessorId) ?? "—"}{r.approvedById ? <span className="pc-sub">Approved by {users.get(r.approvedById)}</span> : null}</td>
                      <td className="whitespace-nowrap">{r._count.results} areas recorded</td>
                      <td><PcBadge tone={ASSESSMENT_TONE[r.status] ?? "grey"}>{ASSESSMENT_STATUS[r.status as keyof typeof ASSESSMENT_STATUS] ?? r.status}</PcBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PcTableWrap>
          ) : <p className="pc-empty">{sp.status || sp.branch ? "No assessments match these filters." : "No assessments yet."}</p>}
        </Panel>
        {canAssess ? (
          <Panel title="Start an assessment" testId="start-assessment">
            <form action={createAssessmentAction} id="start" className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              <input type="hidden" name="back" value="/compliance/cqc/assessments" />
              <label><span className="label">Branch</span><select name="branchId" className="input" defaultValue="" required={Boolean(ctx.branchIds)}>{ctx.branchIds ? null : <option value="">Whole organisation</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label><span className="label">Service</span><select name="serviceTypeCode" className="input" defaultValue=""><option value="">All services</option>{services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
              <label><span className="label">Title (optional)</span><input name="title" className="input" maxLength={200} placeholder="For example: Liverpool quarterly readiness" /></label>
              <label><span className="label">Period from</span><input type="date" name="periodFrom" className="input" defaultValue={addDays(today, -90)} required /></label>
              <label><span className="label">Period to</span><input type="date" name="periodTo" className="input" defaultValue={today} required /></label>
              <label><span className="label">Next assessment due</span><input type="date" name="nextDueAt" className="input" defaultValue={addDays(today, 90)} /></label>
              <label className="md:col-span-2"><span className="label">Start from an earlier approved assessment (optional)</span><select name="copyFromId" className="input" defaultValue=""><option value="">Start blank</option>{previous.map((p) => <option key={p.id} value={p.id}>{p.reference} {p.title}</option>)}</select><span className="mt-1 block text-meta text-[#667085]">Copies the earlier results as a starting point. Each one can then be checked and changed; the earlier assessment is not changed.</span></label>
              <div className="flex items-end"><button className="pc-btn" type="submit">Start assessment</button></div>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
