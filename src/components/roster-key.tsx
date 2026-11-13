import { SHADE_CLASS, TONE_CLASS, TONE_LABEL, type ShadeTone, type Tone } from "@/components/roster-tones";

const SHADE_LABEL: Record<ShadeTone, string> = { leave: "On leave", sick: "Off sick", unavailable: "Unavailable (working pattern)", requested: "Leave requested" };

/** The colour key for the roster and the day timeline. */
export function RosterKey({ tones, shades = [] }: { tones: Tone[]; shades?: ShadeTone[] }) {
  return (
    <ul aria-label="Colour key" className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
      {tones.map((t) => (
        <li key={t} className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-3 w-4 rounded-[2px] border ${TONE_CLASS[t]}`} />{TONE_LABEL[t]}</li>
      ))}
      {shades.map((s) => (
        <li key={s} className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-3 w-4 rounded-[2px] border border-slate-200 ${SHADE_CLASS[s]}`} />{SHADE_LABEL[s]}</li>
      ))}
    </ul>
  );
}
