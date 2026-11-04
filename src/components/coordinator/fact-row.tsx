import { decideFactAction } from "@/app/coordinator-actions";
import { ACCEPTED, destinationField } from "@/lib/care-coordinator-rules";
import type { IntakeView } from "@/server/care/coordinator/intake";
import { Badge, fmtDate } from "@/components/ui";
import { ValueFields } from "./value-fields";

type Fact = IntakeView["facts"][number];

const DECISION_TONE = { PENDING: "slate", APPROVED: "green", EDITED: "green", REJECTED: "rose", CLARIFY: "amber", DUPLICATE: "slate" } as const;
const TEMPORAL = { CURRENT: null, HISTORICAL: "Historical", UNKNOWN: "Date unclear" } as const;

function Hidden({ fact, back, intakeId }: { fact: Fact; back: string; intakeId: string }) {
  return (
    <>
      <input type="hidden" name="back" value={`${back}#fact-${fact.id}`} />
      <input type="hidden" name="intakeId" value={intakeId} />
      <input type="hidden" name="factId" value={fact.id} />
      <input type="hidden" name="lockVersion" value={fact.lockVersion} />
      <input type="hidden" name="destination" value={fact.destination} />
    </>
  );
}

/**
 * One fact read from a document: where it goes in the profile, what was read, the page it came from with the exact
 * words, any conflict, and the coordinator's decision. The actions are plain forms; every decision is saved at once.
 */
