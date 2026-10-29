"use client";

import { useRef, useState } from "react";
import { Bell, ListChecks, LockSimple, UsersThree } from "@phosphor-icons/react";

/**
 * The Advanced Rota board: one row per carer (or service user, area or run route), half-hour columns across the day,
 * and each visit drawn as a card at its time. Overlapping cards in a row stack into lanes so none is hidden.
 * Cards are ordinary links to the visit, so the board works with a keyboard and a screen reader. As in OnePlan, a card
 * can be dragged to another team member's row (or from the Unassigned row); the move goes through the same server-side
 * assignment and eligibility check as every other allocation, and a refusal comes back with its reason.
 */

export const SLOT_PX = 76;

export type CardTone = "due" | "late" | "progress" | "done" | "missed" | "cancelled" | "uncovered";

export interface BoardCard {
  id: string;
  startMin: number;
  endMin: number;
  title: string;
  line: string;
  tone: CardTone;
  double: boolean;
  tasks: number;
  alert: boolean;
  locked: boolean;
  areaColour: string | null;
  label: string;
  /** Set when the card can be dragged to another team member: the carer slot it fills and the visit's version. */
  move?: { slot: "PRIMARY" | "SECOND" | "SHADOW"; lockVersion: number };
}

export interface BoardRow {
  key: string;
  label: React.ReactNode;
  sub?: string;
  danger?: boolean;
  group?: string;
  /** The team member a card dropped on this row is given to. */
  dropStaffId?: string;
  cards: BoardCard[];
}

const TONE: Record<CardTone, string> = {
  due: "border-[#b9cbe6] bg-[#e8eff9]",
  late: "border-[#e2c25b] bg-[#fff3c9]",
  progress: "border-[#7cc4e4] bg-[#d6f0fa]",
  done: "border-[#8fcb9d] bg-[#e1f3e5]",
  missed: "border-[#e39a9a] bg-[#fbe0e0]",
  cancelled: "border-slate-300 bg-slate-100 text-slate-500 line-through",
  uncovered: "border-dashed border-[#d9473f] bg-white",
};

