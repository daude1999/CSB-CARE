import Link from "@/components/link";
import { fmtLondonDate, fromDbDate, addDays } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listLiveRoutes, ROUTE_KIND_LABEL } from "@/server/rota/routes";
import { rotaLookups } from "@/server/rota/queries";
import { createLiveRouteAction } from "@/app/rota-actions";
import { RouteChip, RouteForm } from "@/components/route-ui";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

/** Live Run Routes, laid out as OnePlan's: this week's routes, future weeks and past weeks, with the add form. */
export default async function LiveRoutesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.view");
  const [{ thisWeek, current, future, past }, lk] = await Promise.all([listLiveRoutes(ctx), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  type Row = (typeof current)[number];
  const table = (rows: Row[], empty: string) => rows.length ? (
    <div className="relative min-w-0 overflow-x-auto">
      <table className="table">
        <thead><tr><th>Run route</th><th>Run type</th><th>Week commencing</th><th>Week ending</th><th className="text-right">Visits</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><RouteChip name={r.name} colour={r.colour} textColour={r.textColour} /></td>
              <td>{ROUTE_KIND_LABEL[r.kind]}</td>
              <td className="tabular-nums">{fmtLondonDate(fromDbDate(r.weekStart))}</td>
              <td className="tabular-nums">{fmtLondonDate(addDays(fromDbDate(r.weekStart), 6))}</td>
              <td className="text-right tabular-nums">{r._count.visits}</td>
              <td className="text-right"><Link href={`/rota/routes/${r.id}`} className="btn-secondary py-1">View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : <Empty>{empty}</Empty>;

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="daily" active="routes" />} title="Live Run Routes" back="/rota" subtitle="A run route is one carer's (or one area's) round of visits for a week, in the order you set. Build Rota carries template routes into each built week. Routes never assign a carer, and travel times are not worked out." actions={<Link href="/rota/routes/templates" className="btn-secondary">Template Run Routes</Link>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Card title={`This week (from ${fmtLondonDate(thisWeek)})`}>{table(current, "No run routes this week.")}</Card>
          <Card title="Future weeks">{table(future, "No run routes for future weeks yet.")}</Card>
          <Card title="Past weeks">{table(past, "No run routes in the last eight weeks.")}</Card>
        </div>
        {canEdit ? <Card title="Add a run route"><RouteForm action={createLiveRouteAction} back="/rota/routes" staff={lk.carers} areas={lk.areas} withWeek defaultWeek={thisWeek} /></Card> : null}
      </div>
    </>
  );
}
