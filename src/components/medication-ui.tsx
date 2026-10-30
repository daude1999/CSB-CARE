import type { MarRecord, Medication } from "@prisma/client";
import Link from "@/components/link";
import { fmtLondonDate, fromDbDate, londonTime } from "@/lib/london";
import { OUTCOME_CODE, OUTCOME_LABEL, ROUTE_LABEL, SUPPORT_LABEL, TIME_RANGE_KEYS, TIME_RANGES } from "@/server/care/medication";
import { addMedicationAction, approveMedicationAction, correctDoseAction, recordDoseAction, stopMedicationAction } from "@/app/medication-actions";
import { Badge, Card, Empty, fmtDate } from "@/components/ui";

const label = <T extends string>(map: Record<T, string>, k: string) => (k in map ? map[k as T] : k);
const when = (m: Medication) => (m.asRequired ? `As required${m.maxDosesPerDay ? `, at most ${m.maxDosesPerDay} a day` : ""}` : m.timeRanges.map((t) => label(Object.fromEntries(TIME_RANGE_KEYS.map((k) => [k, TIME_RANGES[k].label])) as Record<string, string>, t)).join(", "));

export function MedicationOff() {
  return <Card><Empty>Medication records are switched off for your organisation. An organisation admin can switch them on in Rota Settings once a clinical review has been done.</Empty></Card>;
}

