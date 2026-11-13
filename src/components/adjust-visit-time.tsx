"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "@phosphor-icons/react";
import { adjustVisitTimeAction, previewAdjustVisitTimeAction } from "@/app/rota-actions";

/** Mirrors AdjustPreview in src/server/rota/adjust-time.ts (the server is the source of truth for every check). */
interface Neighbour { reference: string; serviceUser: string; start: string; end: string; gap: number }
interface Carer { staffId: string; name: string; place: string; state: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE"; blocking: string[]; warnings: string[]; previous: Neighbour | null; next: Neighbour | null }
interface Preview {
  reference: string; serviceUser: string; date: string; published: boolean;
  original: { start: string; end: string; durationMin: number }; revised: { start: string; end: string; durationMin: number };
  plannedMin: number; shorter: boolean; carers: Carer[]; blocking: string[]; warnings: string[]; carersToTell: number;
}

const CHIPS = [30, 40, 45, 60];
const SHORTEN: [string, string][] = [["SU_REQUEST", "Service user or family request"], ["APPOINTMENT", "Hospital or appointment"], ["CARE_PLAN", "Approved care plan change"]];
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module";
const PRIMARY = `inline-flex h-10 items-center rounded-[8px] bg-[#4b1f9e] px-4 text-[14.5px] font-semibold text-white hover:bg-[#3d1880] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const SECONDARY = `inline-flex h-10 items-center rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold text-[#101828] hover:bg-slate-50 ${FOCUS}`;

const addMinutes = (hhmm: string, n: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return "";
  const t = (((Number(m[1]) * 60 + Number(m[2]) + n) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Adjust Visit Time: a button that opens the dialog for one visit. Step 1 edits the time and checks it on the server
 * (nothing is saved), step 2 shows original and revised times side by side and confirms. A blocking result keeps
 * Confirm off; there is no override. The template is never changed.
 */
export function AdjustVisitTime({ visitId, lockVersion, start, durationMin, label = "Adjust visit time", className }: { visitId: string; lockVersion: number; start: string; durationMin: number; label?: string; className?: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"edit" | "checking" | "confirm" | "saving">("edit");
  const [newStart, setNewStart] = useState(start);
  const [minutes, setMinutes] = useState(String(durationMin));
  const [reason, setReason] = useState("");
  const [shorten, setShorten] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const reset = () => {
    setPhase("edit");
    setNewStart(start);
    setMinutes(String(durationMin));
    setReason("");
    setShorten("");
    setError(null);
    setPreview(null);
  };
  const close = () => {
    if (phase === "saving") return;
    setOpen(false);
    reset();
  };
  const fd = () => {
    const f = new FormData();
    f.set("visitId", visitId);
    f.set("lockVersion", String(lockVersion));
    f.set("start", newStart);
    f.set("durationMin", minutes);
    f.set("reason", reason);
    f.set("shortenReason", shorten);
    return f;
  };
  const n = Number(minutes);
  const finish = Number.isInteger(n) && n >= 5 && n <= 1440 ? addMinutes(newStart, n) : "";

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("checking");
    try {
      const r = await previewAdjustVisitTimeAction(fd());
      if (!r.ok) {
        setError(r.error);
        setPhase("edit");
        return;
      }
      setPreview(r.data);
      setPhase("confirm");
    } catch {
      setError("The new time could not be checked. Check your connection and try again.");
      setPhase("edit");
    }
  }

  async function confirm() {
    setError(null);
    setPhase("saving");
    try {
      const r = await adjustVisitTimeAction(fd());
      if (!r.ok) {
        setError(r.error);
        setPhase("confirm");
        return;
      }
      setOpen(false);
      reset();
      setDone(r.data.message);
      router.refresh();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
      setPhase("confirm");
    }
  }

  const needsShortenReason = preview?.shorter ?? false;
  const canConfirm = !!preview && !preview.blocking.length && reason.trim().length >= 3 && (!needsShortenReason || !!shorten);

  return (
    <>
      <button type="button" onClick={() => { setDone(null); setOpen(true); }} aria-haspopup="dialog" className={className ?? `inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-module hover:bg-[#f6f2fd] ${FOCUS}`}>
        <Clock size={16} aria-hidden />{label}
      </button>
      {done ? <p role="status" data-testid="adjust-done" className="fixed bottom-4 left-1/2 z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 rounded-[10px] bg-[#101828] px-4 py-3 text-[14px] text-white shadow-lg">{done} <button type="button" onClick={() => setDone(null)} className="ml-2 underline">Close</button></p> : null}
      <dialog ref={dialog} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }} aria-labelledby={titleId} data-testid="adjust-time" className="m-auto whitespace-normal w-[min(600px,calc(100vw-24px))] rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-left text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40">
        {open ? (
          <div className="flex max-h-[calc(100vh-32px)] flex-col">
            <header className="border-b border-[#eaecf0] px-5 py-4">
              <h2 id={titleId} className="text-[19px] font-bold">{phase === "confirm" || phase === "saving" ? "Confirm Visit Time Adjustment" : "Adjust Visit Time"}</h2>
              <p className="mt-0.5 text-[14px] text-[#475467]">This visit only. The repeating template is not changed.</p>
            </header>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 text-[14.5px] [overflow-wrap:anywhere]">
              {error ? <p role="alert" className="mb-3 rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[14px] text-[#b42318]">{error}</p> : null}
              {phase === "edit" || phase === "checking" ? (
                <form id={`${titleId}-f`} onSubmit={check} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block"><span className="block text-[13.5px] font-semibold">Start time</span><input type="time" required value={newStart} onChange={(e) => setNewStart(e.target.value)} className={`input mt-1 ${FOCUS}`} /></label>
                    <label className="block"><span className="block text-[13.5px] font-semibold">Duration (minutes)</span><input type="number" min={5} max={1440} required value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`input mt-1 ${FOCUS}`} /></label>
                    <div><span className="block text-[13.5px] font-semibold">Finish time</span><output className="mt-1 flex h-10 items-center text-[15px] font-semibold tabular-nums" data-testid="adjust-finish">{finish || "–"}</output></div>
                  </div>
                  <div role="group" aria-label="Duration" className="flex flex-wrap gap-1.5">
                    {CHIPS.map((c) => (
                      <button key={c} type="button" aria-pressed={n === c} onClick={() => setMinutes(String(c))} className={`h-8 rounded-full border px-3 text-[13.5px] ${FOCUS} ${n === c ? "border-[#4b1f9e] bg-[#4b1f9e] font-semibold text-white" : "border-[#d0d5dd] bg-white hover:bg-module/[.08]"}`}>{c} min</button>
                    ))}
                  </div>
                  <label className="block"><span className="block text-[13.5px] font-semibold">Reason for the change</span><input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: GP appointment at 10:00" className={`input mt-1 ${FOCUS}`} /></label>
                  <p className="text-[13px] text-[#475467]">Currently {start}–{addMinutes(start, durationMin)} ({durationMin} min). Each carer is checked at the new time before anything is saved.</p>
                </form>
              ) : preview ? (
                <div className="space-y-4">
                  <p className="font-semibold">{preview.reference} · {preview.serviceUser} · {dayLabel(preview.date)}</p>
                  <table className="w-full border-collapse text-[14.5px]" data-testid="adjust-compare">
                    <caption className="sr-only">Original and revised time</caption>
                    <thead><tr className="border-b border-[#eaecf0] text-left"><th scope="col" className="py-2 pr-3" /><th scope="col" className="py-2 pr-3 font-semibold">Original</th><th scope="col" className="py-2 font-semibold">Revised</th></tr></thead>
                    <tbody>
                      <tr className="border-b border-[#f2f4f7]"><th scope="row" className="py-2 pr-3 text-left font-medium">Start</th><td className="py-2 pr-3 text-[#667085] tabular-nums">{preview.original.start}</td><td className="py-2 font-semibold tabular-nums">{preview.revised.start}</td></tr>
                      <tr className="border-b border-[#f2f4f7]"><th scope="row" className="py-2 pr-3 text-left font-medium">Finish</th><td className="py-2 pr-3 text-[#667085] tabular-nums">{preview.original.end}</td><td className="py-2 font-semibold tabular-nums">{preview.revised.end}</td></tr>
                      <tr><th scope="row" className="py-2 pr-3 text-left font-medium">Duration</th><td className="py-2 pr-3 text-[#667085]">{preview.original.durationMin} min</td><td className="py-2 font-semibold">{preview.revised.durationMin} min</td></tr>
                    </tbody>
                  </table>
                  {preview.blocking.length ? (
                    <ul role="alert" className="space-y-1 rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[14px] text-[#b42318]" data-testid="adjust-blocking">
                      {preview.blocking.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  ) : null}
                  {preview.warnings.length ? (
                    <ul className="space-y-1 rounded-[8px] border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-[14px] text-[#93370d]" data-testid="adjust-warnings">
                      {preview.warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  ) : null}
                  <div>
                    <p className="text-[14px] font-semibold">Carers</p>
                    {preview.carers.length ? (
                      <ul className="mt-1 divide-y divide-[#f2f4f7] text-[14px]" data-testid="adjust-carers">
                        {preview.carers.map((c) => (
                          <li key={c.staffId} className="py-1.5">
                            <span className="font-medium">{c.name}</span> <span className="text-[#667085]">({c.place})</span>{" "}
                            <span className={c.state === "ELIGIBLE" ? "text-[#067647]" : c.state === "REQUIRES_REVIEW" ? "text-[#93370d]" : "font-semibold text-[#b42318]"}>{c.state === "ELIGIBLE" ? "can do the new time" : c.state === "REQUIRES_REVIEW" ? `can do it, with warnings: ${c.warnings.join("; ")}` : "cannot do the new time"}</span>
                            <span className="block text-[13px] text-[#475467]">
                              Before: {c.previous ? `${c.previous.reference} ${c.previous.start}–${c.previous.end} (${c.previous.serviceUser}), ${c.previous.gap} min gap` : "no earlier visit"} · After: {c.next ? `${c.next.reference} ${c.next.start}–${c.next.end} (${c.next.serviceUser}), ${c.next.gap} min gap` : "no later visit"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 text-[14px] text-[#475467]">No carer is booked on this visit yet.</p>}
                  </div>
                  {needsShortenReason ? (
                    <fieldset className="rounded-[8px] border border-[#d0d5dd] p-3">
                      <legend className="px-1 text-[14px] font-semibold">Why is the visit shorter than planned?</legend>
                      <div className="mt-1 grid gap-1">
                        {SHORTEN.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[14px]"><input type="radio" name={`${titleId}-shorten`} value={k} checked={shorten === k} onChange={() => setShorten(k)} className="h-4 w-4" />{l}</label>)}
                      </div>
                      <p className="mt-2 text-[13px] text-[#475467]">Carer availability is not a reason to shorten someone&apos;s care. A permanent change must go through the care plan.</p>
                    </fieldset>
                  ) : null}
                  <p className="text-[13.5px] text-[#475467]" data-testid="adjust-reason">Reason: {reason}</p>
                  {preview.published ? <p className="text-[13.5px] text-[#475467]">This visit is published. {preview.carersToTell ? `${preview.carersToTell} linked carer${preview.carersToTell === 1 ? " will be" : "s will be"} told in the app.` : "No carer on it has a sign-in, so nobody can be told in the app."}</p> : <p className="text-[13.5px] text-[#475467]">This visit is not published yet, so carers are not told.</p>}
                </div>
              ) : null}
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-[#eaecf0] px-5 py-3">
              {phase === "edit" || phase === "checking" ? (
                <>
                  <button key="edit-cancel" type="button" className={SECONDARY} onClick={close}>Cancel</button>
                  <button key="edit-check" type="submit" form={`${titleId}-f`} className={PRIMARY} disabled={phase === "checking"}>{phase === "checking" ? "Checking…" : "Check new time"}</button>
                </>
              ) : (
                <>
                  <button key="confirm-cancel" type="button" className={SECONDARY} onClick={close} disabled={phase === "saving"}>Cancel</button>
                  <button key="confirm-back" type="button" className={SECONDARY} onClick={() => { setError(null); setPhase("edit"); }} disabled={phase === "saving"}>Back</button>
                  <button key="confirm-save" type="button" className={PRIMARY} onClick={confirm} disabled={!canConfirm || phase === "saving"} title={preview?.blocking.length ? "This time cannot be used: see the reasons above" : needsShortenReason && !shorten ? "Choose why the visit is shorter" : undefined}>{phase === "saving" ? "Saving…" : "Confirm"}</button>
                </>
              )}
            </footer>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
