"use client";
import { useActionState, useMemo, useState } from "react";
import Link from "@/components/link";
import { careCoordinatorImportAction, type ImportState } from "@/app/care-coordinator-actions";
import { DESTINATIONS, DECISIONS, type ReviewField } from "@/server/care/coordinator-field-review";

const initial: ImportState = {phase:"idle",message:"No records have been created."};
type Manifest = { fieldReviews?: ReviewField[]; [key:string]:unknown };
export function CareCoordinatorIntakeForm() {
  const [state, action, busy] = useActionState(careCoordinatorImportAction, initial);
  const [manifest,setManifest]=useState("");
  const parsed=useMemo(()=>{
    try{
      const value:unknown=JSON.parse(manifest);
      return typeof value==="object" && value!==null && !Array.isArray(value) ? value as Manifest : null;
    } catch {return null;}
  },[manifest]);
  const reviews=parsed?.fieldReviews ?? [];
  function patchReview(index:number, key:keyof ReviewField, value:string) {
    if(!parsed || !Array.isArray(parsed.fieldReviews)) return;
    const next={...parsed,fieldReviews:parsed.fieldReviews.map((item,i)=>
      i===index?{...item,[key]:value}:item)};
    setManifest(JSON.stringify(next,null,2));
  }
  return <div className="space-y-5">
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Source-linked Care Coordinator import.</strong> This uses the existing Service User profile,
      not a duplicate client database. Read the extracted proposals individually, including the original document
      and page reference. Clinical information remains subject to independent review.
      Do not copy personal medical documents into GitHub.
    </section>
    <form action={action} encType="multipart/form-data" className="space-y-4">
      <label className="block">
        <span className="label">Source-linked import manifest</span>
        <textarea name="manifest" required rows={10} className="input w-full font-mono text-xs"
          value={manifest} onChange={e=>setManifest(e.target.value)} spellCheck={false}
          placeholder='{"serviceUser":{...},"contacts":[],"carePlan":{...},"package":{...},"visits":[...],"fieldReviews":[{"id":"personal.name","destination":"personal","fieldPath":"serviceUser.firstName","label":"First name","sourceDocument":"Council Support Plan","sourcePage":1,"confidence":"HIGH","proposedValue":"Example","decision":"APPROVE","reviewedBy":"Coordinator name"}]}'/>
      </label>
      {reviews.length>0 ? <section aria-label="Field-by-field coordinator review" className="space-y-3">
        <h2 className="text-lg font-semibold">Source → destination review ({reviews.length} fields)</h2>
        <p className="text-sm text-slate-600">Edit decisions and reasons here; the JSON updates automatically. Only approved and verified fields can be saved. Historical incidents, body-map observations, medication and other unsupported destinations remain review-only.</p>
        <div className="max-h-[600px] space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {reviews.map((r,i)=><article key={r.id||i} className="rounded-lg border border-slate-200 p-3 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{r.label}</strong>
              <span className="text-xs text-slate-500">{DESTINATIONS[r.destination]||"Unmapped"} · {r.fieldPath}</span>
            </div>
            <p><strong>Source:</strong> {r.sourceDocument} · page {r.sourcePage} · {r.confidence}</p>
            <p className="whitespace-pre-wrap break-words"><strong>Proposed:</strong> {r.proposedValue}</p>
            {r.existingValue !== undefined ? <p className="whitespace-pre-wrap"><strong>Existing:</strong> {r.existingValue}</p>:null}
            {r.discrepancy?<p className="text-amber-800">Conflict: {r.discrepancy}</p>:null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label><span className="label">Decision</span>
                <select className="input w-full" aria-label={`Decision for ${r.label}`} value={r.decision} onChange={e=>patchReview(i,"decision",e.target.value)}>
                  {DECISIONS.map(d=><option value={d} key={d}>{d}</option>)}
                </select>
              </label>
              <label><span className="label">Reviewed by</span>
                <input className="input w-full" aria-label={`Reviewer for ${r.label}`} value={r.reviewedBy||""} onChange={e=>patchReview(i,"reviewedBy",e.target.value)}/>
              </label>
            </div>
            <label className="block"><span className="label">Reason / clarification</span>
              <input className="input w-full" value={r.reason||""} aria-label={`Reason for ${r.label}`} onChange={e=>patchReview(i,"reason",e.target.value)}/>
            </label>
            <label className="block"><span className="label">Proposed value (edit and mark EDITED)</span>
              <textarea className="input w-full" rows={2} value={r.proposedValue} aria-label={`Proposed value for ${r.label}`} onChange={e=>patchReview(i,"proposedValue",e.target.value)}/>
            </label>
          </article>)}
        </div>
        <p className="text-xs text-slate-600">A changed proposed value must also be changed in its corresponding structured manifest field before validation will pass. This prevents an approved label from silently saving different data.</p>
      </section>:null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Council Support Plan (PDF)</span>
          <input type="file" name="supportPlan" accept=".pdf,application/pdf" className="input w-full" /></label>
        <label className="block"><span className="label">Hospital Discharge Letter (restricted PDF)</span>
          <input type="file" name="discharge" accept=".pdf,application/pdf" className="input w-full" /></label>
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>I have reviewed every field and original source, confirmed the organisation and service user,
          and approve creation of Assessment-stage records, non-active risk drafts and unpublished recurring templates.
          I understand clinical approvals, staff allocation and rota publication are separate.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="preview" disabled={busy} className="btn-secondary">
          {busy?"Processing…":"Validate without saving"}
        </button>
        <button type="submit" name="intent" value="execute" disabled={busy || reviews.length===0} className="btn-primary">
          Create approved draft records
        </button>
      </div>
    </form>
    <section aria-live="polite" className="rounded-xl border border-slate-200 p-4 text-sm">
      <p className="font-semibold">{state.phase==="error"?"Needs attention":state.phase==="complete"?"Import result":state.phase==="preview"?"Validation":"Status"}</p>
      <p className="mt-1 whitespace-pre-wrap">{state.message}</p>
      {state.count?<p className="mt-2">{state.count.contacts} contacts, {state.count.visits} recurring templates and {state.count.weeklyMinutes} minutes/week.</p>:null}
      {state.serviceUserId?<div className="mt-2 flex flex-wrap gap-3">
        <Link href={`/rota/service-users/${state.serviceUserId}`} className="underline">Open service user</Link>
        <Link href={`/rota/service-users/import/risks?id=${state.serviceUserId}`} className="underline">Review draft risks</Link>
        <Link href={`/rota/service-users/import/reviews?id=${state.serviceUserId}`} className="underline">Review confidential follow-ups</Link>
        <Link href={`/rota/service-users/import/finalize?id=${state.serviceUserId}`} className="underline">Prepare approved rota week</Link>
      </div>:null}
      {state.steps?.length?<ul className="mt-2 list-disc pl-5">{state.steps.map((s,i)=><li key={i}>{s}</li>)}</ul>:null}
      {state.blocked?.length?<div className="mt-3"><strong>Remaining human checks</strong><ul className="list-disc pl-5">{state.blocked.map((s,i)=><li key={i}>{s}</li>)}</ul></div>:null}
    </section>
  </div>;
}
