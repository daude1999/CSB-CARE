import type { VisitStatus } from "@prisma/client";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName } from "@/server/rota/queries";
import { addDays, fmtLondonDate, isIsoDate, londonDate } from "@/lib/london";
import { bulkVisitsAction } from "@/app/rota-actions";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import { AreaDot, CarerSlots, FlagBadges, Stepper, TimeSpan, VisitStatusBadge, VISIT_LABEL } from "@/components/rota-ui";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(VISIT_LABEL) as VisitStatus[];

export default async function DailyVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const status = STATUSES.includes(sp.status as VisitStatus) ? (sp.status as VisitStatus) : undefined;
  const filters = { date, areaId: sp.area || undefined, staffId: sp.carer || undefined, serviceUserId: sp.su || undefined, callTypeId: sp.call || undefined, status, unassigned: sp.view === "unassigned", review: sp.view === "review", includeCancelled: sp.cancelled === "1", q: sp.q?.trim() || undefined };
  const [{ rows, truncated }, lk] = await Promise.all([listVisits(ctx, filters), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canPublish = hasOrgPermission(ctx, "rota.build");
  const params = { date, area: sp.area, carer: sp.carer, su: sp.su, call: sp.call, status: sp.status, view: sp.view, cancelled: sp.cancelled, q: sp.q };
  const back = `/rota/visits?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]))}`;
  const minutes = rows.filter((r) => r.status !== "CANCELLED").reduce((n, r) => n + (r.scheduledEnd.getTime() - r.scheduledStart.getTime()) / 60000, 0);
  const unassigned = rows.reduce((n, r) => n + r.flags.unassignedSlots, 0);

  return (
    <>
      <PageHeader
        title="Daily Visits"
        back="/rota"
        subtitle="Every visit on one day. Filter, then tick visits to assign, move, lock, publish or cancel them together. Each visit is checked on its own, and any that cannot change are listed with the reason."
        actions={canEdit ? <Link href={`/rota/visits/new?date=${date}`} className="btn-primary">Add one-off visit</Link> : null}
      />
      <Flash searchParams={sp} />

      <section aria-label="Filters" className="panel mb-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Stepper base="/rota/visits" params={params} param="date" prev={addDays(date, -1)} next={addDays(date, 1)} label={fmtLondonDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
          <p className="text-[13.5px] text-slate-600">
            <span className="tabular-nums">{rows.length}</span> visits · <span className="tabular-nums">{(minutes / 60).toFixed(1)}</span> planned hours · <span className={unassigned ? "font-medium text-[#a3242c]" : ""}><span className="tabular-nums">{unassigned}</span> empty carer slots</span>
            {date !== londonDate() ? <> · <Link href="/rota/visits">Back to today</Link></> : null}
          </p>
        </div>
        <form className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" method="get">
          <label className="col-span-2 md:col-span-1"><span className="label">Date</span><input type="date" name="date" defaultValue={date} className="input" /></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span className="label">Carer</span><select name="carer" defaultValue={sp.carer ?? ""} className="input"><option value="">Any carer</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
          <label><span className="label">Service user</span><select name="su" defaultValue={sp.su ?? ""} className="input"><option value="">Anyone</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select></label>
          <label><span className="label">Call type</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span className="label">Status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{VISIT_LABEL[s]}</option>)}</select></label>
          <label><span className="label">Show</span><select name="view" defaultValue={sp.view ?? ""} className="input"><option value="">All visits</option><option value="unassigned">Unassigned only</option><option value="review">Needs review only</option></select></label>
          <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, postcode, ref" className="input" /></label>
          <div className="col-span-2 flex flex-wrap items-center gap-3 md:col-span-4 xl:col-span-8">
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Include cancelled</label>
            <button className="btn-primary" type="submit">Apply filters</button>
            <Link href={`/rota/visits?date=${date}`} className="btn-secondary">Clear</Link>
          </div>
        </form>
      </section>

      {canEdit ? (
        <form id="bulk" action={bulkVisitsAction} className="panel mb-3" aria-label="Change selected visits">
          <input type="hidden" name="back" value={back} />
          <h2 className="mb-2 text-[15px]">Change selected visits</h2>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="sr-only">Assign a carer</legend>
              <label><span className="label">Carer</span><select name="staffId" className="input w-48"><option value="">Choose…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
              <label><span className="label">Slot</span><select name="slot" className="input w-32"><option value="PRIMARY">First carer</option><option value="SECOND">Second carer</option><option value="SHADOW">Shadow</option></select></label>
              <label className="flex items-center gap-1.5 pb-2 text-[13.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept warnings</label>
              <button className="btn-secondary" name="kind" value="assign">Assign</button>
              <button className="btn-secondary" name="kind" value="unassign">Remove from slot</button>
            </fieldset>
            <fieldset className="flex items-end gap-2">
              <legend className="sr-only">Move times</legend>
              <label><span className="label">Minutes (− earlier)</span><input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} className="input w-24" /></label>
              <button className="btn-secondary" name="kind" value="nudge">Move times</button>
            </fieldset>
            <fieldset className="flex items-end gap-2">
              <legend className="sr-only">Lock or publish</legend>
              <button className="btn-secondary" name="kind" value="lock">Lock times</button>
              <button className="btn-secondary" name="kind" value="unlock">Unlock</button>
              {canPublish ? <button className="btn-secondary" name="kind" value="publish">Publish</button> : null}
            </fieldset>
            <fieldset className="flex items-end gap-2">
              <legend className="sr-only">Cancel</legend>
              <label><span className="label">Cancellation reason</span><input name="reason" className="input w-56" placeholder="Required to cancel" /></label>
              <button className="btn-danger" name="kind" value="cancel">Cancel visits</button>
            </fieldset>
          </div>
        </form>
      ) : null}

      <Card>
        {rows.length ? (
          <div className="min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {canEdit ? <th className="w-8"><SelectAll form="bulk" name="visitIds" label="Select all visits" /></th> : null}
                <th>Time</th>
                <th>Service user</th>
                <th>Call</th>
                <th>Carers</th>
                <th>Area</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className={v.status === "CANCELLED" ? "opacity-60" : undefined}>
                  {canEdit ? <td><input type="checkbox" form="bulk" name="visitIds" value={v.id} aria-label={`Select ${v.reference}`} className="h-4 w-4" /></td> : null}
                  <td>
                    <TimeSpan start={v.scheduledStart} end={v.scheduledEnd} />
                    {v.timeLocked ? <span className="ml-1 text-[12px] text-slate-500" title="Time locked">· locked</span> : null}
                  </td>
                  <td>
                    <Link href={`/rota/visits/${v.id}`}>{suName(v.serviceUser)}</Link>
                    <div className="text-[12.5px] text-slate-500">{v.reference} · {v.serviceUser.postcode ?? "no postcode"}</div>
                  </td>
                  <td>
                    {v.callType.name}
                    {v.medicationRequired ? <span className="block text-[12px] text-slate-500">Medication prompt</span> : null}
                  </td>
                  <td><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                  <td><AreaDot area={v.area} /></td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <VisitStatusBadge status={v.status} />
                      <FlagBadges flags={v.flags} />
                      {!v.publishedAt && v.status === "SCHEDULED" ? <span className="text-[12px] text-slate-500">Not published</span> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty>
        )}
        {truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">Showing the first 1,000 visits. Narrow the filters to see the rest.</p> : null}
      </Card>
    </>
  );
}
