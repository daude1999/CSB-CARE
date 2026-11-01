"use client";

import { useEffect, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

/** Each bulk action and the extra details it needs. The server checks everything again. */
const ACTIONS = [
  { kind: "cancel", label: "Cancel Visits", needs: ["reason"] },
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
  { kind: "nudge", label: "Nudge Times", needs: ["minutes"] },
  { kind: "publish", label: "Publish to carers", needs: [] },
] as const;

type Kind = (typeof ACTIONS)[number]["kind"];
type Option = { id: string; name: string };

const FIELD = "h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#101828]";

/** Counts the ticked visit checkboxes that belong to the bulk form, wherever they sit on the page. */
function useSelectedCount(form: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const recount = () => setCount(document.querySelectorAll(`input[type=checkbox][form="${form}"][name="visitIds"]:checked`).length);
    recount();
    document.addEventListener("change", recount);
    document.addEventListener("selectall:change", recount);
    return () => {
      document.removeEventListener("change", recount);
      document.removeEventListener("selectall:change", recount);
    };
  }, [form]);
  return count;
}

/**
 * The Daily Rota's bulk actions bar. Choosing an action shows the details it needs (a carer for Reassign, a time for Edit
 * Times, and so on) right next to it, and Go stays off until visits are ticked and those details are filled in, saying
 * why. It must sit inside the bulk form; the form posts to the same server action, which re-checks every visit.
 */
export function BulkVisitBar({ form, staff, callTypes, canPublish }: { form: string; staff: Option[]; callTypes: Option[]; canPublish: boolean }) {
  const selected = useSelectedCount(form);
  const [kind, setKind] = useState<Kind | "">("");
  const [staffId, setStaffId] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [callTypeId, setCallTypeId] = useState("");
  const [reason, setReason] = useState("");
  const action = ACTIONS.find((a) => a.kind === kind);
  const needs = new Set<string>(action?.needs ?? []);

  const missing =
    !selected ? "Tick the visits to change first."
    : !action ? "Choose a bulk action."
    : needs.has("staff") && !staffId ? "Choose a carer."
    : needs.has("time") && !time ? "Choose the new start time."
    : needs.has("duration") && !duration ? "Enter the new length in minutes."
    : needs.has("service") && !callTypeId ? "Choose a service call."
    : needs.has("reason") && reason.trim().length < 3 ? "Give a reason (at least 3 letters)."
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-10 items-center rounded-[8px] bg-[#f2f4f7] px-3 text-[13.5px] font-semibold text-[#344054]" data-testid="bulk-selected" aria-live="polite">
        {selected} selected
      </span>
      <label className="relative">
        <span className="sr-only">Bulk action</span>
        <select name="kind" aria-label="Bulk action" required value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} className="h-10 w-[210px] appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px] text-[#101828]">
          <option value="" disabled>Bulk Actions…</option>
          {ACTIONS.filter((a) => a.kind !== "publish" || canPublish).map((a) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
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
      {needs.has("slot") ? (
        <label><span className="sr-only">Carer place</span>
          <select aria-label="Carer place" name="slot" defaultValue="PRIMARY" className={`${FIELD} w-[120px]`}>
            <option value="PRIMARY">Carer 1</option>
            <option value="SECOND">Carer 2</option>
            {kind === "unassign" ? <option value="SHADOW">Shadow</option> : null}
          </select>
        </label>
      ) : null}
      {needs.has("time") ? <label><span className="sr-only">New start time</span><input aria-label="New start time" type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} /></label> : null}
      {needs.has("duration") ? <label><span className="sr-only">New length in minutes</span><input aria-label="New length in minutes" type="number" name="duration" min={5} max={1440} step={5} placeholder="Minutes" value={duration} onChange={(e) => setDuration(e.target.value)} className={`${FIELD} w-[110px]`} /></label> : null}
      {needs.has("minutes") ? <label className="flex items-center gap-1.5 text-[13.5px] text-[#344054]">Move by<input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} aria-label="Minutes to move by (minus for earlier)" className={`${FIELD} w-[90px]`} />min</label> : null}
      {needs.has("service") ? (
        <label><span className="sr-only">Service call</span>
          <select aria-label="Service call" name="callTypeId" value={callTypeId} onChange={(e) => setCallTypeId(e.target.value)} className={`${FIELD} w-[180px]`}>
            <option value="">Choose a service call…</option>
            {callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      ) : null}
      {needs.has("reason") || needs.has("reasonOptional") ? <label><span className="sr-only">Reason</span><input aria-label="Reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needs.has("reason") ? "Reason" : "Reason (optional)"} className={`${FIELD} w-[200px]`} /></label> : null}
      {needs.has("warnings") ? <label className="flex items-center gap-1.5 text-[13.5px] text-[#344054]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept warnings</label> : null}

      <button disabled={Boolean(missing)} aria-describedby="bulk-hint" className="h-10 rounded-[8px] bg-[#5b2bb5] px-4 text-[14.5px] font-semibold text-white hover:bg-[#4c2398] disabled:cursor-not-allowed disabled:bg-[#c9b8ea]">Go</button>
      <span id="bulk-hint" className="text-[13px] text-[#667085]" data-testid="bulk-hint">{missing ?? `Ready: ${action?.label.toLowerCase()} for ${selected} visit${selected === 1 ? "" : "s"}.`}</span>
    </div>
  );
}
