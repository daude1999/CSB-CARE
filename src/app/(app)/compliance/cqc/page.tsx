import { notFound, redirect } from "next/navigation";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs, workspaceHome } from "@/components/compliance-nav";
import { PcSelect } from "@/components/pc-select";
import { Flash, fmtDate } from "@/components/ui";
import { ConfidenceNote, FigureRow, Meter, NotOfficialBanner, Panel, ScoreValue, scoreToneOf, WarningList } from "@/components/cqc-ui";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { membersWithRoles, visibleBranches, visibleServiceTypes } from "@/server/cqc/common";
import { cqcOverview, parseOverviewFilters } from "@/server/cqc/dashboard";
import { KEY_QUESTIONS, KQ_LABEL } from "@/server/cqc/scoring";

export const dynamic = "force-dynamic";

/**
 * CQC Inspection & Evidence overview: where the organisation (or a branch or service) stands, what management must deal
 * with now, and every figure linking to the records it was counted from. Warnings sit above the scores so a high score
 * can never hide an unresolved critical risk.
 */
export default async function CqcOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId) notFound();
  if (!hasOrgPermission(ctx, "cqc.view")) {
    const home = workspaceHome(ctx, "cqc");
    if (home && home !== "/compliance/cqc") redirect(home);
    notFound();
  }
  const f = parseOverviewFilters(sp);
  const [ov, branches, services, managers] = await Promise.all([cqcOverview(ctx, f), visibleBranches(ctx), visibleServiceTypes(ctx), membersWithRoles(ctx.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER"])]);
  const r = ov.live?.readiness ?? null;
  const fig = ov.figures;
  const a = ov.assessment;
  const aHref = a ? `/compliance/cqc/assessments/${a.id}` : null;
  const branchQ = ov.branch ? `&branch=${ov.branch}` : "";
  const filtered = Boolean(f.branch || f.service || f.from || f.to || f.manager);
  const canAssess = hasOrgPermission(ctx, "cqc.assess");
  const canRca = hasOrgPermission(ctx, "rca.create");

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="overview" />}
        title="CQC Inspection & Evidence"
        subtitle="Where the service stands against CQC's five key questions, the evidence behind it, and what management needs to deal with now."
        actions={<>
          {canAssess ? <Link href="/compliance/cqc/assessments#start" className="pc-btn-secondary">Start assessment</Link> : null}
          {canRca ? <Link href="/compliance/cqc/rca/new" className="pc-btn"><Plus size={16} weight="bold" aria-hidden="true" />New RCA Investigation</Link> : null}
        </>}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <form method="get" action="/compliance/cqc" className="pc-panel pc-toolbar" role="search" aria-label="Filter the overview">
          <PcSelect name="branch" label="Branch" defaultValue={f.branch ?? ""} options={[{ value: "", label: ctx.branchIds ? "My branches" : "Organisation-wide" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="service" label="Service" defaultValue={f.service ?? ""} options={[{ value: "", label: "All services" }, ...services.map((s) => ({ value: s.code, label: s.name }))]} />
          <PcSelect name="manager" label="Responsible manager" defaultValue={f.manager ?? ""} options={[{ value: "", label: "Anyone" }, ...managers.map((m) => ({ value: m.id, label: m.name }))]} />
          <label className="pc-select pr-3"><span>From</span><input type="date" name="from" defaultValue={f.from} className="border-0 bg-transparent text-[13.5px]" aria-label="Period from" /></label>
          <label className="pc-select pr-3"><span>To</span><input type="date" name="to" defaultValue={f.to} className="border-0 bg-transparent text-[13.5px]" aria-label="Period to" /></label>
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          {filtered ? <Link href="/compliance/cqc" className="pc-link">Clear filters</Link> : null}
        </form>

        <Panel title="Needs management attention" testId="cqc-attention">
          <WarningList items={ov.warnings} />
        </Panel>

        <NotOfficialBanner>
          {a ? <>Scores from <Link href={aHref!} className="pc-link">{a.reference}</Link> ({a.framework.version}), recalculated now from current records. <Link href="/compliance/cqc/framework#method" className="pc-link">How it is worked out</Link></> : "No assessment yet for this scope, so no scores are shown."}
        </NotOfficialBanner>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Readiness by key question" testId="cqc-readiness" actions={aHref ? <Link href={aHref} className="pc-btn-secondary pc-btn-sm">Open assessment</Link> : null}>
            {r ? (
              <>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-[#eaecf0] px-5 py-4">
                  <div>
                    <span className="block text-[13px] font-medium text-[#475467]">Overall CQC readiness</span>
                    <ScoreValue g={r.overall} big />
                  </div>
                  <p className="max-w-[460px] pb-1 text-[13px] text-[#475467]"><ConfidenceNote g={r.overall} />. Evidence coverage {Math.round(r.overall.evidenceCoverage * 100)}% ({r.overall.withVerifiedEvidence} of {r.overall.applicable} areas have verified, in-date evidence). Coverage is shown apart from the score: having evidence is not the same as being compliant.</p>
                </div>
                <table className="pc-table">
                  <thead><tr><th>Key question</th><th className="w-[38%]">Readiness</th><th>Assessed</th><th>Evidence coverage</th></tr></thead>
                  <tbody>
                    {KEY_QUESTIONS.map((k) => {
                      const g = r.byQuestion[k];
                      return (
                        <tr key={k} data-testid={`kq-${k}`}>
                          <td><Link href={`${aHref}?q=${k}`} className="pc-strong">{KQ_LABEL[k]}</Link></td>
                          <td><div className="flex items-center gap-3"><span className="w-[120px] shrink-0"><ScoreValue g={g} /></span><Meter value={g.score} tone={scoreToneOf(g.score)} /></div></td>
                          <td className="whitespace-nowrap">{g.assessed} of {g.applicable}{g.notApplicable ? <span className="pc-sub">{g.notApplicable} not applicable</span> : null}</td>
                          <td className="whitespace-nowrap">{Math.round(g.evidenceCoverage * 100)}%<span className="pc-sub">{g.withVerifiedEvidence} with verified evidence</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="pc-empty">{canAssess ? <>No readiness assessment yet. <Link href="/compliance/cqc/assessments#start" className="pc-link">Start the first assessment</Link> to see scores.</> : "No readiness assessment has been carried out yet."}</p>
            )}
          </Panel>
          <Panel title="Assessment" testId="cqc-assessment-panel">
            <div className="divide-y divide-[#eaecf0]">
              <FigureRow label="Applicable assessment requirements" value={r ? fig.applicable : null} href={aHref} note={r ? `${r.overall.notApplicable} marked not applicable` : undefined} testId="fig-applicable" />
              <FigureRow label="Last approved assessment" value={ov.lastApproved?.approvedAt ? fmtDate(ov.lastApproved.approvedAt) : "None"} href={ov.lastApproved ? `/compliance/cqc/assessments/${ov.lastApproved.id}` : null} note={ov.lastApproved?.reference} />
              <FigureRow label="Next assessment due" value={ov.lastApproved?.nextDueAt ? fmtDate(ov.lastApproved.nextDueAt) : a?.nextDueAt ? fmtDate(a.nextDueAt) : "Not set"} tone={(ov.lastApproved?.nextDueAt ?? a?.nextDueAt) && (ov.lastApproved?.nextDueAt ?? a?.nextDueAt)! < new Date() ? "red" : undefined} />
              <FigureRow label="Framework version" value={a?.framework.version ?? "—"} href="/compliance/cqc/framework" />
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Evidence" testId="cqc-evidence-figures">
            <div className="divide-y divide-[#eaecf0]">
              <FigureRow label="Linked evidence records" value={fig.evidenceTotal} href={`/compliance/cqc/evidence?x=1${branchQ}`} testId="fig-evidence" />
              <FigureRow label="Verified" value={fig.verified} href={`/compliance/cqc/evidence?status=VERIFIED${branchQ}`} tone="green" testId="fig-verified" />
              <FigureRow label="Awaiting verification" value={fig.awaiting} href={`/compliance/cqc/evidence?status=AWAITING${branchQ}`} tone={fig.awaiting ? "amber" : undefined} />
              <FigureRow label="Missing evidence" value={r ? fig.missing : null} href={`/compliance/cqc/evidence?status=GAPS${branchQ}`} tone={fig.missing ? "red" : undefined} note="Applicable areas with no verified, in-date evidence" testId="fig-missing" />
              <FigureRow label="Expired or outdated" value={fig.outdated} href={`/compliance/cqc/evidence?status=OUTDATED${branchQ}`} tone={fig.outdated ? "amber" : undefined} />
            </div>
          </Panel>
          <Panel title="Improvement and investigations">
            <div className="divide-y divide-[#eaecf0]">
              <FigureRow label="Open corrective actions" value={fig.openActions} href="/actions" />
              <FigureRow label="Overdue corrective actions" value={fig.overdueActions} href="/compliance/cqc/actions?status=OVERDUE" tone={fig.overdueActions ? "red" : undefined} />
              <FigureRow label="Open RCA investigations" value={fig.openRcas} href={fig.openRcas !== null ? "/compliance/cqc/rca?status=OPEN" : null} />
              <FigureRow label="Overdue investigations" value={ov.rca?.overdue ?? null} href={ov.rca ? "/compliance/cqc/rca?status=OVERDUE" : null} tone={ov.rca?.overdue ? "red" : undefined} />
            </div>
          </Panel>
          <Panel title="Care and workforce">
            <div className="divide-y divide-[#eaecf0]">
              <FigureRow label="Open safeguarding concerns" value={fig.safeguarding} href={hasOrgPermission(ctx, "incident.manage") ? "/rota/incidents?safeguarding=1" : null} tone={fig.safeguarding ? "red" : undefined} testId="fig-safeguarding" />
              <FigureRow label="Open incidents" value={fig.incidents} href={hasOrgPermission(ctx, "incident.manage") ? "/rota/incidents" : null} />
              <FigureRow label="Overdue care plan reviews" value={fig.carePlanReviews} href={hasOrgPermission(ctx, "serviceUser.view") ? "/rota/care-plans" : null} tone={fig.carePlanReviews ? "amber" : undefined} />
              <FigureRow label="Overdue risk assessment reviews" value={fig.riskReviews} href={hasOrgPermission(ctx, "serviceUser.view") ? "/rota/risks" : null} tone={fig.riskReviews ? "amber" : undefined} />
              <FigureRow label="Training and competency gaps" value={fig.trainingGaps} href={hasOrgPermission(ctx, "readiness.view") ? "/rota/readiness" : null} tone={fig.trainingGaps ? "amber" : undefined} note="Active staff not fully ready" />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
