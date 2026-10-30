import type { VisitStatus } from "@prisma/client";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName } from "@/server/rota/queries";
import { addDays, fmtLondonDate, isIsoDate, londonDate, londonTime } from "@/lib/london";
import { bulkVisitsAction } from "@/app/rota-actions";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { CarerSlots, FlagBadges, longDate, rotaState, VISIT_LABEL, NotBuiltNotice } from "@/components/rota-ui";
import { weekIsBuilt } from "@/server/rota/build";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(VISIT_LABEL) as VisitStatus[];
const RISK: Record<string, { label: string; colour: string }> = { LOW: { label: "Low", colour: "#3f9a5b" }, MEDIUM: { label: "Medium", colour: "#e0a526" }, HIGH: { label: "High", colour: "#d9473f" } };

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const minsBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60000);

/**
 * Daily Rota: every visit on one day, laid out as the office knows it from OnePlan. Team member and service user
 * filters and the Actions menu at the top, the date heading with previous and next day, bulk actions and search,
 * then one row per visit with scheduled and clocked times, and the day's hour totals at the foot.
 */
export default async function DailyRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const status = STATUSES.includes(sp.status as VisitStatus) ? (sp.status as VisitStatus) : undefined;
  const filters = { date, areaId: sp.area || undefined, staffId: sp.carer || undefined, serviceUserId: sp.su || undefined, callTypeId: sp.call || undefined, status, unassigned: sp.view === "unassigned", review: sp.view === "review", late: sp.view === "late", includeCancelled: sp.cancelled === "1", q: sp.q?.trim() || undefined };
  const [{ rows, truncated }, lk] = await Promise.all([listVisits(ctx, filters), rotaLookups(ctx)]);
  const notBuilt = rows.length === 0 && !(await weekIsBuilt(ctx, date));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canPublish = hasOrgPermission(ctx, "rota.build");
  const params = { date, area: sp.area, carer: sp.carer, su: sp.su, call: sp.call, status: sp.status, view: sp.view, cancelled: sp.cancelled, q: sp.q };
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const back = `/rota/visits?${qs({})}`;
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const scheduled = live.reduce((n, r) => n + minsBetween(r.scheduledStart, r.scheduledEnd), 0);
  const clocked = live.reduce((n, r) => n + (r.actualStart && r.actualEnd ? minsBetween(r.actualStart, r.actualEnd) : 0), 0);
  const unassigned = rows.reduce((n, r) => n + r.flags.unassignedSlots, 0);
  const only = sp.view === "late" ? "late visits" : sp.view === "review" ? "visits with an allocation to review" : sp.view === "unassigned" ? "unassigned visits" : status ? `${VISIT_LABEL[status].toLowerCase()} visits` : null;

  return (
    <>
      <PageHeader title="Daily Rota" back="/rota" subtitle="Every visit on one day. Tick visits and choose a bulk action; each visit is checked on its own and any that cannot change are listed with the reason." />
      <Flash searchParams={sp} />
      {notBuilt ? <NotBuiltNotice date={date} canBuild={hasOrgPermission(ctx, "rota.build")} /> : null}

      <section aria-label="Filters and actions" className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="date" value={date} />
          <label><span className="sr-only">Team member</span>
            <select name="carer" defaultValue={sp.carer ?? ""} className="input w-[210px]"><option value="">Select team member…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select>
          </label>
          <label><span className="sr-only">Service user</span>
            <select name="su" defaultValue={sp.su ?? ""} className="input w-[210px]"><option value="">Select service user…</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select>
          </label>
          <details className="relative">
            <summary className="btn-secondary cursor-pointer list-none">More filters</summary>
            <div className="absolute left-0 z-20 mt-1 grid w-[300px] gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg">
              <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label><span className="label">Service call</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label><span className="label">Status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{VISIT_LABEL[s]}</option>)}</select></label>
              <label><span className="label">Show only</span><select name="view" defaultValue={sp.view ?? ""} className="input"><option value="">All visits</option><option value="late">Late</option><option value="unassigned">Unassigned</option><option value="review">Needs review</option></select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Include cancelled</label>
            </div>
          </details>
          <button className="btn-primary">Show</button>
          {Object.entries(params).some(([k, v]) => k !== "date" && v) ? <Link href={`/rota/visits?date=${date}`} className="btn-secondary">Clear</Link> : null}
        </form>
        <details className="relative">
          <summary className="btn-primary cursor-pointer list-none">Actions ▾</summary>
          <ul className="absolute right-0 z-20 mt-1 w-[220px] rounded border border-slate-200 bg-white py-1 text-[14px] shadow-lg">
            {canEdit ? <li><Link href={`/rota/visits/new?date=${date}`} className="block px-3 py-2 hover:bg-slate-50">Add visit</Link></li> : null}
            <li><Link href={`/rota/visits?${qs({ cancelled: sp.cancelled === "1" ? undefined : "1" })}`} className="block px-3 py-2 hover:bg-slate-50">{sp.cancelled === "1" ? "Hide cancelled" : "View cancelled"}</Link></li>
            <li><Link href="/workforce/absences" className="block px-3 py-2 hover:bg-slate-50">View holidays</Link></li>
            <li><Link href="/rota/templates" className="block px-3 py-2 hover:bg-slate-50">To templates</Link></li>
            <li><Link href={`/rota/advanced?date=${date}`} className="block px-3 py-2 hover:bg-slate-50">To Advanced Rota</Link></li>
          </ul>
        </details>
      </section>

      <section className="panel" aria-label="Visits">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-[#6b46c9] pt-3">
          <h2 className="text-[22px] font-semibold text-[#2f6b3a]">{longDate(date)}</h2>
          <form method="get" className="flex items-center gap-1.5">
            {Object.entries(params).filter(([k, v]) => k !== "date" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Link href={`/rota/visits?${qs({ date: addDays(date, -1) })}`} className="btn-secondary px-2.5" aria-label="Previous day"><CaretLeft size={18} weight="bold" /></Link>
            <label className="sr-only" htmlFor="rota-date">Date</label>
            <input id="rota-date" type="date" name="date" defaultValue={date} className="input w-[150px]" />
            <button className="btn-secondary">Go</button>
            <Link href={`/rota/visits?${qs({ date: addDays(date, 1) })}`} className="btn-secondary px-2.5" aria-label="Next day"><CaretRight size={18} weight="bold" /></Link>
            {date !== londonDate() ? <Link href={`/rota/visits?${qs({ date: undefined })}`} className="ml-1 text-[14px]">Today</Link> : null}
          </form>
        </div>
        {only ? <p className="mb-2 rounded bg-[#fff6db] px-3 py-1.5 text-[14px]" role="note">You are looking at {only} only. <Link href={`/rota/visits?date=${date}`}>Show every visit</Link></p> : null}

        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          {canEdit ? (
            <form id="bulk" action={bulkVisitsAction} className="flex flex-wrap items-end gap-2" aria-label="Bulk actions">
              <input type="hidden" name="back" value={back} />
              <label><span className="sr-only">Bulk action</span>
                <select name="kind" className="input w-[200px]" required defaultValue="">
                  <option value="" disabled>Bulk actions…</option>
                  <option value="cancel">Cancel Visits</option>
                  <option value="activate">Activate Visits</option>
                  <option value="assign">Reassign Visits</option>
                  <option value="unassign">Unassign Visits</option>
                  <option value="lock">Add Rota Lock(s)</option>
                  <option value="unlock">Remove Rota Lock(s)</option>
                  <option value="editTime">Edit Times</option>
                  <option value="editDuration">Edit Duration</option>
                  <option value="editService">Edit Service Name</option>
                  <option value="addAlert">Add Alerts</option>
                  <option value="removeAlert">Remove Alerts</option>
                  <option value="shadow">Add Shadow Shifts</option>
                  <option value="doubleUp">Convert To Double Up</option>
                  <option value="single">Revert Double Up To Single</option>
                  <option value="nudge">Nudge Times</option>
                  {canPublish ? <option value="publish">Publish to carers</option> : null}
                </select>
              </label>
              <button className="btn-primary bg-[#13703c]">Go</button>
              <details className="relative">
                <summary className="cursor-pointer pb-2 text-[13.5px] text-[#1d4f91]">Action options</summary>
                <div className="absolute left-0 z-20 mt-1 grid w-[300px] gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg">
                  <label><span className="label text-[12px]">Team member (reassign, shadow)</span><select name="staffId" className="input"><option value="">Choose…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                  <label><span className="label text-[12px]">Slot</span><select name="slot" className="input"><option value="PRIMARY">Carer 1</option><option value="SECOND">Carer 2</option><option value="SHADOW">Shadow</option></select></label>
                  <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept warnings</label>
                  <label><span className="label text-[12px]">Minutes (nudge)</span><input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} className="input" /></label>
                  <label><span className="label text-[12px]">New start time (edit times)</span><input type="time" name="time" className="input" /></label>
                  <label><span className="label text-[12px]">Duration in minutes (edit duration)</span><input type="number" name="duration" min={5} max={1440} step={5} className="input" /></label>
                  <label><span className="label text-[12px]">Service call (edit service name)</span><select name="callTypeId" className="input"><option value="">Choose…</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label><span className="label text-[12px]">Reason (cancel, activate, unassign)</span><input name="reason" className="input" /></label>
                </div>
              </details>
            </form>
          ) : <span />}
          <form method="get" className="flex items-center gap-2" role="search">
            {Object.entries(params).filter(([k, v]) => k !== "q" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label htmlFor="rota-q" className="text-[14px] font-semibold">Search:</label>
            <input id="rota-q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, postcode, ref" className="input w-[200px]" />
          </form>
        </div>

        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto rounded border border-slate-200">
            <table className="table whitespace-nowrap text-[13.5px] [&_td]:py-1.5 [&_th]:py-2">
              <thead>
                <tr>
                  {canEdit ? <th className="w-8"><SelectAll form="bulk" name="visitIds" label="Select all visits" /></th> : null}
                  <th>Ref</th><th>Date</th><th>Status</th><th title="Acknowledged by the carer"><span aria-hidden>Ack</span><span className="sr-only">Acknowledged by the carer</span></th><th title="Single or double-up">Link</th><th title="Area">Area</th><th title="Run route">Run</th><th title="Risk rating">Risk</th>
                  <th>Service user</th>
                  <th className="text-right">Sched start</th><th className="text-right">Sched end</th><th className="text-right">Sched dur</th>
                  <th className="text-right">Clock in</th><th className="text-right">Clock out</th><th className="text-right">Clock dur</th>
                  <th>Team member</th><th>Service call</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const st = rotaState(v);
                  const carers = v.assignments.filter((a) => a.slot !== "SHADOW");
                  const acked = carers.length > 0 && carers.every((a) => a.acknowledgedAt);
                  const risk = v.serviceUser.riskLevel ? RISK[v.serviceUser.riskLevel] : null;
                  return (
                    <tr key={v.id} className={st.tint}>
                      {canEdit ? <td><input type="checkbox" form="bulk" name="visitIds" value={v.id} aria-label={`Select ${v.reference}`} className="h-4 w-4" /></td> : null}
                      <td><Link href={`/rota/visits/${v.id}`}>{v.reference}</Link></td>
                      <td className="tabular-nums">{fmtLondonDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                      <td className="font-medium">{st.label}</td>
                      <td className="text-center">{acked ? <span className="text-[#13703c]" title="Acknowledged">✓<span className="sr-only">Acknowledged</span></span> : <span className="text-slate-500" title="Not acknowledged">✗<span className="sr-only">Not acknowledged</span></span>}</td>
                      <td className="text-center" title={v.carersRequired > 1 ? "Double-up (two carers)" : "Single carer"}>{v.carersRequired > 1 ? "2" : "1"}<span className="sr-only">{v.carersRequired > 1 ? " carers" : " carer"}</span></td>
                      <td className="text-center">{v.area ? <span title={v.area.name} className="inline-block h-3 w-3 rounded-full align-middle" style={{ background: v.area.colour }}><span className="sr-only">{v.area.name}</span></span> : <span className="text-slate-400" title="No area">–</span>}</td>
                      <td className="text-center">{v.runRoute ? <span title={v.runRoute.name} className="rounded px-1.5" style={{ background: v.runRoute.colour, color: v.runRoute.textColour }}>{v.runRoute.name.slice(0, 3)}<span className="sr-only">{v.runRoute.name.slice(3)}</span></span> : "–"}</td>
                      <td className="text-center">{risk ? <span title={`${risk.label} risk`} className="inline-block h-3 w-3 rounded-[2px] align-middle" style={{ background: risk.colour }}><span className="sr-only">{risk.label} risk</span></span> : "–"}</td>
                      <td><Link href={`/rota/service-users/${v.serviceUser.id}`}>{suName(v.serviceUser)}</Link> <span className="text-slate-500">{v.serviceUser.postcode ?? ""}</span></td>
                      <td className="text-right tabular-nums">{londonTime(v.scheduledStart)}</td>
                      <td className="text-right tabular-nums">{londonTime(v.scheduledEnd)}</td>
                      <td className="text-right tabular-nums">{hm(minsBetween(v.scheduledStart, v.scheduledEnd))}</td>
                      <td className="text-right tabular-nums">{v.actualStart ? londonTime(v.actualStart) : ""}</td>
                      <td className="text-right tabular-nums">{v.actualEnd ? londonTime(v.actualEnd) : ""}</td>
                      <td className="text-right tabular-nums">{v.actualStart && v.actualEnd ? hm(minsBetween(v.actualStart, v.actualEnd)) : ""}</td>
                      <td><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                      <td>{v.callType.name}{v.medicationRequired ? <span className="ml-1 text-[12px] text-slate-500">· med prompt</span> : null}</td>
                      <td><span className="flex gap-1">{v.timeLocked ? <span className="text-[12px] text-slate-600">Locked</span> : null}{!v.publishedAt && v.status === "SCHEDULED" ? <span className="text-[12px] text-slate-600">Not published</span> : null}<FlagBadges flags={{ ...v.flags, late: false }} /></span></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td colSpan={canEdit ? 11 : 10} className="text-right">Totals ({live.length} visits{unassigned ? `, ${unassigned} empty carer slots` : ""})</td>
                  <td className="text-right">Sched</td>
                  <td className="text-right tabular-nums">{hm(scheduled)}</td>
                  <td colSpan={2} className="text-right">Clocked</td>
                  <td className="text-right tabular-nums">{hm(clocked)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty>
        )}
        {truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">Showing the first 1,000 visits. Narrow the filters to see the rest.</p> : null}
        <p className="mt-2 text-[12.5px] text-slate-500">Row colours: late pale yellow, in progress pale blue, complete pale green, missed pale red; the status is always written out too. Hover the area dot, run route and risk square for their names.</p>
      </section>
    </>
  );
}
