import Link from "@/components/link";
import { addDays, fmtLondonDate, fromDbDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { gapSummary, getLiveRoute, routeGaps, ROUTE_IDLE_GAP_MIN, ROUTE_KIND_LABEL, ROUTE_TIGHT_GAP_MIN } from "@/server/rota/routes";
import { suName } from "@/server/rota/queries";
import { addToRouteAction, moveStopAction, orderRouteByTimeAction, moveToRouteAction, removeFromRouteAction, removeRouteAction } from "@/app/rota-actions";
import { RouteChip } from "@/components/route-ui";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import { VisitStatusBadge } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

/** One live run route: each day's stops in the order the carer follows, the gap between them, and visits to add. */
export default async function LiveRoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("rota.view");
  const { route, owner, visits, candidates, others } = await orNotFound(getLiveRoute(ctx, id));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const back = `/rota/routes/${route.id}`;
  const week = fromDbDate(route.weekStart);
  const days = [...new Set(visits.map((v) => fromDbDate(v.date)))];

  return (
    <>
      <PageHeader title={route.name} back="/rota/routes" subtitle={`${ROUTE_KIND_LABEL[route.kind]}${owner ? ` · ${owner}` : ""} · week of ${fmtLondonDate(week)} to ${fmtLondonDate(addDays(week, 6))}`} actions={<RouteChip name={route.name} colour={route.colour} textColour={route.textColour} />} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          {days.length ? days.map((d) => {
            const list = visits.filter((v) => fromDbDate(v.date) === d);
            const gaps = routeGaps(list);
            const g = gapSummary(gaps);
            const problems = [g.overlaps && `${g.overlaps} overlap${g.overlaps === 1 ? "" : "s"}`, g.tight && `${g.tight} gap${g.tight === 1 ? "" : "s"} under ${ROUTE_TIGHT_GAP_MIN} min`, g.outOfOrder && `${g.outOfOrder} out of time order`, g.idle && `${g.idle} wait${g.idle === 1 ? "" : "s"} over ${ROUTE_IDLE_GAP_MIN / 60} h`].filter(Boolean);
            return (
              <Card
                key={d}
                title={fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })}
                actions={canEdit && g.outOfOrder ? (
                  <form action={orderRouteByTimeAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="date" value={d} /><button className="btn-secondary px-2 py-0.5 text-[13px]">Put in time order</button></form>
                ) : null}
              >
                <p className={`mb-1 text-[13px] ${g.overlaps || g.outOfOrder ? "text-[#a3242c]" : g.tight ? "text-[#8a5a00]" : "text-slate-600"}`}>
                  Time-gap check: {problems.length ? problems.join(", ") : "no overlaps or tight gaps"}. Scheduled times only; travel time is not worked out.
                </p>
                <ol className="rows">
                  {list.map((v, i) => {
                    const gap = gaps.find((x) => x.visitId === v.id);
                    const bad = gap?.kinds.some((k) => k === "OVERLAP" || k === "OUT_OF_ORDER");
                    return (
                      <li key={v.id} className="py-2 text-[14px]">
                        {gap ? <p className={`mb-1 text-[12.5px] ${bad ? "font-medium text-[#a3242c]" : gap.kinds.includes("TIGHT") ? "text-[#8a5a00]" : "text-slate-500"}`}>{gap.text}</p> : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-6 text-right font-semibold tabular-nums">{i + 1}.</span>
                          <Link href={`/rota/visits/${v.id}`} className="font-medium">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)} {suName(v.serviceUser)}</Link>
                          <span className="text-slate-600">{v.serviceUser.postcode ?? ""} · {v.callType.name} · {v.assignments.map((a) => a.staff.displayName).join(", ") || "unassigned"}</span>
                          <VisitStatusBadge status={v.status} />
                          {canEdit ? (
                            <span className="ml-auto flex gap-1">
                              <form action={moveStopAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="id" value={v.id} /><button name="dir" value="up" className="btn-secondary px-2 py-0.5" aria-label={`Move ${suName(v.serviceUser)} earlier`} disabled={i === 0}>↑</button></form>
                              <form action={moveStopAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="id" value={v.id} /><button name="dir" value="down" className="btn-secondary px-2 py-0.5" aria-label={`Move ${suName(v.serviceUser)} later`} disabled={i === list.length - 1}>↓</button></form>
                              <form action={removeFromRouteAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="id" value={v.id} /><button className="btn-secondary px-2 py-0.5">Remove</button></form>
                              {others.length ? (
                                <form action={moveToRouteAction} className="flex gap-1">
                                  <input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} /><input type="hidden" name="id" value={v.id} />
                                  <select name="toRouteId" required className="input py-0.5 text-[13px]" aria-label={`Move ${suName(v.serviceUser)} to another route`}>
                                    <option value="">Move to…</option>
                                    {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                                  </select>
                                  <button className="btn-secondary px-2 py-0.5">Move</button>
                                </form>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            );
          }) : <Card><Empty>No visits on this route yet.</Empty></Card>}
        </div>
        {canEdit ? (
          <aside className="space-y-3">
            <Card title="Add visits">
              {candidates.length ? (
                <form action={addToRouteAction} className="space-y-2">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} />
                  <ul className="max-h-[420px] space-y-1 overflow-y-auto text-[13.5px]">
                    {candidates.map((v) => <li key={v.id}><label className="flex items-center gap-2"><input type="checkbox" name="ids" value={v.id} />{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric" })} {londonTime(v.scheduledStart)} {suName(v.serviceUser)}</label></li>)}
                  </ul>
                  <button className="btn-primary">Add to route</button>
                </form>
              ) : <Empty>{route.staffId ? "No other visits for this carer that week." : "No unrouted visits in this area that week."}</Empty>}
            </Card>
            <Card title="Remove route">
              <form action={removeRouteAction} className="space-y-2">
                <input type="hidden" name="back" value="/rota/routes" /><input type="hidden" name="kind" value="LIVE" /><input type="hidden" name="routeId" value={route.id} />
                <p className="text-[13.5px] text-slate-600">The visits stay on the rota with their carers; only the route goes.</p>
                <button className="btn-danger">Remove this route</button>
              </form>
            </Card>
          </aside>
        ) : null}
      </div>
    </>
  );
}
