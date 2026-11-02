import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { AppError } from "@/lib/errors";
import { complianceReport, isReportKind, parseReportFilters, REPORT_GROUPS, REPORT_TITLES, type ComplianceReportKind } from "@/server/compliance/reports";
import { db } from "@/lib/db";
import { Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Which reports a person may open: each needs the permission of the workspace its records come from. */
function allowed(ctx: Ctx, kind: ComplianceReportKind) {
  if (kind === "signoff" || kind === "signoff-groups") return hasOrgPermission(ctx, "staff.view");
  if (kind === "audits" || kind === "findings") return hasOrgPermission(ctx, "audit.conduct");
  if (kind === "risks") return hasOrgPermission(ctx, "risk.view");
  if (kind === "evidence") return hasOrgPermission(ctx, "evidence.read");
  return true;
}

/**
 * Compliance Reports: oversight reports for registered and compliance managers, by category, for a period and branch.
 * Figures come from live records and say what they count. Exports (CSV, Excel, PDF) carry the same filters and are logged.
 */
export default async function ComplianceReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "report.view")) notFound();
  const groups = REPORT_GROUPS.map((g) => ({ name: g.name, kinds: g.kinds.filter((k) => allowed(ctx, k)) })).filter((g) => g.kinds.length);
  const kind: ComplianceReportKind = sp.kind && isReportKind(sp.kind) && allowed(ctx, sp.kind) ? sp.kind : "policies";
  let error: string | null = null;
  let f = parseReportFilters({});
  try {
    f = parseReportFilters(sp);
  } catch (e) {
    error = e instanceof AppError ? e.message : "Check the dates";
  }
  const report = await complianceReport(ctx, kind, f).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const branches = await db.branch.findMany({ where: { organisationId: ctx.organisationId!, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const qs = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ kind, from: f.from, to: f.to, branch: f.branch, ...over }).filter(([, v]) => v) as [string, string][]);
    return q.toString();
  };
  const canExport = hasOrgPermission(ctx, "report.export");

  return (
    <>
      <CompliancePageHeader title="Compliance Reports" subtitle="Oversight reports from your live records, for the period and branch you choose. Each figure says what it counts. These are internal management reports: they do not certify compliance and are not CQC ratings." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Reports" className="panel h-fit lg:sticky lg:top-3">
          {groups.map((g) => (
            <div key={g.name} className="mb-3 last:mb-0">
              <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{g.name}</h2>
              <ul className="space-y-0.5">
                {g.kinds.map((k) => (
                  <li key={k}><Link href={`/compliance/reports?${qs({ kind: k })}`} aria-current={k === kind ? "page" : undefined} className={`block rounded-[4px] px-2 py-1.5 text-[14px] no-underline ${k === kind ? "bg-[#eaf1fd] font-semibold text-[#0b1530]" : "text-slate-700 hover:bg-slate-100"}`}>{REPORT_TITLES[k]}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-3">
          <section aria-label="Report filters" className="panel">
            <form method="get" action="/compliance/reports" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="kind" value={kind} />
              <label><span className="label">From</span><input type="date" name="from" defaultValue={f.from} className="input" /></label>
              <label><span className="label">To</span><input type="date" name="to" defaultValue={f.to} className="input" /></label>
              {branches.length > 1 ? <label><span className="label">Branch</span><select name="branch" defaultValue={f.branch ?? ""} className="input"><option value="">{ctx.branchIds ? "All my branches" : "All branches"}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : null}
              <button className="btn-primary">Apply</button>
              {canExport ? (
                <span className="ml-auto flex flex-wrap gap-2">
                  {(["csv", "xlsx", "pdf"] as const).map((fmt) => <a key={fmt} href={`/api/compliance-reports/${kind}?${qs({ kind: undefined, format: fmt })}`} data-no-progress="" className="btn-secondary">{fmt === "csv" ? "Export CSV" : fmt === "xlsx" ? "Excel" : "PDF"}</a>)}
                </span>
              ) : null}
            </form>
            {error ? <p role="alert" className="mt-2 text-[13.5px] text-[#a3242c]">{error}. Showing the last 12 months instead.</p> : null}
            <p className="mt-2 text-[12.5px] text-slate-600">{report.periodBasis ? `The period applies to each record's ${report.periodBasis}.` : "This report shows the current position; the period does not apply."}</p>
          </section>

          <section aria-labelledby="report-title" className="panel">
            <h2 id="report-title" className="text-[18px]">{report.title}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="report-summary">
              {(report.summary ?? []).map(([label, value]) => (
                <div key={label} className="rounded-[4px] border border-slate-200 px-3 py-2">
                  <dt className="text-[12.5px] leading-4 text-slate-600">{label}</dt>
                  <dd className="mt-1 text-[20px] font-medium tabular-nums text-[#0b1530]">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[12.5px] text-slate-600">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>

          <Card>
            {report.rows.length ? (
              <div className="relative overflow-x-auto">
                <table className="table" data-testid="report-table">
                  <thead><tr>{report.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{report.rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={`py-2 text-[13px] ${String(v ?? "").length < 24 ? "whitespace-nowrap" : ""}`}>{String(v ?? "")}</td>)}</tr>)}</tbody>
                </table>
                {report.rows.length > 200 ? <p className="mt-2 text-[13px] text-slate-600">Showing 200 of {report.rows.length} rows. Export for the full report.</p> : null}
              </div>
            ) : <Empty>No records for this report in the chosen period and branch.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
