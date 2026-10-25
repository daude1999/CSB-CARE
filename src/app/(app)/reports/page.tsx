import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { REPORTS, reportRows, type ReportKind } from "@/server/reports/tables";
import { reportTrends } from "@/server/reports/trends";
import { MonthChart } from "@/components/month-chart";
import { Card, Empty, PageHeader, SegmentNav } from "@/components/ui";

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
      <PageHeader eyebrow="Insights · live from your records" title="Reports" subtitle="Generated from live data at the time you open them. Export as CSV for inspection packs or board reporting." actions={<a className="btn-primary" href={`/api/reports/${kind}`}>Export CSV</a>} />
      <section aria-label="Trends" className="mb-10 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between border-b-2 border-navy-900 pb-2">
            <h2 className="text-[17px]">Versions published</h2>
            <span className="eyebrow">Last 12 months · {published12}</span>
          </div>
          <MonthChart data={trends.publications} unit="versions published" label="Policy versions published per month, last 12 months. The current month is highlighted." />
        </div>
        <div>
          <div className="mb-3 flex items-baseline justify-between border-b-2 border-navy-900 pb-2">
            <h2 className="text-[17px]">Review calendar</h2>
            <span className="eyebrow">{overdue ? <span className="text-rose-700">{overdue} overdue</span> : "None overdue"} · {due12} due in 12 months</span>
          </div>
          <MonthChart data={trends.reviewCalendar} unit="policies due for review" label="Policies due for review by month for the next 12 months, with overdue reviews in the first column." />
        </div>
      </section>
      <div className="mb-6 border-b border-slate-300">
        <SegmentNav label="Report" items={(Object.keys(REPORTS) as ReportKind[]).map((k) => ({ href: `/reports?kind=${k}`, label: REPORTS[k], active: k === kind }))} />
      </div>
      <Card title={REPORTS[kind]}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="text-xs">{String(v)}</td>)}</tr>)}</tbody>
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
