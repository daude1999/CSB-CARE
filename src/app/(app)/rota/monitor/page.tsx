import { GearSix } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { fmtLondonDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { monitorBoard, type MonitorState } from "@/server/rota/monitor";
import { monitorAlerts, visitStateLabel } from "@/server/rota/monitor-alerts";
import { missedMedsCount } from "@/server/care/medication";
import { rotaLookups, suName } from "@/server/rota/queries";
import { sweepNowAction } from "@/app/rota-actions";
import { Badge, Flash, fmtDate } from "@/components/ui";
import { CallRing } from "@/components/rota-ui";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

function secs(n: number) {
  return n < 90 ? `${Math.round(n)} s` : `${Math.round(n / 60)} min`;
}

const TINT: Partial<Record<MonitorState, string>> = { late: "[&>td]:bg-[#fff6db]", missed: "[&>td]:bg-[#fde8e8]", not_delivered: "[&>td]:bg-[#fde8e8]", overrun: "[&>td]:bg-[#fff6db]", on_visit: "[&>td]:bg-[#e2f2fb]", done: "[&>td]:bg-[#eaf6ec]" };

/**
 * The Monitor: today's calls as they happen, laid out as the office knows it from OnePlan. Four outcome rings at the
 * top, then one row per call with the scheduled In and Out times and what has actually happened at each.
 */
export default async function MonitorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.monitor");
  const [b, lk] = await Promise.all([monitorBoard(ctx, { areaId: sp.area || undefined }), rotaLookups(ctx)]);
  const canSettings = hasOrgPermission(ctx, "rota.settings");
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = q ? b.rows.filter((v) => `${v.reference} ${suName(v.serviceUser)} ${v.assignments.map((a) => a.staff.displayName).join(" ")} ${v.callType.name}`.toLowerCase().includes(q)) : b.rows;
  const total = b.rows.length;
  const complete = b.rows.filter((r) => r.state === "done").length;
  const late = b.rows.filter((r) => r.state === "late" || (r.arrivedLateMin ?? 0) >= b.settings.lateAfterMin).length;
  const missed = b.rows.filter((r) => r.state === "missed").length;
  const { alerts, folded, older } = await monitorAlerts(ctx, { areaId: sp.area || undefined, lateAfterMin: b.settings.lateAfterMin }, b.now);
  const missedMeds = await missedMedsCount(b.settings.organisationId, b.rows.map((r) => r.id));
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(2) : "0.00");
  const back = `/rota/monitor${sp.area ? `?area=${sp.area}` : ""}`;
  const stale = !b.lastRun || b.now.getTime() - b.lastRun.startedAt.getTime() > 10 * 60000;

  return (
    <>
      <AutoRefresh seconds={60} />
      <Flash searchParams={sp} />

      <section aria-label="Today's calls" className="panel mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CallRing label="Complete Calls" value={complete} total={total} colour="#2e7d32" note={`${pct(complete)}% of ${total} visits`} href={`/rota/visits?status=COMPLETED`} />
        <CallRing label="Late Calls" value={late} total={total} colour="#b26a00" note={`${pct(late)}% of visits ${b.settings.lateAfterMin} minutes late`} href="/rota/visits?view=late" />
        <CallRing label="Missed Calls" value={missed} total={total} colour="#b42a23" note={`${pct(missed)}% not clocked into`} href="/rota/missed?period=day" />
        <CallRing label="Calls With Missed Meds" value={missedMeds} total={total} colour="#2a6f97" note={missedMeds === null ? "Medication records are switched off" : `${pct(missedMeds)}% with a dose not recorded`} href={missedMeds === null ? undefined : "/rota/exceptions?kind=MISSED_MEDICATION&state=all"} />
      </section>

      <section className="panel mb-3" aria-labelledby="alerts-title" data-testid="monitor-alerts">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="alerts-title" className="text-[17px] font-semibold text-navy-900">Today&apos;s alerts <span className="ml-1 text-[14px] font-normal text-slate-500">{alerts.length} open</span></h2>
          <Link href="/rota/exceptions" className="text-[13.5px]">{older ? `${older} open from earlier days in Exceptions` : "All exceptions"}</Link>
        </div>
        {alerts.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table text-[14px]">
              <thead><tr><th>What</th><th>Who</th><th>When</th><th>Why</th><th>Visit now</th><th>Owner</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {alerts.slice(0, 6).map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap"><Badge tone={a.severity === "CRITICAL" ? "rose" : a.severity === "WARNING" ? "amber" : "slate"}>{a.what}</Badge>{a.overdue ? <div className="mt-0.5 text-[12.5px] font-medium text-[#a3242c]">Past its deadline</div> : null}</td>
                    <td>{a.person ? <Link href={`/rota/service-users/${a.person.id}`}>{a.person.name}</Link> : "—"}{a.carers.length ? <div className="text-[12.5px] text-slate-600">{a.carers.join(", ")}</div> : a.visit ? <div className="text-[12.5px] text-[#a3242c]">No carer booked</div> : null}</td>
                    <td className="whitespace-nowrap tabular-nums">{a.visit ? <>Call {londonTime(a.visit.scheduledStart)}</> : null}<div className="text-[12.5px] text-slate-600">Raised {fmtDate(a.raisedAt, true)}</div></td>
                    <td className="max-w-[340px] text-[13.5px]">{a.why}</td>
                    <td>{a.visit ? <><Link href={`/rota/visits/${a.visit.id}#attendance`} className="font-semibold">{a.visit.reference}</Link><div><Badge tone={a.visit.state.tone}>{a.visit.state.label}</Badge></div></> : "—"}</td>
                    <td className="text-[13.5px]">{a.reviewer}{a.deadline ? <div className="text-[12.5px] text-slate-600">due by {londonTime(a.deadline)}</div> : null}</td>
                    <td><span className="flex flex-wrap gap-1.5">{a.actions.map((x) => <Link key={x.label} href={x.href} className="btn-secondary whitespace-nowrap px-2 py-0.5 text-[13px]">{x.label}</Link>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="py-3 text-[14px] text-slate-600">No open alerts for today&apos;s calls.</p>}
        <p className="mt-2 text-[12.5px] text-slate-500">{alerts.length > 6 ? `Showing the 6 most urgent of ${alerts.length}; the rest are in Exceptions. ` : ""}{folded ? `${folded} older ${folded === 1 ? "alert is" : "alerts are"} folded in because the same visit has a newer alert. ` : ""}Each alert is listed once. Alerts are shown in the app only; nothing is sent by text or email.</p>
      </section>

      <section className="panel" aria-labelledby="monitor-title">
        <div className="mb-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
          <Link href="/rota" className="btn-secondary justify-self-start">Back</Link>
          <h1 id="monitor-title" className="text-center text-[20px] font-semibold text-[#7b1fa2] sm:text-[24px]">The Monitor</h1>
          <span className="flex items-center gap-2 justify-self-end">
            <form action={sweepNowAction}><input type="hidden" name="back" value={back} /><button className="btn-secondary">Check now</button></form>
            {canSettings ? <Link href="/rota/settings" className="text-[#d9473f]" aria-label="Monitor settings" title="Monitor settings"><GearSix size={28} weight="fill" /></Link> : null}
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <p className={stale ? "font-medium text-[#8a5a00]" : "text-slate-600"}>
            {b.lastRun ? <>Last checked at <span className="tabular-nums">{londonTime(b.lastRun.startedAt)}</span>.</> : "Not checked yet today."}
            {stale ? " Automatic checks look behind; press Check now." : ""}{" "}
            {b.medianLatencySec !== null ? <>Alerts reached the office in a median {secs(b.medianLatencySec)} over the last day.</> : null} The page refreshes every minute.
          </p>
          <form method="get" className="flex flex-wrap items-center gap-2" role="search">
            <label className="sr-only" htmlFor="mon-area">Area</label>
            <select id="mon-area" name="area" defaultValue={sp.area ?? ""} className="input w-40 py-1.5"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <label htmlFor="mon-q" className="text-[14px] font-semibold">Search:</label>
            <input id="mon-q" name="q" type="search" defaultValue={sp.q ?? ""} className="input w-full max-w-48 py-1.5 sm:w-48" />
          </form>
        </div>

        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table text-[14.5px]">
              <thead><tr><th>Ref</th><th>Team member</th><th>Area</th><th>In</th><th>Out</th><th>Client</th><th>Service call</th></tr></thead>
              <tbody>
                {rows.map((v) => {
                  const inAt = v.clocks.find((c) => c.kind === "IN");
                  const outAt = v.clocks.find((c) => c.kind === "OUT");
                  const inState = inAt ? <span className="text-[#1d6f9e]">» in: {londonTime(inAt.at)}</span> : v.state === "missed" ? <span className="text-[#b42a23]">» Missed</span> : v.state === "not_delivered" ? <span className="text-[#b42a23]">» Not delivered</span> : v.state === "late" ? <span className="text-[#8a5a00]">» Late</span> : <span>» Due</span>;
                  const outState = outAt ? <span className="text-[#2e7d32]">« Out: {londonTime(outAt.at)}</span> : inAt ? <span className={v.state === "overrun" ? "text-[#8a5a00]" : "text-[#1d6f9e]"}>« {v.state === "overrun" ? "Not clocked out" : "Out:"}</span> : v.state === "late" || v.state === "missed" ? <span className="text-[#8a5a00]">« Late</span> : <span>« Due</span>;
                  return (
                    <tr key={v.id} className={TINT[v.state] ?? ""}>
                      <td><Link href={`/rota/visits/${v.id}#attendance`} className="font-semibold">{v.reference}</Link><div className="text-[13px] text-[#a3242c]">{fmtLondonDate(b.today)}</div><div className="mt-0.5"><Badge tone={visitStateLabel(v, b.now, b.settings.lateAfterMin).tone}>{visitStateLabel(v, b.now, b.settings.lateAfterMin).label}</Badge></div></td>
                      <td>
                        {v.assignments.length ? v.assignments.map((a) => (
                          <div key={a.id} className="whitespace-nowrap">
                            <Link href={`/rota/staff/${a.staff.id}`}>{a.staff.displayName}</Link>{a.slot === "SHADOW" ? " (shadow)" : ""}
                            <span className={`ml-1.5 text-[12.5px] ${a.acknowledgedAt ? "text-[#2e7d32]" : "text-slate-500"}`}>{a.acknowledgedAt ? "✓ seen" : "not seen"}</span>
                            {a.staff.workPhone ? <a href={`tel:${a.staff.workPhone}`} className="ml-1.5 text-[12.5px] tabular-nums">{a.staff.workPhone}</a> : null}
                          </div>
                        )) : <span className="font-medium text-[#b42a23]">No carer booked</span>}
                      </td>
                      <td className="font-medium">{v.area?.name ?? "No area"}</td>
                      <td className="whitespace-nowrap"><span className="font-semibold underline decoration-slate-400 tabular-nums">{londonTime(v.scheduledStart)}</span><div className="tabular-nums">{inState}</div></td>
                      <td className="whitespace-nowrap"><span className="font-semibold underline decoration-slate-400 tabular-nums">{londonTime(v.scheduledEnd)}</span><div className="tabular-nums">{outState}</div></td>
                      <td><Link href={`/rota/service-users/${v.serviceUser.id}`}>{suName(v.serviceUser)}</Link>{v.serviceUser.phone ? <div className="text-[12.5px]"><a href={`tel:${v.serviceUser.phone}`}>{v.serviceUser.phone}</a></div> : null}</td>
                      <td className="font-medium">{v.callType.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="py-6 text-center text-[14px] text-slate-500">{q ? "No calls match your search." : "No calls today."}</p>}
        <details className="mt-3 text-[13.5px]">
          <summary className="cursor-pointer font-medium">What the words mean and how the monitor works</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-slate-700 sm:grid-cols-[150px_1fr]" data-testid="monitor-terms">
            <dt className="font-medium">Late</dt><dd>Nobody has clocked in {b.settings.lateAfterMin} minutes after the planned start.</dd>
            <dt className="font-medium">Missed</dt><dd>Nobody has clocked in {b.settings.missedAfterMin} minutes after the planned start. This means no attendance was recorded. It does not prove the carer did not go, so check with the carer and the person before deciding what happened.</dd>
            <dt className="font-medium">Not delivered</dt><dd>Someone has confirmed the visit did not happen.</dd>
            <dt className="font-medium">Cancelled</dt><dd>The visit was called off in advance. It stays on the list, struck through.</dd>
            <dt className="font-medium">Missed meds</dt><dd>Counted only when medication records are switched on in Rota Settings.</dd>
          </dl>
          <p className="mt-2 text-slate-700">For any problem: open the call’s reference, check with the carer, record what happened, and a manager signs off missed calls on the Missed Calls page.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
            <li>Clock times come from the server when the carer presses the button. Location and NFC checks are not in use.</li>
            <li>Checks run every minute while the background worker runs. On the demo site there is no worker, so use Check now for an immediate check.</li>
            <li>Missed calls are marked once and kept. Nothing is cancelled or reassigned automatically.</li>
            <li>Coordinators are alerted in the app only. No texts or emails are sent.</li>
            <li>Open the reference of a call to record or correct a clock time or change the carer.</li>
          </ul>
        </details>
      </section>
    </>
  );
}
