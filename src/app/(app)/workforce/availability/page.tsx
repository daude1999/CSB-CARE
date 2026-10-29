import Link from "@/components/link";
import { ForbiddenError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, hhmm, londonDate, WEEKDAYS } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { absenceStaff, listAvailability } from "@/server/workforce/absences";
import { addAvailabilityAction, endAvailabilityAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  let data;
  try {
    data = await listAvailability(ctx, sp.staff || undefined);
  } catch (e) {
    if (e instanceof ForbiddenError) return <><PageHeader title="Availability" back="/hr" /><Card><Empty>{e.message}</Empty></Card></>;
    throw e;
  }
  const { actor, rows } = data;
  const staff = await absenceStaff(ctx);
  const back = `/workforce/availability${sp.staff ? `?staff=${sp.staff}` : ""}`;
  const people = [...new Map(rows.map((r) => [r.staff.id, r.staff.displayName])).entries()];

  return (
    <>
      <PageHeader title="Availability" back="/hr" subtitle="Each person's usual working pattern. Times marked unavailable block allocation; if someone has available times recorded, visits outside them need a coordinator's review. People with nothing recorded can be booked at any time." />
      <Flash searchParams={sp} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Working patterns" actions={<form method="get" className="flex gap-2"><select name="staff" defaultValue={sp.staff ?? ""} className="input py-1.5 text-[14px]" aria-label="Member of staff"><option value="">Everyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select><button className="btn-secondary py-1">Show</button></form>}>
          {people.length ? (
            <div className="space-y-4">
              {people.map(([id, name]) => (
                <section key={id} aria-label={name}>
                  <h3 className="mb-1 text-[14.5px] font-semibold"><Link href={`/rota/staff/${id}`}>{name}</Link></h3>
                  <ul className="rows">
                    {rows.filter((r) => r.staff.id === id).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
                        <span className="w-24">{WEEKDAYS[r.weekday - 1]}</span>
                        <span className="tabular-nums">{hhmm(r.startMinute)}–{r.endMinute === 1440 ? "24:00" : hhmm(r.endMinute)}</span>
                        <Badge tone={r.kind === "AVAILABLE" ? "green" : "rose"}>{r.kind === "AVAILABLE" ? "Available" : "Unavailable"}</Badge>
                        <span className="text-[12.5px] text-slate-500">from {fmtLondonDate(fromDbDate(r.effectiveFrom))}{r.effectiveTo ? ` to ${fmtLondonDate(fromDbDate(r.effectiveTo))}` : ""}{r.note ? ` · ${r.note}` : ""}</span>
                        {actor.canEdit ? <form action={endAvailabilityAction} className="ml-auto"><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={r.id} /><button className="btn-secondary px-2 py-0.5 text-[13px]">End</button></form> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : <Empty>No working patterns recorded{sp.staff ? " for this person" : ""}.</Empty>}
        </Card>
        {actor.canEdit ? (
          <Card title="Add to a pattern">
            <form action={addAvailabilityAction} className="space-y-2.5">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">Member of staff</span><select name="staffId" required defaultValue={sp.staff ?? ""} className="input"><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
              <fieldset><legend className="label">Days</legend><div className="flex flex-wrap gap-3">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="weekdays" value={i + 1} defaultChecked={i < 5} className="h-4 w-4" /> {d.slice(0, 3)}</label>)}</div></fieldset>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">From</span><input type="time" name="start" required defaultValue="07:00" className="input" /></label>
                <label><span className="label">Until</span><input type="time" name="end" required defaultValue="15:00" className="input" /></label>
              </div>
              <label className="block"><span className="label">This time is</span><select name="kind" className="input"><option value="AVAILABLE">Available to work</option><option value="UNAVAILABLE">Not available</option></select></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Starting</span><input type="date" name="from" required defaultValue={londonDate()} className="input" /></label>
                <label><span className="label">Ending (optional)</span><input type="date" name="to" className="input" /></label>
              </div>
              <label className="block"><span className="label">Note</span><input name="note" className="input" placeholder="e.g. school run" /></label>
              <button className="btn-primary">Save</button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
