import { addDays, fmtLondonDate, isIsoDate, londonDate, londonTime, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName, weekDates } from "@/server/rota/queries";
import { assignCarerAction, moveVisitAction } from "@/app/rota-actions";
import { Flash, PageHeader } from "@/components/ui";
import { Stepper } from "@/components/rota-ui";
import { PlannerBoard, type PlannerChip, type PlannerRow } from "@/components/planner-board";
import Link from "@/components/link";

export const dynamic = "force-dynamic";

export default async function PlannerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const today = londonDate();
  const week = mondayOf(sp.week && isIsoDate(sp.week) ? sp.week : today);
  const dates = weekDates(week);
  const [{ rows: visits, truncated }, lk] = await Promise.all([listVisits(ctx, { date: week, to: addDays(week, 6), areaId: sp.area || undefined, includeCancelled: sp.cancelled === "1" }, 3000), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const blank = () => dates.map((): PlannerChip[] => []);
  const byStaff = new Map<string, { cells: PlannerChip[][]; minutes: number }>();
  const unassigned = blank();

  for (const v of visits) {
    const di = dayIndex.get(londonDate(v.scheduledStart));
    if (di === undefined) continue;
    const time = londonTime(v.scheduledStart);
    const name = suName(v.serviceUser);
    const movable = v.status === "SCHEDULED" || v.status === "MISSED";
    const done = v.status === "COMPLETED" || v.status === "IN_PROGRESS";
    const minutes = (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000;
    for (const a of v.assignments) {
      const row = byStaff.get(a.staffId) ?? { cells: blank(), minutes: 0 };
      row.cells[di]!.push({ visitId: v.id, slot: a.slot as PlannerChip["slot"], lockVersion: v.lockVersion, href: `/rota/visits/${v.id}`, time, label: `${name}${a.slot === "SHADOW" ? " (shadow)" : v.carersRequired > 1 ? " (2)" : ""}`, title: `${v.callType.name} ${time}–${londonTime(v.scheduledEnd)}${a.reviewReason && movable ? ` · Needs review: ${a.reviewReason}` : ""}`, tone: v.status === "CANCELLED" ? "cancelled" : done ? "done" : a.reviewReason && movable ? "review" : "ok", movable });
      if (v.status !== "CANCELLED" && a.slot !== "SHADOW") row.minutes += minutes;
      byStaff.set(a.staffId, row);
    }
    if (v.flags.unassignedSlots > 0) {
      const slot = v.assignments.some((a) => a.slot === "PRIMARY") ? "SECOND" : "PRIMARY";
      unassigned[di]!.push({ visitId: v.id, slot, lockVersion: v.lockVersion, href: `/rota/visits/${v.id}`, time, label: `${name}${v.carersRequired > 1 ? " (2)" : ""}`, title: `${v.callType.name} ${time}–${londonTime(v.scheduledEnd)} · drag to a carer to assign`, tone: "empty", movable });
    }
  }
  // Carers shown: everyone booked this week, plus (when an area is chosen) that area's carers so there is somewhere to drop.
  const staffRows = lk.staff.filter((s) => byStaff.has(s.id) || (sp.area ? s.areas.some((a) => a.areaId === sp.area) : sp.all === "1"));
  const rows: PlannerRow[] = [
    { id: "unassigned", name: "Unassigned", sub: `${unassigned.flat().length} visits`, cells: unassigned },
    ...staffRows.map((s) => {
      const r = byStaff.get(s.id) ?? { cells: blank(), minutes: 0 };
      return { id: s.id, name: s.displayName, sub: `${(r.minutes / 60).toFixed(1)} h · ${s.jobTitle}`, href: `/rota/staff/${s.id}`, cells: r.cells };
    }),
  ];
  // A drag that needs confirmation comes back with the move in the address, so the coordinator can accept the warnings.
  const move = (() => {
    const [visitId, slot, staffId, lockVersion, toDate] = (sp.move ?? "").split("~");
    const v = visits.find((x) => x.id === visitId);
    const st = lk.staff.find((x) => x.id === staffId);
    if (!v || !st || !slot || !lockVersion) return null;
    return { visitId: v.id, slot, staffId: st.id, lockVersion, toDate: toDate && isIsoDate(toDate) ? toDate : null, label: `${suName(v.serviceUser)} at ${londonTime(v.scheduledStart)} on ${fmtLondonDate(londonDate(v.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}`, staff: st.displayName };
  })();
  const params = { week, area: sp.area, cancelled: sp.cancelled, all: sp.all };
  const back = `/rota/planner?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]))}`;

  return (
    <>
      <PageHeader title="Rota Planner" back="/rota" subtitle="The week by carer. Drag a visit to another carer to reassign it, or to another day to move that one visit at the same time of day (its recurring template is not changed). Every move is checked against holidays, HR checks, clashes and preferences before it is saved. Keyboard users can open a visit and change the carer or day there." />
      <Flash searchParams={sp} />
      <section aria-label="Week and filters" className="panel mb-3 flex flex-wrap items-end justify-between gap-3">
        <Stepper base="/rota/planner" params={params} param="week" prev={addDays(week, -7)} next={addDays(week, 7)} label={`w/c ${fmtLondonDate(week, { day: "numeric", month: "short", year: "numeric" })}`} />
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={week} />
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="h-4 w-4" /> Show carers with no visits</label>
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Cancelled</label>
          <button className="btn-primary">Show</button>
          {week !== mondayOf(today) ? <Link href="/rota/planner" className="btn-secondary">This week</Link> : null}
        </form>
      </section>
      {move && sp.error?.startsWith("Needs your confirmation") && canEdit ? (
        <section aria-label="Confirm move" className="panel mb-3 border-l-4 border-[#e3934a]">
          <p className="text-[14px]">Move <span className="font-medium">{move.label}</span> to <span className="font-medium">{move.staff}</span>{move.toDate ? <> on <span className="font-medium">{fmtLondonDate(move.toDate, { weekday: "short", day: "numeric", month: "short" })}</span></> : null} anyway? The warnings above will be recorded on the allocation.</p>
          <form action={move.toDate ? moveVisitAction : assignCarerAction} className="mt-2 flex gap-2">
            {move.toDate ? <input type="hidden" name="toDate" value={move.toDate} /> : null}
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="visitId" value={move.visitId} />
            <input type="hidden" name="slot" value={move.slot} />
            <input type="hidden" name="staffId" value={move.staffId} />
            <input type="hidden" name="lockVersion" value={move.lockVersion} />
            <input type="hidden" name="acceptWarnings" value="true" />
            <button className="btn-primary">Move anyway</button>
            <Link href={back} className="btn-secondary">Leave it</Link>
          </form>
        </section>
      ) : null}
      <section className="panel" aria-label="Week planner">
        <div className="mb-2 flex flex-wrap gap-3 text-[12.5px] text-slate-600">
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-[#b9cfea] bg-[#eef4fb] align-middle" />Allocated</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-[#f2b8bc] bg-[#fde1e3] align-middle" />Needs review</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-dashed border-[#e4544f] align-middle" />Unassigned</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-[#bfe3cd] bg-[#eef8f2] align-middle" />Started or done</span>
          <span>(2) double-up</span>
        </div>
        <PlannerBoard days={dates.map((d) => ({ date: d, label: fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" }), today: d === today }))} rows={rows} action={assignCarerAction} moveAction={moveVisitAction} back={back} canEdit={canEdit} />
        {truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">This week has more than 3,000 visits. Choose an area to see them all.</p> : null}
      </section>
    </>
  );
}
