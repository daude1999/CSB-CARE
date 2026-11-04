"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { previewTemplateEditAction, previewTemplateImpactAction } from "@/app/rota-actions";

interface FieldChange { key: string; label: string; before: string; after: string }
interface EditPreview { templateId: string; version: number; serviceUser: string; callType: string; changes: FieldChange[]; token: string; futureVisits: number }
type Result = "update" | "manual" | "started" | "locked" | "review" | "removed" | "unchanged";
interface ImpactRow { visitId: string; reference: string; date: string; status: string; published: boolean; result: Result; reason?: string; previous: string; proposed: string; changes: string[] }
interface Impact { rows: ImpactRow[]; newDates: string[]; manualActions: string[]; summary: { update: number; review: number; protected: number; removed: number; past: number; unchanged: number }; fingerprint: string; token: string }

const RESULT: Record<Result, { label: string; cls: string }> = {
  update: { label: "Can update", cls: "bg-[#ecfdf3] text-[#067647]" },
  manual: { label: "Manual change – protected", cls: "bg-[#f4f1fd] text-[#4b1f9e]" },
  started: { label: "Started or finished – history kept", cls: "bg-[#f2f4f7] text-[#344054]" },
  locked: { label: "Time locked – protected", cls: "bg-[#eef4ff] text-[#1d4f91]" },
  review: { label: "Needs review", cls: "bg-[#fffaeb] text-[#93370d]" },
  removed: { label: "No longer in the template", cls: "bg-[#fef3f2] text-[#b42318]" },
  unchanged: { label: "Already matches", cls: "bg-[#f2f4f7] text-[#475467]" },
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const BTN = "inline-flex h-10 items-center justify-center rounded-[8px] px-4 text-[14.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5] disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BTN} bg-[#4b1f9e] text-white hover:bg-[#3d1880]`;
const SECONDARY = `${BTN} border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50`;

type Phase = "idle" | "checking" | "confirm" | "loadingReview" | "review" | "final" | "saving";

/**
 * The edit form for an existing template, with Confirm Template Changes in front of every save (brief of 3 Nov 2026,
 * sections 7-9). Save asks the server what would change from the unsaved values (nothing is written), then:
 *   Template Only → Continue saves the template with the reviewed proposal's token.
 *   Template + Future Rota → Continue shows the affected future visits, then Confirm Future Rota Changes applies them.
 * Cancel, Esc or closing the dialog writes nothing. The server refuses a save without the reviewed token or plan.
 */
export function TemplateEditForm({ action, children, submit }: { action: (fd: FormData) => Promise<void>; children: ReactNode; submit: string }) {
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const bypass = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditPreview | null>(null);
  const [applyTo, setApplyTo] = useState<"template" | "future">("template");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [cancelIds, setCancelIds] = useState<string[]>([]);
  const [cancelReason, setCancelReason] = useState("");
  const [final, setFinal] = useState<{ applyTo: "template" | "future"; token: string; fingerprint: string } | null>(null);

  const open = phase === "confirm" || phase === "loadingReview" || phase === "review" || phase === "final" || phase === "saving";
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // Submit only after React has written the confirmed values into the hidden fields.
  useEffect(() => {
    if (!final) return;
    bypass.current = true;
    form.current?.requestSubmit();
  }, [final]);

  const close = () => {
    if (phase === "saving") return;
    setPhase("idle");
    setImpact(null);
    setCancelIds([]);
    setCancelReason("");
    setError(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (bypass.current) {
      bypass.current = false;
      setPhase("saving");
      return;
    }
    e.preventDefault();
    setNotice(null);
    setError(null);
    setPhase("checking");
    try {
      const r = await previewTemplateEditAction(new FormData(e.currentTarget));
      if (!r.ok) {
        setNotice(r.error);
        setPhase("idle");
        return;
      }
      setEdit(r.data);
      setApplyTo("template");
      setPhase("confirm");
    } catch {
      setNotice("The changes could not be checked. Check your connection and try again.");
      setPhase("idle");
    }
  }

  async function next() {
    if (!edit || !form.current) return;
    if (applyTo === "template") {
      setFinal({ applyTo: "template", token: edit.token, fingerprint: "" });
      return;
    }
    setError(null);
    setPhase("loadingReview");
    try {
      const r = await previewTemplateImpactAction(new FormData(form.current));
      if (!r.ok) {
        setError(r.error);
        setPhase("confirm");
        return;
      }
      if (r.data.token !== edit.token) {
        setError("The form changed since you pressed Save. Close this and save again.");
        setPhase("confirm");
        return;
      }
      setImpact(r.data);
      setPhase("review");
    } catch {
      setError("The future visits could not be checked. Check your connection and try again.");
      setPhase("confirm");
    }
  }

  const rows = impact?.rows.filter((r) => r.result !== "unchanged") ?? [];
  const cancelOk = !cancelIds.length || cancelReason.trim().length >= 3;

  return (
    <form ref={form} action={action} onSubmit={onSubmit} className="space-y-4" data-no-progress>
      {children}
      <input type="hidden" name="confirmToken" value={final?.token ?? ""} />
      <input type="hidden" name="applyTo" value={final?.applyTo ?? ""} />
      <input type="hidden" name="fingerprint" value={final?.fingerprint ?? ""} />
      {final?.applyTo === "future" ? cancelIds.map((id) => <input key={id} type="hidden" name="cancelVisitIds" value={id} />) : null}
      {final?.applyTo === "future" ? <input type="hidden" name="cancelReason" value={cancelReason} /> : null}
      {notice ? <p role="alert" className="rounded-[8px] border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-[14px] text-[#93370d]" data-testid="template-save-notice">{notice}</p> : null}
      <button className="btn-primary" disabled={phase === "checking" || phase === "saving"} aria-haspopup="dialog">{phase === "checking" ? "Checking…" : submit}</button>

      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        aria-labelledby="tpl-confirm-title"
        className="m-auto w-[min(860px,calc(100vw-24px))] max-h-[calc(100vh-32px)] rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40"
        data-testid="template-confirm"
      >
        {edit ? (
          <div className="flex max-h-[calc(100vh-32px)] flex-col">
            <header className="border-b border-[#eaecf0] px-5 py-4">
              <h2 id="tpl-confirm-title" className="text-[19px] font-bold">
                {phase === "review" || phase === "loadingReview" ? "Review Changes to Future Rota" : phase === "final" || (phase === "saving" && final?.applyTo === "future") ? "Confirm Future Rota Changes" : "Confirm Template Changes"}
              </h2>
              <p className="mt-0.5 text-[15px] font-semibold text-[#344054]">{edit.serviceUser} – {edit.callType}</p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {error ? <p role="alert" className="mb-3 rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[14px] text-[#b42318]">{error}</p> : null}

              {phase === "confirm" || phase === "loadingReview" || (phase === "saving" && final?.applyTo === "template") ? (
                <>
                  <p className="text-[15px]">Are you sure you want to save these changes to this template?</p>
                  <table className="mt-3 w-full border-collapse text-[14.5px]" data-testid="template-changes">
                    <caption className="sr-only">Changed settings</caption>
                    <thead><tr className="border-b border-[#eaecf0] text-left"><th scope="col" className="py-2 pr-3 font-semibold">Field</th><th scope="col" className="py-2 pr-3 font-semibold">Previous</th><th scope="col" className="py-2 font-semibold">New</th></tr></thead>
                    <tbody>
                      {edit.changes.map((c) => (
                        <tr key={c.key} className="border-b border-[#f2f4f7] align-top">
                          <th scope="row" className="py-2 pr-3 text-left font-medium">{c.label}</th>
                          <td className="py-2 pr-3 text-[#667085]">{c.before}</td>
                          <td className="py-2 font-semibold">{c.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <fieldset className="mt-4">
                    <legend className="text-[15px] font-semibold">Where should these changes apply?</legend>
                    <div className="mt-2 grid gap-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#d0d5dd] p-3 has-[:checked]:border-[#4b1f9e] has-[:checked]:bg-[#f7f4fe]">
                        <input type="radio" name="tplApply" value="template" checked={applyTo === "template"} onChange={() => setApplyTo("template")} className="mt-1 h-4 w-4" />
                        <span><span className="block font-semibold">Template only</span><span className="block text-[14px] text-[#475467]">Save changes to the recurring template. Existing scheduled visits will not be changed.</span></span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#d0d5dd] p-3 has-[:checked]:border-[#4b1f9e] has-[:checked]:bg-[#f7f4fe]">
                        <input type="radio" name="tplApply" value="future" checked={applyTo === "future"} onChange={() => setApplyTo("future")} className="mt-1 h-4 w-4" />
                        <span><span className="block font-semibold">Template + future rota</span><span className="block text-[14px] text-[#475467]">Save the template and review eligible future scheduled visits that could be updated{edit.futureVisits ? ` (${plural(edit.futureVisits, "scheduled visit")} built)` : ""}.</span></span>
                      </label>
                    </div>
                  </fieldset>
                </>
              ) : null}

              {(phase === "review" || phase === "final" || (phase === "saving" && final?.applyTo === "future")) && impact ? (
                <>
                  {phase === "review" ? (
                    <ul className="mb-3 grid gap-0.5 text-[14.5px]" data-testid="impact-summary">
                      <li><strong className="text-[#067647]">{plural(impact.summary.update, "future visit")}</strong> eligible for updating.</li>
                      <li><strong className={impact.summary.review ? "text-[#93370d]" : ""}>{plural(impact.summary.review, "visit")}</strong> {impact.summary.review === 1 ? "requires" : "require"} review.</li>
                      <li><strong>{plural(impact.summary.protected, "visit")}</strong> protected (manual changes, time locks, started or finished).</li>
                      {impact.summary.removed ? <li><strong className="text-[#b42318]">{plural(impact.summary.removed, "visit")}</strong> no longer in the template: kept unless you tick them below.</li> : null}
                      <li><strong>0</strong> past visits affected.</li>
                    </ul>
                  ) : (
                    <p className="text-[15px]" data-testid="final-confirm">You&apos;re about to update {plural(impact.summary.update, "eligible future visit")} for this service user{cancelIds.length ? ` and cancel ${plural(cancelIds.length, "visit")} you ticked` : ""}. Existing protected visits will remain unchanged ({impact.summary.protected} protected, {impact.summary.review} needing review{impact.summary.removed - cancelIds.length > 0 ? `, ${impact.summary.removed - cancelIds.length} kept outside the template` : ""}).</p>
                  )}
                  {phase === "review" ? (
                    rows.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[14px]" data-testid="impact-table">
                          <caption className="sr-only">Future visits and what would happen to each</caption>
                          <thead><tr className="border-b border-[#eaecf0] text-left"><th scope="col" className="py-2 pr-3 font-semibold">Date</th><th scope="col" className="py-2 pr-3 font-semibold">Previous</th><th scope="col" className="py-2 pr-3 font-semibold">Proposed</th><th scope="col" className="py-2 font-semibold">Result</th></tr></thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.visitId} className="border-b border-[#f2f4f7] align-top" data-result={r.result}>
                                <td className="whitespace-nowrap py-2 pr-3">{fmtDate(r.date)}<span className="block text-[12px] text-[#667085]">{r.reference}{r.published ? " · published" : ""}</span></td>
                                <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[#667085]">{r.previous}</td>
                                <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{r.proposed}{r.changes.length && r.result !== "removed" ? <span className="block text-[12px] text-[#667085]">{r.changes.join(", ")}</span> : null}</td>
                                <td className="py-2">
                                  <span className={`inline-block rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${RESULT[r.result].cls}`}>{RESULT[r.result].label}</span>
                                  {r.reason && r.result !== "update" ? <span className="mt-0.5 block text-[12.5px] text-[#475467]">{r.reason}</span> : null}
                                  {r.result === "removed" ? (
                                    <label className="mt-1 flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={cancelIds.includes(r.visitId)} onChange={(e) => setCancelIds((ids) => (e.target.checked ? [...ids, r.visitId] : ids.filter((x) => x !== r.visitId)))} className="h-4 w-4" />Cancel this visit</label>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-[14.5px] text-[#475467]">No future visits of this template would change.</p>
                  ) : null}
                  {phase === "review" && cancelIds.length ? (
                    <label className="mt-3 block text-[14px]"><span className="font-semibold">Why cancel the ticked visits?</span><input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="input mt-1" placeholder="For example: Wednesday visits stop from next week" /></label>
                  ) : null}
                  {phase === "review" && impact.newDates.length ? (
                    <p className="mt-3 rounded-[8px] bg-[#eef4ff] px-3 py-2 text-[14px] text-[#1d3c6e]" data-testid="new-dates">{plural(impact.newDates.length, "new visit")} would be needed in weeks already built ({impact.newDates.slice(0, 6).map(fmtDate).join(", ")}{impact.newDates.length > 6 ? "…" : ""}). They are <strong>not</strong> added now: after saving, use Create Future Rota on the service user&apos;s Rota tab.</p>
                  ) : null}
                  {phase === "review" && impact.manualActions.length ? (
                    <ul className="mt-3 list-disc pl-5 text-[14px] text-[#475467]">{impact.manualActions.map((m) => <li key={m}>{m}</li>)}</ul>
                  ) : null}
                </>
              ) : null}
              {phase === "loadingReview" ? <p className="mt-3 text-[14px] text-[#475467]" role="status">Checking future visits…</p> : null}
              {phase === "saving" ? <p className="mt-3 text-[14px] text-[#475467]" role="status">Saving…</p> : null}
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-[#eaecf0] px-5 py-3">
              {phase === "confirm" || phase === "loadingReview" ? (
                <>
                  <button type="button" className={SECONDARY} onClick={close}>Cancel</button>
                  <button type="button" className={PRIMARY} onClick={next} disabled={phase === "loadingReview"}>Continue</button>
                </>
              ) : phase === "review" ? (
                <>
                  <button type="button" className={SECONDARY} onClick={close}>Cancel</button>
                  <button type="button" className={SECONDARY} onClick={() => setPhase("confirm")}>Back</button>
                  <button type="button" className={PRIMARY} onClick={() => setPhase("final")} disabled={!cancelOk} title={cancelOk ? undefined : "Give a reason for cancelling the ticked visits"}>Continue</button>
                </>
              ) : phase === "final" ? (
                <>
                  <button type="button" className={SECONDARY} onClick={() => setPhase("review")}>Back to Review</button>
                  <button type="button" className={PRIMARY} onClick={() => impact && setFinal({ applyTo: "future", token: impact.token, fingerprint: impact.fingerprint })}>Confirm &amp; Apply</button>
                </>
              ) : null}
            </footer>
          </div>
        ) : null}
      </dialog>
    </form>
  );
}
