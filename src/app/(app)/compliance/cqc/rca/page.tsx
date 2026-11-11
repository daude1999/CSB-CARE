import { notFound } from "next/navigation";
import { DownloadSimple, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { FigureRow, Panel, RCA_TONE, SEVERITY_TONE } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { membersWithRoles, visibleBranches, visibleServiceTypes } from "@/server/cqc/common";
import { canSeeRcas, listRcas, parseRcaFilters, RCA_CATEGORIES, RCA_STATUS, rcaDashboard, SEVERITIES, SOURCE_KINDS } from "@/server/cqc/rca";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const REPORT = "/api/cqc-reports/actions?source=RCA&format=";

/**
 * Root Cause Analysis: what is open, overdue or critical, recurring themes, and the list of investigations. Every figure
 * is a link to the list filtered to the investigations it counts.
 */
export default async function RcaListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId || !canSeeRcas(ctx)) notFound();
  const f = parseRcaFilters(sp);
  const [rows, dash, branches, services, people] = await Promise.all([listRcas(ctx, f), rcaDashboard(ctx, f), visibleBranches(ctx), visibleServiceTypes(ctx), membersWithRoles(ctx.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "POLICY_REVIEWER", "POLICY_APPROVER"])]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));
  const done = rows.length ? await db.complianceAction.groupBy({ by: ["rcaId", "status"], where: { rcaId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }) : [];
  const progress = new Map<string, { done: number; total: number }>();
  for (const d of done) {
    const p = progress.get(d.rcaId!) ?? { done: 0, total: 0 };
    p.total += d._count._all;
    if (d.status === "VERIFIED" || d.status === "CLOSED") p.done += d._count._all;
    progress.set(d.rcaId!, p);
  }
  const href = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...f, ...o })) if (v) p.set(k, v); return `/compliance/cqc/rca?${p}`; };
  const filtered = Object.values(f).some(Boolean);
  const canCreate = hasOrgPermission(ctx, "rca.create");

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="rca" />}
        title="Root Cause Analysis"
        subtitle="Investigations into incidents, missed calls, audit findings and risks: what happened, why, what is being done, and whether it worked."
        actions={canCreate ? <Link href="/compliance/cqc/rca/new" className="pc-btn"><Plus size={16} weight="bold" aria-hidden="true" />New RCA Investigation</Link> : null}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <form method="get" action="/compliance/cqc/rca" className="pc-panel pc-toolbar" role="search" aria-label="Filter investigations">
          <PcSearch placeholder="Reference, title or linked record" defaultValue={f.q} label="Search investigations" />
          <PcSelect name="status" label="Status" defaultValue={f.status ?? ""} options={[{ value: "", label: "Any" }, { value: "OPEN", label: "All open" }, { value: "OVERDUE", label: "Overdue" }, { value: "CRITICAL", label: "Critical, open" }, ...Object.entries(RCA_STATUS).map(([value, label]) => ({ value, label }))]} />
          <PcSelect name="severity" label="Severity" defaultValue={f.severity ?? ""} options={[{ value: "", label: "Any" }, ...Object.entries(SEVERITIES).map(([value, label]) => ({ value, label }))]} />
          <PcSelect name="category" label="Category" defaultValue={f.category ?? ""} options={[{ value: "", label: "Any" }, ...RCA_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
          <PcSelect name="branch" label="Branch" defaultValue={f.branch ?? ""} options={[{ value: "", label: "All" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="service" label="Service" defaultValue={f.service ?? ""} options={[{ value: "", label: "All" }, ...services.map((s) => ({ value: s.code, label: s.name }))]} />
          <PcSelect name="owner" label="Investigator or manager" defaultValue={f.owner ?? ""} options={[{ value: "", label: "Anyone" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
          <label className="pc-select pr-3"><span>From</span><input type="date" name="from" defaultValue={f.from} className="border-0 bg-transparent text-body" aria-label="Event from" /></label>
          <label className="pc-select pr-3"><span>To</span><input type="date" name="to" defaultValue={f.to} className="border-0 bg-transparent text-body" aria-label="Event to" /></label>
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          {filtered ? <Link href="/compliance/cqc/rca" className="pc-link">Clear filters</Link> : null}
        </form>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="pc-panel" data-testid="rca-list">
            <div className="pc-panel-head"><h2 className="pc-panel-title">Investigations <span className="font-normal text-[#667085]">({rows.length})</span></h2></div>
            <PcTableWrap label="Investigations">
              <table className="pc-table">
                <thead><tr><th>Reference</th><th>Investigation</th><th>Severity</th><th>Status</th><th>Investigator</th><th>Due</th><th className="text-right">Actions done</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = progress.get(r.id) ?? { done: 0, total: 0 };
                    return (
                      <tr key={r.id} data-testid={`rca-${r.reference}`}>
                        <td className="whitespace-nowrap"><Link href={`/compliance/cqc/rca/${r.id}`} className="pc-strong">{r.reference}</Link>{r.restricted ? <span className="pc-sub">Restricted</span> : null}</td>
                        <td className="min-w-[240px] max-w-[380px]">
                          <span className="block text-[#101828]">{r.title}</span>
                          <span className="pc-sub">{r.category} · {fmtDate(r.eventDate)} · {r.branchId ? branchNames.get(r.branchId) ?? "Branch" : "Whole organisation"}{!r.hidden && r.sources.length ? ` · ${r.sources.map((s) => `${SOURCE_KINDS[s.sourceType as keyof typeof SOURCE_KINDS] ?? s.sourceType} ${s.sourceRef}`).join(", ")}` : ""}</span>
                        </td>
                        <td><PcBadge tone={SEVERITY_TONE[r.severity] ?? "grey"}>{SEVERITIES[r.severity as keyof typeof SEVERITIES]}</PcBadge></td>
                        <td className="whitespace-nowrap"><PcBadge tone={RCA_TONE[r.status] ?? "grey"}>{RCA_STATUS[r.status as keyof typeof RCA_STATUS]}</PcBadge></td>
                        <td className="whitespace-nowrap">{names.get(r.ownerId) ?? "—"}</td>
                        <td className={`whitespace-nowrap ${r.overdue ? "font-semibold text-[#b42318]" : ""}`}>{fmtDate(r.dueDate)}{r.overdue ? <span className="pc-sub text-[#b42318]">Overdue</span> : null}</td>
                        <td className="text-right tabular-nums">{p.total ? `${p.done} of ${p.total}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PcTableWrap>
            {!rows.length ? <p className="pc-empty">{filtered ? "No investigations match these filters." : "No investigations yet. Start one from an incident, a missed call or here."}</p> : null}
          </section>

          <div className="space-y-4">
            <Panel title="At a glance" testId="rca-figures">
              <div className="divide-y divide-[#eaecf0]">
                <FigureRow label="Open investigations" value={dash.total - dash.closed} href={href({ status: "OPEN" })} />
                <FigureRow label="New" value={dash.new} href={href({ status: "NEW" })} />
                <FigureRow label="Investigating" value={dash.investigating} href={href({ status: "INVESTIGATING" })} />
                <FigureRow label="Awaiting management review" value={dash.awaitingReview} href={href({ status: "AWAITING_REVIEW" })} tone={dash.awaitingReview ? "amber" : undefined} />
                <FigureRow label="Overdue" value={dash.overdue} href={href({ status: "OVERDUE" })} tone={dash.overdue ? "red" : undefined} testId="rca-overdue" />
                <FigureRow label="Critical, still open" value={dash.critical} href={href({ status: "CRITICAL" })} tone={dash.critical ? "red" : undefined} />
                <FigureRow label="Actions outstanding" value={dash.actionsOutstanding} href="/compliance/cqc/actions?source=RCA&status=OPEN" />
                <FigureRow label="Effectiveness reviews due" value={dash.effectivenessDue} href={href({ status: "EFFECTIVENESS_REVIEW" })} />
                <FigureRow label="Closed" value={dash.closed} href={href({ status: "CLOSED" })} />
              </div>
            </Panel>
            <Panel title="Recurring themes" testId="rca-themes">
              {dash.themes.length ? (
                <ul className="divide-y divide-[#eaecf0]">{dash.themes.map(([c, n]) => <li key={c}><Link href={href({ category: c })} className="flex justify-between px-5 py-2 text-body no-underline hover:bg-[#f9fafb]"><span className="text-[#344054]">{c}</span><strong className="tabular-nums">{n}</strong></Link></li>)}</ul>
              ) : <p className="px-5 py-3 text-meta text-[#667085]">No category has come up more than once in the last 12 months.</p>}
              <p className="border-t border-[#eaecf0] px-5 py-2 text-caption text-[#667085]">Categories with two or more investigations in the last 12 months.</p>
            </Panel>
            {hasOrgPermission(ctx, "report.export") ? (
              <Panel title="Export">
                <div className="flex flex-wrap gap-2 px-5 py-3">
                  <a href={`${REPORT}pdf`} data-no-progress="" className="pc-btn-secondary pc-btn-sm"><DownloadSimple size={14} aria-hidden="true" />RCA actions (PDF)</a>
                  <a href={`${REPORT}csv`} data-no-progress="" className="pc-btn-secondary pc-btn-sm">CSV</a>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
