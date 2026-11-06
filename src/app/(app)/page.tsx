import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { complianceDashboard } from "@/server/compliance/dashboard";
import { setupChecklist } from "@/server/setup/checklist";
import { SetupPanel } from "@/components/setup-panel";
import { CheckCircle, Files, Info, Plus, Stamp, CalendarX } from "@phosphor-icons/react/dist/ssr";
import { CompliancePageHeader } from "@/components/module-header";
import { canUseQueue } from "@/components/compliance-nav";
import { PcBadge, PcFigure, PcTableWrap, type PcTone } from "@/components/compliance-ui";
import { fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const CHANGE_STATUS: Record<string, { label: string; tone: PcTone }> = {
  NEWLY_DETECTED: { label: "Awaiting triage", tone: "red" },
  AWAITING_CLASSIFICATION: { label: "Awaiting triage", tone: "red" },
  POTENTIALLY_SUBSTANTIVE: { label: "Awaiting triage", tone: "red" },
  UNDER_REVIEW: { label: "Under review", tone: "blue" },
  CONFIRMED_RELEVANT: { label: "Impact assessment", tone: "amber" },
  IMPACT_ASSESSMENT_COMPLETED: { label: "Decision needed", tone: "blue" },
  POLICY_REVISION_REQUIRED: { label: "Revision needed", tone: "amber" },
};

/**
 * Compliance Dashboard (owner's brief of 3 Nov 2026, screenshot 01): four figures, what needs attention, recent
 * regulatory updates and the next policy reviews. Every figure is counted from the caller's own records today and
 * links to the list it was counted from.
 */
export default async function Dashboard() {
  const ctx = await requireCtx();
  const now = new Date();
  const dash = await complianceDashboard(ctx, now);
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, isDemo: true } }) : null;
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB";
  const firstName = ctx.userName.split(/\s+/)[0]!;
  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const steps = canManage ? await setupChecklist(ctx.organisationId!) : [];
  const f = dash.figures;
  const own = Boolean(ctx.organisationId);

  return (
    <div className="relative min-w-0">
      <CompliancePageHeader
        title="Compliance Dashboard"
        subtitle={`Overview of policy compliance, regulatory updates and key actions for ${orgName}.`}
        actions={hasOrgPermission(ctx, "policy.author") ? <Link href="/policies/new" className="pc-btn"><Plus size={16} weight="bold" aria-hidden="true" />Create policy</Link> : undefined}
      />

      <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-figures">
        <PcFigure icon={<Files size={20} />} label={own ? "Total policies" : "Total templates"} value={f.total} note={own ? "Active in your library" : "CSB starter library"} href="/policies" testId="figure-total" />
        <PcFigure icon={<CheckCircle size={20} />} iconTone="green" label="Up to date" value={f.upToDate} note="Published, review not yet due" href="/policies?status=current" testId="figure-up-to-date" />
        <PcFigure icon={<CalendarX size={20} />} iconTone="amber" label="Needs review" value={f.needsReview} note={`${f.overdue} overdue · ${f.dueSoon} due in 60 days`} href="/policies?tab=calendar" testId="figure-needs-review" />
        <PcFigure icon={<Stamp size={20} />} iconTone="blue" label="Drafts in progress" value={f.draftsInProgress} note="Not yet published" href={canUseQueue(ctx) ? "/queue" : "/policies?quick=drafts"} testId="figure-drafts" />
      </section>
      <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-[#667085]">
        <Info size={14} aria-hidden="true" className="shrink-0" />
        Counted from your own policy library today ({fmtDate(now)}). CSB central documents you use as published are kept up to date by CSB and are not counted here.{org?.isDemo ? " Sample workspace: records are illustrative." : ""}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section aria-labelledby="attention-heading" className="pc-panel">
          <div className="pc-panel-head">
            <h2 id="attention-heading" className="pc-panel-title flex items-center gap-2">Needs attention {dash.attention.some((x) => x.count) ? <PcBadge tone="red">{dash.attention.filter((x) => x.count).length}</PcBadge> : null}</h2>
          </div>
          {dash.attention.some((x) => x.count) ? (
            <ul className="divide-y divide-[#f2f4f7]" data-testid="needs-attention">
              {dash.attention.filter((x) => x.count).map((x) => (
                <li key={x.key} className="flex items-center gap-3 px-5 py-3">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${x.key === "drafts" ? "bg-[#6941c6]" : x.tone === "rose" ? "bg-[#d92d20]" : "bg-[#f79009]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#101828]">{x.label} <span className="font-normal text-[#667085]">· {x.count}</span></span>
                    <span className="block truncate text-[13px] text-[#475467]" title={x.detail}>{x.detail}</span>
                  </span>
                  <Link href={x.href} className="pc-link">{x.action}<span className="sr-only">: {x.label}</span></Link>
                </li>
              ))}
            </ul>
          ) : <p className="pc-empty">Nothing is overdue or waiting on you.</p>}
        </section>

        <section aria-labelledby="updates-heading" className="pc-panel">
          <div className="pc-panel-head">
            <h2 id="updates-heading" className="pc-panel-title">Recent regulatory updates</h2>
            <Link href="/changes?group=all" className="pc-link">Regulatory Monitoring</Link>
          </div>
          {dash.recentUpdates.length ? (
            <ul className="divide-y divide-[#f2f4f7]" data-testid="recent-updates">
              {dash.recentUpdates.map((c) => {
                const st = CHANGE_STATUS[c.status] ?? { label: "Closed", tone: "grey" as const };
                return (
                  <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/changes/${c.id}`} className="pc-plain block truncate text-[14px] font-semibold text-[#101828] no-underline hover:text-[#5b2bb5]">{c.title}</Link>
                      <span className="block truncate text-[13px] text-[#475467]">{c.source.name} · {c.officialDate ? `published ${fmtDate(c.officialDate)}` : `detected ${fmtDate(c.detectedAt)}`}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <PcBadge tone={st.tone}>{st.label}</PcBadge>
                      {c.isSimulated ? <PcBadge tone="purple" title="Demonstration data, not a real regulatory update">Simulated</PcBadge> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="pc-empty">No regulatory updates have been detected yet.</p>}
        </section>
      </div>

      <section aria-labelledby="dates-heading" className="pc-panel mt-4">
        <div className="pc-panel-head">
          <h2 id="dates-heading" className="pc-panel-title">Key dates · policy reviews</h2>
          {own ? <Link href="/policies?tab=calendar" className="pc-link">View calendar</Link> : null}
        </div>
        {dash.keyDates.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="key-dates">
              <thead><tr><th>Policy</th><th>Ref</th><th>Review due</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>
                {dash.keyDates.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/policies?selected=${p.id}`} className="pc-strong">{p.title}</Link></td>
                    <td className="whitespace-nowrap">{p.ref}</td>
                    <td className={`whitespace-nowrap ${p.state === "overdue" ? "font-semibold text-[#b42318]" : ""}`}>{fmtDate(p.nextReviewDate)}</td>
                    <td>{p.owner ?? <span className="text-[#667085]">Not recorded</span>}</td>
                    <td>{p.state === "overdue" ? <PcBadge tone="red">Overdue</PcBadge> : p.state === "due" ? <PcBadge tone="amber">Due for review</PcBadge> : <PcBadge tone="grey">Scheduled</PcBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">No review dates are set.</p>}
      </section>

      {canManage ? <SetupPanel firstName={firstName} orgName={orgName} steps={steps} /> : null}
    </div>
  );
}
