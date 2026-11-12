"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "@/components/link";
import { X } from "@phosphor-icons/react";
import { FOLD_PX, hhmm, hourMarks, lanes, roundLabel, scaleFor, shortDuration, type Segment } from "@/lib/day-board";

/**
 * The Daily Rota Board (approved redesign, 10 Nov 2026): one row per team member working the day, a "Needs a carer"
 * row first, time running left to right with quiet stretches folded, and each visit as a focusable button that opens
 * a drawer. A visit can be dragged to another team member's row; the move is sent to the same server action as the
 * Advanced Rota planner (`assignCarerAction`), which runs the eligibility service and returns any refusal or warning.
 */

export type BlockTone = "done" | "due" | "needs" | "missed" | "late" | "progress" | "cancelled";

export interface BoardBlock {
  id: string;
  startMin: number;
  endMin: number;
  surname: string;
  initials: string;
  serviceUser: string;
  callType: string;
  reference: string;
  statusLabel: string;
  tone: BlockTone;
  carers: string[];
  area: string | null;
  double: boolean;
  label: string;
  fullHref: string;
  reassignHref: string | null;
  move?: { slot: string; lockVersion: number };
}

export interface BoardRowData {
  key: string;
  name: string;
  initials: string;
  sub: string;
  needs?: boolean;
  dropStaffId?: string;
  blocks: BoardBlock[];
}

export interface BoardFooter {
  visits: number;
  completed: number;
  toCome: number;
  needs: number;
  carers: number;
}

/** Block colours: completed and still-to-come as the approved design; the others as their status badges. */
const TONE: Record<BlockTone, { cls: string; style?: CSSProperties }> = {
  done: { cls: "border-l-[3px] border-l-[#16a34a] bg-status-completed-bg text-ink" },
  due: { cls: "border-l-[3px] border-l-module bg-module/[.13] text-ink" },
  needs: { cls: "border-[1.5px] border-dashed border-status-missed bg-white text-ink" },
  missed: { cls: "border-l-[3px] border-l-[#b42318] bg-[#fdecec] text-[#7a1a12]" },
  late: { cls: "border-l-[3px] border-l-[#b54708] bg-[#fdf3d8] text-[#5c3d00]" },
  progress: { cls: "border-l-[3px] border-l-[#175cd3] bg-[#e6f0fb] text-[#123b8a]" },
  cancelled: { cls: "border-l-[3px] border-l-[#b42318] bg-[#fdecec] text-[#7a1a12] line-through decoration-[#b42318]" },
};
export const LEGEND: [BlockTone, string][] = [["done", "Completed"], ["due", "Still to come"], ["progress", "In progress"], ["late", "Late"], ["missed", "Missed"], ["needs", "Needs a carer"], ["cancelled", "Cancelled"]];

const NAME_COL = 196;
const ROW_PX = 50;
const BLOCK_PX = 38;

