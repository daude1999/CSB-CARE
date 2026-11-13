import { ACCEPTED, destinationField } from "@/lib/care-coordinator-rules";
import type { IntakeView } from "@/server/care/coordinator/intake";
import { Badge, fmtDate } from "@/components/ui";

type Fact = IntakeView["facts"][number];

const DECISION_TONE = { PENDING: "amber", APPROVED: "green", EDITED: "green", REJECTED: "slate", CLARIFY: "amber", DUPLICATE: "slate" } as const;
const TEMPORAL = { CURRENT: null, HISTORICAL: "Historical", UNKNOWN: "Date unclear" } as const;

/**
 * One fact read from a document, read-only (owner's brief of 7 Nov 2026: no fact-by-fact approval): where it goes in
 * the profile, what was read, the page it came from with the exact words, any conflict, and what CSB AI (or, on older
 * intakes, a person) did with it. Corrections are made on the record itself.
 */
export function FactRow({ fact, docName }: { fact: Fact; docName: string | null }) {
  const decided = fact.decision !== "PENDING";
  return (
    <li id={`fact-${fact.id}`} className={`scroll-mt-24 rounded-[3px] border border-l-[3px] border-slate-200 bg-white px-3 py-2.5 ${fact.conflict ? "border-l-[#e3934a]" : ACCEPTED.has(fact.decision) ? "border-l-[#3fae6a]" : fact.decision === "REJECTED" ? "border-l-[#e4544f]" : "border-l-slate-300"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-slate-900">{fact.label} <span className="ml-1 text-meta font-normal text-slate-600">→ <span className="font-mono text-caption">{destinationField(fact.destination)}</span></span></h3>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={DECISION_TONE[fact.decision as keyof typeof DECISION_TONE] ?? "slate"}>{fact.decisionLabel}</Badge>
          {fact.appliedAt ? <Badge tone="navy">Saved to record</Badge> : null}
          {fact.restricted ? <Badge tone="violet">Restricted</Badge> : null}
          {TEMPORAL[fact.temporal as keyof typeof TEMPORAL] ? <Badge tone="amber">{TEMPORAL[fact.temporal as keyof typeof TEMPORAL]}</Badge> : null}
          {fact.origin === "MANUAL" ? <Badge>Added by hand</Badge> : fact.verification === "VERIFIED" ? <Badge tone="green" title="The exact words were found on the page">Words found on page</Badge> : <Badge tone="amber" title="The exact words were not found; compare with the original">Check original</Badge>}
        </div>
      </div>

      <p className="mt-1 whitespace-pre-line break-words text-body text-slate-900">{fact.display || <span className="text-slate-500">No value</span>}</p>
      {fact.decision === "EDITED" && fact.proposedDisplay && fact.proposedDisplay !== fact.display ? <p className="mt-1 text-meta text-slate-600">Read from the document as: {fact.proposedDisplay}</p> : null}
      {fact.existing !== null && fact.existing !== "" ? <p className="mt-1 text-meta text-slate-600">On the record now: {fact.existing}</p> : null}

      {!fact.hidden ? (
        <div className="mt-1.5 rounded bg-[#f5f9fc] px-3 py-1.5 text-meta text-slate-700">
          <span className="font-medium">{docName ?? (fact.origin === "MANUAL" ? "Added by a person" : "Document")}</span>
          {fact.sourcePage ? <>, page {fact.sourcePage}</> : null}
          {fact.sourceDocumentId ? <> · <a href={`/api/care-coordinator/documents/${fact.sourceDocumentId}${fact.sourcePage ? `#page=${fact.sourcePage}` : ""}`} target="_blank" rel="noopener">Open original<span className="sr-only"> (opens in a new tab)</span></a></> : null}
          {fact.quote ? <> · <q className="italic text-slate-800">{fact.quote}</q></> : null}
        </div>
      ) : null}

      {fact.conflict ? <p role="note" className="mt-2 rounded border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-body text-[#6b4a00]">{fact.conflict}</p> : null}
      {fact.question ? <p className="mt-2 text-body text-slate-800"><span className="font-medium">Question:</span> {fact.question}{fact.assignedTo ? <> · asked of {fact.assignedTo}</> : null}</p> : null}
      {decided ? <p className="mt-1 text-meta text-slate-600">{fact.decisionLabel} · {fact.decidedBy ?? "Unknown"}{fact.decidedAt ? `, ${fmtDate(fact.decidedAt, true)}` : ""}{fact.decisionNote ? `. ${fact.decisionNote}` : ""}</p> : null}

    </li>
  );
}
