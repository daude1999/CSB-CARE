"use client";
import { useActionState } from "react";
import Link from "@/components/link";
import { careCoordinatorImportAction, type ImportState } from "@/app/care-coordinator-actions";

const initial: ImportState = {phase:"idle",message:"No records have been created."};
export function CareCoordinatorIntakeForm() {
  const [state, action, busy] = useActionState(careCoordinatorImportAction, initial);
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Controlled service-user import.</strong> Do not paste patient details into GitHub.
        Prepare an accurate source-linked JSON manifest from the support plan and discharge letter,
        review it and upload the original PDFs using this secure authenticated form.
        Clinical instructions, risk ratings, medication and the rota must be approved separately.
      </section>
      <form action={action} encType="multipart/form-data" className="space-y-4">
        <label className="block">
          <span className="label">Approved service-user import manifest (JSON)</span>
          <textarea name="manifest" required rows={14} className="input w-full font-mono text-xs" spellCheck={false}
            placeholder='{"serviceUser":{"firstName":"...","lastName":"...","areaId":"..."},"contacts":[],"carePlan":{"summary":"...","reviewDue":"2027-01-15","sections":{...}},"package":{"startDate":"2026-11-09","endDate":"2026-12-30"},"visits":[...]}' />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Council Support Plan (PDF, 4 MB max)</span>
            <input type="file" name="supportPlan" accept=".pdf,application/pdf" className="input w-full" /></label>
          <label className="block"><span className="label">Hospital Discharge Letter (restricted PDF, 4 MB max)</span>
            <input type="file" name="discharge" accept=".pdf,application/pdf" className="input w-full" /></label>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>I have checked that this is the correct service user and organisation, reconciled the authorised care package and visit timetable, and approve creation of Assessment-stage records and unpublished recurring templates. I understand risk and clinical approvals are NOT being performed.</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="preview" disabled={busy} className="btn-secondary">
            {busy ? "Processing…" : "Validate without saving"}
          </button>
          <button type="submit" name="intent" value="execute" disabled={busy} className="btn-primary">Create approved draft records</button>
        </div>
      </form>
      <section aria-live="polite" className="rounded-xl border border-slate-200 p-4 text-sm">
        <p className="font-semibold">{state.phase === "error" ? "Needs attention" : state.phase === "complete" ? "Import result" : state.phase === "preview" ? "Preflight validation" : "Status"}</p>
        <p className="mt-1 whitespace-pre-wrap">{state.message}</p>
        {state.count ? <p className="mt-2">Proposed: {state.count.contacts} contacts, {state.count.visits} recurring visits, {state.count.weeklyMinutes} minutes/week.</p> : null}
        {state.serviceUserId ? <p className="mt-2"><Link href={`/rota/service-users/${state.serviceUserId}`} className="font-semibold underline">Open created service user</Link></p> : null}
        {state.steps?.length ? <ul className="mt-2 list-disc pl-5">{state.steps.map((s,i)=><li key={i}>{s}</li>)}</ul> : null}
        {state.blocked?.length ? <div className="mt-3"><strong>Must be completed by authorised staff:</strong><ul className="mt-1 list-disc pl-5">{state.blocked.map((s,i)=><li key={i}>{s}</li>)}</ul></div> : null}
      </section>
    </div>
  );
}
