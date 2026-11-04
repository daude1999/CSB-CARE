"use client";
import { useActionState } from "react";
import Link from "@/components/link";
import {coordinatorBuildAction,type BuildState} from "@/app/care-coordinator-build-actions";
const initial:BuildState={phase:"idle",message:"No rota visits have been created."};
export function CoordinatorRotaBuildForm({id}:{id:string}){
  const [state,action,busy]=useActionState(coordinatorBuildAction,initial);
  return <form action={action} className="space-y-4">
    <input name="serviceUserId" type="hidden" value={id} />
    <label className="block"><span className="label">Week beginning (Monday)</span><input name="weekStart" type="date" required className="input" /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /><span>I am an authorised manager. The care plan is independently approved, risk assessments and clinical requirements have been checked, and I authorise activating this person and creating unpublished visits for this week.</span></label>
    <button className="btn-primary" disabled={busy}>{busy?"Preparing…":"Activate and create unpublished rota visits"}</button>
    <section aria-live="polite" className="rounded-lg border border-slate-200 p-3 text-sm">
      <strong>{state.phase==="error"?"Action needs attention":state.phase==="complete"?"Rota build result":"Status"}</strong>
      <p className="mt-1">{state.message}</p>
      {state.created!==undefined?<p>{state.created} visits created; {state.existing} existing visits skipped.</p>:null}
      {state.errors?.length?<ul className="mt-2 list-disc pl-4">{state.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:null}
      {state.phase==="complete"?<p className="mt-2"><Link href="/rota/today" className="underline">Open Daily Rota</Link></p>:null}
    </section>
  </form>;
}
