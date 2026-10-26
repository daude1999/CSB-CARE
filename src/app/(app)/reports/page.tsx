import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { REPORTS, reportRows, type ReportKind } from "@/server/reports/tables";
import { reportTrends } from "@/server/reports/trends";
import { MonthChart } from "@/components/month-chart";
import { Card, Empty, PageHeader, SegmentNav, Stat, StatRow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "report.view") && !hasPlatformPermission(ctx, "sources.manage")) notFound();
  const kind = (sp.kind && sp.kind in REPORTS ? sp.kind : "policies") as ReportKind;
  const [{ columns, rows }, trends] = await Promise.all([reportRows(ctx, kind), reportTrends(ctx)]);
  const overdue = trends.reviewCalendar[0]!.value;
  const published12 = trends.publications.reduce((n, m) => n + m.value, 0);
  const due12 = trends.reviewCalendar.slice(1).reduce((n, m) => n + m.value, 0);
  return (
    <>
      <PageHeader eyebrow="Insights · live from your records" title="Reports" subtitle="Generated from live data at the time you open them. Export as CSV for inspection packs or board reporting." />
      <StatRow>
        <Stat label="Versions Published" value={published12} hint="In the last 12 months" tone="navy" />
        <Stat label="Reviews Overdue" value={overdue} hint={overdue ? "Past their review date" : "None overdue"} tone="rose" />
        <Stat label="Reviews Due" value={due12} hint="In the next 12 months" tone="amber" />
        <Stat label="Report Rows" value={rows.length} hint={REPORTS[kind]} tone="violet" />
      </StatRow>
      <section aria-label="Trends" className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="panel">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[17px]">Versions published</h2>
            <span className="text-[13px] text-slate-600">Last 12 months · {published12}</span>
          </div>
          <MonthChart data={trends.publications} unit="versions published" label="Policy versions published per month, last 12 months. The current month is highlighted." />
        </div>
        <div className="panel">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[17px]">Review calendar</h2>
            <span className="text-[13px] text-slate-600">{overdue ? <span className="text-[#a3242c]">{overdue} overdue</span> : "None overdue"} · {due12} due in 12 months</span>
          </div>
          <MonthChart data={trends.reviewCalendar} unit="policies due for review" label="Policies due for review by month, for the next 12 months, with overdue reviews in the first column." />
        </div>
      </section>
      <SegmentNav label="Report" items={(Object.keys(REPORTS) as ReportKind[]).map((k) => ({ href: `/reports?kind=${k}`, label: REPORTS[k], active: k === kind }))} />
      <Card title={REPORTS[kind]} actions={<a className="btn-primary py-1" href={`/api/reports/${kind}`}>Export CSV</a>}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={`py-2 text-[13px] ${String(v).length < 24 ? "whitespace-nowrap" : ""}`}>{String(v)}</td>)}</tr>)}</tbody>
            </table>
            {rows.length > 200 ? <p className="muted mt-2">Showing 200 of {rows.length} rows. Export for the full report.</p> : null}
          </div>
        ) : (
          <Empty>No data.</Empty>
        )}
      </Card>
    </>
  );
}
