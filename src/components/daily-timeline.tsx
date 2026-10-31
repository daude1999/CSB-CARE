import { CheckCircle, Clock, ForkKnife, Prohibit, UsersThree, XCircle, Coffee, Moon, Sun } from "@phosphor-icons/react/dist/ssr";
import { hhmm } from "@/lib/london";
import type { TimelineBlock, TimelineRow } from "@/server/rota/roster";
import { SHADE_CLASS, SHADE_TEXT } from "@/components/roster-tones";
import { ScrollIntoNow } from "@/components/scroll-into-now";

/** Pixels per minute, and the narrowest a card is drawn so a service user's name stays readable. */
const PX = 3;
const MIN_W = 172;
const LANE = 60;
const NAME_W = 190;

/** Card colours by state. Every state is also written on the card and in its label, so colour is never the only signal. */
const CARD: Record<string, string> = {
  COMPLETED: "border-[#cfe9d8] bg-[#eaf6ee]",
  IN_PROGRESS: "border-[#c7dbf6] bg-[#e9f1fc]",
  MISSED: "border-[#f3c9c9] bg-[#fdecec]",
  NOT_DELIVERED: "border-[#e4e7ec] bg-[#f2f4f7]",
  CANCELLED: "border-[#e4e7ec] bg-[#f8f9fb] text-slate-400 line-through",
  SCHEDULED: "border-[#ddd6f6] bg-[#f6f3fd]",
  OPEN: "border-[#f5d9a8] bg-[#fdf3e2]",
  DRAFT: "border-dashed border-[#b8b2d6] bg-white",
};

const STATE_WORD: Record<string, string> = { COMPLETED: "Completed", IN_PROGRESS: "In progress", MISSED: "Missed", NOT_DELIVERED: "Not delivered", CANCELLED: "Cancelled", SCHEDULED: "Scheduled" };

function cardKey(b: TimelineBlock) {
  if (b.slot === "OPEN" && b.status !== "CANCELLED") return "OPEN";
  if (b.status === "SCHEDULED" && b.tone === "draft") return "DRAFT";
  return b.status;
}

function CallIcon({ b }: { b: TimelineBlock }) {
  const p = { size: 20, weight: "bold" as const, "aria-hidden": true };
  if (b.status === "COMPLETED") return <CheckCircle {...p} weight="fill" className="text-[#1f9d4c]" />;
  if (b.status === "MISSED") return <XCircle {...p} weight="fill" className="text-[#e5484d]" />;
  if (b.status === "IN_PROGRESS") return <Clock {...p} className="text-[#2f7de1]" />;
  if (b.status === "CANCELLED" || b.status === "NOT_DELIVERED") return <Prohibit {...p} className="text-slate-400" />;
  if (b.slot === "OPEN") return <UsersThree {...p} className="text-[#c27a06]" />;
  const c = b.call.toLowerCase();
  if (c.includes("lunch") || c.includes("tea") || c.includes("meal")) return <ForkKnife {...p} className="text-[#1f8a4c]" />;
  if (c.includes("bed") || c.includes("night")) return <Moon {...p} className="text-[#5a3aa8]" />;
  if (c.includes("morning") || c.includes("breakfast")) return <Sun {...p} className="text-[#c27a06]" />;
  return <Coffee {...p} className="text-[#5a3aa8]" />;
}