function lanes(cards: BoardCard[]) {
  const ends: number[] = [];
  return [...cards]
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
    .map((c) => {
      let lane = ends.findIndex((e) => e <= c.startMin);
      if (lane === -1) lane = ends.length;
      ends[lane] = c.endMin;
      return { c, lane };
    });
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function TimelineBoard({ rows, fromMin, toMin, nowMin, caption, action, back = "" }: { rows: BoardRow[]; fromMin: number; toMin: number; nowMin: number | null; caption: string; action?: (fd: FormData) => Promise<void>; back?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [drag, setDrag] = useState<{ card: BoardCard; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ card: BoardCard; staffId: string } | null>(null);
  const slots = Array.from({ length: (toMin - fromMin) / 30 }, (_, i) => fromMin + i * 30);
  const width = slots.length * SLOT_PX;
  const x = (m: number) => ((Math.min(Math.max(m, fromMin), toMin) - fromMin) / 30) * SLOT_PX;
  let lastGroup: string | undefined;
  return (
    <div className="relative min-w-0 overflow-x-auto rounded border border-slate-200 bg-white" role="region" aria-label={caption} tabIndex={0}>
      {action ? (
        <form ref={form} action={action} className="hidden">
          <input type="hidden" name="back" value={pending?.card.move ? `${back}${back.includes("?") ? "&" : "?"}move=${pending.card.id}~${pending.card.move.slot}~${pending.staffId}~${pending.card.move.lockVersion}` : back} />
          <input type="hidden" name="visitId" value={pending?.card.id ?? ""} />
          <input type="hidden" name="slot" value={pending?.card.move?.slot ?? ""} />
          <input type="hidden" name="staffId" value={pending?.staffId ?? ""} />
          <input type="hidden" name="lockVersion" value={pending?.card.move?.lockVersion ?? ""} />
        </form>
      ) : null}
      {pending ? <p role="status" className="sticky left-0 bg-[#fff6db] px-3 py-1.5 text-[13px]">Checking and saving the move…</p> : null}
      <div style={{ width: width + 170 }}>
        <div className="sticky top-0 z-10 flex border-b border-slate-300 bg-white text-[13.5px] font-semibold">
          <div className="sticky left-0 z-20 w-[170px] shrink-0 border-r border-slate-200 bg-white px-2 py-2">{caption}</div>
          {slots.map((s) => <div key={s} className="shrink-0 border-l border-slate-200 px-1.5 py-2 tabular-nums" style={{ width: SLOT_PX }}>{hhmm(s)}</div>)}
        </div>
        {rows.map((r) => {
          const placed = lanes(r.cards);
          const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1));
          const header = r.group && r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <div key={r.key}>
              {header ? <div className="sticky left-0 border-b border-slate-200 bg-slate-50 px-2 py-1 text-[12.5px] font-semibold uppercase tracking-wide text-slate-600">{header}</div> : null}
              <div className="flex border-b border-slate-200">
                <div className={`sticky left-0 z-[5] w-[170px] shrink-0 border-r border-slate-200 bg-white px-2 py-2 text-[13.5px] ${r.danger ? "text-[#b42a23]" : ""}`}>
                  <div className="font-medium">{r.label}</div>
                  {r.sub ? <div className="text-[12px] text-slate-500">{r.sub}</div> : null}
                </div>
                <div
                  className={`relative shrink-0 ${drag && r.dropStaffId && drag.from !== r.key ? (over === r.key ? "bg-[#e3effb]" : "bg-[#f7fafd]") : ""}`}
                  onDragOver={(e) => {
                    if (!action || !drag || !r.dropStaffId || drag.from === r.key) return;
                    e.preventDefault();
                    setOver(r.key);
                  }}
                  onDragLeave={() => setOver((o) => (o === r.key ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!action || !drag || !r.dropStaffId || drag.from === r.key) return;
                    setOver(null);
                    setPending({ card: drag.card, staffId: r.dropStaffId });
                    setDrag(null);
                    // Submit after React has written the hidden fields.
                    setTimeout(() => form.current?.requestSubmit(), 0);
                  }}
                  style={{ width, height: laneCount * 58 + 8, backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${SLOT_PX - 1}px, #e5e9ef ${SLOT_PX - 1}px, #e5e9ef ${SLOT_PX}px)` }}>
                  {nowMin !== null && nowMin >= fromMin && nowMin <= toMin ? <div aria-hidden className="absolute bottom-0 top-0 w-[2px] bg-[#d9473f]" style={{ left: x(nowMin) }} /> : null}
                  {placed.map(({ c, lane }) => (
                    <a
                      key={`${c.id}-${lane}`}
                      href={`/rota/visits/${c.id}`}
                      draggable={!!action && !!c.move}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDrag({ card: c, from: r.key });
                      }}
                      onDragEnd={() => setDrag(null)}
                      aria-label={c.label}
                      title={c.label}
                      className={`absolute overflow-hidden rounded-[3px] border px-1.5 py-1 text-[12px] leading-tight text-navy-900 no-underline hover:z-[6] hover:shadow-md focus-visible:z-[6] ${action && c.move ? "cursor-grab" : ""} ${TONE[c.tone]}`}
                      style={{ left: x(c.startMin) + 2, width: Math.max(x(c.endMin) - x(c.startMin) - 4, 44), top: lane * 58 + 4, height: 52 }}
                    >
                      <span className="block truncate font-semibold">{c.title}</span>
                      <span className="block truncate">{c.line}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-600">
                        {c.areaColour ? <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: c.areaColour }} /> : null}
                        {c.double ? <UsersThree size={13} aria-hidden /> : null}
                        {c.tasks ? <span className="inline-flex items-center gap-0.5 text-[#13703c]"><ListChecks size={13} aria-hidden />{c.tasks}</span> : null}
                        {c.alert ? <Bell size={13} aria-hidden /> : null}
                        {c.locked ? <LockSimple size={13} aria-hidden /> : null}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {!rows.length ? <p className="px-3 py-6 text-center text-[14px] text-slate-500">No visits to show for this view.</p> : null}
      </div>
    </div>
  );
}
