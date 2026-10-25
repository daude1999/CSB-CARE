import Link from "@/components/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { REPORTS, reportRows, type ReportKind } from "@/server/reports/tables";
import { Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "report.view") && !hasPlatformPermission(ctx, "sources.manage")) notFound();
  const kind = (sp.kind && sp.kind in REPORTS ? sp.kind : "policies") as ReportKind;
  const { columns, rows } = await reportRows(ctx, kind);
  return (
    <>
      <PageHeader title="Reports" subtitle="Generated from live data at the time you open them. Export as CSV for inspection packs or board reporting." actions={<a className="btn-primary" href={`/api/reports/${kind}`}>Export CSV</a>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(Object.keys(REPORTS) as ReportKind[]).map((k) => <Link key={k} href={`/reports?kind=${k}`} className={k === kind ? "btn-primary" : "btn-secondary"}>{REPORTS[k]}</Link>)}
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