/** The medicines on a person's list, with approval by a second person, stopping and changing. */
export function MedicationList({ meds, serviceUserId, back, canManage, me, names, month }: { meds: Medication[]; serviceUserId: string; back: string; canManage: boolean; me: string; names: Map<string, string>; month: string }) {
  const who = (id: string | null) => (id ? names.get(id) ?? "a former member" : "");
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Medicines" actions={<a href={`/api/rota/mar?su=${serviceUserId}&month=${month}`} className="btn-secondary py-1">MAR chart (PDF)</a>}>
        {meds.length ? (
          <ul className="rows">
            {meds.map((m) => (
              <li key={m.id} className="py-3 text-[14px]" data-medication={m.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.name}{m.strength ? ` ${m.strength}` : ""}</span>
                  {m.status === "DRAFT" ? <Badge tone="amber">Waiting for a second check</Badge> : m.status === "ACTIVE" ? <Badge tone="green">In use</Badge> : <Badge>Stopped</Badge>}
                  {m.controlled ? <Badge tone="rose">Controlled drug</Badge> : null}
                  {m.asRequired ? <Badge tone="violet">As required</Badge> : null}
                </div>
                <p className="text-[13.5px] text-slate-700">{m.dose} · {label(ROUTE_LABEL, m.route)} · {label(SUPPORT_LABEL, m.support)} · {when(m)} · from {fmtLondonDate(fromDbDate(m.startDate))}{m.endDate ? ` to ${fmtLondonDate(fromDbDate(m.endDate))}` : ""}</p>
                {m.instructions ? <p className="text-[13.5px] text-slate-700">{m.instructions}</p> : null}
                <p className="text-[12.5px] text-slate-500">Entered by {who(m.createdById)} {fmtDate(m.createdAt, true)}{m.approvedById ? ` · checked by ${who(m.approvedById)}` : ""}{m.prescriber ? ` · prescriber ${m.prescriber}` : ""}{m.stopReason ? ` · stopped: ${m.stopReason}` : ""}{m.changeReason ? ` · change: ${m.changeReason}` : ""}</p>
                {canManage && m.status === "DRAFT" ? (
                  m.createdById === me ? <p className="text-[13px] text-slate-600">You entered this, so someone else must check it against the prescription and approve it.</p> : (
                    <form action={approveMedicationAction} className="mt-1"><input type="hidden" name="back" value={back} /><input type="hidden" name="medicationId" value={m.id} /><button className="btn-primary py-1">Checked against the prescription: approve</button></form>
                  )
                ) : null}
                {canManage && m.status !== "STOPPED" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.status === "ACTIVE" ? (
                      <details className="w-full">
                        <summary className="btn-secondary inline-block cursor-pointer py-1">Record a change</summary>
                        <MedicationForm back={back} serviceUserId={serviceUserId} m={m} />
                      </details>
                    ) : null}
                    <details>
                      <summary className="btn-secondary inline-block cursor-pointer py-1">Stop</summary>
                      <form action={stopMedicationAction} className="mt-2 flex flex-wrap gap-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="medicationId" value={m.id} /><input name="reason" required minLength={3} className="input py-1" placeholder="Why it stops" aria-label={`Why ${m.name} stops`} /><button className="btn-danger py-1">Stop</button></form>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <Empty>No medicines recorded.</Empty>}
      </Card>
      {canManage ? <Card title="Add a medicine"><MedicationForm back={back} serviceUserId={serviceUserId} /><p className="mt-2 text-[12.5px] text-slate-600">Copy it exactly from the prescription or the pharmacy label. A second person checks it before carers see it. The platform does not check doses or interactions.</p></Card> : null}
    </div>
  );
}

function MedicationForm({ back, serviceUserId, m }: { back: string; serviceUserId: string; m?: Medication }) {
  return (
    <form action={addMedicationAction} className="mt-2 space-y-2">
      <input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={serviceUserId} />
      {m ? <input type="hidden" name="replacesId" value={m.id} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Medicine</span><input name="name" required defaultValue={m?.name} className="input" /></label>
        <label><span className="label">Strength</span><input name="strength" defaultValue={m?.strength ?? ""} placeholder="e.g. 500 mg" className="input" /></label>
        <label><span className="label">Dose</span><input name="dose" required defaultValue={m?.dose} placeholder="e.g. 1 tablet" className="input" /></label>
        <label><span className="label">How it is taken</span><select name="route" defaultValue={m?.route ?? "ORAL"} className="input">{Object.entries(ROUTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className="label">Support</span><select name="support" defaultValue={m?.support ?? "PROMPT"} className="input">{Object.entries(SUPPORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className="label">Starts</span><input type="date" name="startDate" required defaultValue={m ? fromDbDate(m.startDate) : undefined} className="input" /></label>
      </div>
      <fieldset><legend className="label">When</legend>
        <div className="flex flex-wrap gap-3 text-[13.5px]">
          {TIME_RANGE_KEYS.map((k) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="timeRanges" value={k} defaultChecked={m?.timeRanges.includes(k)} />{TIME_RANGES[k].label}</label>)}
          <label className="flex items-center gap-1.5"><input type="checkbox" name="asRequired" value="1" defaultChecked={m?.asRequired} />As required</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="controlled" value="1" defaultChecked={m?.controlled} />Controlled drug</label>
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Most doses a day (as required)</span><input type="number" name="maxDosesPerDay" min={1} max={24} defaultValue={m?.maxDosesPerDay ?? ""} className="input" /></label>
        <label><span className="label">Ends (optional)</span><input type="date" name="endDate" defaultValue={m?.endDate ? fromDbDate(m.endDate) : ""} className="input" /></label>
      </div>
      <label className="block"><span className="label">Instructions</span><textarea name="instructions" rows={2} defaultValue={m?.instructions ?? ""} className="input" /></label>
      <label className="block"><span className="label">Prescriber</span><input name="prescriber" defaultValue={m?.prescriber ?? ""} className="input" /></label>
      {m ? <label className="block"><span className="label">What changed</span><input name="reason" required minLength={3} className="input" /></label> : null}
      <button className="btn-primary">{m ? "Save change for a second check" : "Add for a second check"}</button>
    </form>
  );
}

type Due = { med: Medication; records: MarRecord[] };

/** On the carer's visit: each medicine due, and a form to record it once clocked in. */
export function CarerMedication({ visitId, due, clockedIn }: { visitId: string; due: Due[]; clockedIn: boolean }) {
  if (!due.length) return null;
  return (
    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5" aria-label="Medication">
      <p className="text-[13.5px] font-medium">Medication due</p>
      <ul className="mt-1 space-y-2">
        {due.map(({ med: m, records }) => (
          <li key={m.id} className="text-[13.5px]">
            <p><span className="font-medium">{m.name}{m.strength ? ` ${m.strength}` : ""}</span> · {m.dose} · {label(SUPPORT_LABEL, m.support)}{m.asRequired ? " · as required" : ""}{m.controlled ? " · controlled drug" : ""}</p>
            {m.instructions ? <p className="text-slate-700">{m.instructions}</p> : null}
            {records.map((r) => <p key={r.id} className="text-slate-700">Recorded: {OUTCOME_LABEL[r.outcome]} at {londonTime(r.at)}{r.reason ? ` (${r.reason})` : ""}</p>)}
            {clockedIn && (m.asRequired || !records.length) ? (
              <form action={recordDoseAction} className="mt-1 flex flex-wrap items-end gap-2">
                <input type="hidden" name="back" value="/carer" /><input type="hidden" name="visitId" value={visitId} /><input type="hidden" name="medicationId" value={m.id} />
                <label><span className="label">Outcome</span><select name="outcome" className="input py-1.5" aria-label={`Outcome for ${m.name}`}>{Object.entries(OUTCOME_LABEL).filter(([k]) => m.asRequired || k !== "NOT_REQUIRED").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <input name="reason" className="input min-w-0 flex-1 py-1.5" placeholder="Reason if refused or not given" aria-label={`Reason for ${m.name}`} />
                {m.controlled ? <input name="witnessName" className="input py-1.5" placeholder="Witness name" aria-label={`Witness for ${m.name}`} /> : null}
                <button className="btn-primary py-1">Record</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {!clockedIn ? <p className="mt-1 text-[12.5px] text-slate-600">Clock in to record medication.</p> : null}
    </div>
  );
}

/** On the office's visit page: what was due, every record including corrections, and the correction form. */
export function VisitMedication({ data, back, canManage }: { data: { due: Medication[]; records: MarRecord[]; meds: Map<string, Medication> }; back: string; canManage: boolean }) {
  return (
    <section id="medication" aria-label="Medication">
      <Card title="Medication">
        {data.due.length || data.records.length ? (
          <ul className="rows text-[14px]">
            {data.due.map((m) => {
              const recs = data.records.filter((r) => r.medicationId === m.id);
              return (
                <li key={m.id} className="py-2">
                  <p className="font-medium">{m.name}{m.strength ? ` ${m.strength}` : ""} · {m.dose}{m.asRequired ? " · as required" : ""}</p>
                  {recs.length ? recs.map((r) => (
                    <div key={r.id} className={r.supersededAt ? "text-slate-500 line-through" : ""}>
                      <span>{OUTCOME_CODE[r.outcome]} · {OUTCOME_LABEL[r.outcome]} at {londonTime(r.at)}{r.reason ? ` · ${r.reason}` : ""}{r.witnessName ? ` · witness ${r.witnessName}` : ""}{r.supersedesId ? " · correction" : ""}</span>
                      {canManage && !r.supersededAt ? (
                        <details className="no-underline">
                          <summary className="cursor-pointer text-[13px] text-navy-700">Correct this record</summary>
                          <form action={correctDoseAction} className="mt-1 flex flex-wrap gap-2"><input type="hidden" name="back" value={`${back}#medication`} /><input type="hidden" name="recordId" value={r.id} /><select name="outcome" className="input py-1" aria-label="Correct outcome">{Object.entries(OUTCOME_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input name="reason" required minLength={5} className="input py-1" placeholder="Why it is corrected" aria-label="Why it is corrected" /><button className="btn-secondary py-1">Save correction</button></form>
                        </details>
                      ) : null}
                    </div>
                  )) : <p className={m.asRequired ? "text-slate-500" : "font-medium text-[#a3242c]"}>{m.asRequired ? "Not needed on this visit" : "Not recorded"}</p>}
                </li>
              );
            })}
          </ul>
        ) : <Empty>No medicines due on this visit.</Empty>}
        <p className="mt-2 text-[12.5px] text-slate-600">Records cannot be edited or deleted. A correction is kept alongside the original. <Link href="/rota/exceptions?kind=MISSED_MEDICATION">Missed medication</Link></p>
      </Card>
    </section>
  );
}
