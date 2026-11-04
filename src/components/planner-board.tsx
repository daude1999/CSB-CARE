"use client";
import type { PlaceKey } from "@/lib/carer-places";

import { useRef, useState } from "react";
import { SHADE_CLASS, SHADE_TEXT, TONE_CLASS, type ShadeTone, type Tone } from "@/components/roster-tones";

export interface PlannerChip {
  visitId: string;
  slot: PlaceKey;
  lockVersion: number;
  href: string;
  time: string;
  label: string;
  title: string;
  tone: Tone;
  movable: boolean;
}
export interface PlannerRow {
  id: string;
  name: string;
  sub: string;
  href?: string;
  /** The carer is over their weekly hours. */
  over?: boolean;
  cells: PlannerChip[][];
  /** Leave or unavailable time shaded on a day, with its label. */
  shades?: ({ tone: ShadeTone; label: string } | null)[];
}

/** The planner keeps its quieter colours; the roster passes `tones` for the state colours. */
const PLANNER_TONE: Partial<Record<Tone, string>> = {
  ok: "border-[#b9cfea] bg-[#eef4fb] text-[#1d4f91]",
  review: "border-[#f2b8bc] bg-[#fde1e3] text-[#a3242c]",
  done: "border-[#bfe3cd] bg-[#eef8f2] text-[#1c7a43]",
};

/**
 * The week grid. Carers are rows and days are columns. A visit chip can be dragged to another carer on the same day,
 * or (when the page passes `moveAction`) to any carer on another day of the week, which moves that one visit at the
 * same time of day. Every move goes through the same server-side assignment and eligibility checks as every other
 * allocation, and a refusal is shown with its reason. Without a mouse, open the visit (Enter on the chip) and change the
 * carer or day there.
 */
export function PlannerBoard({ days, rows, action, moveAction, back, canEdit, idName = "visitId", versionName = "lockVersion", rowLabel = "Carer", stateColours = false, confirmTemplate = false }: { days: { date: string; label: string; today: boolean }[]; rows: PlannerRow[]; action: (fd: FormData) => Promise<void>; moveAction?: (fd: FormData) => Promise<void>; back: string; canEdit: boolean; idName?: string; versionName?: string; rowLabel?: string; stateColours?: boolean; /** Template Planner: a carer move opens Confirm Template Changes first. */ confirmTemplate?: boolean }) {
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const [asking, setAsking] = useState<{ chip: PlannerChip; from: string; to: string; day: string } | null>(null);
  const confirmedMove = useRef(false);
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
        {confirmTemplate ? <input type="hidden" name="confirmed" value="1" /> : null}
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
                <span className={`block text-[12px] ${r.over ? "font-medium text-[#a3242c]" : "text-slate-500"}`}>{r.sub}{r.over ? " · over limit" : ""}</span>
              </th>
              {r.cells.map((cell, di) => {
                const key = `${r.id}:${di}`;
                const shade = r.shades?.[di] ?? null;
                const droppable = canEdit && r.id !== "unassigned" && !!drag && (drag.day === di || !!moveAction) && !(drag.day === di && drag.staffId === r.id);
                return (
                  <td
                    key={di}
                    className={`border-l border-t border-slate-200 px-1 py-1 align-top ${droppable && over === key ? "bg-[#e3effb]" : droppable ? "bg-[#f7fafd]" : shade ? SHADE_CLASS[shade.tone] : ""}`}
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
                      if (confirmTemplate && !otherDay) {
                        setAsking({ chip: drag.chip, from: rows.find((x) => x.id === drag.staffId)?.name ?? "No carer", to: r.name, day: days[di]!.label });
                        setTimeout(() => confirmDialog.current?.showModal(), 0);
                        return;
                      }
                      // Submit after React has written the hidden fields.
                      setTimeout(() => (otherDay ? moveForm.current : form.current)?.requestSubmit(), 0);
                    }}
                  >
                    <div className="flex min-h-[28px] flex-col gap-[3px]">
                      {shade ? <span className={`text-[11.5px] font-medium ${SHADE_TEXT[shade.tone]}`}>{shade.label}</span> : null}
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
                          className={`block rounded-[3px] border px-1.5 py-[3px] leading-[15px] no-underline ${(!stateColours && PLANNER_TONE[c.tone]) || TONE_CLASS[c.tone]} ${canEdit && c.movable ? "cursor-grab" : ""}`}
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
      {pending && !asking ? <p role="status" className="mt-2 text-[13px] text-slate-600">Checking and saving the move…</p> : null}
      {confirmTemplate ? (
        <dialog ref={confirmDialog} onClose={() => { setAsking(null); if (confirmedMove.current) { confirmedMove.current = false; setTimeout(() => form.current?.requestSubmit(), 0); } else setPending(null); }} aria-labelledby="planner-confirm-title" data-testid="template-carer-confirm" className="m-auto w-[min(520px,calc(100vw-24px))] rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40">
          {asking ? (
            <>
              <div className="px-5 py-4 text-[14.5px]">
                <h2 id="planner-confirm-title" className="text-[19px] font-bold">Confirm Template Changes</h2>
                <p className="mt-2 text-[15px]">Are you sure you want to save this change to the template?</p>
                <p className="mt-2 font-semibold">{asking.chip.label} · {asking.day} {asking.chip.time}</p>
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1"><dt className="font-medium">Carer (previous)</dt><dd className="text-[#667085]">{asking.from}</dd><dt className="font-medium">Carer (new)</dt><dd className="font-semibold">{asking.to}</dd></dl>
                <p className="mt-3 rounded-[8px] bg-[#f7f4fe] px-3 py-2 text-[14px] text-[#3d1880]"><strong>Template only.</strong> Existing scheduled visits will not be changed.</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#eaecf0] px-5 py-3">
                <button type="button" onClick={() => confirmDialog.current?.close()} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold">Cancel</button>
                <button type="button" onClick={() => { confirmedMove.current = true; confirmDialog.current?.close(); }} className="h-10 rounded-[8px] bg-[#4b1f9e] px-4 text-[14.5px] font-semibold text-white">Continue</button>
              </div>
            </>
          ) : null}
        </dialog>
      ) : null}
    </div>
  );
}
