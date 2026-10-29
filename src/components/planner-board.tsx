"use client";

import { useRef, useState } from "react";

export interface PlannerChip {
  visitId: string;
  slot: "PRIMARY" | "SECOND" | "SHADOW";
  lockVersion: number;
  href: string;
  time: string;
  label: string;
  title: string;
  tone: "ok" | "review" | "empty" | "done" | "cancelled";
  movable: boolean;
}
export interface PlannerRow {
  id: string;
  name: string;
  sub: string;
  href?: string;
  cells: PlannerChip[][];
}

const TONE: Record<PlannerChip["tone"], string> = {
  ok: "border-[#b9cfea] bg-[#eef4fb] text-[#1d4f91]",
  review: "border-[#f2b8bc] bg-[#fde1e3] text-[#a3242c]",
  empty: "border-dashed border-[#e4544f] bg-white text-[#a3242c]",
  done: "border-[#bfe3cd] bg-[#eef8f2] text-[#1c7a43]",
  cancelled: "border-slate-200 bg-slate-50 text-slate-400 line-through",
};

/**
 * The week grid. Carers are rows and days are columns. A visit chip can be dragged to another carer on the same day;
 * the move goes through the same server-side assignment and eligibility check as every other allocation, and a refusal
 * is shown with its reason. Without a mouse, open the visit (Enter on the chip) and choose the carer there.
 */
export function PlannerBoard({ days, rows, action, back, canEdit }: { days: { date: string; label: string; today: boolean }[]; rows: PlannerRow[]; action: (fd: FormData) => Promise<void>; back: string; canEdit: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [drag, setDrag] = useState<{ chip: PlannerChip; day: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ chip: PlannerChip; staffId: string } | null>(null);

  return (
    <div className="overflow-x-auto">
      <form ref={form} action={action} className="hidden">
        <input type="hidden" name="back" value={pending ? `${back}${back.includes("?") ? "&" : "?"}move=${pending.chip.visitId}~${pending.chip.slot}~${pending.staffId}~${pending.chip.lockVersion}` : back} />
        <input type="hidden" name="visitId" value={pending?.chip.visitId ?? ""} />
        <input type="hidden" name="slot" value={pending?.chip.slot ?? ""} />
        <input type="hidden" name="staffId" value={pending?.staffId ?? ""} />
        <input type="hidden" name="lockVersion" value={pending?.chip.lockVersion ?? ""} />
      </form>
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[190px] bg-white px-2 py-2 text-left text-[13px] font-normal text-slate-600">Carer</th>
            {days.map((d) => (
              <th key={d.date} scope="col" className={`px-1 py-2 text-left text-[13px] font-medium ${d.today ? "text-[#1d4f91]" : "text-slate-700"}`}>{d.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky left-0 z-10 border-t border-slate-200 bg-white px-2 py-1.5 text-left align-top font-normal">
                {r.href ? <a href={r.href} className="text-[13.5px] font-medium text-[#1d4f91] no-underline hover:underline">{r.name}</a> : <span className="text-[13.5px] font-medium text-[#a3242c]">{r.name}</span>}
                <span className="block text-[12px] text-slate-500">{r.sub}</span>
              </th>
              {r.cells.map((cell, di) => {
                const key = `${r.id}:${di}`;
                const droppable = canEdit && r.id !== "unassigned" && drag?.day === di;
                return (
                  <td
                    key={di}
                    className={`border-l border-t border-slate-200 px-1 py-1 align-top ${droppable && over === key ? "bg-[#e3effb]" : droppable ? "bg-[#f7fafd]" : ""}`}
                    onDragOver={(e) => {
                      if (!droppable) return;
                      e.preventDefault();
                      setOver(key);
                    }}
                    onDragLeave={() => setOver((o) => (o === key ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!droppable || !drag) return;
                      setOver(null);
                      setPending({ chip: drag.chip, staffId: r.id });
                      setDrag(null);
                      // Submit after React has written the hidden fields.
                      setTimeout(() => form.current?.requestSubmit(), 0);
                    }}
                  >
                    <div className="flex min-h-[28px] flex-col gap-[3px]">
                      {cell.map((c) => (
                        <a
                          key={`${c.visitId}-${c.slot}`}
                          href={c.href}
                          title={c.title}
                          draggable={canEdit && c.movable}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            setDrag({ chip: c, day: di });
                          }}
                          onDragEnd={() => setDrag(null)}
                          className={`block rounded-[3px] border px-1.5 py-[3px] leading-[15px] no-underline ${TONE[c.tone]} ${canEdit && c.movable ? "cursor-grab" : ""}`}
                        >
                          <span className="tabular-nums">{c.time}</span> {c.label}
                        </a>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {pending ? <p role="status" className="mt-2 text-[13px] text-slate-600">Checking and saving the move…</p> : null}
    </div>
  );
}
