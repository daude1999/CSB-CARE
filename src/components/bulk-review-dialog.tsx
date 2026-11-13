"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VisitStatus } from "@prisma/client";
import { previewBulkVisitsAction, runBulkVisitsAction } from "@/app/rota-actions";
import { rowBoxes } from "@/components/select-all";

/** What the bar hands over: the action, a snapshot of the bulk form (ticked visits and details) and the details in words. */
export interface BulkRequest {
  kind: string;
  label: string;
  fields: FormData;
  details: [string, string][];
}

type Outcome = "updated" | "unchanged" | "refused" | "error";
interface Row {
  visitId: string;
  reference: string;
  outcome: Outcome;
  message?: string;
  warnings?: string[];
  serviceUser?: string;
  date?: string;
  time?: string;
  status?: VisitStatus;
  carers?: string;
  lockVersion?: number;
}

const STATUS: Record<VisitStatus, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", MISSED: "Missed", CANCELLED: "Cancelled", NOT_DELIVERED: "Not delivered" };

/** Plain words for what Confirm does, and what it does not do, for each action. */
const NOTES: Record<string, string> = {
  complete: "Each visit is marked Completed (office confirmed). No clock-in, clock-out or medicine record is created, and the visit's earlier status stays in its history. Enter actual times only if you know them.",
  publish: "Booked carers see these visits in My visits and get a notice in the app. No email or text message is sent.",
  cancel: "Carers are taken off the rota for these visits. Invoices follow the charge decision.",
  assign: "Each visit is checked against the carer's availability, training and other bookings. Carers who are not eligible are refused.",
  shadow: "Shadow carers are extra and do not count towards the carers each visit needs.",
  activate: "Only cancelled or not-delivered visits still in the future can be activated. It does not complete past visits.",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The review and results for a Daily Rota bulk action, in a modal dialog. Review runs the action through the server's
 * real rules without saving, so it shows exactly which visits will change, which are already as asked and which will be
 * refused and why. Confirm applies it visit by visit; the results then list every visit that was not changed, and the
 * coordinator can keep just those ticked to fix them, with the successful changes kept.
 */
export function BulkReviewDialog({ form, itemName, request, onClose }: { form: string; itemName: string; request: BulkRequest; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"loading" | "review" | "running" | "results">("loading");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Row[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [times, setTimes] = useState<Record<string, { actualStart?: string; actualEnd?: string }>>({});
  const complete = request.kind === "complete";

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    previewBulkVisitsAction(request.fields).then(
      (r) => {
        if (!live) return;
        if (r.ok) setRows(r.data);
        else setError(r.error);
        setPhase("review");
      },
      () => {
        if (!live) return;
        setError("The review could not be loaded. Check your connection and try again.");
        setPhase("review");
      },
    );
    return () => {
      live = false;
    };
  }, [request]);

  const will = rows.filter((r) => r.outcome === "updated");
  const already = rows.filter((r) => r.outcome === "unchanged");
  const refused = rows.filter((r) => r.outcome === "refused" || r.outcome === "error");
  // A note that applies to every visit that will change is said once, above the list, not on every row.
  const common = will.length ? (will[0]!.warnings ?? []).filter((w) => will.every((r) => r.warnings?.includes(w))) : [];

  async function confirm() {
    const fd = new FormData();
    for (const [k, v] of request.fields.entries()) if (k !== itemName) fd.append(k, v);
    // Only the visits the review said will change are sent, so nothing unseen is touched.
    for (const r of will) fd.append(itemName, r.visitId);
    if (complete) {
      fd.set("confirmDelivered", confirmed ? "on" : "");
      for (const r of will) {
        if (r.lockVersion !== undefined) fd.set(`lockVersion:${r.visitId}`, String(r.lockVersion));
        const t = times[r.visitId];
        if (t?.actualStart) fd.set(`actualStart:${r.visitId}`, t.actualStart);
        if (t?.actualEnd) fd.set(`actualEnd:${r.visitId}`, t.actualEnd);
      }
    }
    setPhase("running");
    setError(null);
    try {
      const r = await runBulkVisitsAction(fd);
      if (!r.ok) {
        setError(r.error);
        setPhase("review");
        return;
      }
      setResults(r.data);
      setPhase("results");
      router.refresh();
    } catch {
      setError("The change could not be sent. Check your connection; nothing is shown as done until the server confirms it.");
      setPhase("review");
    }
  }

  /** Leaves ticked only the visits that were not changed (keep = true), or clears the selection. */
  function finish(keep: boolean) {
    const notDone = new Set([...results.filter((r) => r.outcome === "refused" || r.outcome === "error").map((r) => r.visitId), ...refused.map((r) => r.visitId)]);
    rowBoxes(form, itemName).forEach((c) => {
      c.checked = keep && notDone.has(c.value);
    });
    document.dispatchEvent(new Event("selectall:change"));
    dialog.current?.close();
  }

  const done = results.filter((r) => r.outcome === "updated");
  const same = [...already, ...results.filter((r) => r.outcome === "unchanged")];
  const failed = results.filter((r) => r.outcome === "refused");
  const errors = results.filter((r) => r.outcome === "error");
  const notChanged = [...refused, ...failed, ...errors];
  const title = phase === "results" ? `${request.label}: results` : `Review: ${request.label}`;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(e) => {
        if (phase === "running") e.preventDefault();
      }}
      aria-labelledby="bulk-review-title"
      className="m-auto w-[min(1080px,calc(100vw-32px))] max-h-[calc(100vh-48px)] rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40"
      data-testid="bulk-review"
    >
      <div className="flex max-h-[calc(100vh-48px)] flex-col">
        <header className="border-b border-[#eaecf0] px-5 py-4">
          <h2 id="bulk-review-title" className="text-subtitle font-semibold">{title}</h2>
          {phase === "loading" ? <p className="mt-1 text-body text-[#475467]" role="status">Checking {plural(request.fields.getAll(itemName).length, "visit")}…</p> : null}
          {phase === "review" && !error ? (
            <p className="mt-1 text-body text-[#475467]" role="status" data-testid="bulk-review-summary">
              {plural(rows.length, "visit")} selected: <strong className="text-[#067647]">{will.length} will change</strong>
              {already.length ? <>, {already.length} already as asked</> : null}
              {refused.length ? <>, <strong className="text-[#b42318]">{refused.length} cannot be changed</strong></> : null}.
            </p>
          ) : null}
          {phase === "running" ? <p className="mt-1 text-body text-[#475467]" role="status">Applying to {plural(will.length, "visit")}. Keep this window open…</p> : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <p role="alert" className="mb-3 rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-body text-[#b42318]">{error}</p> : null}

          {phase === "results" ? (
            <>
              <ul className="mb-4 grid gap-1 text-body" data-testid="bulk-results-summary">
                <li><strong className="text-[#067647]">{plural(done.length, "visit")}</strong> {complete ? "completed" : "updated"}.</li>
                <li><strong>{plural(same.length, "visit")}</strong> already as asked (not changed again).</li>
                <li><strong className={notChanged.length ? "text-[#b42318]" : ""}>{plural(failed.length + refused.length, "visit")}</strong> could not be {complete ? "completed" : "changed"}.</li>
                <li><strong>{errors.length}</strong> unexpected {errors.length === 1 ? "error" : "errors"}.</li>
              </ul>
              {notChanged.length ? <ResultTable caption="Not changed: fix these and try again" rows={notChanged} tone="bad" /> : null}
              {same.length ? <ResultTable caption="Already as asked" rows={same} tone="plain" /> : null}
              {done.some((r) => r.warnings?.length) ? <ResultTable caption={complete ? "Completed, with notes" : "Changed, with notes"} rows={done.filter((r) => r.warnings?.length)} tone="plain" showWarnings /> : null}
            </>
          ) : phase !== "loading" && rows.length ? (
            <>
              <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body">
                <dt className="text-[#475467]">Action</dt><dd className="font-semibold">{request.label}</dd>
                {request.details.map(([k, v]) => <div key={k} className="contents"><dt className="text-[#475467]">{k}</dt><dd className="break-words">{v}</dd></div>)}
              </dl>
              {NOTES[request.kind] ? <p className="mb-3 rounded-[8px] bg-[#f9fafb] px-3 py-2 text-body text-[#344054]">{NOTES[request.kind]}</p> : null}
              {common.length ? <ul className="mb-3 list-disc rounded-[8px] border border-[#fedf89] bg-[#fffaeb] py-2 pl-7 pr-3 text-body text-[#93370d]" aria-label="Applies to every visit that will change">{common.map((w) => <li key={w}>{w} (all {plural(will.length, "visit")})</li>)}</ul> : null}
              <div className="overflow-x-auto rounded-[8px] border border-[#eaecf0]">
                <table className="w-full border-collapse text-body">
                  <caption className="sr-only">Selected visits and what will happen to each</caption>
                  <thead className="bg-[#f9fafb] text-left">
                    <tr className="border-b border-[#eaecf0]">
                      <th scope="col" className="px-3 py-2 font-semibold">Ref</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Service user</th>
                      <th scope="col" className="px-3 py-2 font-semibold">When</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Carers</th>
                      <th scope="col" className="min-w-[260px] px-3 py-2 font-semibold">What will happen</th>
                      {complete ? <th scope="col" className="px-3 py-2 font-semibold">Actual times (if known)</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...refused, ...will, ...already].map((r) => (
                      <tr key={r.visitId} className="border-b border-[#f2f4f7] align-top last:border-0" data-testid="bulk-review-row">
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{r.reference}</td>
                        <td className="px-3 py-2">{r.serviceUser}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.date ? `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}` : ""} {r.time}</td>
                        <td className="px-3 py-2">{r.status ? STATUS[r.status] : ""}</td>
                        <td className="px-3 py-2 tabular-nums">{r.carers}</td>
                        <td className="px-3 py-2">
                          {r.outcome === "updated" ? <span className="font-semibold text-[#067647]">Will change</span> : r.outcome === "unchanged" ? <span className="text-[#475467]">No change: {r.message}</span> : <span className="text-[#b42318]"><span className="font-semibold">Cannot change:</span> {r.message}</span>}
                          {r.warnings?.some((w) => !common.includes(w)) ? <ul className="mt-1 list-disc pl-4 text-meta text-[#93370d]">{r.warnings.filter((w) => !common.includes(w)).map((w) => <li key={w}>{w}</li>)}</ul> : null}
                        </td>
                        {complete ? (
                          <td className="whitespace-nowrap px-3 py-2">
                            {r.outcome === "updated" ? (
                              <span className="flex items-center gap-1">
                                <input type="time" aria-label={`Actual start for ${r.reference}`} value={times[r.visitId]?.actualStart ?? ""} onChange={(e) => setTimes((t) => ({ ...t, [r.visitId]: { ...t[r.visitId], actualStart: e.target.value } }))} className="h-8 w-[124px] rounded-[6px] border border-[#d0d5dd] px-1.5 text-meta" />
                                <span aria-hidden>–</span>
                                <input type="time" aria-label={`Actual end for ${r.reference}`} value={times[r.visitId]?.actualEnd ?? ""} onChange={(e) => setTimes((t) => ({ ...t, [r.visitId]: { ...t[r.visitId], actualEnd: e.target.value } }))} className="h-8 w-[124px] rounded-[6px] border border-[#d0d5dd] px-1.5 text-meta" />
                              </span>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {complete && will.length ? (
                <label className="mt-3 flex items-start gap-2 rounded-[8px] border border-[#d0d5dd] px-3 py-2 text-body">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>I confirm the care on {will.length === 1 ? "this visit was" : `these ${will.length} visits was`} delivered, as confirmed by the person named above.</span>
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eaecf0] px-5 py-3">
          {phase === "results" ? (
            <>
              {notChanged.length ? <button type="button" onClick={() => finish(true)} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-body font-semibold">Keep the {plural(notChanged.length, "visit")} not changed ticked</button> : null}
              <button type="button" autoFocus onClick={() => finish(false)} className="h-10 rounded-[8px] bg-module px-4 text-body font-semibold text-white hover:bg-[#4c2398]">Close</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => dialog.current?.close()} disabled={phase === "running"} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-body font-semibold disabled:opacity-50">Back</button>
              <button
                type="button"
                onClick={confirm}
                disabled={phase !== "review" || !will.length || (complete && !confirmed)}
                className="h-10 rounded-[8px] bg-module px-4 text-body font-semibold text-white hover:bg-[#4c2398] disabled:cursor-not-allowed disabled:bg-[#c9b8ea]"
              >
                {phase === "running" ? "Applying…" : !will.length && phase === "review" ? "Nothing to change" : complete ? `Confirm Completion (${will.length})` : `Confirm: ${request.label} (${will.length})`}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function ResultTable({ caption, rows, tone, showWarnings = false }: { caption: string; rows: Row[]; tone: "bad" | "plain"; showWarnings?: boolean }) {
  return (
    <div className="mb-3 overflow-x-auto rounded-[8px] border border-[#eaecf0]">
      <table className="w-full border-collapse text-body">
        <caption className={`px-3 py-2 text-left text-body font-semibold ${tone === "bad" ? "text-[#b42318]" : "text-[#344054]"}`}>{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.visitId} className="border-t border-[#f2f4f7] align-top" data-testid={tone === "bad" ? "bulk-failed-row" : "bulk-result-row"}>
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">{r.reference === "—" ? "—" : <a href={`/rota/visits/${r.visitId}`} target="_blank" rel="noreferrer" className="text-module">{r.reference}</a>}</th>
              <td className="px-3 py-2">{showWarnings ? r.warnings?.join(". ") : r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
