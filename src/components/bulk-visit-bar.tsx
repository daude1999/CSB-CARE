"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { MAX_CARERS } from "@/lib/carer-places";
import { rowBoxes } from "@/components/select-all";
import { BulkReviewDialog, type BulkRequest } from "@/components/bulk-review-dialog";

type Need = "reason" | "reasonOptional" | "completeReason" | "verifiedBy" | "charge" | "staff" | "slot" | "slotAll" | "warnings" | "time" | "duration" | "service" | "minutes" | "carers";
export type BulkAction = { kind: string; label: string; needs: readonly Need[] };

/** Each Daily Rota bulk action and the extra details it needs. The server checks everything again. */
const ACTIONS = [
  { kind: "cancel", label: "Cancel Visits", needs: ["reason", "charge"] },
  { kind: "activate", label: "Activate Visits", needs: ["reason"] },
  { kind: "assign", label: "Reassign Visits", needs: ["staff", "slot", "warnings"] },
  { kind: "unassign", label: "Unassign Visits", needs: ["slot", "reasonOptional"] },
  { kind: "lock", label: "Add Rota Lock(s)", needs: [] },
  { kind: "unlock", label: "Remove Rota Lock(s)", needs: [] },
  { kind: "editTime", label: "Edit Times", needs: ["time"] },
  { kind: "editDuration", label: "Edit Duration", needs: ["duration"] },
  { kind: "editService", label: "Edit Service Name", needs: ["service"] },
  { kind: "addAlert", label: "Add Alerts", needs: [] },
  { kind: "removeAlert", label: "Remove Alerts", needs: [] },
  { kind: "shadow", label: "Add Shadow Shifts", needs: ["staff", "warnings"] },
  { kind: "doubleUp", label: "Convert To Double Up", needs: [] },
  { kind: "single", label: "Revert Double Up To Single", needs: [] },
  { kind: "setCarers", label: "Change Carers Needed", needs: ["carers"] },
  { kind: "nudge", label: "Nudge Times", needs: ["minutes"] },
  { kind: "publish", label: "Publish to Carers", needs: [] },
  { kind: "complete", label: "Complete Calls", needs: ["completeReason", "verifiedBy"] },
] as const satisfies readonly BulkAction[];

/** The Daily Templates bulk actions (they change the repeating pattern, not built visits). */
const TEMPLATE_ACTIONS = [
  { kind: "disable", label: "Deactivate Templates", needs: [] },
  { kind: "enable", label: "Activate Templates", needs: [] },
  { kind: "assign", label: "Reassign Templates", needs: ["staff", "slotAll"] },
  { kind: "unassign", label: "Unassign Templates", needs: ["slotAll"] },
  { kind: "editTime", label: "Edit Start Time", needs: ["time"] },
  { kind: "editDuration", label: "Edit Duration", needs: ["duration"] },
  { kind: "nudge", label: "Nudge Times", needs: ["minutes"] },
  { kind: "lock", label: "Add Lock(s)", needs: [] },
  { kind: "unlock", label: "Remove Lock(s)", needs: [] },
  { kind: "editService", label: "Edit Service Name", needs: ["service"] },
  { kind: "addAlert", label: "Add Alert", needs: [] },
  { kind: "removeAlert", label: "Remove Alert", needs: [] },
  { kind: "duplicate", label: "Duplicate Templates", needs: [] },
  { kind: "doubleUp", label: "Convert To Double Up", needs: [] },
  { kind: "single", label: "Revert Double Up To Single", needs: [] },
  { kind: "setCarers", label: "Change Carers Needed", needs: ["carers"] },
] as const satisfies readonly BulkAction[];

type Option = { id: string; name: string };
/** Template bulk actions with their own confirmation (Deactivate) or that only add new, switched-off copies. */
const NO_CONFIRM = new Set(["enable", "duplicate"]);

const FIELD = "h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#101828]";

