import { ROUTE_KIND_LABEL } from "@/server/rota/routes";

/** The add-route form shared by live and template run routes (OnePlan's fields: name, run type, owner, colours). */
export function RouteForm({ action, back, staff, areas, withWeek, defaultWeek }: { action: (fd: FormData) => Promise<void>; back: string; staff: { id: string; displayName: string }[]; areas: { id: string; name: string }[]; withWeek: boolean; defaultWeek?: string }) {
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="back" value={back} />
      <label className="block"><span className="label">Run route name</span><input name="name" required minLength={2} maxLength={60} className="input" /></label>
      <label className="block"><span className="label">Run type</span><select name="kind" className="input">{Object.entries(ROUTE_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="block"><span className="label">Team member (team member route)</span><select name="staffId" className="input"><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
      <label className="block"><span className="label">Area (area route)</span><select name="areaId" className="input"><option value="">Choose…</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {withWeek ? <label className="block"><span className="label">Week starting</span><input type="date" name="weekStart" required defaultValue={defaultWeek} className="input" /></label> : null}
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Colour</span><input type="color" name="colour" defaultValue="#1a6b8f" className="input h-10 p-1" /></label>
        <label><span className="label">Text colour</span><input type="color" name="textColour" defaultValue="#ffffff" className="input h-10 p-1" /></label>
      </div>
      <p className="text-[12.5px] text-slate-600">The text colour must be readable on the route colour; the server checks the contrast.</p>
      <button className="btn-primary">Add run route</button>
    </form>
  );
}

export function RouteChip({ name, colour, textColour }: { name: string; colour: string; textColour: string }) {
  return <span className="inline-block rounded px-2 py-0.5 text-[12.5px] font-medium" style={{ background: colour, color: textColour }}>{name}</span>;
}