export function BoardLegend() {
  return (
    <ul aria-label="Colour key" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-status-ink">
      {LEGEND.map(([t, label]) => (
        <li key={t} className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-3 w-4 rounded-[3px] ${TONE[t].cls}`} />{label}</li>
      ))}
    </ul>
  );
}

export function RotaBoard({ rows, rounds, segments, nowMin, footer, action, back }: { rows: BoardRowData[]; rounds: { name: string; start: number; end: number }[]; segments: Segment[]; nowMin: number | null; footer: BoardFooter; action?: (fd: FormData) => Promise<void>; back: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(900);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setTrackPx(Math.max(320, el.clientWidth - NAME_COL));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { x, width } = useMemo(() => scaleFor(segments, trackPx), [segments, trackPx]);
  const hours = useMemo(() => hourMarks(segments), [segments]);
  const dayFrom = segments[0]?.from ?? 0;
  const dayTo = segments[segments.length - 1]?.to ?? 24 * 60;
  const folded = segments.some((s) => s.folded);

  // Drag to reassign, through the same hidden form and server action as the Advanced Rota planner.
  const form = useRef<HTMLFormElement>(null);
  const [drag, setDrag] = useState<{ block: BoardBlock; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ block: BoardBlock; staffId: string } | null>(null);

  // The drawer, and the block to give focus back to when it closes.
  const [open, setOpen] = useState<BoardBlock | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    const el = opener.current;
    if (el) requestAnimationFrame(() => el.focus());
  }, []);

  const showNow = nowMin !== null && nowMin >= dayFrom && nowMin <= dayTo;
  return (
    <div className="min-w-0">
      {action ? (
        <form ref={form} action={action} className="hidden" aria-hidden>
          <input type="hidden" name="back" value={pending?.block.move ? `${back}${back.includes("?") ? "&" : "?"}move=${pending.block.id}~${pending.block.move.slot}~${pending.staffId}~${pending.block.move.lockVersion}` : back} />
          <input type="hidden" name="visitId" value={pending?.block.id ?? ""} />
          <input type="hidden" name="slot" value={pending?.block.move?.slot ?? ""} />
          <input type="hidden" name="staffId" value={pending?.staffId ?? ""} />
          <input type="hidden" name="lockVersion" value={pending?.block.move?.lockVersion ?? ""} />
        </form>
      ) : null}
      {pending ? <p role="status" className="bg-[#fff6db] px-3 py-1.5 text-meta">Checking {pending.block.serviceUser} with the eligibility rules and saving the move…</p> : null}

      <div ref={track} className="relative min-w-0 overflow-x-auto" data-testid="board-scroll" role="region" aria-label="Board: visits by team member" tabIndex={0}>
        <div style={{ width: NAME_COL + width }} className="relative">
          {/* Call rounds above the hours. */}
          <div className="flex h-[22px] border-b border-rule">
            <div className="sm:sticky sm:left-0 z-20 shrink-0 bg-white" style={{ width: NAME_COL }} />
            <div className="relative" style={{ width }}>
              {rounds.map((r) => {
                const left = x(Math.max(r.start, dayFrom));
                const w = Math.max(24, x(Math.min(r.end, dayTo)) - left);
                return <span key={r.name} data-testid="board-round" className="absolute top-[3px] truncate rounded-[4px] bg-module/[.08] px-1.5 text-caption font-semibold leading-4 text-ink" style={{ left, width: w }} title={`${r.name}: ${hhmm(r.start)} to ${hhmm(r.end)}`}>{roundLabel(r.name)}</span>;
              })}
            </div>
          </div>
          {/* Hours. */}
          <div className="flex h-[26px] border-b border-rule text-caption font-semibold tabular-nums text-status-ink">
            <div className="sm:sticky sm:left-0 z-20 flex shrink-0 items-center bg-white px-3 text-caption font-semibold text-ink" style={{ width: NAME_COL }}>Team member</div>
            <div className="relative" style={{ width }}>
              {hours.map((h) => <span key={h} className="absolute top-[5px] border-l border-rule pl-1" style={{ left: x(h) }}>{hhmm(h)}</span>)}
              {segments.filter((s) => s.folded).map((s) => <span key={s.from} aria-hidden className="absolute bottom-0 top-0 bg-[repeating-linear-gradient(135deg,#e4e7ec_0,#e4e7ec_2px,transparent_2px,transparent_6px)]" style={{ left: x(s.from), width: FOLD_PX }} />)}
            </div>
          </div>

          {rows.map((r) => {
            const { placed, count } = lanes(r.blocks);
            const h = Math.max(ROW_PX, count * (BLOCK_PX + 4) + 8);
            const droppable = !!action && !!drag && !!r.dropStaffId && drag.from !== r.key;
            return (
              <div key={r.key} data-testid={r.needs ? "board-needs-row" : "board-row"} className={`flex border-b border-rule ${r.needs ? "bg-[#fef3f2]" : ""}`} style={{ height: h }}>
                <div className={`sm:sticky sm:left-0 z-[5] flex shrink-0 items-center gap-2.5 border-r border-rule px-3 ${r.needs ? "bg-[#fef3f2]" : "bg-white"}`} style={{ width: NAME_COL }}>
                  <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${r.needs ? "bg-status-missed text-white" : "bg-module/[.13] text-ink"}`}>{r.initials}</span>
                  <span className="min-w-0">
                    <span className={`block truncate text-body font-semibold ${r.needs ? "text-[#b42318]" : "text-ink"}`}>{r.name}</span>
                    <span className="block truncate text-caption text-status-ink">{r.sub}</span>
                  </span>
                </div>
                <div
                  className={`relative ${droppable ? (over === r.key ? "bg-module/[.10]" : "bg-module/[.04]") : ""}`}
                  style={{ width }}
                  onDragOver={(e) => {
                    if (!droppable) return;
                    e.preventDefault();
                    setOver(r.key);
                  }}
                  onDragLeave={() => setOver((o) => (o === r.key ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!droppable || !drag || !r.dropStaffId) return;
                    setOver(null);
                    setPending({ block: drag.block, staffId: r.dropStaffId });
                    setDrag(null);
                    setTimeout(() => form.current?.requestSubmit(), 0);
                  }}
                >
                  {/* Hours already past are shaded very lightly. */}
                  {showNow ? <span aria-hidden className="absolute bottom-0 left-0 top-0 bg-[#101828]/[.03]" style={{ width: x(nowMin!) }} /> : null}
                  {hours.map((m) => <span key={m} aria-hidden className="absolute bottom-0 top-0 w-px bg-[#f2f4f7]" style={{ left: x(m) }} />)}
                  {segments.filter((s) => s.folded).map((s) => <span key={s.from} aria-hidden className="absolute bottom-0 top-0 bg-[repeating-linear-gradient(135deg,#e4e7ec_0,#e4e7ec_2px,transparent_2px,transparent_6px)]" style={{ left: x(s.from), width: FOLD_PX }} />)}
                  {placed.map(({ item: b, lane }) => {
                    const left = x(b.startMin) + 1;
                    const w = Math.max(18, x(b.endMin) - x(b.startMin) - 2);
                    const narrow = w < 60;
                    const t = TONE[b.tone];
                    return (
                      <button
                        key={`${b.id}-${lane}`}
                        type="button"
                        data-testid="board-block"
                        data-tone={b.tone}
                        aria-label={b.label}
                        aria-haspopup="dialog"
                        title={b.label}
                        draggable={!!action && !!b.move}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", b.id);
                          setDrag({ block: b, from: r.key });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setOpen(b);
                        }}
                        className={`absolute overflow-hidden rounded-[5px] text-left leading-[15px] ${w < 92 ? "px-1 text-micro tracking-tight" : "px-1.5 text-caption"} hover:z-[6] hover:shadow-md focus-visible:z-[6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-module ${action && b.move ? "cursor-grab" : "cursor-pointer"} ${t.cls}`}
                        style={{ left, width: w, top: 6 + lane * (BLOCK_PX + 4), height: BLOCK_PX }}
                      >
                        {narrow ? (
                          <>
                            <span className="block truncate font-semibold">{b.initials}{b.double ? " ×2" : ""}</span>
                            <span className="block truncate tabular-nums">{hhmm(b.startMin)}</span>
                          </>
                        ) : (
                          <>
                            <span className="block truncate font-semibold">{b.surname}{b.double ? <span className="font-bold"> ×2</span> : null}</span>
                            <span className="block truncate tabular-nums">{hhmm(b.startMin)}{w >= 92 ? ` · ${shortDuration(b.endMin - b.startMin)}` : ` · ${b.endMin - b.startMin}m`}</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!rows.length ? <p className="px-3 py-8 text-center text-body text-status-ink">No visits match these filters on this day.</p> : null}

          {/* The time now, Europe/London. */}
          {showNow ? (
            <div aria-hidden data-testid="board-now" className="pointer-events-none absolute bottom-0 top-[22px] z-[7] w-[2px] bg-status-missed" style={{ left: NAME_COL + x(nowMin!) }}>
              <span className="absolute -top-px left-1/2 -translate-x-1/2 rounded-[4px] bg-status-missed px-1 text-micro font-semibold leading-4 text-white tabular-nums">{hhmm(nowMin!)}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div data-testid="board-footer" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule px-3.5 py-2.5 text-meta text-status-ink">
        <span><strong className="tabular-nums text-ink">{footer.visits}</strong> visits today</span>
        <span><strong className="tabular-nums text-ink">{footer.completed}</strong> completed</span>
        <span><strong className="tabular-nums text-ink">{footer.toCome}</strong> still to come</span>
        <span><strong className={`tabular-nums ${footer.needs ? "text-[#b42318]" : "text-ink"}`}>{footer.needs}</strong> need a carer</span>
        <span><strong className="tabular-nums text-ink">{footer.carers}</strong> carers working</span>
        {folded ? <span className="ml-auto">Quiet hours with no visits are folded <span aria-hidden className="ml-1 inline-block h-3 w-4 align-middle bg-[repeating-linear-gradient(135deg,#d0d5dd_0,#d0d5dd_2px,transparent_2px,transparent_6px)]" />.</span> : null}
      </div>

      {open ? <VisitDrawer block={open} onClose={close} /> : null}
    </div>
  );
}

interface DrawerData {
  tasks: { name: string; outcome: string | null }[];
  why: { name: string; eligibility: string | null; warningsAccepted: string[]; review: string | null; match: { points: number; text: string }[] }[];
}

const ELIGIBILITY_WORD: Record<string, string> = { ELIGIBLE: "Passed every eligibility check when booked", REQUIRES_REVIEW: "Booked with warnings the coordinator accepted", NOT_ELIGIBLE: "Did not pass the eligibility check" };
const BADGE: Record<BlockTone, string> = {
  done: "bg-[#e7f6ec] text-[#14713a]",
  due: "bg-[#f2f4f7] text-[#344054]",
  needs: "bg-[#fdecec] text-[#b42318]",
  missed: "bg-[#fdecec] text-[#b42318]",
  late: "bg-[#fdf3d8] text-[#8a5a00]",
  progress: "bg-[#e6f0fb] text-[#175cd3]",
  cancelled: "bg-[#fdecec] text-[#b42318]",
};

/** The visit drawer: a 420px panel from the right over a dimmed page. Esc or the close button returns focus. */
function VisitDrawer({ block: b, onClose }: { block: BoardBlock; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<DrawerData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Keep Tab inside the drawer while it is open.
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    fetch(`/api/rota/visits/${encodeURIComponent(b.id)}/drawer`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DrawerData>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [b.id]);

  return (
    <div className="fixed inset-0 z-[70]">
      <div aria-hidden className="absolute inset-0 bg-[#101828]/40" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="board-drawer-title" data-testid="visit-drawer" className="absolute bottom-0 right-0 top-0 flex w-full max-w-[420px] flex-col bg-white shadow-[-8px_0_24px_rgba(16,24,40,0.18)]">
        <div className="flex items-start gap-3 border-b border-rule px-5 py-4">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-module/[.13] text-body font-semibold text-ink">{b.initials}</span>
          <div className="min-w-0 flex-1">
            <h2 id="board-drawer-title" className="truncate text-subtitle font-semibold text-ink" style={{ fontFamily: "inherit" }}>{b.serviceUser}</h2>
            <p className="text-meta text-status-ink">{b.callType} · {b.reference}</p>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close visit details" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink hover:bg-[#f2f4f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module"><X size={18} weight="bold" aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-body text-ink">
          <section aria-label="Details">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
              <dt className="text-status-ink">Time</dt><dd className="tabular-nums">{hhmm(b.startMin)} to {hhmm(b.endMin)} · {shortDuration(b.endMin - b.startMin)}</dd>
              <dt className="text-status-ink">Status</dt><dd><span className={`inline-flex rounded-full px-2 py-0.5 text-meta font-semibold ${BADGE[b.tone]}`}>{b.statusLabel}</span></dd>
              <dt className="text-status-ink">Carers</dt><dd>{b.carers.length ? b.carers.join(", ") : <span className="text-[#b42318]">No carer booked</span>}{b.double ? <span className="text-status-ink"> · needs two carers</span> : null}</dd>
              <dt className="text-status-ink">Area</dt><dd>{b.area ?? "No area"}</dd>
            </dl>
          </section>
          <section aria-labelledby="drawer-tasks">
            <h3 id="drawer-tasks" className="mb-1.5 text-body font-semibold" style={{ fontFamily: "inherit" }}>Care tasks</h3>
            {failed ? <p className="text-status-ink">The care tasks could not be loaded. Open the full visit to see them.</p> : !data ? <p className="text-status-ink" role="status">Loading…</p> : data.tasks.length ? (
              <ul className="divide-y divide-rule rounded-[8px] border border-rule">
                {data.tasks.map((t, i) => <li key={i} className="flex items-center justify-between gap-3 px-3 py-2"><span>{t.name}</span>{t.outcome ? <span className="text-meta text-status-ink">{t.outcome}</span> : null}</li>)}
              </ul>
            ) : <p className="text-status-ink">No care tasks on this visit.</p>}
          </section>
          {data && data.why.length ? (
            <section aria-labelledby="drawer-why" data-testid="drawer-why">
              <h3 id="drawer-why" className="mb-1.5 text-body font-semibold" style={{ fontFamily: "inherit" }}>Why this carer</h3>
              <ul className="space-y-3">
                {data.why.map((c, i) => (
                  <li key={i} className="rounded-[8px] border border-rule px-3 py-2.5">
                    <p className="font-semibold">{c.name}</p>
                    {c.eligibility ? <p className="text-meta text-status-ink">{ELIGIBILITY_WORD[c.eligibility] ?? c.eligibility}</p> : null}
                    {c.warningsAccepted.length ? <ul className="mt-1 list-disc pl-5 text-meta text-[#8a5a00]">{c.warningsAccepted.map((w, j) => <li key={j}>{w}</li>)}</ul> : null}
                    {c.review ? <p className="mt-1 text-meta text-[#b54708]">Needs review: {c.review}</p> : null}
                    {c.match.length ? <ul className="mt-1 space-y-0.5 text-meta">{c.match.map((m, j) => <li key={j}><span className="tabular-nums font-semibold">{m.points > 0 ? `+${m.points}` : m.points}</span> {m.text}</li>)}</ul> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-rule px-5 py-3">
          {b.reassignHref ? <Link href={b.reassignHref} className="btn-primary">Reassign</Link> : null}
          <Link href={b.fullHref} className="btn-secondary">Open full visit</Link>
        </div>
      </div>
    </div>
  );
}
