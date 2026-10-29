import Link from "@/components/link";
import { londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { monitorBoard, type MonitorState } from "@/server/rota/monitor";
import { rotaLookups, suName } from "@/server/rota/queries";
import { sweepNowAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader, type Tone } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const STATE: Record<MonitorState, { label: string; tone: Tone }> = {
  missed: { label: "Missed", tone: "rose" },
  not_delivered: { label: "Not delivered", tone: "rose" },
  late: { label: "Late", tone: "amber" },
  overrun: { label: "Not clocked out", tone: "amber" },
  on_visit: { label: "On visit", tone: "teal" },
  due: { label: "Due", tone: "slate" },
  later: { label: "Later", tone: "slate" },
  done: { label: "Completed", tone: "green" },
};
const URGENCY: MonitorState[] = ["missed", "not_delivered", "late", "overrun"];

function secs(n: number) {
  return n < 90 ? `${Math.round(n)} s` : `${Math.round(n / 60)} min`;
}

type Row = Awaited<ReturnType<typeof monitorBoard>>["rows"][number];

function Carers({ v }: { v: Row }) {
  if (!v.assignments.length) return <span className="text-[#a3242c]">No carer booked</span>;
  return (
    <span className="flex flex-col">
      {v.assignments.map((a) => {
        const inAt = v.clocks.find((c) => c.staffId === a.staffId && c.kind === "IN");
        return (
          <span key={a.id}>
            <Link href={`/rota/staff/${a.staff.id}`}>{a.staff.displayName}</Link>
            {a.slot === "SHADOW" ? <span className="text-slate-500"> (shadow)</span> : null}
            {a.staff.workPhone ? <a href={`tel:${a.staff.workPhone}`} className="ml-2 text-[13px] tabular-nums">{a.staff.workPhone}</a> : null}
            {inAt ? <span className="ml-2 text-[12.5px] text-slate-500">in {londonTime(inAt.at)}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

export default async function MonitorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.monitor");
  const [b, lk] = await Promise.all([monitorBoard(ctx, { areaId: sp.area || undefined }), rotaLookups(ctx)]);
  const canCorrect = hasOrgPermission(ctx, "rota.clockCorrect");
  const action = b.rows.filter((r) => URGENCY.includes(r.state)).sort((x, y) => URGENCY.indexOf(x.state) - URGENCY.indexOf(y.state) || x.scheduledStart.getTime() - y.scheduledStart.getTime());
  const onVisit = b.rows.filter((r) => r.state === "on_visit");
  const due = b.rows.filter((r) => r.state === "due");
  const done = b.rows.filter((r) => r.state === "done");
  const lateArrivals = done.filter((r) => (r.arrivedLateMin ?? 0) >= b.settings.lateAfterMin);
  const shortVisits = done.filter((r) => r.durationPct !== null && r.durationPct < b.settings.shortVisitPercent);
  const back = `/rota/monitor${sp.area ? `?area=${sp.area}` : ""}`;
  const stale = !b.lastRun || b.now.getTime() - b.lastRun.startedAt.getTime() > 10 * 60000;

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="The Monitor"
        back="/rota"
        subtitle={`Today's calls as they happen, from carers' clock-ins and outs. A call is late ${b.settings.lateAfterMin} minutes after its start with nobody clocked in, and missed after ${b.settings.missedAfterMin} minutes. Clock times come from the server when the carer presses the button; location and NFC checks are not in use.`}
        actions={
          <form action={sweepNowAction}>
            <input type="hidden" name="back" value={back} />
            <button className="btn-secondary">Check now</button>
          </form>
        }
      />
      <Flash searchParams={sp} />

      <section aria-label="Monitor status" className="panel mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px]">
        <span className={stale ? "font-medium text-[#8a5a00]" : "text-slate-700"}>
          {b.lastRun ? <>Last checked at <span className="tabular-nums">{londonTime(b.lastRun.startedAt)}</span></> : "Not checked yet today"}
          {stale ? ". Automatic checks look behind; press Check now." : ""}
        </span>
        <span className="text-slate-700">
          {b.medianLatencySec !== null ? <>Alerts reached the office in a median <span className="tabular-nums">{secs(b.medianLatencySec)}</span> over the last day (target {secs(b.settings.alertLatencyTargetSec)}, {b.alertCount} alerts)</> : "No late or missed alerts in the last day"}
        </span>
        <span className="text-slate-500">This page refreshes every minute.</span>
        <form method="get" className="ml-auto flex items-end gap-2">
          <label className="flex items-center gap-2"><span className="text-slate-600">Area</span>
            <select name="area" defaultValue={sp.area ?? ""} className="input w-44 py-1.5"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <button className="btn-secondary py-1.5" type="submit">Show</button>
        </form>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card title={`Needs action now (${action.length})`}>
            {action.length ? (
              <div className="relative min-w-0 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Due</th><th>Service user</th><th>Carers</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {action.map((v) => (
                      <tr key={v.id}>
                        <td className="tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</td>
                        <td>
                          <Link href={`/rota/visits/${v.id}`}>{suName(v.serviceUser)}</Link>
                          <div className="text-[12.5px] text-slate-500">{v.callType.name} · {v.serviceUser.postcode ?? "no postcode"}{v.serviceUser.phone ? <> · <a href={`tel:${v.serviceUser.phone}`}>{v.serviceUser.phone}</a></> : null}</div>
                        </td>
                        <td><Carers v={v} /></td>
                        <td>
                          <Badge tone={STATE[v.state].tone}>{STATE[v.state].label}</Badge>
                          {v.state === "late" || v.state === "missed" ? <div className="mt-0.5 text-[12.5px] text-slate-600 tabular-nums">{v.minutesLate} min after start</div> : null}
                          {v.state === "not_delivered" && v.notDeliveredReason ? <div className="mt-0.5 text-[12.5px] text-slate-600">{v.notDeliveredReason}</div> : null}
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <Link href={`/rota/visits/${v.id}${canCorrect ? "#attendance" : ""}`} className="btn-secondary py-1">{canCorrect && v.state !== "not_delivered" ? "Record or reassign" : "Open"}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Nothing late or missed right now.</Empty>}
          </Card>

          <Card title={`On visits now (${onVisit.length})`}>
            {onVisit.length ? (
              <ul className="rows">
                {onVisit.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5 text-[14px]">
                    <span className="w-[92px] shrink-0 tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
                    <Link href={`/rota/visits/${v.id}`} className="min-w-[150px] font-medium">{suName(v.serviceUser)}</Link>
                    <Carers v={v} />
                    <span className="ml-auto"><AreaDot area={v.area} /></span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No one is clocked in at the moment.</Empty>}
          </Card>

          <Card title={`Due in the next hour (${due.length})`}>
            {due.length ? (
              <ul className="rows">
                {due.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5 text-[14px]">
                    <span className="w-[92px] shrink-0 tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
                    <Link href={`/rota/visits/${v.id}`} className="min-w-[150px] font-medium">{suName(v.serviceUser)}</Link>
                    <Carers v={v} />
                    <span className="ml-auto"><AreaDot area={v.area} /></span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No calls start in the next hour.</Empty>}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="Completed today">
            <p className="text-[14px]"><span className="tabular-nums font-medium">{done.length}</span> of <span className="tabular-nums">{b.rows.length}</span> calls completed so far.</p>
            <h3 className="mt-3 text-[13.5px] font-semibold">Arrived {b.settings.lateAfterMin}+ minutes late ({lateArrivals.length})</h3>
            {lateArrivals.length ? (
              <ul className="rows text-[13.5px]">
                {lateArrivals.map((v) => <li key={v.id} className="flex justify-between gap-2 py-1.5"><Link href={`/rota/visits/${v.id}`}>{suName(v.serviceUser)} · {londonTime(v.scheduledStart)}</Link><span className="tabular-nums text-slate-600">+{v.arrivedLateMin} min</span></li>)}
              </ul>
            ) : <p className="text-[13.5px] text-slate-500">None.</p>}
            <h3 className="mt-3 text-[13.5px] font-semibold">Shorter than {b.settings.shortVisitPercent}% of planned time ({shortVisits.length})</h3>
            {shortVisits.length ? (
              <ul className="rows text-[13.5px]">
                {shortVisits.map((v) => <li key={v.id} className="flex justify-between gap-2 py-1.5"><Link href={`/rota/visits/${v.id}`}>{suName(v.serviceUser)} · {londonTime(v.scheduledStart)}</Link><span className="tabular-nums text-slate-600">{v.durationPct}%</span></li>)}
              </ul>
            ) : <p className="text-[13.5px] text-slate-500">None.</p>}
          </Card>
          <Card title="How this works">
            <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-slate-700">
              <li>Checks run every minute while the background worker runs. On the demo site there is no worker, so they run when the site processes its queue; use Check now for an immediate check.</li>
              <li>Missed calls are marked once and kept. Nothing is cancelled or reassigned automatically.</li>
              <li>Coordinators are alerted in the app only. No texts or emails are sent.</li>
              <li>Thresholds are set in <Link href="/rota/settings">Rota settings</Link>.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
