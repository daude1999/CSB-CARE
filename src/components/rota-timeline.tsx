import { hhmm } from "@/lib/london";
import type { TimelineRow } from "@/server/rota/roster";
import { SHADE_CLASS, SHADE_TEXT, TONE_CLASS } from "@/components/roster-tones";
import { ScrollIntoNow } from "@/components/scroll-into-now";

/** Pixels per minute: a 30-minute call is wide enough to read a name. */
const PX_PER_MIN = 2.4;

/** Puts overlapping blocks on separate lanes so none hides another. */
function lanes<T extends { start: number; end: number }>(blocks: T[]) {
  const ends: number[] = [];
  const placed = [...blocks].sort((a, b) => a.start - b.start).map((b) => {
    let lane = ends.findIndex((e) => e <= b.start);
    if (lane === -1) lane = ends.length;
    ends[lane] = b.end;
    return { ...b, lane };
  });
  return { placed, count: Math.max(1, ends.length) };
}

/**
 * The day as a timeline: one row per carer, visits as blocks placed by their scheduled time. Every block is a link to
 * the visit (Enter opens it), and its title gives the full time, call and state, so the colour is never the only signal.
 */
export function RotaTimeline({ rows, axisStart, axisEnd, nowMinute }: { rows: TimelineRow[]; axisStart: number; axisEnd: number; nowMinute?: number | null }) {
  const span = Math.max(60, axisEnd - axisStart);
  const pos = (m: number) => `${(((Math.min(Math.max(m, axisStart), axisEnd) - axisStart) / span) * 100).toFixed(3)}%`;
  const hours: number[] = [];
  for (let h = Math.ceil(axisStart / 60) * 60; h <= axisEnd; h += 60) hours.push(h);
  const LANE = 40;
  const first = Math.min(...rows.flatMap((r) => r.blocks.map((b) => b.start)), axisEnd);
  const focus = nowMinute != null && nowMinute >= axisStart && nowMinute <= axisEnd ? nowMinute : first;
  // The name column is 200px; the scroll offset is worked out on the track part of the table.
  const width = 200 + span * PX_PER_MIN;
  return (
    <ScrollIntoNow fraction={(200 + (focus - axisStart) * PX_PER_MIN) / width}>
      <table className="w-full border-separate border-spacing-0 text-[12.5px]" style={{ minWidth: width }}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 w-[200px] bg-white px-2 py-2 text-left text-[13px] font-normal text-slate-600">Carer</th>
            <th scope="col" className="relative h-8 bg-white p-0">
              <span className="sr-only">Timeline {hhmm(axisStart)} to {hhmm(axisEnd)}</span>
              {hours.map((h) => (
                <span key={h} aria-hidden className="absolute top-2 -translate-x-1/2 text-[12px] font-normal tabular-nums text-slate-500" style={{ left: pos(h) }}>{hhmm(h)}</span>
              ))}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const { placed, count } = lanes(r.blocks);
            return (
              <tr key={r.id}>
                <th scope="row" className={`sticky left-0 z-10 border-t border-slate-200 bg-white px-2 py-1.5 text-left align-top font-normal ${r.id === "unassigned" ? "bg-[#fff7f6]" : ""}`}>
                  {r.href ? <a href={r.href} className="text-[13.5px] font-medium text-[#1d4f91] no-underline hover:underline">{r.name}</a> : <span className={`text-[13.5px] font-medium ${r.id === "unassigned" ? "text-[#a3242c]" : ""}`}>{r.name}</span>}
                  <span className="block text-[12px] text-slate-500">{r.sub}</span>
                  {r.shade ? <span className={`block text-[11.5px] font-medium ${SHADE_TEXT[r.shade.tone]}`}>{r.shade.label}</span> : null}
                </th>
                <td className={`relative border-l border-t border-slate-200 p-0 align-top ${r.shade ? SHADE_CLASS[r.shade.tone] : r.id === "unassigned" ? "bg-[#fff7f6]" : ""}`} style={{ height: count * LANE + 8 }}>
                  {hours.map((h) => <span key={h} aria-hidden className="absolute bottom-0 top-0 border-l border-slate-100" style={{ left: pos(h) }} />)}
                  {nowMinute != null && nowMinute >= axisStart && nowMinute <= axisEnd ? <span aria-hidden className="absolute bottom-0 top-0 z-[1] border-l-2 border-[#d9473f]" style={{ left: pos(nowMinute) }} /> : null}
                  {placed.map((b) => (
                    <a
                      key={b.id}
                      href={b.href}
                      title={b.title}
                      aria-label={b.title}
                      className={`absolute z-[2] block overflow-hidden rounded-[3px] border px-1.5 py-[2px] leading-[15px] no-underline focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${TONE_CLASS[b.tone]}`}
                      style={{ left: pos(b.start), width: `max(46px, calc(${pos(b.end)} - ${pos(b.start)} - 2px))`, top: 4 + b.lane * LANE, height: LANE - 4 }}
                    >
                      <span className="block truncate font-medium">{b.label}</span>
                      <span className="block truncate text-[11.5px] opacity-90">{b.sub}</span>
                    </a>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollIntoNow>
  );
}