/**
 * The ticked row checkboxes that belong to the bulk form, wherever they sit on the page. Recounted on every tick, on
 * Select all, and whenever the rows change (a refresh after an action, another page, a filter), so the count is never stale.
 */
function useSelectedCount(form: string, name: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const recount = () => setCount(rowBoxes(form, name).filter((c) => c.checked).length);
    recount();
    const observer = new MutationObserver(recount);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", recount);
    document.addEventListener("selectall:change", recount);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", recount);
      document.removeEventListener("selectall:change", recount);
    };
  }, [form, name]);
  return count;
}

/**
 * The Daily Rota's bulk actions bar. Choosing an action shows the details it needs (a carer for Reassign, a time for Edit
 * Times, and so on) right next to it, and Go stays off until visits are ticked and those details are filled in, saying
 * why. Go opens a review of exactly what will happen to each ticked visit; nothing changes until Confirm, and the
 * results then list every visit that was not changed and why. Without JavaScript the form posts straight to the server.
 */
export function BulkVisitBar({ form, staff, callTypes, canPublish, canComplete = false }: { form: string; staff: Option[]; callTypes: Option[]; canPublish: boolean; canComplete?: boolean }) {
  const actions = ACTIONS.filter((a) => (a.kind !== "publish" || canPublish) && (a.kind !== "complete" || canComplete));
  return <BulkActionBar form={form} itemName="visitIds" noun="visit" actions={actions} staff={staff} callTypes={callTypes} review />;
}

/** The Daily Templates bulk actions bar. Posts to templateBulkAction, which re-checks every template. */
export function BulkTemplateBar({ form, staff, callTypes }: { form: string; staff: Option[]; callTypes: Option[] }) {
  return <BulkActionBar form={form} itemName="templateIds" noun="template" actions={TEMPLATE_ACTIONS} staff={staff} callTypes={callTypes} compact confirmTemplates />;
}

