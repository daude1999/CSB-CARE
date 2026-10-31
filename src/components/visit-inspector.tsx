import type { ReactNode } from "react";
import { ArrowsLeftRight, CalendarBlank, CheckCircle, Clock, Hash, Hourglass, MapPin, Path, ShieldWarning, SignIn, SignOut, Stack, Trash, User, UserPlus, Users, X, ArrowsClockwise, CalendarDots, Circle, Notepad } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { fmtLondonDate, fromDbDate, hhmm, londonMinute, londonTime } from "@/lib/london";
import { assignCarerAction, cancelVisitAction, doubleUpAction, swapCarersAction, updateVisitAction, reinstateVisitAction } from "@/app/rota-actions";
import { NOTE_LABEL, OUTCOME_LABEL } from "@/server/care/visit-record";
import { suName } from "@/server/rota/queries";
import type { VisitInspectorData } from "@/server/rota/inspector";
import { READINESS_LABEL } from "@/server/readiness";
import { fmtDate } from "@/components/ui";

const STATUS: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: "Scheduled", cls: "bg-[#f3f0fc] text-[#5a3aa8] border-[#ddd6f6]" },
  IN_PROGRESS: { label: "In progress", cls: "bg-[#e9f1fc] text-[#1d4f91] border-[#c7dbf6]" },
  COMPLETED: { label: "Completed", cls: "bg-[#eaf6ee] text-[#1c7a43] border-[#cfe9d8]" },
  MISSED: { label: "Missed", cls: "bg-[#fdecec] text-[#a3242c] border-[#f3c9c9]" },
  NOT_DELIVERED: { label: "Not delivered", cls: "bg-[#f2f4f7] text-slate-700 border-[#e4e7ec]" },
  CANCELLED: { label: "Cancelled", cls: "bg-[#f2f4f7] text-slate-600 border-[#e4e7ec]" },
};
const RISK: Record<string, { label: string; colour: string }> = { LOW: { label: "Low risk", colour: "#1f9d4c" }, MEDIUM: { label: "Medium risk", colour: "#e0a526" }, HIGH: { label: "High risk", colour: "#d9473f" } };
const EVENT: Record<string, string> = { CREATED: "Visit created", ASSIGNED: "Carer assigned", REASSIGNED: "Carer replaced", EDITED: "Visit changed", UNASSIGNED: "Carer removed", SWAPPED: "Carers swapped", PUBLISHED: "Published to carers", STATUS: "Status changed", CLOCK: "Clock recorded", TASKS: "Tasks recorded" };
const STATE_WORD = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;
const SLOT = { PRIMARY: "Carer 1", SECOND: "Carer 2", SHADOW: "Shadow" } as const;
const TABS = [
  ["details", "Details"],
  ["notes", "Notes"],
  ["tasks", "Care tasks"],
  ["history", "History"],
] as const;

