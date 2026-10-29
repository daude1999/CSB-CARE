import { Bell, ListChecks, LockSimple, MinusCircle, Pill, User, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { cycleWeekOf, fromDbDate, hhmm, isoWeekday, londonDate, mondayOf, WEEKDAYS } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { listTemplates } from "@/server/rota/templates";
import { templateBulkAction } from "@/app/rota-actions";
import { Empty, Flash } from "@/components/ui";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

const RISK: Record<string, { label: string; colour: string }> = { LOW: { label: "Low", colour: "#3f9a5b" }, MEDIUM: { label: "Medium", colour: "#e0a526" }, HIGH: { label: "High", colour: "#d9473f" } };
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const NEW_DAYS = 7;

/**
 * Daily Templates, laid out as the office knows it from OnePlan: team member and service user filters on the left,
 * "Week N, Day Templates" with the week and day pickers in the middle, the Actions menu on the right, then bulk
 * actions, search and one row per carer slot (a double-up shows as two rows with the same reference).
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const lk = await rotaLookups(ctx);
  const settings = await rotaSettings(db, lk.scope.organisationId);
  const today = londonDate();
  const thisWeek = cycleWeekOf(mondayOf(today), fromDbDate(settings.anchorMonday), settings.cycleLength);
  const week = sp.week === "all" ? undefined : Number(sp.week) >= 1 && Number(sp.week) <= settings.cycleLength ? Number(sp.week) : thisWeek;
  const day = sp.day === "all" ? undefined : Number(sp.day) >= 1 && Number(sp.day) <= 7 ? Number(sp.day) : isoWeekday(today);
  const state = sp.state === "off" || sp.state === "all" ? sp.state : "on";
  const rows = await listTemplates(ctx, { week, day, serviceUserId: sp.su || undefined, staffId: sp.carer || undefined, areaId: sp.area || undefined, callTypeId: sp.call || undefined, state, noCarer: sp.empty === "1", q: sp.q });
  const staffName = new Map(lk.staff.map((s) => [s.id, s.displayName]));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const params: Record<string, string | undefined> = { week: sp.week, day: sp.day, su: sp.su, carer: sp.carer, area: sp.area, call: sp.call, state: sp.state, empty: sp.empty, q: sp.q };
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const back = `/rota/templates?${qs({})}`;
  const heading = `${week ? `Week ${week}` : "All Weeks"}, ${day ? WEEKDAYS[day - 1] : "All Days"} Templates`;
  const newSince = Date.now() - NEW_DAYS * 86400000;
  const slots = rows.reduce((n, t) => n + t.carersRequired, 0);

  return (
    <>
      <Flash searchParams={sp} />
      <form method="get" aria-label="Filters" className="mb-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[260px_1fr_220px]">
        <div className="grid gap-2">
          <label><span className="sr-only">Team member</span>
            <select name="carer" defaultValue={sp.carer ?? ""} className="input"><option value="">Select team member…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select>
          </label>
          <label><span className="sr-only">Service user</span>
            <select name="su" defaultValue={sp.su ?? ""} className="input"><option value="">Select service user…</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select>
          </label>
          <details className="relative">
            <summary className="cursor-pointer text-[13.5px] text-[#1d4f91]">More filters</summary>
            <div className="absolute left-0 z-20 mt-1 grid w-[280px] gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg">
              <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label><span className="label">Service call</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label><span className="label">Templates</span><select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Enabled only</option><option value="off">Disabled only</option><option value="all">Enabled and disabled</option></select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="empty" value="1" defaultChecked={sp.empty === "1"} className="h-4 w-4" /> Only templates with no team member</label>
            </div>
          </details>
        </div>
        <div className="text-center">
          <h1 className="text-[26px] font-semibold text-[#2a6f97]">{heading}</h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <label><span className="sr-only">Template week</span>
              <select name="week" defaultValue={week ? String(week) : "all"} className="input w-[180px]">
                {Array.from({ length: settings.cycleLength }, (_, i) => <option key={i} value={i + 1}>Week {i + 1}{i + 1 === thisWeek ? " (this week)" : ""}</option>)}
                <option value="all">All Weeks</option>
              </select>
            </label>
            <label><span className="sr-only">Day</span>
              <select name="day" defaultValue={day ? String(day) : "all"} className="input w-[140px]">
                {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                <option value="all">All Days</option>
              </select>
            </label>
            <button className="btn-primary">Show</button>
            {Object.values(params).some(Boolean) ? <Link href="/rota/templates" className="btn-secondary">Clear</Link> : null}
          </div>
        </div>
        <details className="relative justify-self-end">
          <summary className="btn-primary cursor-pointer list-none bg-[#2a6f97]">Actions ▾</summary>
          <ul className="absolute right-0 z-20 mt-1 w-[230px] rounded border border-slate-200 bg-white py-1 text-[14px] shadow-lg">
            {canEdit ? <li><Link href="/rota/templates/new" className="block px-3 py-2 hover:bg-slate-50">Add New Template</Link></li> : null}
            <li><Link href={`/rota/templates?${qs({ state: state === "off" ? undefined : "off" })}`} className="block px-3 py-2 hover:bg-slate-50">{state === "off" ? "View enabled" : "View disabled"}</Link></li>
            <li><Link href="/rota/visits" className="block px-3 py-2 hover:bg-slate-50">To Live Rota</Link></li>
            {hasOrgPermission(ctx, "rota.build") ? <li><Link href="/rota/build?new=1" className="block px-3 py-2 hover:bg-slate-50">Forecast Rota Build</Link></li> : null}
            <li><Link href="/rota/templates/planner" className="block px-3 py-2 hover:bg-slate-50">To Advanced Templates</Link></li>
          </ul>
        </details>
      </form>

      <section className="panel border-t-[3px] border-[#2a6f97]" aria-label={heading}>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          {canEdit ? (
            <form id="tbulk" action={templateBulkAction} className="flex flex-wrap items-end gap-2" aria-label="Bulk actions">
              <input type="hidden" name="back" value={back} />
              <label><span className="sr-only">Bulk action</span>
                <select name="kind" className="input w-[220px]" required defaultValue="">
                  <option value="" disabled>Bulk Actions</option>
                  <option value="disable">Disable Template</option>
                  <option value="enable">Enable Template</option>
                  <option value="assign">Reassign Template</option>
                  <option value="unassign">Unassign Template</option>
                  <option value="editTime">Edit Time</option>
                  <option value="editDuration">Edit Duration</option>
                  <option value="nudge">Nudge Times</option>
                  <option value="lock">Add Lock(s)</option>
                  <option value="unlock">Remove Lock(s)</option>
                  <option value="editService">Edit Service Name</option>
                  <option value="addAlert">Add Alert</option>
                  <option value="removeAlert">Remove Alert</option>
                  <option value="duplicate">Duplicate Templates</option>
                  <option value="doubleUp">Convert To Double Up</option>
                  <option value="single">Revert Double Up To Single</option>
                </select>
              </label>
              <button className="btn-primary bg-[#13703c]">Go</button>
              <details className="relative">
                <summary className="cursor-pointer pb-2 text-[13.5px] text-[#1d4f91]">Action options</summary>
                <div className="absolute left-0 z-20 mt-1 grid w-[300px] gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg">
                  <label><span className="label text-[12px]">Team member (reassign)</span><select name="staffId" className="input"><option value="">Choose…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                  <label><span className="label text-[12px]">Slot (reassign, unassign)</span><select name="slot" className="input"><option value="PRIMARY">Team member 1</option><option value="SECOND">Team member 2</option><option value="SHADOW">Shadow</option></select></label>
                  <label><span className="label text-[12px]">New start time (edit time)</span><input type="time" name="time" className="input" /></label>
                  <label><span className="label text-[12px]">Duration in minutes (edit duration)</span><input type="number" name="duration" min={5} max={1440} step={5} className="input" /></label>
                  <label><span className="label text-[12px]">Minutes, negative is earlier (nudge)</span><input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} className="input" /></label>
                  <label><span className="label text-[12px]">Service call (edit service name)</span><select name="callTypeId" className="input"><option value="">Choose…</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                </div>
              </details>
            </form>
          ) : <span />}
          <form method="get" className="flex items-center gap-2" role="search">
            {Object.entries(params).filter(([k, v]) => k !== "q" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label htmlFor="tpl-q" className="text-[14px] font-semibold">Search:</label>
            <input id="tpl-q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, ref, call" className="input w-[200px]" />
          </form>
        </div>

        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto rounded border border-slate-200">
            <table className="table whitespace-nowrap text-[13.5px] [&_td]:py-1.5 [&_th]:py-2">
              <thead>
                <tr>
                  {canEdit ? <th className="w-8"><SelectAll form="tbulk" name="templateIds" label="Select all templates" /></th> : null}
                  <th>Ref</th><th>Day</th><th>New</th><th title="Disabled templates are not built"><span className="sr-only">Disabled</span><MinusCircle size={16} aria-hidden /></th>
                  <th title="Single or double-up">Link</th><th title="Area">Area</th><th title="Run route">Run</th><th title="Risk rating">Risk</th>
                  <th>Service User</th><th className="text-right">Start</th><th className="text-right">End</th><th className="text-right">Dur</th>
                  <th>Team Member</th><th>Service Call</th>
                  <th title="Time lock"><span className="sr-only">Time lock</span><LockSimple size={16} aria-hidden /></th>
                  <th title="Alert when late"><span className="sr-only">Alert when late</span><Bell size={16} aria-hidden /></th>
                  <th title="Medication prompt"><span className="sr-only">Medication prompt</span><Pill size={16} aria-hidden /></th>
                  <th title="Tasks"><span className="sr-only">Tasks</span><ListChecks size={16} aria-hidden /></th>
                  <th>Week</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((t) => {
                  const ref = `T-${t.id.slice(-6).toUpperCase()}`;
                  const risk = t.serviceUser.riskLevel ? RISK[t.serviceUser.riskLevel] : null;
                  const isNew = t.createdAt.getTime() >= newSince;
                  const staff = [t.preferredStaff1Id, ...(t.carersRequired > 1 ? [t.preferredStaff2Id] : [])];
                  return staff.map((id, i) => (
                    <tr key={`${t.id}-${i}`} className={t.enabled ? "" : "[&>td]:bg-slate-100 [&>td]:text-slate-500"}>
                      {canEdit ? <td>{i === 0 ? <input type="checkbox" form="tbulk" name="templateIds" value={t.id} aria-label={`Select ${ref} ${suName(t.serviceUser)} ${t.callType.name}`} className="h-4 w-4" /> : null}</td> : null}
                      <td><Link href={`/rota/templates/${t.id}`} className="text-[#2e7d32]">{ref}</Link></td>
                      <td>{day ? WEEKDAYS[day - 1]!.slice(0, 3) : t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 3)).join(" ")}</td>
                      <td className="text-[#2e7d32]">{isNew ? "New" : ""}</td>
                      <td className="text-center">{t.enabled ? "" : <span title="Disabled" className="text-[#d9473f]"><MinusCircle size={18} weight="fill" aria-hidden /><span className="sr-only">Disabled</span></span>}</td>
                      <td className="text-center" title={t.carersRequired > 1 ? "Double-up (two carers)" : "Single carer"}>{t.carersRequired > 1 ? <UsersThree size={18} weight="fill" className="inline text-[#e0a526]" aria-hidden /> : <User size={16} weight="fill" className="inline text-slate-500" aria-hidden />}<span className="sr-only">{t.carersRequired > 1 ? "Double-up" : "Single"}</span></td>
                      <td className="text-center">{t.area ? <span title={t.area.name} className="inline-block h-3 w-3 rounded-full align-middle" style={{ background: t.area.colour }}><span className="sr-only">{t.area.name}</span></span> : <span className="text-slate-400" title="No area">–</span>}</td>
                      <td className="text-center">{t.runRoute ? <span title={t.runRoute.name} className="rounded px-1.5" style={{ background: t.runRoute.colour, color: t.runRoute.textColour }}>{t.runRoute.name.slice(0, 3)}<span className="sr-only">{t.runRoute.name.slice(3)}</span></span> : ""}</td>
                      <td className="text-center">{risk ? <span title={`${risk.label} risk`} className="inline-block h-3 w-3 rounded-[2px] align-middle" style={{ background: risk.colour }}><span className="sr-only">{risk.label} risk</span></span> : ""}</td>
                      <td><Link href={`/rota/service-users/${t.serviceUser.id}`}>{suName(t.serviceUser)}</Link></td>
                      <td className="text-right tabular-nums">{hhmm(t.startMinute)}</td>
                      <td className="text-right tabular-nums">{hhmm((t.startMinute + t.durationMin) % 1440)}</td>
                      <td className="text-right tabular-nums">{hm(t.durationMin)}</td>
                      <td>{id ? staffName.get(id) ?? "Former staff" : <span className="font-medium text-[#b42a23]">Unassigned</span>}</td>
                      <td>{t.callType.name}</td>
                      <td className="text-center">{t.timeLocked ? <span title="Time locked"><LockSimple size={15} aria-hidden /><span className="sr-only">Time locked</span></span> : ""}</td>
                      <td className="text-center">{t.alertOnLate ? <span title="Alert when late" className="text-slate-500"><Bell size={15} weight="fill" aria-hidden /><span className="sr-only">Alert when late</span></span> : ""}</td>
                      <td className="text-center">{t.medicationRequired ? <span title="Medication prompt (not eMAR)"><Pill size={15} aria-hidden /><span className="sr-only">Medication prompt</span></span> : ""}</td>
                      <td className="text-center">{t._count.tasks ? <span title={`${t._count.tasks} tasks`} className="text-slate-600"><ListChecks size={15} aria-hidden className="inline" /><span className="sr-only">{t._count.tasks} tasks</span></span> : ""}</td>
                      <td>{t.cycleWeeks.length === settings.cycleLength ? "All" : t.cycleWeeks.join(", ")}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No templates for {heading.replace(" Templates", "")} match these filters.</Empty>
        )}
        <p className="mt-2 text-[12.5px] text-slate-500">
          {rows.length} templates, {slots} team member slots. A double-up shows as two rows with the same reference. Changing a template does not change visits already built until you apply the change from the template. Run routes are planned and not built yet.
        </p>
      </section>
    </>
  );
}
