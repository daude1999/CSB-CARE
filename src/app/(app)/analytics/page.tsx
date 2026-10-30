import { notFound } from "next/navigation";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { fmtLondonDate } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { computeKpis, KPI_GROUPS, type KpiGroup } from "@/server/reports/kpis";
import { Card, Empty, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (v: number | null, unit: string) => (v === null ? "No data" : unit === "%" ? `${v}%` : unit === "£" ? `£${v.toLocaleString("en-GB")}` : unit === "hours" ? `${v.toLocaleString("en-GB")} h` : v.toLocaleString("en-GB"));

/**
 * Reporting & Analytics: the organisation's measures across care delivery, workforce, compliance and finance, each
 * with its definition and a link to the records behind it. Worked out live for the chosen branch and dates.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("reporting");
  if (!hasOrgPermission(ctx, "analytics.view")) notFound();
  let data: Awaited<ReturnType<typeof computeKpis>>;
  try {
    data = await computeKpis(ctx, sp);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return <><PageHeader title="Analytics" /><Card><Empty>{e.message} <Link href="/analytics">Reset the filters</Link></Empty></Card></>;
  }
  const { scope, branches, branch, group, rows } = data;
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ branch: branch ?? undefined, from: sp.from, to: sp.to, group: group ?? undefined, ...over })) if (v) p.set(k, v);
    return p.toString();
  };
  const groups = (Object.keys(KPI_GROUPS) as KpiGroup[]).filter((g) => rows.some((r) => r.group === g) || group === g);
  const shown = group ? [group] : groups;
  const scopeName = branch ? branches.find((b) => b.id === branch)?.name ?? "Branch" : ctx.branchIds ? "My branches" : "All branches";

  return (
    <>
      <PageHeader title="Analytics" subtitle={`${scopeName} · ${fmtLondonDate(scope.from)} to ${fmtLondonDate(scope.to)}. Every figure is worked out from your records when you open the page; the definition sits next to each one.`} actions={hasOrgPermission(ctx, "report.export") ? <a href={`/api/analytics?${q({})}`} className="btn-secondary">Download CSV</a> : null} />
      <section aria-label="Scope" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {group ? <input type="hidden" name="group" value={group} /> : null}
          <label><span className="label">Branch</span><select name="branch" defaultValue={branch ?? ""} className="input"><option value="">{ctx.branchIds ? "All my branches" : "All branches"}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label><span className="label">From</span><input type="date" name="from" defaultValue={scope.from} className="input" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={scope.to} className="input" /></label>
          <button className="btn-primary">Apply</button>
          <Link href="/analytics" className="btn-secondary">Last 28 days</Link>
        </form>
      </section>
      <SegmentNav label="Area" items={[{ href: `/analytics?${q({ group: undefined })}`, label: "All", active: !group }, ...groups.map((g) => ({ href: `/analytics?${q({ group: g })}`, label: KPI_GROUPS[g], active: group === g }))]} />
      {rows.length ? shown.map((g) => {
        const list = rows.filter((r) => r.group === g);
        if (!list.length) return null;
        return (
          <Card key={g} title={KPI_GROUPS[g]} className="mb-3">
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th className="w-[28%]">Measure</th><th className="w-[14%] text-right">Value</th><th>How it is worked out</th></tr></thead>
                <tbody>
                  {list.map((k) => (
                    <tr key={k.key} data-kpi={k.key}>
                      <td className="font-medium">{k.href ? <Link href={k.href}>{k.name}</Link> : k.name}<span className="block text-[12.5px] font-normal text-slate-600">{k.detail}</span></td>
                      <td className="text-right text-[18px] font-semibold tabular-nums">{fmt(k.value, k.unit)}</td>
                      <td className="text-[13px] text-slate-700">{k.definition}{!k.branchAware && (branch || ctx.branchIds) ? <span className="block text-[12.5px] text-[#8a5a00]">Whole organisation: this measure has no branch.</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      }) : <Card><Empty>None of the measures apply to your roles.</Empty></Card>}
      <p className="text-[13px] text-slate-600">More detail: <Link href="/rota/reports">Rota reports</Link>{hasOrgPermission(ctx, "report.view") ? <> · <Link href="/reports">Compliance reports</Link></> : null}. Scheduled reports and charts by month are not built yet.</p>
    </>
  );
}
