import { Pill } from "@phosphor-icons/react/dist/ssr";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { setMedicationLeadAction } from "@/app/rota-actions";
import { Badge } from "@/components/ui";
import { LEAD_STATUS_LABEL, type LeadStatus, type medicationLeadView } from "@/server/care/medication-lead";

type View = NonNullable<Awaited<ReturnType<typeof medicationLeadView>>>;

const TONE: Record<LeadStatus, "green" | "amber" | "rose" | "slate"> = { ASSIGNED: "green", NEEDS_REASSESSMENT: "rose", UNASSIGNED: "amber", NOT_NEEDED: "slate" };
const when = (d: Date) => `${fmtLondonDate(londonDate(d), { day: "numeric", month: "short" })} ${londonTime(d)}`;

/**
 * Medication Lead, inside the visit's Carers card: who is responsible for medication on this visit, the choice of
 * carers (only those cleared for medication can be chosen), and the history. It records responsibility only; what was
 * given is recorded on the MAR by the carer who gave it.
 */
export function MedicationLeadPanel({ view, visitId, back }: { view: View; visitId: string; back: string }) {
  if (!view.needed && !view.lead && !view.history.length) return null;
  const choosable = view.options.filter((o) => o.ok && o.staffId !== view.lead?.staffId);
  return (
    <section id="medication-lead" aria-labelledby="medication-lead-title" className="mt-3 rounded-[10px] border border-[#e4e7ec] bg-[#fbfcfe] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill size={18} aria-hidden className="text-module" />
        <h3 id="medication-lead-title" className="text-[15px] font-semibold text-[#101828]">Medication Lead</h3>
        <Badge tone={TONE[view.status]}>{LEAD_STATUS_LABEL[view.status]}</Badge>
      </div>
      {view.lead ? (
        <p className="mt-2 text-[14px] text-[#101828]">
          <strong>{view.lead.name}</strong> <span className="text-slate-600">({view.lead.place})</span>
          <span className="block text-[12.5px] text-slate-500">{view.lead.source === "AUTO" ? "Set automatically: the only carer, cleared for medication" : `Chosen by ${view.lead.by}`} · {when(view.lead.since)}</span>
        </p>
      ) : view.status === "NEEDS_REASSESSMENT" ? (
        <p className="mt-2 text-[14px] font-medium text-[#a3242c]">The Medication Lead is no longer on this visit. Choose another carer who is cleared for medication.</p>
      ) : view.options.length === 0 ? (
        <p className="mt-2 text-[14px] text-slate-600">Book a carer first. With one carer, they become the Medication Lead automatically if they are cleared for medication.</p>
      ) : (
        <p className="mt-2 text-[14px] text-[#8a5a00]">{view.options.length === 1 ? "The carer booked is not cleared for medication, so medication responsibility is not assigned." : "Choose which carer is responsible for medication on this visit."}</p>
      )}
      {view.options.some((o) => !o.ok) ? (
        <ul className="mt-2 space-y-0.5 text-[12.5px] text-slate-600" aria-label="Carers not cleared for medication">
          {view.options.filter((o) => !o.ok).map((o) => <li key={o.staffId}>{o.name} ({o.place}) cannot be Medication Lead: {o.reasons.slice(0, 2).join("; ")}</li>)}
        </ul>
      ) : null}
      {view.canChange && choosable.length ? (
        <form action={setMedicationLeadAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="back" value={`${back}#medication-lead`} />
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="lockVersion" value={view.lockVersion} />
          <label className="min-w-0 flex-1">
            <span className="sr-only">Medication Lead</span>
            <select name="staffId" required className="input max-w-md py-1.5 text-[14px]" aria-label={view.lead ? "Change the Medication Lead to" : "Choose the Medication Lead"}>
              <option value="">{view.lead ? "Change to…" : "Choose a carer…"}</option>
              {choosable.map((o) => <option key={o.staffId} value={o.staffId}>{o.place} · {o.name}</option>)}
            </select>
          </label>
          <input name="reason" required={Boolean(view.lead)} minLength={view.lead ? 3 : undefined} className="input w-56 py-1.5 text-[14px]" placeholder={view.lead ? "Reason for the change" : "Note (optional)"} aria-label={view.lead ? "Reason for changing the Medication Lead" : "Note about the Medication Lead (optional)"} />
          <button className="btn-primary py-1">{view.lead ? "Change Medication Lead" : "Set Medication Lead"}</button>
        </form>
      ) : null}
      {view.history.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[#1d4f91]">Previous Medication Leads ({view.history.length})</summary>
          <ul className="mt-1.5 space-y-1 text-[13px] text-slate-700">
            {view.history.map((h) => (
              <li key={h.id}><strong className="font-medium">{h.name}</strong>, {when(h.from)} to {when(h.to)}. {h.source === "AUTO" ? "Set automatically" : `Chosen by ${h.setBy}`}; ended by {h.endedBy}: {h.endReason}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-2 text-[12px] text-slate-500">The Medication Lead is responsible for medication on this visit. It does not show that medication was given: that is the MAR record, made by the carer who gave it.</p>
    </section>
  );
}
