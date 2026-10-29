import { redirect } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { addDays, dbDate, fmtLondonDate, londonDate, londonTime, mondayOf } from "@/lib/london";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listAlerts } from "@/server/rota/alerts";
import { listVisits, suName, type VisitRow } from "@/server/rota/queries";
import { resolveAlertAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { CarerSlots, FlagBadges, VISIT_LABEL } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

function VisitLine({ v }: { v: VisitRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px]">
      <span className="w-[92px] shrink-0 tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
      <Link href={`/rota/visits/${v.id}`} className="row-title min-w-[150px]">{suName(v.serviceUser)}</Link>
      <span className="text-slate-600">{v.callType.name}</span>
      <CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} />
      <span className="ml-auto flex flex-wrap gap-1"><FlagBadges flags={v.flags} /></span>
    </li>
  );
}

export default async function RotaToday({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view")) redirect(rotaHome(ctx));
  const today = londonDate();
  const nextMonday = addDays(mondayOf(today), 7);
  const [{ rows }, alerts] = await Promise.all([listVisits(ctx, { date: today, includeCancelled: true }), listAlerts(ctx, { take: 30 })]);
  const org = ctx.organisationId!;
  const [nextWeekBuilt, nextWeekUnpublished, nextWeekEmpty] = await Promise.all([
    db.rotaBuild.count({ where: { organisationId: org, weekStart: dbDate(nextMonday), status: "BUILT" } }),
    db.visit.count({ where: { organisationId: org, date: { gte: dbDate(nextMonday), lte: dbDate(addDays(nextMonday, 6)) }, publishedAt: null, status: "SCHEDULED" } }),
    listVisits(ctx, { date: nextMonday, to: addDays(nextMonday, 6), unassigned: true }).then((r) => r.rows.reduce((n, v) => n + v.flags.unassignedSlots, 0)),
  ]);
  const now = Date.now();
  const live = rows.filter((v) => v.status !== "CANCELLED");
  const notStarted = live.filter((v) => v.flags.overdueStart);
  const unassigned = live.filter((v) => v.flags.unassignedSlots > 0 && v.scheduledEnd.getTime() > now);
  const review = live.filter((v) => v.flags.review.length > 0 && v.scheduledEnd.getTime() > now);
  const upcoming = live.filter((v) => v.status === "SCHEDULED" && !v.flags.overdueStart && v.scheduledStart.getTime() - now < 2 * 3600_000 && v.scheduledStart.getTime() > now - 60_000);
  const byStatus = Object.entries(VISIT_LABEL).map(([s, label]) => [label, rows.filter((v) => v.status === s).length] as const).filter(([, n]) => n > 0);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canBuild = hasOrgPermission(ctx, "rota.build");

  return (
    <>
      <PageHeader
        title="Today"
        back="/"
        subtitle={`${fmtLondonDate(today, { weekday: "long", day: "numeric", month: "long" })}. What needs the office now: visits not started on time, empty carer slots and allocations that need checking. Late and missed calls are worked out from planned times; the live call monitor is not built yet.`}
        actions={<Link href="/rota/visits" className="btn-secondary">All of today’s visits</Link>}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <Card title={<>Not started on time <span className="text-slate-500">({notStarted.length})</span></>}>
            {notStarted.length ? <ul className="rows">{notStarted.map((v) => <VisitLine key={v.id} v={v} />)}</ul> : <Empty>Every visit due so far has started.</Empty>}
          </Card>
          <Card title={<>Still to cover today <span className="text-slate-500">({unassigned.length})</span></>} actions={<Link href="/rota/unassigned" className="btn-secondary py-1">Unassigned visits</Link>}>
            {unassigned.length ? <ul className="rows">{unassigned.map((v) => <VisitLine key={v.id} v={v} />)}</ul> : <Empty>Every remaining visit today has its carers.</Empty>}
          </Card>
          <Card title={<>Allocations to check <span className="text-slate-500">({review.length})</span></>}>
            {review.length ? (
              <ul className="rows">
                {review.map((v) => (
                  <li key={v.id} className="py-2.5 text-[14px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="w-[92px] tabular-nums">{londonTime(v.scheduledStart)}</span>
                      <Link href={`/rota/visits/${v.id}`} className="row-title">{suName(v.serviceUser)}</Link>
                      <CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} />
                    </div>
                    <p className="mt-0.5 pl-[104px] text-[13px] text-[#a3242c]">{v.flags.review.join("; ")}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>No allocations need checking for the rest of today.</Empty>}
          </Card>
          <Card title="Starting in the next two hours">
            {upcoming.length ? <ul className="rows">{upcoming.map((v) => <VisitLine key={v.id} v={v} />)}</ul> : <Empty>No visits start in the next two hours.</Empty>}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="Today’s visits">
            {rows.length ? (
              <ul className="space-y-1.5 text-[14px]">
                {byStatus.map(([label, n]) => (
                  <li key={label} className="flex justify-between"><span>{label}</span><span className="tabular-nums">{n}</span></li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-1.5 font-medium"><span>All visits</span><span className="tabular-nums">{rows.length}</span></li>
              </ul>
            ) : <Empty>No visits today.</Empty>}
          </Card>

          <Card title={`Week of ${fmtLondonDate(nextMonday, { day: "numeric", month: "short" })}`}>
            {nextWeekBuilt ? (
              <div className="space-y-1.5 text-[14px]">
                <p>Built{nextWeekUnpublished ? <> · <span className="text-[#8a5a00]">{nextWeekUnpublished} visits not yet published</span></> : " and published"}.</p>
                <p className={nextWeekEmpty ? "text-[#a3242c]" : ""}>{nextWeekEmpty} empty carer slot{nextWeekEmpty === 1 ? "" : "s"}.</p>
              </div>
            ) : <p className="text-[14px] text-[#8a5a00]">Not built yet.</p>}
            {canBuild ? <Link href={`/rota/build?week=${nextMonday}`} className="btn-secondary mt-3 py-1">Open Build Rota</Link> : null}
          </Card>

          <Card title={<>Open alerts <span className="text-slate-500">({alerts.length})</span></>}>
            {alerts.length ? (
              <ul className="space-y-3">
                {alerts.map((a) => (
                  <li key={a.id} className="border-l-4 pl-3 text-[13.5px]" style={{ borderColor: a.severity === "CRITICAL" ? "#e4544f" : a.severity === "WARNING" ? "#e3934a" : "#4a7fc9" }}>
                    <div className="flex items-center gap-2">
                      <Badge tone={a.severity === "CRITICAL" ? "rose" : a.severity === "WARNING" ? "amber" : "slate"}>{a.kind.toLowerCase().replace(/_/g, " ")}</Badge>
                      <span className="text-slate-500">{fmtDate(a.raisedAt, true)}</span>
                    </div>
                    <p className="mt-1">{a.visitId ? <Link href={`/rota/visits/${a.visitId}`}>{a.message}</Link> : a.message}</p>
                    {canEdit ? (
                      <form action={resolveAlertAction} className="mt-1.5 flex gap-2">
                        <input type="hidden" name="back" value="/rota" />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input name="resolution" required minLength={3} className="input py-1 text-[13.5px]" placeholder="What was done" aria-label="What was done" />
                        <button className="btn-secondary py-1">Close</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No open alerts.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
