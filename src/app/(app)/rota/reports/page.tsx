import Link from "@/components/link";
import { ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups } from "@/server/rota/queries";
import { MAX_RANGE_DAYS, ROTA_REPORTS, defaultRange, parseFilters, rotaReport, type RotaReportFilters } from "@/server/rota/reports";
import { Card, Empty, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

const qs = (f: Partial<RotaReportFilters>) => new URLSearchParams(Object.entries({ report: f.report, from: f.from, to: f.to, area: f.areaId }).filter((e): e is [string, string] => !!e[1])).toString();

export default async function RotaReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.view");
  let filters: RotaReportFilters;
  let problem: string | null = null;
  try {
    filters = parseFilters(sp);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    problem = e.message;
    filters = { report: "delivery", ...defaultRange() };
  }
  let report;
  try {
    report = await rotaReport(ctx, filters);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    problem = e.message;
    filters = { ...filters, areaId: undefined };
    report = await rotaReport(ctx, filters);
  }
  const lk = await rotaLookups(ctx);
  const canExport = hasOrgPermission(ctx, "report.export");
  const today = londonDate();
  const thisMonday = mondayOf(today);
  const quick = [
    { label: "Last week", from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
    { label: "This week", from: thisMonday, to: addDays(thisMonday, 6) },
    { label: "Last 4 weeks", from: addDays(thisMonday, -28), to: addDays(thisMonday, -1) },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];

  return (
    <>
      <PageHeader
        title="Rota Reports"
        back="/rota"
        subtitle="Worked out from visits and clock times when you open the page, so corrections show straight away. Choose a report, dates and an area; each row links to the records behind it."
        actions={canExport ? <span className="flex flex-wrap gap-2"><a href={`/api/rota/reports?${qs(filters)}&format=xlsx`} className="btn-secondary">Download Excel</a><a href={`/api/rota/reports?${qs(filters)}&format=pdf`} className="btn-secondary">Download PDF</a><a href={`/api/rota/reports?${qs(filters)}`} className="btn-secondary">Download CSV</a></span> : null}
      />
      {problem ? <p role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] text-[#a3242c]">{problem}. Showing the default instead.</p> : null}
      <SegmentNav label="Reports" items={Object.entries(ROTA_REPORTS).map(([k, label]) => ({ href: `/rota/reports?${qs({ ...filters, report: k as RotaReportFilters["report"] })}`, label, active: k === filters.report }))} />
      <section className="panel mb-3" aria-label="Report filters">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="report" value={filters.report} />
          <label><span className="label">From</span><input type="date" name="from" defaultValue={filters.from} className="input" required /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={filters.to} className="input" required /></label>
          <label><span className="label">Area</span>
            <select name="area" defaultValue={filters.areaId ?? ""} className="input">
              <option value="">{lk.scope.areaIds ? "All my areas" : "All areas"}</option>
              {lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button className="btn-primary">Show report</button>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13.5px]">
            {quick.map((q) => <Link key={q.label} href={`/rota/reports?${qs({ ...filters, from: q.from, to: q.to })}`}>{q.label}</Link>)}
          </span>
        </form>
        <p className="mt-2 text-[12.5px] text-slate-500">Up to {MAX_RANGE_DAYS} days at a time.</p>
      </section>
      <Card title={`${report.title}${report.areaName ? ` · ${report.areaName}` : ""}`}>
        <p className="mb-3 max-w-[80ch] text-[14.5px]">{report.summary}</p>
        {report.truncated ? <p className="mb-3 text-[13px] text-[#a3242c]">This range has more visits than one report can show. Choose a shorter range.</p> : null}
        {report.rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr>{report.columns.map((c, i) => <th key={c} scope="col" className={report.numeric[i] ? "text-right" : undefined}>{c}</th>)}</tr></thead>
              <tbody>
                {report.rows.map((r, n) => (
                  <tr key={n}>
                    {r.cells.map((c, i) => (
                      <td key={i} className={report.numeric[i] ? "text-right tabular-nums" : undefined}>{i === 0 && r.href ? <Link href={r.href}>{c}</Link> : c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals ? (
                <tfoot><tr className="border-t-2 border-slate-300 font-semibold">{report.totals.map((c, i) => <td key={i} className={report.numeric[i] ? "text-right tabular-nums" : undefined}>{c}</td>)}</tr></tfoot>
              ) : null}
            </table>
          </div>
        ) : <Empty>Nothing to report for these dates{report.areaName ? " in this area" : ""}.</Empty>}
      </Card>
      <details className="panel mt-3 text-[14px]">
        <summary className="cursor-pointer font-medium">How these figures are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>Planned hours are the visit length times the number of carers needed. Delivered and clocked hours come from clock-in to clock-out, using corrected times where the office has changed them.</li>
          <li>A visit is on time if the first carer clocked in within the late threshold in Rota Settings. A short visit is one where a carer was clocked in for less than the short-visit percentage of the planned length.</li>
          <li>Cancelled visits are counted separately and left out of planned hours. Shadow shifts are left out.</li>
          <li>Medication: missed and refused doses are in the Exceptions register and each person&apos;s monthly MAR chart (when medication records are switched on).</li>
        </ul>
      </details>
    </>
  );
}