export function FactRow({ fact, docName, editable, back, intakeId, members, callTypes }: { fact: Fact; docName: string | null; editable: boolean; back: string; intakeId: string; members: { id: string; name: string; manager: boolean }[]; callTypes: { id: string; name: string }[] }) {
  const decided = fact.decision !== "PENDING";
  const canAct = editable && !fact.hidden && !fact.appliedAt;
  const open = fact.decision === "PENDING" || fact.decision === "CLARIFY";
  return (
    <li id={`fact-${fact.id}`} className={`scroll-mt-24 rounded-[3px] border border-l-[3px] border-slate-200 bg-white px-3 py-2.5 ${fact.conflict ? "border-l-[#e3934a]" : ACCEPTED.has(fact.decision) ? "border-l-[#3fae6a]" : fact.decision === "REJECTED" ? "border-l-[#e4544f]" : "border-l-slate-300"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold text-slate-900">{fact.label} <span className="ml-1 text-[12.5px] font-normal text-slate-600">→ <span className="font-mono text-[12px]">{destinationField(fact.destination)}</span></span></h3>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={DECISION_TONE[fact.decision as keyof typeof DECISION_TONE] ?? "slate"}>{fact.decisionLabel}</Badge>
          {fact.appliedAt ? <Badge tone="navy">Saved to record</Badge> : null}
          {fact.restricted ? <Badge tone="violet">Restricted</Badge> : null}
          {TEMPORAL[fact.temporal as keyof typeof TEMPORAL] ? <Badge tone="amber">{TEMPORAL[fact.temporal as keyof typeof TEMPORAL]}</Badge> : null}
          {fact.origin === "MANUAL" ? <Badge>Added by hand</Badge> : fact.verification === "VERIFIED" ? <Badge tone="green" title="The exact words were found on the page">Words found on page</Badge> : <Badge tone="amber" title="Compare with the original before approving">Check original</Badge>}
        </div>
      </div>

      <p className="mt-1 whitespace-pre-line break-words text-[14.5px] text-slate-900">{fact.display || <span className="text-slate-500">No value</span>}</p>
      {fact.decision === "EDITED" && fact.proposedDisplay && fact.proposedDisplay !== fact.display ? <p className="mt-1 text-[13px] text-slate-600">Read from the document as: {fact.proposedDisplay}</p> : null}
      {fact.existing !== null && fact.existing !== "" ? <p className="mt-1 text-[13px] text-slate-600">On the record now: {fact.existing}</p> : null}

      {!fact.hidden ? (
        <div className="mt-1.5 rounded bg-[#f5f9fc] px-3 py-1.5 text-[13px] text-slate-700">
          <span className="font-medium">{docName ?? (fact.origin === "MANUAL" ? "Added by a person" : "Document")}</span>
          {fact.sourcePage ? <>, page {fact.sourcePage}</> : null}
          {fact.sourceDocumentId ? <> · <a href={`/api/care-coordinator/documents/${fact.sourceDocumentId}${fact.sourcePage ? `#page=${fact.sourcePage}` : ""}`} target="_blank" rel="noopener">Open original<span className="sr-only"> (opens in a new tab)</span></a></> : null}
          {fact.quote ? <> · <q className="italic text-slate-800">{fact.quote}</q></> : null}
        </div>
      ) : null}

      {fact.conflict ? <p role="note" className="mt-2 rounded border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-[13.5px] text-[#6b4a00]">{fact.conflict}</p> : null}
      {fact.question ? <p className="mt-2 text-[13.5px] text-slate-800"><span className="font-medium">Question:</span> {fact.question}{fact.assignedTo ? <> · asked of {fact.assignedTo}</> : null}</p> : null}
      {decided ? <p className="mt-1 text-[12.5px] text-slate-600">{fact.decisionLabel} by {fact.decidedBy ?? "Unknown"}{fact.decidedAt ? `, ${fmtDate(fact.decidedAt, true)}` : ""}{fact.decisionNote ? `. ${fact.decisionNote}` : ""}</p> : null}

      {canAct ? (
        <div className="mt-2 flex flex-wrap items-start gap-1.5 [&_.btn-danger]:py-1 [&_.btn-primary]:py-1 [&_.btn-secondary]:py-1 [&_.btn-danger]:text-[13.5px] [&_.btn-primary]:text-[13.5px] [&_.btn-secondary]:text-[13.5px]">
          {open ? (
            <form action={decideFactAction}>
              <Hidden fact={fact} back={back} intakeId={intakeId} />
              <input type="hidden" name="decision" value="APPROVED" />
              <button className="btn-primary">Approve</button>
            </form>
          ) : null}
          <details className="group w-full sm:w-auto [&[open]]:w-full">
            <summary className="btn-secondary cursor-pointer list-none">Edit</summary>
            <form action={decideFactAction} className="mt-2 space-y-3 rounded border border-slate-200 p-3">
              <Hidden fact={fact} back={back} intakeId={intakeId} />
              <input type="hidden" name="decision" value="EDITED" />
              <ValueFields destination={fact.destination} value={fact.value} callTypes={callTypes} idPrefix={`e-${fact.id}`} />
              <label className="block"><span className="label">Why you changed it (optional)</span><input name="note" className="input" maxLength={1000} /></label>
              <button className="btn-primary">Save edit and approve</button>
            </form>
          </details>
          {open ? (
            <>
              <details className="w-full sm:w-auto [&[open]]:w-full">
                <summary className="btn-secondary cursor-pointer list-none">Ask a question</summary>
                <form action={decideFactAction} className="mt-2 space-y-2 rounded border border-slate-200 p-3">
                  <Hidden fact={fact} back={back} intakeId={intakeId} />
                  <input type="hidden" name="decision" value="CLARIFY" />
                  <label className="block"><span className="label">What needs clarifying</span><input name="question" required minLength={5} maxLength={1000} className="input" defaultValue={fact.question ?? ""} /></label>
                  <label className="block"><span className="label">Ask someone (they get a notification)</span>
                    <select name="assignedToId" className="input" defaultValue=""><option value="">Nobody yet</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.manager ? " (manager)" : ""}</option>)}</select>
                  </label>
                  <button className="btn-primary">Save question</button>
                </form>
              </details>
              <details className="w-full sm:w-auto [&[open]]:w-full">
                <summary className="btn-secondary cursor-pointer list-none">Duplicate</summary>
                <form action={decideFactAction} className="mt-2 space-y-2 rounded border border-slate-200 p-3">
                  <Hidden fact={fact} back={back} intakeId={intakeId} />
                  <input type="hidden" name="decision" value="DUPLICATE" />
                  <label className="block"><span className="label">Duplicate of what</span><input name="note" required minLength={3} maxLength={1000} className="input" placeholder="e.g. Same as the support plan, page 1" /></label>
                  <button className="btn-secondary">Mark as duplicate</button>
                </form>
              </details>
              <details className="w-full sm:w-auto [&[open]]:w-full">
                <summary className="btn-secondary cursor-pointer list-none">Reject</summary>
                <form action={decideFactAction} className="mt-2 space-y-2 rounded border border-slate-200 p-3">
                  <Hidden fact={fact} back={back} intakeId={intakeId} />
                  <input type="hidden" name="decision" value="REJECTED" />
                  <label className="block"><span className="label">Why it should not be saved</span><input name="note" required minLength={3} maxLength={1000} className="input" /></label>
                  <button className="btn-danger">Reject</button>
                </form>
              </details>
            </>
          ) : (
            <form action={decideFactAction}>
              <Hidden fact={fact} back={back} intakeId={intakeId} />
              <input type="hidden" name="decision" value="PENDING" />
              <button className="btn-secondary">Undo decision</button>
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}
