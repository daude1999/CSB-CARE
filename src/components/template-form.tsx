import type { VisitTemplate } from "@prisma/client";
import { fromDbDate, hhmm, londonDate, WEEKDAYS } from "@/lib/london";
import { suName, type rotaLookups } from "@/server/rota/queries";

type Lookups = Awaited<ReturnType<typeof rotaLookups>>;

/** The rota template form, used to create and to edit a template. Validation happens on the server (templateSchema). */
export function TemplateForm({ action, lk, t, taskIds = [], back, cycleLength, submit }: { action: (fd: FormData) => Promise<void>; lk: Lookups; t?: VisitTemplate; taskIds?: string[]; back: string; cycleLength: number; submit: string }) {
  // The HR-fed carer pool, plus whoever the template already names so an existing choice is never silently dropped.
  const keep = new Set([t?.preferredStaff1Id, t?.preferredStaff2Id, t?.shadowStaffId].filter((x): x is string => !!x));
  const pool = new Set(lk.carers.map((s) => s.id));
  const staffOpt = lk.staff.filter((s) => pool.has(s.id) || keep.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.jobTitle}</option>);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      {t ? <><input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="version" value={t.version} /></> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <label><span className="label">Service user</span><select name="serviceUserId" required defaultValue={t?.serviceUserId ?? ""} className="input"><option value="">Choose…</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)} ({s.reference})</option>)}</select></label>
        <label><span className="label">Call type</span><select name="callTypeId" required defaultValue={t?.callTypeId ?? ""} className="input"><option value="">Choose…</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="label">Area</span><select name="areaId" defaultValue={t?.areaId ?? ""} className="input"><option value="">The service user’s area</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <fieldset>
          <legend className="label">Cycle weeks</legend>
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: cycleLength }, (_, i) => i + 1).map((w) => (
              <label key={w} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="cycleWeeks" value={w} defaultChecked={t ? t.cycleWeeks.includes(w) : true} className="h-4 w-4" /> Week {w}</label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Days</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="weekdays" value={i + 1} defaultChecked={t ? t.weekdays.includes(i + 1) : i < 5} className="h-4 w-4" /> {d.slice(0, 3)}</label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label><span className="label">Start (UK time)</span><input type="time" name="start" required defaultValue={t ? hhmm(t.startMinute) : "08:00"} className="input" /></label>
        <label><span className="label">Minutes</span><input type="number" name="durationMin" min={5} max={1440} required defaultValue={t?.durationMin ?? 30} className="input" /></label>
        <label><span className="label">Carers needed</span><select name="carersRequired" defaultValue={t?.carersRequired ?? 1} className="input"><option value={1}>One</option><option value={2}>Two (double-up)</option></select></label>
        <input type="hidden" name="rotaType" value={t?.rotaType ?? "NORMAL"} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label><span className="label">First carer</span><select name="preferredStaff1Id" defaultValue={t?.preferredStaff1Id ?? ""} className="input"><option value="">Leave unassigned</option>{staffOpt}</select></label>
        <label><span className="label">Second carer (double-ups)</span><select name="preferredStaff2Id" defaultValue={t?.preferredStaff2Id ?? ""} className="input"><option value="">None</option>{staffOpt}</select></label>
        <label><span className="label">Shadow carer</span><select name="shadowStaffId" defaultValue={t?.shadowStaffId ?? ""} className="input"><option value="">None</option>{staffOpt}</select></label>
      </div>
      <fieldset>
        <legend className="label">Tasks</legend>
        <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
          {lk.careTasks.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="taskIds" value={c.id} defaultChecked={taskIds.includes(c.id)} className="h-4 w-4" /> {c.name}</label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="timeLocked" defaultChecked={t?.timeLocked ?? false} className="h-4 w-4" /> Lock the time</label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="medicationRequired" defaultChecked={t?.medicationRequired ?? false} className="h-4 w-4" /> Medication prompt</label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="alertOnLate" defaultChecked={t?.alertOnLate ?? true} className="h-4 w-4" /> Alert the office if late</label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label><span className="label">From</span><input type="date" name="effectiveFrom" required defaultValue={t ? fromDbDate(t.effectiveFrom) : londonDate()} className="input" /></label>
        <label><span className="label">Until (optional)</span><input type="date" name="effectiveTo" defaultValue={t?.effectiveTo ? fromDbDate(t.effectiveTo) : ""} className="input" /></label>
        <label><span className="label">Run route</span><select name="runRouteTemplateId" defaultValue={t?.runRouteTemplateId ?? ""} className="input"><option value="">None</option>{lk.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </div>
      <label className="block"><span className="label">Notes for the office</span><textarea name="notes" rows={2} defaultValue={t?.notes ?? ""} className="input" /></label>
      <button className="btn-primary">{submit}</button>
    </form>
  );
}