const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} hour${m >= 120 ? "s" : ""}${m % 60 ? ` ${m % 60}m` : ""} (${m}m)` : `${m} minutes`);

function Cell({ icon, label, children, className = "" }: { icon: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 items-start gap-2.5 px-3 py-1.5 ${className}`}>
      <span aria-hidden className="mt-1 shrink-0 text-[#475467]">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[12px] text-[#475467]">{label}</dt>
        <dd className="truncate text-[14px] font-semibold text-[#0b1530]">{children}</dd>
      </div>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 divide-x divide-[#eef0f3] rounded-[8px] border border-[#e4e7ec] [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-[#eef0f3]">{children}</dl>;
}

/** A pop-over for one action. A native disclosure, so it works without JavaScript and from the keyboard. */
function ActionPop({ label, icon, tone = "secondary", children, align = "left" }: { label: string; icon: ReactNode; tone?: "primary" | "secondary" | "danger"; children: ReactNode; align?: "left" | "right" }) {
  const cls = tone === "primary" ? "border-[#6b3fd0] bg-[#6b3fd0] text-white hover:bg-[#5a33b5]" : tone === "danger" ? "border-[#e5484d] bg-white text-[#c8323a] hover:bg-[#fdeeee]" : "border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50";
  return (
    <details className="group relative">
      <summary className={`flex h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-[8px] border px-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden ${cls}`}>
        <span aria-hidden>{icon}</span>{label}
      </summary>
      <div className={`absolute bottom-12 z-40 w-[340px] max-w-[85vw] rounded-[10px] border border-[#e4e7ec] bg-white p-3 text-[14px] shadow-[0_8px_24px_rgba(16,24,40,0.18)] ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>
    </details>
  );
}

/**
 * The Daily Rota's Visit Details panel. Every action posts to the same server actions as the visit page, so the
 * eligibility check, row locks, concurrency check and audit history all apply unchanged. After an action the page comes
 * back to the same day with this visit still selected.
 */
export function VisitInspector({ data, tab, back, closeHref }: { data: VisitInspectorData; tab: string; back: string; closeHref: string }) {
  const { visit: v, live, flags, editable, assignable, canEdit, candidates, swaps, names } = data;
  const st = STATUS[v.status] ?? STATUS.SCHEDULED!;
  const date = fromDbDate(v.date);
  const planned = mins(v.scheduledStart, v.scheduledEnd);
  const carers = live.filter((a) => a.slot !== "SHADOW");
  const shadow = live.find((a) => a.slot === "SHADOW");
  const acked = carers.length > 0 && carers.every((a) => a.acknowledgedAt);
  const risk = v.serviceUser.riskLevel ? RISK[v.serviceUser.riskLevel] : null;
  const who = (u: string | null | undefined) => (u ? names.get(u) ?? "Former member" : "System");
  const activeTab = TABS.some(([k]) => k === tab) ? tab : "details";
  const tabHref = (k: string) => `${back}${back.includes("?") ? "&" : "?"}tab=${k}`.replace(/([?&])tab=[^&]*&(?=.*tab=)/, "$1");
  const hidden = (
    <>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="visitId" value={v.id} />
      <input type="hidden" name="lockVersion" value={v.lockVersion} />
    </>
  );
  const openSlots = data.slots.filter((s) => !live.some((a) => a.slot === s));

  return (
    <aside aria-labelledby="vi-title" className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7ec] bg-white xl:max-h-[max(560px,calc(100vh-310px))]">
      <div className="flex items-center gap-2 border-b border-[#eef0f3] px-4 py-3">
        <CalendarBlank size={22} weight="bold" className="text-[#6b3fd0]" aria-hidden />
        <h2 id="vi-title" className="text-[18px] font-bold text-[#0b1530]">Visit Details</h2>
        <Link href={`/rota/visits/${v.id}`} className="ml-auto text-[13px] font-medium text-[#5a3aa8] no-underline hover:underline">Open full visit</Link>
        <Link href={closeHref} aria-label="Close visit details" className="flex h-8 w-8 items-center justify-center rounded-full text-[#344054] hover:bg-slate-100"><X size={18} aria-hidden /></Link>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f3f0fc] text-[#5a3aa8]"><User size={22} weight="bold" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold text-[#0b1530]">{suName(v.serviceUser)}</p>
          <p className="truncate text-[13.5px] text-[#475467]">{v.callType.name} · {londonTime(v.scheduledStart)} – {londonTime(v.scheduledEnd)} ({planned >= 60 && planned % 60 === 0 ? `${planned / 60}h` : `${planned}m`})</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${st.cls}`}><CheckCircle size={15} aria-hidden weight={v.status === "COMPLETED" ? "fill" : "regular"} />{st.label}</span>
      </div>

      <nav aria-label="Visit details sections" className="flex border-b border-[#e4e7ec] px-3">
        {TABS.map(([k, label]) => (
          <Link key={k} href={tabHref(k)} aria-current={activeTab === k ? "page" : undefined} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-center text-[14px] no-underline ${activeTab === k ? "border-[#6b3fd0] font-semibold text-[#5a3aa8]" : "border-transparent text-[#344054] hover:text-[#0b1530]"}`}>
            {label}{k === "notes" && v.visitNotes.length ? ` (${v.visitNotes.length})` : k === "tasks" && v.tasks.length ? ` (${v.tasks.length})` : ""}
          </Link>
        ))}
      </nav>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {activeTab === "details" ? (
          <>
            {flags.review.length || flags.late ? (
              <ul className="space-y-1 rounded-[8px] bg-[#fdf4e3] px-3 py-2 text-[13px] text-[#7a4b00]">
                {flags.late ? <li>Late: {v.actualStart ? "started" : "not started"} more than the late threshold after {londonTime(v.scheduledStart)}.</li> : null}
                {flags.review.map((r) => <li key={r}>Needs review: {r}</li>)}
              </ul>
            ) : null}
            <Group>
              <Cell icon={<Hash size={18} />} label="Reference">{v.reference}</Cell>
              <Cell icon={<CalendarBlank size={18} />} label="Date">{fmtLondonDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })}</Cell>
              <Cell icon={<MapPin size={18} />} label="Area">{v.area?.name ?? "No area"}</Cell>
              <Cell icon={<Path size={18} />} label="Run route">{v.runRoute?.name ?? "None"}</Cell>
              <Cell icon={<ShieldWarning size={18} />} label="Risk">{risk ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ background: risk.colour }} />{risk.label}</span> : "Not rated"}</Cell>
              <Cell icon={<Stack size={18} />} label="Service call">{v.callType.name}</Cell>
            </Group>
            <Group>
              <Cell icon={<Clock size={18} />} label="Scheduled start">{londonTime(v.scheduledStart)}</Cell>
              <Cell icon={<Clock size={18} />} label="Scheduled end">{londonTime(v.scheduledEnd)}</Cell>
              <Cell icon={<Hourglass size={18} />} label="Scheduled duration">{dur(planned)}</Cell>
              <Cell icon={<SignIn size={18} />} label="Clock in">{v.actualStart ? londonTime(v.actualStart) : "Not yet"}</Cell>
              <Cell icon={<SignOut size={18} />} label="Clock out">{v.actualEnd ? londonTime(v.actualEnd) : v.actualStart ? "In progress" : "Not yet"}</Cell>
              <Cell icon={<Hourglass size={18} />} label="Actual duration">{v.actualStart && v.actualEnd ? dur(mins(v.actualStart, v.actualEnd)) : "—"}</Cell>
            </Group>
            <Group>
              <Cell icon={<Users size={18} />} label={v.carersRequired > 1 ? "Team members (2 needed)" : "Team member"} className="col-span-1">
                <span className="flex flex-wrap gap-1 whitespace-normal">
                  {carers.length ? carers.map((a) => <span key={a.id} className="rounded-[6px] bg-[#f3f0fc] px-1.5 py-0.5 text-[13px] text-[#5a3aa8]">{a.staff.displayName}</span>) : <span className="text-[#a3242c]">Unassigned</span>}
                  {openSlots.length && carers.length ? <span className="rounded-[6px] bg-[#fdf3e2] px-1.5 py-0.5 text-[13px] text-[#8a5a00]">{openSlots.length} slot open</span> : null}
                </span>
              </Cell>
              <Cell icon={<Circle size={18} />} label="Acknowledged">{carers.length ? (acked ? "Yes" : carers.some((a) => a.acknowledgedAt) ? "Partly" : "Not yet") : "—"}</Cell>
              <Cell icon={<Users size={18} />} label="Double-up">{v.carersRequired > 1 ? `Yes · ${carers.length} of 2 assigned` : "No"}</Cell>
              <Cell icon={<User size={18} />} label="Shadowing">{shadow ? shadow.staff.displayName : "No one"}</Cell>
            </Group>
            {v.notes ? <p className="rounded-[8px] bg-[#f7f8fa] px-3 py-2 text-[13.5px] text-[#344054]"><span className="font-semibold">Office notes: </span>{v.notes}</p> : null}
            {v.cancelReason ? <p className="rounded-[8px] bg-[#fdecec] px-3 py-2 text-[13.5px] text-[#a3242c]">Cancelled: {v.cancelReason}</p> : null}
            {!v.publishedAt && v.status === "SCHEDULED" ? <p className="text-[12.5px] text-slate-600">Not yet published to carers.</p> : null}
          </>
        ) : null}

        {activeTab === "notes" ? (
          v.visitNotes.length ? (
            <ul className="divide-y divide-[#eef0f3]">
              {v.visitNotes.map((n) => (
                <li key={n.id} className="py-2 text-[14px]">
                  <span className="text-[12.5px] text-slate-600">{NOTE_LABEL[n.category] ?? "Note"} · {who(n.authorUserId)} · {fmtDate(n.createdAt, true)}</span>
                  <p className="text-[#0b1530]">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : <p className="py-4 text-[14px] text-slate-600">No notes on this visit. <Link href={`/rota/visits/${v.id}#attendance`}>Add a note</Link> on the full visit page.</p>
        ) : null}

        {activeTab === "tasks" ? (
          v.tasks.length ? (
            <ul className="divide-y divide-[#eef0f3]">
              {v.tasks.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-[14px]">
                  <span className="text-[#0b1530]">{t.name}</span>
                  <span className="text-right text-[13px] text-slate-600">{t.outcomes[0] ? `${OUTCOME_LABEL[t.outcomes[0].outcome]} · ${fmtDate(t.outcomes[0].at, true)}` : "Not recorded"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="py-4 text-[14px] text-slate-600">No care tasks on this visit.</p>
        ) : null}

        {activeTab === "history" ? (
          v.events.length ? (
            <ol className="space-y-2 text-[13.5px]">
              {v.events.map((e) => (
                <li key={e.id} className="border-l-2 border-[#ddd6f6] pl-3">
                  <div className="font-semibold text-[#0b1530]">{EVENT[e.type] ?? e.type.toLowerCase()}{e.toStatus ? ` → ${(STATUS[e.toStatus]?.label ?? e.toStatus).toLowerCase()}` : ""}</div>
                  <div className="text-slate-600">{who(e.actorId)} · {fmtDate(e.createdAt, true)}</div>
                  {e.reason ? <div className="text-[#344054]">{e.reason}</div> : null}
                </li>
              ))}
            </ol>
          ) : <p className="py-4 text-[14px] text-slate-600">No history yet.</p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="grid grid-cols-2 gap-2 border-t border-[#eef0f3] px-3 py-3 sm:grid-cols-4">
          {assignable ? (
            <ActionPop label="Reassign" icon={<ArrowsClockwise size={18} />} tone="primary">
              <p className="mb-2 font-semibold">Choose a carer</p>
              {candidates.map(({ slot, list }) => {
                const current = live.find((a) => a.slot === slot);
                return (
                  <form key={slot} action={assignCarerAction} className="mb-3 space-y-1.5 last:mb-0">
                    {hidden}
                    <input type="hidden" name="slot" value={slot} />
                    <label className="block">
                      <span className="text-[12.5px] text-slate-600">{SLOT[slot]}{current ? ` · now ${current.staff.displayName}` : " · open"}</span>
                      <select name="staffId" required className="input py-1.5 text-[13.5px]">
                        <option value="">{current ? "Replace with…" : "Choose a carer…"}</option>
                        {list.map((c) => <option key={c.id} value={c.id} disabled={c.state === "NOT_ELIGIBLE"}>{c.score !== null ? `${c.score} · ` : ""}{c.name} — {STATE_WORD[c.state]}{c.readiness && c.readiness !== "READY" ? ` (${READINESS_LABEL[c.readiness].toLowerCase()})` : ""}{c.reasons.length ? `: ${c.reasons.slice(0, 2).join("; ")}` : ""}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> I have read the warnings</label>
                    <button className="btn-primary py-1 text-[13.5px]">{current ? "Replace" : "Assign"}</button>
                  </form>
                );
              })}
              <p className="mt-2 text-[12px] text-slate-500">Carers who are not eligible cannot be chosen. The check runs again when you save.</p>
            </ActionPop>
          ) : null}
          {editable ? (
            <ActionPop label="Move visit" icon={<CalendarDots size={18} />}>
              <form action={updateVisitAction} className="space-y-2">
                {hidden}
                <input type="hidden" name="callTypeId" value={v.callTypeId} />
                <input type="hidden" name="notes" value={v.notes ?? ""} />
                {v.timeLocked ? <input type="hidden" name="timeLocked" value="on" /> : null}
                {v.medicationRequired ? <input type="hidden" name="medicationRequired" value="on" /> : null}
                {v.alertOnLate ? <input type="hidden" name="alertOnLate" value="on" /> : null}
                <p className="font-semibold">Move to another day or time</p>
                <label className="block"><span className="text-[12.5px] text-slate-600">Date</span><input type="date" name="date" required defaultValue={date} className="input py-1.5" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="text-[12.5px] text-slate-600">Start</span><input type="time" name="start" required defaultValue={hhmm(londonMinute(v.scheduledStart))} className="input py-1.5" /></label>
                  <label><span className="text-[12.5px] text-slate-600">Minutes</span><input type="number" name="durationMin" min={5} max={1440} required defaultValue={planned} className="input py-1.5" /></label>
                </div>
                {v.timeLocked ? <p className="text-[12.5px] text-[#8a5a00]">This visit’s time is locked. Unlock it on the full visit page first.</p> : null}
                <button className="btn-primary py-1 text-[13.5px]">Move visit</button>
                <p className="text-[12px] text-slate-500">Every carer on the visit is checked for the new time. If one cannot do it, nothing changes.</p>
              </form>
            </ActionPop>
          ) : null}
          {editable && swaps.length ? (
            <ActionPop label="Swap shift" icon={<ArrowsLeftRight size={18} />} align="right">
              {swaps.map(({ slot, list }) => {
                const current = live.find((a) => a.slot === slot);
                return list.length ? (
                  <form key={slot} action={swapCarersAction} className="mb-3 space-y-1.5 last:mb-0">
                    {hidden}
                    <input type="hidden" name="slot" value={slot} />
                    <label className="block"><span className="text-[12.5px] text-slate-600">Swap {current?.staff.displayName ?? SLOT[slot]} with</span>
                      <select name="with" required className="input py-1.5 text-[13.5px]">
                        <option value="">Choose a visit…</option>
                        {list.map((c) => <option key={`${c.visitId}-${c.slot}`} value={`${c.visitId}|${c.slot}|${c.lockVersion}`}>{londonTime(c.start)}–{londonTime(c.end)} {c.serviceUser} · {c.carer}</option>)}
                      </select>
                    </label>
                    <input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason for the swap" className="input py-1.5 text-[13.5px]" />
                    <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> I have read the warnings</label>
                    <button className="btn-primary py-1 text-[13.5px]">Swap</button>
                  </form>
                ) : <p key={slot} className="mb-2 text-[13px] text-slate-600">No other visit with a carer within 12 hours to swap {current?.staff.displayName ?? "this carer"} with.</p>;
              })}
              <p className="text-[12px] text-slate-500">Both carers are checked for each other’s visit. If either cannot take it, nothing changes.</p>
            </ActionPop>
          ) : null}
          {editable ? (
            <ActionPop label="Cancel" icon={<Trash size={18} />} tone="danger" align="right">
              <form action={cancelVisitAction} className="space-y-2">
                {hidden}
                <p className="font-semibold">Cancel this visit</p>
                <label className="block"><span className="text-[12.5px] text-slate-600">Reason</span><input name="reason" required minLength={3} placeholder="e.g. In hospital" className="input py-1.5" /></label>
                <button className="btn-danger py-1 text-[13.5px]">Cancel visit</button>
              </form>
            </ActionPop>
          ) : null}
          {editable && v.carersRequired === 1 ? (
            <form action={doubleUpAction} className="col-span-2 sm:col-span-4">
              {hidden}
              <input type="hidden" name="carersRequired" value="2" />
              <button className="flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#b9a8ee] text-[13.5px] font-semibold text-[#5a3aa8] hover:bg-[#f6f3fd]"><UserPlus size={17} aria-hidden />Add a second carer (make a double-up)</button>
            </form>
          ) : null}
          {canEdit && ["CANCELLED", "NOT_DELIVERED"].includes(v.status) && v.scheduledStart > new Date() ? (
            <form action={reinstateVisitAction} className="col-span-2 sm:col-span-4">
              {hidden}
              <button className="btn-secondary w-full">Reinstate visit</button>
            </form>
          ) : null}
          {!assignable && !editable && !["CANCELLED", "NOT_DELIVERED"].includes(v.status) ? <p className="col-span-2 text-[12.5px] text-slate-600 sm:col-span-4"><Notepad size={14} className="mr-1 inline" aria-hidden />{STATUS[v.status]?.label ?? v.status} visits cannot be moved or reassigned. Clock corrections are on the full visit page.</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
