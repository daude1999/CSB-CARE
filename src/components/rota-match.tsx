import type { AssignmentSlot } from "@prisma/client";
import { assignCarerAction } from "@/app/rota-actions";
import type { Candidate } from "@/server/rota/queries";

const STATE_LABEL = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;

/**
 * The top-scored carers for one slot, each with the points behind the score and a one-press Assign (or Use, when the
 * slot is held). Only carers the eligibility service allows have a score; Assign still goes through the server's
 * assignment path, which checks everything again. Choosing a "check first" carer records that the warnings were read.
 */
export function CarerRecommendations({ list, visitId, slot, lockVersion, back, replacing, take = 3 }: { list: Candidate[]; visitId: string; slot: AssignmentSlot; lockVersion: number; back: string; replacing: boolean; take?: number }) {
  const top = list.filter((c) => c.score !== null).slice(0, take);
  if (!top.length) return null;
  return (
    <ol className="mt-1.5 space-y-1.5">
      {top.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start gap-2 rounded-[4px] border border-slate-200 px-2.5 py-2 text-[13.5px]">
          <span className="inline-flex h-7 w-9 items-center justify-center rounded-[4px] bg-[#e8f0fb] font-semibold tabular-nums text-[#1d4f91]" aria-label={`Suitability ${c.score} out of 100`}>{c.score}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{c.name}</span> <span className="text-slate-600">· {STATE_LABEL[c.state]} · {c.weekHours} h booked this week</span>
            <span className="block text-[12.5px] text-slate-600">{c.explain.map((e) => `${e.points > 0 ? "+" : ""}${e.points} ${e.text}`).join(" · ")}</span>
            {c.reasons.length ? <span className="block text-[12.5px] text-[#8a5a00]">Check: {c.reasons.slice(0, 3).join("; ")}</span> : null}
          </span>
          <form action={assignCarerAction}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="visitId" value={visitId} />
            <input type="hidden" name="slot" value={slot} />
            <input type="hidden" name="staffId" value={c.id} />
            <input type="hidden" name="lockVersion" value={lockVersion} />
            {c.state === "REQUIRES_REVIEW" ? <input type="hidden" name="acceptWarnings" value="true" /> : null}
            <button className="btn-secondary py-1" aria-label={`${replacing ? "Replace with" : "Assign"} ${c.name}${c.state === "REQUIRES_REVIEW" ? ", accepting the warnings shown" : ""}`}>{replacing ? "Use" : "Assign"}</button>
          </form>
        </li>
      ))}
    </ol>
  );
}

export const SCORE_NOTE = "Scores order the carers the rules allow; they never override a failed check. Gaps between bookings are time gaps, not travel times.";