/** Overlapping cards go on separate lanes; the drawn width (with the minimum) decides overlap, so no card hides another. */
function lanes(blocks: TimelineBlock[]) {
  const ends: number[] = [];
  const minMin = MIN_W / PX;
  const placed = [...blocks].sort((a, b) => a.start - b.start).map((b) => {
    const drawnEnd = Math.max(b.end, b.start + minMin);
    let lane = ends.findIndex((e) => e <= b.start);
    if (lane === -1) lane = ends.length;
    ends[lane] = drawnEnd;
    return { ...b, lane };
  });
  return { placed, count: Math.max(1, ends.length) };
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const dur = (m: number) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/**
 * The Daily Rota timeline: one row per carer (team member), with each visit as a card titled by the service user.
 * A double-up is one visit drawn on both carers' rows. Choosing a card opens it in the Visit Details panel.
 */
export function DailyTimeline({ rows, axisStart, axisEnd, nowMinute, selected, focusMinute, hrefFor, heading }: { rows: TimelineRow[]; axisStart: number; axisEnd: number; nowMinute: number | null; selected: string | null; focusMinute?: number | null; hrefFor: (visitId: string) => string; heading: React.ReactNode }) {
  const span = Math.max(60, axisEnd - axisStart);
  const x = (m: number) => (Math.min(Math.max(m, axisStart), axisEnd) - axisStart) * PX;
  const ticks: number[] = [];
  for (let t = Math.ceil(axisStart / 30) * 30; t <= axisEnd; t += 30) ticks.push(t);
  const width = NAME_W + span * PX;
  const first = Math.min(...rows.flatMap((r) => r.blocks.map((b) => b.start)), axisEnd);
  // Open on the chosen visit, else the current time, else the first visit of the day.
  const focus = focusMinute != null ? focusMinute : nowMinute != null && nowMinute >= axisStart && nowMinute <= axisEnd ? nowMinute : first - 30;
  const showNow = nowMinute != null && nowMinute >= axisStart && nowMinute <= axisEnd;
  return (
    <ScrollIntoNow fraction={(NAME_W + Math.max(0, focus - axisStart) * PX) / width}>
      <table className="border-separate border-spacing-0 text-[13px]" style={{ width, minWidth: "100%" }}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-30 border-b border-[#e4e7ec] bg-white px-3 py-2.5 text-left text-[14px] font-semibold text-[#0b1530]" style={{ width: NAME_W, minWidth: NAME_W }}>{heading}</th>
            <th scope="col" className="relative h-11 border-b border-[#e4e7ec] bg-white p-0" style={{ width: span * PX }}>
              <span className="sr-only">Timeline from {hhmm(axisStart)} to {hhmm(axisEnd)}</span>
              {ticks.map((t) => (
                <span key={t} aria-hidden className="absolute top-3 -translate-x-1/2 text-[12.5px] font-normal tabular-nums text-[#344054]" style={{ left: x(t) }}>{hhmm(t)}</span>
              ))}
              {showNow ? <span aria-hidden className="absolute top-2 z-10 -translate-x-1/2 rounded-[6px] bg-[#6b3fd0] px-1.5 py-0.5 text-[12.5px] font-semibold tabular-nums text-white" style={{ left: x(nowMinute) }}>{hhmm(nowMinute)}</span> : null}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const { placed, count } = lanes(r.blocks);
            const open = r.id === "unassigned";
            if (open && !r.blocks.length) return null;
            return (
              <tr key={r.id}>
                <th scope="row" className={`sticky left-0 z-20 border-b border-[#eef0f3] px-3 py-2 text-left align-top font-normal ${open ? "bg-[#fffaf1]" : "bg-white"}`}>
                  <span className="flex items-start gap-2.5">
                    <span aria-hidden className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${open ? "bg-[#fdf3e2] text-[#c27a06]" : "bg-[#eef0f6] text-[#344054]"}`}>{open ? <UsersThree size={18} /> : initials(r.name)}</span>
                    <span className="min-w-0">
                      {r.href ? <a href={r.href} className="block truncate text-[14px] font-semibold text-[#0b1530] no-underline hover:underline">{r.name}</a> : <span className={`block truncate text-[14px] font-semibold ${open ? "text-[#8a5a00]" : "text-[#0b1530]"}`}>{r.name}</span>}
                      <span className="block truncate text-[12.5px] text-slate-600">{r.run ? `${r.run} · ` : ""}{r.sub}</span>
                      {r.shade ? <span className={`block text-[12px] font-medium ${SHADE_TEXT[r.shade.tone]}`}>{r.shade.label}</span> : null}
                    </span>
                  </span>
                </th>
                <td className={`relative border-b border-[#eef0f3] p-0 align-top ${r.shade ? SHADE_CLASS[r.shade.tone] : open ? "bg-[#fffaf1]" : ""}`} style={{ height: count * LANE + 8 }}>
                  {ticks.map((t) => <span key={t} aria-hidden className={`absolute bottom-0 top-0 border-l ${t % 60 === 0 ? "border-[#eef0f3]" : "border-[#f5f6f8]"}`} style={{ left: x(t) }} />)}
                  {showNow ? <span aria-hidden className="absolute bottom-0 top-0 z-[3] w-0 border-l-2 border-[#6b3fd0]" style={{ left: x(nowMinute) }} /> : null}
                  {placed.map((b) => {
                    const k = cardKey(b);
                    const isSel = selected === b.visitId;
                    const label = `${b.label.replace(/ \((2|shadow)\)$/, "")}, ${b.call} ${b.span}, ${b.slot === "OPEN" && b.status !== "CANCELLED" ? "no carer yet" : STATE_WORD[b.status] ?? b.status}${b.double ? ", double-up" : ""}${b.tone === "draft" ? ", not published" : ""}${b.tone === "review" ? ", needs review" : ""}`;
                    return (
                      <a
                        key={b.id}
                        href={hrefFor(b.visitId)}
                        aria-label={label}
                        aria-current={isSel ? "true" : undefined}
                        title={b.title}
                        className={`absolute z-[4] flex items-start gap-2 overflow-hidden rounded-[8px] border px-2.5 py-1.5 no-underline focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#6b3fd0] ${CARD[k]} ${isSel ? "!border-[#6b3fd0] ring-2 ring-[#6b3fd0]/30" : ""} ${b.tone === "review" ? "shadow-[inset_3px_0_0_#e0a526]" : ""}`}
                        style={{ left: x(b.start) + 2, width: Math.max(MIN_W, (b.end - b.start) * PX) - 4, top: 4 + b.lane * LANE, height: LANE - 6 }}
                      >
                        <span className="mt-0.5 shrink-0"><CallIcon b={b} /></span>
                        <span className="min-w-0 flex-1 leading-[16px]">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-[#0b1530]">{b.label.replace(/ \((2|shadow)\)$/, "")}</span>
                            {b.slot === "SHADOW" ? <span className="shrink-0 text-[10.5px] text-slate-600">shadow</span> : null}
                          </span>
                          <span className="block truncate text-[12px] text-[#344054]">{b.call} {b.span} ({dur(b.end - b.start)})</span>
                          {b.double ? <span className="mt-0.5 inline-block rounded-full border border-[#b9a8ee] bg-white px-1.5 text-[10.5px] font-semibold leading-[14px] text-[#5a3aa8]">Double-up{b.slot === "OPEN" && b.status !== "CANCELLED" ? ` · ${b.sub.split(" · ").pop()}` : ""}</span> : b.slot === "OPEN" && b.status !== "CANCELLED" ? <span className="block truncate text-[11.5px] font-medium text-[#8a5a00]">{b.sub.split(" · ").pop()}</span> : b.tone === "draft" ? <span className="block truncate text-[11.5px] text-slate-500">Not published</span> : b.tone === "review" ? <span className="block truncate text-[11.5px] font-medium text-[#7a4b00]">Needs review</span> : null}
                        </span>
                      </a>
                    );
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollIntoNow>
  );
}
