import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listTemplateRoutes, ROUTE_KIND_LABEL } from "@/server/rota/routes";
import { rotaLookups } from "@/server/rota/queries";
import { createTemplateRouteAction } from "@/app/rota-actions";
import { RouteChip, RouteForm } from "@/components/route-ui";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

/** Template Run Routes: the rounds templates belong to. Build Rota creates each week's live route from these. */
export default async function TemplateRoutesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.view");
  const [rows, lk] = await Promise.all([listTemplateRoutes(ctx), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="templates" active="routes" />} title="Template Run Routes" back="/rota/templates" subtitle="Put templates on a route and set their order here. Each Build Rota carries the route into the built week as a live run route." actions={<Link href="/rota/routes" className="btn-secondary">Live Run Routes</Link>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          {rows.length ? (
            <table className="table">
              <thead><tr><th>Run route</th><th>Run type</th><th className="text-right">Templates</th><th>State</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><RouteChip name={r.name} colour={r.colour} textColour={r.textColour} /></td>
                    <td>{ROUTE_KIND_LABEL[r.kind]}</td>
                    <td className="text-right tabular-nums">{r.templates}</td>
                    <td>{r.active ? <Badge tone="green">In use</Badge> : <Badge>Switched off</Badge>}</td>
                    <td className="text-right"><Link href={`/rota/routes/templates/${r.id}`} className="btn-secondary py-1">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No template run routes yet.</Empty>}
        </Card>
        {canEdit ? <Card title="Add New Template Run Route"><RouteForm action={createTemplateRouteAction} back="/rota/routes/templates" staff={lk.staff} areas={lk.areas} withWeek={false} /></Card> : null}
      </div>
    </>
  );
}
