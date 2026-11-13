import { hhmm, WEEKDAYS } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getTemplateRoute, ROUTE_KIND_LABEL } from "@/server/rota/routes";
import { suName } from "@/server/rota/queries";
import { addToRouteAction, moveStopAction, moveToRouteAction, removeFromRouteAction, removeRouteAction } from "@/app/rota-actions";
import { RouteChip } from "@/components/route-ui";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One template run route: its templates in round order, and templates that could join it. */
export default async function TemplateRoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("rota.view");
  const { route, owner, templates, candidates, others } = await orNotFound(getTemplateRoute(ctx, id));
  const canEdit = hasOrgPermission(ctx, "rota.edit") && route.active;
  const back = `/rota/routes/templates/${route.id}`;
  const days = (w: number[]) => w.map((d) => WEEKDAYS[d - 1]?.slice(0, 3)).join(" ");
  const hidden = (x: string) => <><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="TEMPLATE" /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="id" value={x} /></>;
  return (
    <>
      <PageHeader title={route.name} back="/rota/routes/templates" subtitle={`${ROUTE_KIND_LABEL[route.kind]}${owner ? ` · ${owner}` : ""}${route.active ? "" : " · switched off"}`} actions={<RouteChip name={route.name} colour={route.colour} textColour={route.textColour} />} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Templates in round order">
          {templates.length ? (
            <ol className="rows">
              {templates.map((t, i) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-[14px]">
                  <span className="w-6 text-right font-semibold tabular-nums">{i + 1}.</span>
                  <span className="font-medium tabular-nums">{hhmm(t.startMinute)}</span>
                  <span>{suName(t.serviceUser)}</span>
                  <span className="text-slate-600">{t.serviceUser.postcode ?? ""} · {t.callType.name} · {days(t.weekdays)} · weeks {t.cycleWeeks.join(", ")}</span>
                  {canEdit ? (
                    <span className="ml-auto flex gap-1">
                      <form action={moveStopAction}>{hidden(t.id)}<button name="dir" value="up" className="btn-secondary px-2 py-0.5" aria-label="Move earlier in the round" disabled={i === 0}>↑</button></form>
                      <form action={moveStopAction}>{hidden(t.id)}<button name="dir" value="down" className="btn-secondary px-2 py-0.5" aria-label="Move later in the round" disabled={i === templates.length - 1}>↓</button></form>
                      <form action={removeFromRouteAction}>{hidden(t.id)}<button className="btn-secondary px-2 py-0.5">Remove</button></form>
                      {others.length ? (
                        <form action={moveToRouteAction} className="flex gap-1">
                          {hidden(t.id)}
                          <select name="toRouteId" required className="input py-0.5 text-[13px]" aria-label={`Move ${suName(t.serviceUser)} at ${hhmm(t.startMinute)} to another route`}>
                            <option value="">Move to…</option>
                            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                          <button className="btn-secondary px-2 py-0.5">Move</button>
                        </form>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : <Empty>No templates on this route yet.</Empty>}
        </Card>
        {canEdit ? (
          <aside className="space-y-3">
            <Card title="Add templates">
              {candidates.length ? (
                <form action={addToRouteAction} className="space-y-2">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="TEMPLATE" /><input type="hidden" name="routeId" value={route.id} />
                  <ul className="max-h-[420px] space-y-1 overflow-y-auto text-[13.5px]">
                    {candidates.map((t) => <li key={t.id}><label className="flex items-center gap-2"><input type="checkbox" name="ids" value={t.id} />{hhmm(t.startMinute)} {suName(t.serviceUser)} · {days(t.weekdays)}</label></li>)}
                  </ul>
                  <button className="btn-primary">Add to route</button>
                </form>
              ) : <Empty>No other templates for this {route.staffId ? "carer" : "area"}.</Empty>}
            </Card>
            <Card title="Switch off">
              <form action={removeRouteAction} className="space-y-2">
                <input type="hidden" name="back" value="/rota/routes/templates" /><input type="hidden" name="kind" value="TEMPLATE" /><input type="hidden" name="routeId" value={route.id} />
                <p className="text-[13.5px] text-slate-600">Templates come off the route; weeks already built keep their live routes.</p>
                <button className="btn-danger">Switch off this route</button>
              </form>
            </Card>
          </aside>
        ) : null}
      </div>
    </>
  );
}