/** The same bar for any list: which checkboxes count (itemName), what they are called, and which actions it offers. */
function BulkActionBar({ form, itemName, noun, actions, staff, callTypes, compact = false, review = false, confirmTemplates = false }: { form: string; itemName: string; noun: string; actions: readonly BulkAction[]; staff: Option[]; callTypes: Option[]; compact?: boolean; review?: boolean; confirmTemplates?: boolean }) {
  const [confirming, setConfirming] = useState<[string, string][] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const selected = useSelectedCount(form, itemName);
  const [kind, setKind] = useState("");
  const [staffId, setStaffId] = useState("");
  const [place, setPlace] = useState("PRIMARY");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [callTypeId, setCallTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [verifiedBy, setVerifiedBy] = useState("");
  const [charge, setCharge] = useState<"" | "yes" | "no">("");
  const [carers, setCarers] = useState("");
  const [carersCustom, setCarersCustom] = useState("");
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const [request, setRequest] = useState<BulkRequest | null>(null);
  const action = actions.find((a) => a.kind === kind);
  const needs = new Set<string>(action?.needs ?? []);
  // The approved Daily Templates design joins Go to the action list; it stays separate while extra details are shown.
  const joined = compact && needs.size === 0;
  const nudge = Number(minutes);

  const missing =
    !selected ? `Tick the ${noun}s to change first.`
    : !action ? "Choose a bulk action."
    : needs.has("staff") && !staffId ? "Choose a carer."
    : needs.has("time") && !time ? "Choose the new start time."
    : needs.has("duration") && !(Number(duration) >= 5 && Number(duration) <= 1440 && Number.isInteger(Number(duration))) ? "Enter the new length: 5 to 1440 minutes."
    : needs.has("minutes") && !(Number.isInteger(nudge) && nudge !== 0 && Math.abs(nudge) <= 240) ? "Move by 1 to 240 minutes (minus for earlier)."
    : needs.has("service") && !callTypeId ? "Choose a service call."
    : needs.has("carers") && !carers ? "Choose how many carers each visit needs."
    : needs.has("carers") && carers === "custom" && !(Number(carersCustom) >= 1 && Number(carersCustom) <= MAX_CARERS && Number.isInteger(Number(carersCustom))) ? `Enter a whole number of carers from 1 to ${MAX_CARERS}.`
    : needs.has("charge") && !charge ? "Choose Charge or Don't charge."
    : needs.has("reason") && reason.trim().length < 3 ? "Give a reason (at least 3 letters)."
    : needs.has("completeReason") && reason.trim().length < 3 ? "Give the reason for completing (at least 3 letters)."
    : needs.has("verifiedBy") && verifiedBy.trim().length < 3 ? "Say who confirmed the care was delivered."
    : null;

  /** Opens the review with the ticked visits and the details chosen, read at this moment. */
  const openReview = () => {
    if (missing || !action) return;
    const el = document.getElementById(form);
    if (!(el instanceof HTMLFormElement)) return;
    setRequest({ label: action.label, kind: action.kind, fields: new FormData(el), details: describe() });
  };

  // Enter in a field submits the form; with the review step on, it opens the review instead of applying straight away.
  useEffect(() => {
    if (!review) return;
    const el = document.getElementById(form);
    if (!(el instanceof HTMLFormElement)) return;
    const stop = (e: SubmitEvent) => {
      e.preventDefault();
      openReview();
    };
    el.addEventListener("submit", stop);
    return () => el.removeEventListener("submit", stop);
  });

  // Enter in a field would post straight away; for template changes it opens Confirm Template Changes instead.
  useEffect(() => {
    if (!confirmTemplates) return;
    const el = document.getElementById(form);
    if (!(el instanceof HTMLFormElement)) return;
    const stop = (e: SubmitEvent) => {
      if (confirmed || NO_CONFIRM.has(kind)) return;
      e.preventDefault();
      if (!missing) setConfirming(describe());
    };
    el.addEventListener("submit", stop);
    return () => el.removeEventListener("submit", stop);
  });

  /** The chosen details in words, for the review. */
  function describe(): [string, string][] {
    const out: [string, string][] = [];
    if (needs.has("staff")) out.push(["Carer", staff.find((s) => s.id === staffId)?.name ?? ""]);
    if (needs.has("slot")) out.push(["Carer place", place === "SHADOW" ? "Shadow" : place === "PRIMARY" ? "Carer 1" : place === "SECOND" ? "Carer 2" : `Carer ${place.slice(1)}`]);
    if (needs.has("warnings")) out.push(["Warnings", acceptWarnings ? "Accepted: carers who need review are booked" : "Not accepted: carers who need review are refused"]);
    if (needs.has("time")) out.push(["New start time", time]);
    if (needs.has("duration")) out.push(["New length", `${duration} minutes`]);
    if (needs.has("minutes")) out.push(["Move by", `${nudge > 0 ? "+" : ""}${nudge} minutes`]);
    if (needs.has("service")) out.push(["Service call", callTypes.find((c) => c.id === callTypeId)?.name ?? ""]);
    if (needs.has("carers")) out.push(["Carers needed", carers === "custom" ? carersCustom : carers]);
    if (needs.has("charge")) out.push(["Cancellation charge", charge === "yes" ? "Charge" : "Don't charge"]);
    if (needs.has("reason") || needs.has("completeReason") || (needs.has("reasonOptional") && reason.trim())) out.push(["Reason", reason.trim()]);
    if (needs.has("verifiedBy")) out.push(["Confirmed by", verifiedBy.trim()]);
    return out;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={compact && !selected ? "sr-only" : "flex h-10 items-center rounded-[8px] bg-[#f2f4f7] px-3 text-[13.5px] font-semibold text-[#344054]"} data-testid="bulk-selected" aria-live="polite">
        {selected} selected
      </span>
      <label className="relative">
        <span className="sr-only">Bulk action</span>
        <select name="kind" aria-label="Bulk action" required value={kind} onChange={(e) => setKind(e.target.value)} className={`h-10 w-[210px] appearance-none border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px] text-[#101828] ${joined ? "rounded-l-[8px] rounded-r-none" : "rounded-[8px]"}`}>
          <option value="" disabled>Bulk Actions…</option>
          {actions.map((a) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
        </select>
        <CaretDown size={15} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
      </label>

      {needs.has("staff") ? (
        <label><span className="sr-only">Carer</span>
          <select aria-label="Carer" name="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={`${FIELD} w-[200px]`}>
            <option value="">Choose a carer…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ) : null}
      {needs.has("slot") || needs.has("slotAll") ? (
        <label><span className="sr-only">Carer place</span>
          <select aria-label="Carer place" name="slot" value={place} onChange={(e) => setPlace(e.target.value)} className={`${FIELD} w-[120px]`}>
            <option value="PRIMARY">Carer 1</option>
            <option value="SECOND">Carer 2</option>
            {Array.from({ length: MAX_CARERS - 2 }, (_, i) => <option key={i} value={`C${i + 3}`}>Carer {i + 3}</option>)}
            {kind === "unassign" || needs.has("slotAll") ? <option value="SHADOW">Shadow</option> : null}
          </select>
        </label>
      ) : null}
      {needs.has("carers") ? (
        <>
          <label><span className="sr-only">Carers needed</span>
            <select aria-label="Carers needed" name="carers" value={carers} onChange={(e) => setCarers(e.target.value)} className={`${FIELD} w-[170px]`}>
              <option value="">Carers needed…</option>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? "1 carer" : n === 2 ? "2 carers (double-up)" : `${n} carers`}</option>)}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {carers === "custom" ? <label><span className="sr-only">Exact number of carers</span><input aria-label={`Exact number of carers (1 to ${MAX_CARERS})`} type="number" name="carersCustom" min={1} max={MAX_CARERS} step={1} value={carersCustom} onChange={(e) => setCarersCustom(e.target.value)} className={`${FIELD} w-[90px]`} /></label> : null}
        </>
      ) : null}
      {needs.has("time") ? <label><span className="sr-only">New start time</span><input aria-label="New start time" type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} /></label> : null}
      {needs.has("duration") ? <label><span className="sr-only">New length in minutes</span><input aria-label="New length in minutes" type="number" name="duration" min={5} max={1440} step={5} placeholder="Minutes" value={duration} onChange={(e) => setDuration(e.target.value)} className={`${FIELD} w-[110px]`} /></label> : null}
      {needs.has("minutes") ? <label className="flex items-center gap-1.5 text-[13.5px] text-[#344054]">Move by<input type="number" name="minutes" min={-240} max={240} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes to move by (minus for earlier)" className={`${FIELD} w-[90px]`} />min</label> : null}
      {needs.has("service") ? (
        <label><span className="sr-only">Service call</span>
          <select aria-label="Service call" name="callTypeId" value={callTypeId} onChange={(e) => setCallTypeId(e.target.value)} className={`${FIELD} w-[180px]`}>
            <option value="">Choose a service call…</option>
            {callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      ) : null}
      {needs.has("reason") || needs.has("reasonOptional") || needs.has("completeReason") ? <label><span className="sr-only">Reason</span><input aria-label={needs.has("completeReason") ? "Reason for completing" : "Reason"} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needs.has("completeReason") ? "Reason for completing" : needs.has("reason") ? "Reason" : "Reason (optional)"} className={`${FIELD} w-[200px]`} /></label> : null}
      {needs.has("verifiedBy") ? <label><span className="sr-only">Confirmed by</span><input aria-label="Who confirmed the care was delivered" name="verifiedBy" value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="Confirmed by (name and role)" className={`${FIELD} w-[220px]`} /></label> : null}
      {needs.has("charge") ? (
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Charge for the cancellation?</legend>
          {([["yes", "Charge"], ["no", "Don't charge"]] as const).map(([value, label]) => (
            <label key={value} className="flex h-10 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#101828] has-[:checked]:border-module has-[:checked]:bg-[#f6f2fd] has-[:checked]:font-semibold">
              <input type="radio" name="charge" value={value} checked={charge === value} onChange={() => setCharge(value)} className="h-4 w-4" />{label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {needs.has("warnings") ? <label className="flex items-center gap-1.5 text-[13.5px] text-[#344054]"><input type="checkbox" name="acceptWarnings" checked={acceptWarnings} onChange={(e) => setAcceptWarnings(e.target.checked)} className="h-4 w-4" /> Accept warnings</label> : null}

      {confirmTemplates ? <input type="hidden" name="confirmed" value={confirmed ? "1" : ""} form={form} /> : null}
      <button type={review || (confirmTemplates && !NO_CONFIRM.has(kind)) ? "button" : "submit"} onClick={review ? openReview : confirmTemplates && !NO_CONFIRM.has(kind) ? () => !missing && setConfirming(describe()) : undefined} disabled={Boolean(missing)} aria-describedby="bulk-hint" aria-haspopup={review ? "dialog" : undefined} title={missing ?? undefined} className={`h-10 ${joined ? "-ml-2 rounded-l-none rounded-r-[8px]" : "rounded-[8px]"} bg-module px-4 text-[14.5px] font-semibold text-white hover:bg-[#4c2398] disabled:cursor-not-allowed disabled:bg-[#c9b8ea]`}>Go</button>
      <span id="bulk-hint" className={compact && !selected ? "sr-only" : "text-[13px] text-[#667085]"} data-testid="bulk-hint">{missing ?? (review ? `Ready: review ${action?.label.toLowerCase()} for ${selected} ${noun}${selected === 1 ? "" : "s"}.` : `Ready: ${action?.label.toLowerCase()} for ${selected} ${noun}${selected === 1 ? "" : "s"}.`)}</span>
      {confirming && action ? (
        <TemplateBulkConfirm
          label={action.label}
          count={selected}
          details={confirming}
          onCancel={() => setConfirming(null)}
          onContinue={() => {
            setConfirmed(true);
            setConfirming(null);
            // Submit after React has written confirmed=1 into the form.
            setTimeout(() => (document.getElementById(form) as HTMLFormElement | null)?.requestSubmit(), 0);
          }}
        />
      ) : null}
      {review && request ? <BulkReviewDialog form={form} itemName={itemName} request={request} onClose={() => setRequest(null)} /> : null}
    </div>
  );
}

/**
 * Confirm Template Changes for a bulk change to templates. Bulk changes are Template Only: built visits are not changed,
 * because each template's future visits need their own review (open a single template and choose Template + Future Rota).
 */
function TemplateBulkConfirm({ label, count, details, onCancel, onContinue }: { label: string; count: number; details: [string, string][]; onCancel: () => void; onContinue: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="tpl-bulk-title" data-testid="template-bulk-confirm" className="m-auto w-[min(560px,calc(100vw-24px))] rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40">
      <div className="px-5 py-4">
        <h2 id="tpl-bulk-title" className="text-[19px] font-bold">Confirm Template Changes</h2>
        <p className="mt-2 text-[15px]">Are you sure you want to save these changes to {count === 1 ? "this template" : `these ${count} templates`}?</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[14.5px]">
          <dt className="font-medium">Change</dt><dd>{label}</dd>
          {details.map(([k, v]) => <Fragment key={k}><dt className="font-medium">{k}</dt><dd className="font-semibold">{v}</dd></Fragment>)}
        </dl>
        <p className="mt-3 rounded-[8px] bg-[#f7f4fe] px-3 py-2 text-[14px] text-[#3d1880]"><strong>Template only.</strong> Existing scheduled visits will not be changed. To update built visits too, open one template, edit it and choose Template + future rota.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#eaecf0] px-5 py-3">
        <button type="button" onClick={onCancel} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold">Cancel</button>
        <button type="button" onClick={onContinue} className="h-10 rounded-[8px] bg-[#4b1f9e] px-4 text-[14.5px] font-semibold text-white hover:bg-[#3d1880]">Continue</button>
      </div>
    </dialog>
  );
}
