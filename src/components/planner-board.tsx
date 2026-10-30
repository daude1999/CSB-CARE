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
 * The week grid. Carers are rows and days are columns. A visit chip can be dragged to another carer on the same day,
 * or (when the page passes `moveAction`) to any carer on another day of the week, which moves that one visit at the
 * same time of day. Every move goes through the same server-side assignment and eligibility checks as every other
 * allocation, and a refusal is shown with its reason. Without a mouse, open the visit (Enter on the chip) and change the
 * carer or day there.
 */
export function PlannerBoard({ days, rows, action, moveAction, back, canEdit, idName = "visitId", versionName = "lockVersion", rowLabel = "Carer" }: { days: { date: string; label: string; today: boolean }[]; rows: PlannerRow[]; action: (fd: FormData) => Promise<void>; moveAction?: (fd: FormData) => Promise<void>; back: string; canEdit: boolean; idName?: string; versionName?: string; rowLabel?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const moveForm = useRef<HTMLFormElement>(null);
  const [drag, setDrag] = useState<{ chip: PlannerChip; day: number; staffId: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ chip: PlannerChip; staffId: string; toDate?: string } | null>(null);
  const backWith = pending ? `${back}${back.includes("?") ? "&" : "?"}move=${pending.chip.visitId}~${pending.chip.slot}~${pending.staffId}~${pending.chip.lockVersion}${pending.toDate ? `~${pending.toDate}` : ""}` : back;

  return (
    <div className="relative overflow-x-auto">
      <form ref={form} action={action} className="hidden">
        <input type="hidden" name="back" value={backWith} />
        <input type="hidden" name={idName} value={pending?.chip.visitId ?? ""} />
        <input type="hidden" name="slot" value={pending?.chip.slot ?? ""} />
        <input type="hidden" name="staffId" value={pending?.staffId ?? ""} />
        <input type="hidden" name={versionName} value={pending?.chip.lockVersion ?? ""} />
      </form>
      {moveAction ? (
        <form ref={moveForm} action={moveAction} className="hidden">
          <input type="hidden" name="back" value={backWith} />
          <input type="hidden" name="visitId" value={pending?.chip.visitId ?? ""} />
          <input type="hidden" name="slot" value={pending?.chip.slot ?? ""} />
          <input type="hidden" name="staffId" value={pending?.staffId ?? ""} />
          <input type="hidden" name="toDate" value={pending?.toDate ?? ""} />
          <input type="hidden" name="lockVersion" value={pending?.chip.lockVersion ?? ""} />
        </form>
      ) : null}
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[190px] bg-white px-2 py-2 text-left text-[13px] font-normal text-slate-600">{rowLabel}</th>
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
                const droppable = canEdit && r.id !== "unassigned" && !!drag && (drag.day === di || !!moveAction) && !(drag.day === di && drag.staffId === r.id);
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
                      const otherDay = drag.day !== di;
                      setPending({ chip: drag.chip, staffId: r.id, toDate: otherDay ? days[di]!.date : undefined });
                      setDrag(null);
                      // Submit after React has written the hidden fields.
                      setTimeout(() => (otherDay ? moveForm.current : form.current)?.requestSubmit(), 0);
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
                            setDrag({ chip: c, day: di, staffId: r.id });
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
