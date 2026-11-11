import Link from "@/components/link";
import { Badge, Empty, fmtDate } from "@/components/ui";
import { resolveExceptionAction } from "@/app/coordinator-actions";
import type { ExceptionView } from "@/server/care/coordinator/exceptions";

const TONE = { URGENT: "rose", REVIEW: "amber", FOLLOW_UP: "teal", INFO: "slate" } as const;
const TAB_LABEL: Record<string, string> = { details: "Personal details", people: "Contacts", package: "Care package", "care-plans": "Care plan", risks: "Risk assessments", medication: "Medication", incidents: "Incidents", bodymap: "Body map", template: "Visit templates", "call-notes": "Call notes", references: "Reference numbers" };

/**
 * The exceptions CSB AI left after automatic setup (or a person raised), each with what it is about, where it came from,
 * the record to correct, who owns it and the actions that settle it. Used on the intake and on the person's
 * Audit & Exceptions tab. Every action is a server action that checks permissions again.
 */
export function ExceptionList({ items, hidden, back, profileBase, empty }: { items: ExceptionView[]; hidden: number; back: string; profileBase: string | null; empty: string }) {
  if (!items.length && !hidden) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-2">
      {hidden ? <p className="text-meta text-slate-600">{hidden} restricted item{hidden === 1 ? " is" : "s are"} not shown to you (clinical, medication or safeguarding). A registered manager sees and settles {hidden === 1 ? "it" : "them"}.</p> : null}
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.id} id={`exception-${x.id}`} className={`rounded border px-3 py-2 ${x.status === "OPEN" && x.severity === "URGENT" ? "border-[#e8a1a6] bg-[#fff6f6]" : "border-slate-200 bg-white"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={x.status === "OPEN" ? TONE[x.severity] : "green"}>{x.status === "OPEN" ? x.severityLabel : "Resolved"}</Badge>
              <span className="font-medium text-body">{x.title}</span>
              <span className="text-meta text-slate-600">{x.categoryLabel}{x.restricted ? " · restricted" : ""}</span>
            </div>
            <p className="mt-1 text-body text-slate-800">{x.description}</p>
            <dl className="mt-1 grid grid-cols-1 gap-x-4 text-meta text-slate-600 sm:grid-cols-2">
              <div><dt className="inline">Source: </dt><dd className="inline">{x.sourceRef ?? "Not recorded"}</dd></div>
              <div><dt className="inline">Raised: </dt><dd className="inline">{fmtDate(x.createdAt, true)} by {x.raisedBy}</dd></div>
              <div><dt className="inline">Owner: </dt><dd className="inline">{x.owner}</dd></div>
              {x.intake ? <div><dt className="inline">Intake: </dt><dd className="inline"><Link href={`/rota/coordinator/${x.intake.id}?step=setup`}>{x.intake.reference}</Link></dd></div> : null}
            </dl>
            {x.status !== "OPEN" ? <p className="mt-1 text-meta text-slate-700">Resolved {fmtDate(x.resolvedAt, true)} by {x.resolvedBy}: {x.resolution}</p> : null}
            {x.status === "OPEN" ? (
              <div className="mt-2 flex flex-wrap items-start gap-2">
                {profileBase && x.recordTab ? <Link href={`${profileBase}?tab=${x.recordTab}`} className="btn-secondary py-1">Open {TAB_LABEL[x.recordTab] ?? "the record"}</Link> : null}
                {x.choices.length > 1 || (x.choices.length === 1 && x.category !== "REFERENCE") ? x.choices.map((c) => (
                  <form key={c.factId} action={resolveExceptionAction}>
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={x.id} /><input type="hidden" name="action" value="USE_FACT" /><input type="hidden" name="factId" value={c.factId} />
                    <button className="btn-secondary py-1" title={c.source}>Use &ldquo;{c.value}&rdquo; <span className="text-caption text-slate-600">({c.source})</span></button>
                  </form>
                )) : null}
                {x.referenceChoice ? (
                  <form action={resolveExceptionAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={x.id} /><input type="hidden" name="action" value="REFERENCE_TYPE" />
                    <label className="sr-only" htmlFor={`type-${x.id}`}>What the number is</label>
                    <select id={`type-${x.id}`} name="type" className="input w-auto py-1" required defaultValue=""><option value="" disabled>What is it?</option><option value="COUNCIL_CLIENT">Council client number</option><option value="COUNCIL_PACKAGE">Council package reference</option><option value="COUNCIL_FRAMEWORK">Framework / contract ID</option></select>
                    <button className="btn-secondary py-1">Save it</button>
                  </form>
                ) : null}
                <details className="w-full sm:w-auto">
                  <summary className="btn-secondary cursor-pointer list-none py-1">{x.choices.length ? "Leave out or resolve" : "Resolve"}</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <form action={resolveExceptionAction} className="space-y-1">
                      <input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={x.id} /><input type="hidden" name="action" value="RESOLVE" />
                      <label className="block"><span className="label">What was done</span><textarea name="note" required minLength={5} maxLength={2000} rows={2} className="input" placeholder="e.g. Rang the council: 24.75 hours is right; package corrected" /></label>
                      <button className="btn-primary py-1">Mark resolved</button>
                    </form>
                    {x.choices.length ? (
                      <form action={resolveExceptionAction} className="space-y-1">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={x.id} /><input type="hidden" name="action" value="LEAVE_OUT" />
                        <label className="block"><span className="label">Why it is left out</span><textarea name="note" required minLength={5} maxLength={1000} rows={2} className="input" /></label>
                        <button className="btn-secondary py-1">Leave it out</button>
                      </form>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}
            {x.trail.length ? (
              <details className="mt-1 text-meta text-slate-600"><summary className="cursor-pointer">History ({x.trail.length})</summary>
                <ol className="mt-1 space-y-0.5">{x.trail.map((t, i) => <li key={i}>{fmtDate(t.at, true)} · {t.action} · {t.by}</li>)}</ol>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
