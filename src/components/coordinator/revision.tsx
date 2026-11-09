import { Card } from "@/components/ui";
import { CHANGE_STATUS, type ChangeStatus, type revisionSummary } from "@/server/care/coordinator/compare";
import { DECISIONS } from "@/lib/care-coordinator-rules";

type Summary = NonNullable<Awaited<ReturnType<typeof revisionSummary>>>;

const TONE: Record<ChangeStatus, string> = {
  NEW: "bg-[#e7f1fb] text-[#1d4f7a]",
  UNCHANGED: "bg-slate-100 text-slate-700",
  CHANGED: "bg-[#fff4dc] text-[#7a5200]",
  CONFLICTING: "bg-[#fde8e8] text-[#9b1c1c]",
  REMOVED_SUPERSEDED: "bg-[#f1ecfb] text-[#4b2f86]",
  MISSING: "bg-[#fde8e8] text-[#9b1c1c]",
};
const ORDER: ChangeStatus[] = ["CONFLICTING", "CHANGED", "REMOVED_SUPERSEDED", "MISSING", "NEW", "UNCHANGED"];

/** What the revised plan changes, field by field, next to the current record (an updated plan for someone on record). */
export function RevisionPanel({ summary }: { summary: Summary }) {
  const rows = [...summary.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <Card title="What the revised plan changes">
      <p className="text-[14px] text-slate-600">Each detail read from the new documents is set against the person&apos;s current record. CSB AI saves routine details by itself; changes to care already arranged and anything that disagrees are listed under Audit &amp; Exceptions. Completed visits are never rewritten.</p>
      <ul className="mt-2 flex flex-wrap gap-2 text-[13px]" aria-label="Changes by kind">
        {ORDER.map((k) => <li key={k} className={`rounded-full px-2.5 py-0.5 font-medium ${TONE[k]}`}>{CHANGE_STATUS[k]}: {summary.counts[k]}</li>)}
      </ul>
      {summary.hidden ? <p className="mt-2 text-[13px] text-slate-600">{summary.hidden} restricted detail{summary.hidden === 1 ? " is" : "s are"} shown only to a registered manager.</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead className="text-[12.5px] uppercase tracking-wide text-slate-500">
            <tr><th className="py-1.5 pr-3">Change</th><th className="py-1.5 pr-3">Detail</th><th className="py-1.5 pr-3">Current record</th><th className="py-1.5 pr-3">Revised documents</th><th className="py-1.5">What CSB AI did</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.factId ?? `x${i}`} className="border-t border-slate-200 align-top">
                <td className="py-2 pr-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${TONE[r.status]}`}>{CHANGE_STATUS[r.status]}</span></td>
                <td className="py-2 pr-3"><span className="block text-[12.5px] text-slate-500">{r.section}</span>{r.label}</td>
                <td className="py-2 pr-3 text-slate-700">{r.record ?? <span className="text-slate-500">Not recorded</span>}</td>
                <td className="py-2 pr-3 text-slate-700">{r.document ?? <span className="text-slate-500">Not given</span>}</td>
                <td className="py-2">
                  {r.decision ? <span className="text-slate-600">{DECISIONS[r.decision as keyof typeof DECISIONS] ?? r.decision}</span> : <span className="text-slate-600">{r.status === "REMOVED_SUPERSEDED" ? "Change or end it on the Templates screen if the council confirms" : "Ask the council for it"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
