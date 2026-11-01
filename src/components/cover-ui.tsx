import Link from "@/components/link";
import { Badge } from "@/components/ui";
import { RANK_LABEL, type CheckState, type CoverCheck } from "@/server/rota/missed-cover";
import type { Candidate } from "@/server/rota/queries";

/**
 * Shared pieces of the Find Cover panels (Missed Calls today; Unassigned Visits can reuse them): the panel header, a
 * selectable carer row from the eligibility service's ranking, and the safety-check list. Wrap them in <DrawerShell>.
 * Nothing here decides eligibility: it only shows what `slotCandidates` and `coverChecks` returned.
 */

export const PURPLE = "inline-flex items-center justify-center rounded-[6px] bg-[#6b46c9] px-4 py-2 text-[14px] font-semibold text-white no-underline hover:bg-[#5935b6] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6b46c9] disabled:cursor-not-allowed disabled:opacity-50";
export const QUIET = "inline-flex items-center justify-center rounded-[6px] border border-slate-300 bg-white px-3 py-2 text-[14px] font-medium text-slate-800 no-underline hover:border-[#6b46c9] hover:text-[#4b2f9a]";
export const CHECK_TONE: Record<CheckState, { mark: string; cls: string; sr: string }> = {
  ok: { mark: "✓", cls: "bg-[#e6f4ea] text-[#1e6b2c]", sr: "Passed" },
  info: { mark: "i", cls: "bg-slate-100 text-slate-600", sr: "For information" },
  warn: { mark: "!", cls: "bg-[#fdf3dc] text-[#8a5a00]", sr: "Warning" },
  fail: { mark: "✕", cls: "bg-[#fde8e8] text-[#9b231d]", sr: "Failed" },
};

export function CoverHeader({ close, title = "Find Replacement Cover", subtitle = "Find an eligible care worker for this visit." }: { close: string; title?: string; subtitle?: string }) {
  return (
    <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 id="fc-title" className="text-[18px] font-semibold text-[#2a1a5e]">{title}</h2>
        <p className="text-[13.5px] text-slate-600">{subtitle}</p>
      </div>
      <Link href={close} scroll={false} className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-[20px] leading-none text-slate-600 no-underline hover:bg-slate-100 hover:text-slate-900" aria-label="Close Find Cover">×</Link>
    </header>
  );
}

/** Plain bullets from the match score's explanation. Points are not shown: they order the list, they are not a rating. */
function bullets(c: Candidate) {
  const out = c.explain
    .filter((e) => e.text !== "allowed, with warnings to read")
    .map((e) => {
      const t = e.text.replace(/^passes every check$/, "all rota checks passed").replace(/^supported this person/, "supported this service user");
      return t.charAt(0).toUpperCase() + t.slice(1);
    });
  const availability = c.reasons.some((r) => /working pattern|requested|availability/i.test(r));
  return [...out, availability ? "No rota clash at this time" : "Available at this time: no leave or rota clash"];
}

export function CarerOption({ c, rank, name }: { c: Candidate & { areas?: string[] }; rank: number | null; name: string }) {
  const disabled = c.state === "NOT_ELIGIBLE";
  const id = `fc-${name}-${c.id}`;
  return (
    <li>
      <label htmlFor={id} className={`flex gap-3 rounded-[8px] border p-3 ${disabled ? "cursor-not-allowed border-slate-200 bg-slate-50" : "cursor-pointer border-slate-200 bg-white hover:border-[#6b46c9] has-[:checked]:border-[#6b46c9] has-[:checked]:ring-2 has-[:checked]:ring-[#6b46c9]/25"}`}>
        <input id={id} type="radio" name="fcStaff" value={c.id} disabled={disabled} required className="mt-1 h-4 w-4 accent-[#6b46c9]" aria-describedby={`${id}-why`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-[14.5px] text-slate-900">{c.name}</b>
            {rank !== null ? <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${rank === 0 ? "bg-[#ede7fb] text-[#4b2f9a]" : "bg-slate-100 text-slate-700"}`}>{RANK_LABEL[rank]}</span> : null}
            {c.state === "REQUIRES_REVIEW" ? <Badge tone="amber">Check first</Badge> : c.state === "NOT_ELIGIBLE" ? <Badge tone="rose">Not eligible</Badge> : <Badge tone="green">Eligible</Badge>}
          </span>
          <span id={`${id}-why`} className="block">
            {disabled ? (
              <span className="mt-1 block text-[13px] text-[#8a1f1a]">{c.reasons.slice(0, 3).join("; ")}</span>
            ) : (
              <>
                <ul className="mt-1 list-disc pl-4 text-[13px] text-slate-700">{bullets(c).map((b) => <li key={b}>{b}</li>)}</ul>
                {c.reasons.length ? <span className="mt-1 block text-[13px] text-[#8a5a00]">Check: {c.reasons.slice(0, 3).join("; ")}</span> : null}
              </>
            )}
            {c.areas?.length ? <span className="mt-0.5 block text-[12.5px] text-slate-500">Areas: {c.areas.join(", ")}</span> : null}
          </span>
        </span>
      </label>
    </li>
  );
}


export function SafetyChecks({ checks }: { checks: CoverCheck[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-[8px] border border-slate-200 text-[13.5px]" aria-label="Safety checks">
      {checks.map((k) => (
        <li key={k.label} className="flex gap-2.5 px-3 py-2">
          <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${CHECK_TONE[k.state].cls}`}>{CHECK_TONE[k.state].mark}</span>
          <span><span className="sr-only">{CHECK_TONE[k.state].sr}: </span><b className="font-medium">{k.label}</b>: {k.text}</span>
        </li>
      ))}
    </ul>
  );
}
