import type { ReactNode } from "react";
import { ArrowSquareOut, ArrowsLeftRight, CalendarBlank, Circle, Clock, FirstAidKit, Heartbeat, MapPin, NotePencil, PencilSimple, Plus, ShieldWarning, SignIn, Trash, User, UserPlus, Users, UsersThree, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { fmtLondonDate, fromDbDate, hhmm, londonMinute, londonTime } from "@/lib/london";
import { addVisitNoteAction, assignCarerAction, cancelVisitAction, doubleUpAction, swapCarersAction, unassignCarerAction, updateVisitAction, reinstateVisitAction } from "@/app/rota-actions";
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

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 py-[7px]">
      <span aria-hidden className="mt-[1px] shrink-0 text-[#344054]">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="sr-only">{label}</dt>
        <dd className="text-[14.5px] text-[#101828]">{children}</dd>
      </div>
    </div>
  );
}

/** A pop-over for one action. A native disclosure, so it works without JavaScript and from the keyboard. */
function ActionPop({ label, icon, tone = "secondary", children, align = "left", size = "md", className = "" }: { label: string; icon: ReactNode; tone?: "primary" | "secondary" | "danger" | "outline" | "link"; children: ReactNode; align?: "left" | "right"; size?: "md" | "lg"; className?: string }) {
  const cls = {
    primary: "border-[#5b2bb5] bg-[#5b2bb5] text-white hover:bg-[#4c2398]",
    outline: "border-[#5b2bb5] bg-white text-[#5b2bb5] hover:bg-[#f6f2fd]",
    danger: "border-transparent bg-transparent text-[#b42318] hover:bg-[#fdeeee]",
    link: "border-transparent bg-transparent text-[#5b2bb5] hover:bg-[#f6f2fd]",
    secondary: "border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50",
  }[tone];
  return (
    <details className={`group relative ${className}`}>
      <summary className={`flex ${size === "lg" ? "h-11 text-[15px]" : "h-9 text-[14px]"} cursor-pointer list-none items-center justify-center gap-2 rounded-[8px] border px-3 font-semibold [&::-webkit-details-marker]:hidden ${cls}`}>
        <span aria-hidden>{icon}</span>{label}
      </summary>
      <div className={`absolute bottom-12 z-40 w-[340px] max-w-[85vw] rounded-[10px] border border-[#e4e7ec] bg-white p-3 text-[14px] shadow-[0_8px_24px_rgba(16,24,40,0.18)] ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>
    </details>
  );
}

/**
 * The Daily Rota's Visit Details drawer, laid out to the owner's approved reference. Every action posts to the same
 * server actions as the visit page, so the eligibility check, row locks, concurrency check and audit history all apply
 * unchanged. Completed, missed-and-closed and cancelled visits cannot be moved or re-staffed here. After an action the
 * page comes back to the same day, filters and visit.
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
  const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  const done = v.tasks.filter((t) => t.outcomes[0]?.outcome === "DONE").length;

  const assignForm = (slot: (typeof data.slots)[number]) => {
    const list = candidates.find((c) => c.slot === slot)?.list ?? [];
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
  };

  return (
    <aside aria-labelledby="vi-title" className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)] xl:max-h-[calc(100vh-150px)]">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <CalendarBlank size={22} weight="duotone" className="text-[#5b2bb5]" aria-hidden />
        <h2 id="vi-title" className="text-[18px] font-bold text-[#101828]">Visit Details</h2>
        <Link href={closeHref} aria-label="Close visit details" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[#344054] hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5b2bb5]"><X size={19} weight="bold" aria-hidden /></Link>
      </div>

      <div className="flex items-start gap-3 px-4 pb-2.5 pt-1.5">
        <User size={24} aria-hidden className="mt-0.5 shrink-0 text-[#5b2bb5]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-[#101828]"><Link href={`/rota/service-users/${v.serviceUser.id}`} className="text-inherit no-underline hover:underline">{suName(v.serviceUser)}</Link></p>
          <p className="text-[13px] text-[#475467]">Ref: <span className="tabular-nums">{v.reference}</span></p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${st.cls}`}><span aria-hidden className="h-2 w-2 rounded-full bg-current" />{st.label}</span>
      </div>

      <nav aria-label="Visit details sections" className="flex border-b border-[#e4e7ec] px-3">
        {TABS.map(([k, label]) => (
          <Link key={k} href={tabHref(k)} aria-current={activeTab === k ? "page" : undefined} className={`-mb-px flex-1 whitespace-nowrap border-b-2 px-1.5 py-1.5 text-center text-[13.5px] no-underline ${activeTab === k ? "border-[#5b2bb5] font-semibold text-[#5b2bb5]" : "border-transparent text-[#344054] hover:text-[#101828]"}`}>
            {label}{k === "notes" && v.visitNotes.length ? ` (${v.visitNotes.length})` : k === "tasks" && v.tasks.length ? ` (${v.tasks.length})` : ""}
          </Link>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {activeTab === "details" ? (
          <>
            {flags.review.length || flags.late ? (
              <ul className="mb-1.5 mt-1 space-y-1 rounded-[8px] bg-[#fdf4e3] px-3 py-2 text-[13px] text-[#7a4b00]">
                {flags.late ? <li>Late: {v.actualStart ? "started" : "not started"} more than the late threshold after {londonTime(v.scheduledStart)}.</li> : null}
                {flags.review.map((r) => <li key={r}>Needs review: {r}</li>)}
              </ul>
            ) : null}
            <dl>
              <Row icon={<CalendarBlank size={19} />} label="Date">{fmtLondonDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</Row>
              <Row icon={<Clock size={19} />} label="Scheduled time">{londonTime(v.scheduledStart)} – {londonTime(v.scheduledEnd)} ({hm(planned)})</Row>
              <Row icon={<MapPin size={19} />} label="Area">{v.area?.name ?? "No area"}{v.runRoute ? <span className="text-[#475467]"> · {v.runRoute.name}</span> : null}</Row>
              <Row icon={<Heartbeat size={19} />} label="Service call">{v.callType.name}{v.medicationRequired ? <span className="text-[#475467]"> · medication prompt</span> : null}</Row>
              <Row icon={<ShieldWarning size={19} />} label="Risk">{risk ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: risk.colour }} />{risk.label}</span> : <span className="text-[#475467]">Risk not rated</span>}</Row>
              <Row icon={<SignIn size={19} />} label="Clock in and out">{v.actualStart ? <>In {londonTime(v.actualStart)} · {v.actualEnd ? <>Out {londonTime(v.actualEnd)} ({hm(mins(v.actualStart, v.actualEnd))})</> : "not clocked out"}</> : <span className="text-[#475467]">Not clocked in</span>}</Row>
              <Row icon={<Users size={19} weight="bold" />} label="Carers">
                <span className="font-semibold">Carers ({carers.length} of {v.carersRequired})</span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {carers.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-[#eef0f4] py-0.5 pl-2.5 pr-1 text-[13px] text-[#101828]">
                      <Link href={`/rota/staff/${a.staff.id}`} className="text-inherit no-underline hover:underline">{a.staff.displayName}</Link>{a.acknowledgedAt ? <span className="sr-only"> (acknowledged)</span> : null}
                      {assignable ? (
                        <form action={unassignCarerAction} className="inline-flex">
                          {hidden}
                          <input type="hidden" name="slot" value={a.slot} />
                          <button aria-label={`Remove ${a.staff.displayName} from this visit`} title="Remove from this visit" className="flex h-5 w-5 items-center justify-center rounded-full text-[#344054] hover:bg-white"><X size={12} weight="bold" aria-hidden /></button>
                        </form>
                      ) : <span className="w-1" />}
                    </span>
                  ))}
                  {!carers.length ? <span className="text-[13px] font-medium text-[#b42318]">No carer assigned</span> : null}
                </span>
                {assignable && openSlots.length ? (
                  <ActionPop label="Add Carer" icon={<Plus size={16} weight="bold" />} tone="outline" className="mt-2 inline-block [&>summary]:rounded-full [&>summary]:px-4">
                    <p className="mb-2 font-semibold">Add a carer</p>
                    {openSlots.map((s) => assignForm(s))}
                    <p className="mt-2 text-[12px] text-slate-500">Carers who are not eligible cannot be chosen. The check runs again when you save.</p>
                  </ActionPop>
                ) : editable && v.carersRequired === 1 ? (
                  <form action={doubleUpAction} className="mt-2">
                    {hidden}
                    <input type="hidden" name="carersRequired" value="2" />
                    <button className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#5b2bb5] px-4 text-[14px] font-semibold text-[#5b2bb5] hover:bg-[#f6f2fd]" title="Make this a double-up, then choose the second carer"><Plus size={16} weight="bold" aria-hidden />Add Carer</button>
                  </form>
                ) : null}
              </Row>
              {shadow ? <Row icon={<UserPlus size={19} />} label="Shadowing">Shadowing: {shadow.staff.displayName}</Row> : null}
              <Row icon={<Circle size={19} />} label="Acknowledged">{carers.length ? (acked ? "Acknowledged by the carer" + (carers.length > 1 ? "s" : "") : carers.some((a) => a.acknowledgedAt) ? "Partly acknowledged" : "Not acknowledged yet") : <span className="text-[#475467]">Nobody to acknowledge</span>}</Row>
              {v.tasks.length ? <Row icon={<FirstAidKit size={19} />} label="Care tasks"><Link href={tabHref("tasks")} className="text-inherit">{done} of {v.tasks.length} care tasks done</Link></Row> : null}
            </dl>
            {v.notes ? <p className="mt-1.5 rounded-[8px] bg-[#f7f8fa] px-3 py-2 text-[13.5px] text-[#344054]"><span className="font-semibold">Office notes: </span>{v.notes}</p> : null}
            {v.cancelReason ? <p className="mt-1.5 rounded-[8px] bg-[#fdecec] px-3 py-2 text-[13.5px] text-[#a3242c]">Cancelled: {v.cancelReason}</p> : null}
            {!v.publishedAt && v.status === "SCHEDULED" ? <p className="mt-1.5 text-[12.5px] text-slate-600">Not yet published to carers.</p> : null}
          </>
        ) : null}

        {activeTab === "notes" ? (
          v.visitNotes.length ? (
            <ul className="divide-y divide-[#eef0f3]">
              {v.visitNotes.map((n) => (
                <li key={n.id} className="py-2 text-[14px]">
                  <span className="text-[12.5px] text-slate-600">{NOTE_LABEL[n.category] ?? "Note"} · {who(n.authorUserId)} · {fmtDate(n.createdAt, true)}</span>
                  <p className="text-[#101828]">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : <p className="py-4 text-[14px] text-slate-600">No notes on this visit yet.</p>
        ) : null}

        {activeTab === "tasks" ? (
          v.tasks.length ? (
            <>
              <p className="pt-2 text-[13px] text-[#475467]">{done} of {v.tasks.length} done · {v.tasks.filter((t) => !t.outcomes[0]).length} not recorded</p>
              <ul className="divide-y divide-[#eef0f3]">
                {v.tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-[14px]">
                    <span className="text-[#101828]">{t.name}</span>
                    <span className={`text-right text-[13px] ${t.outcomes[0]?.outcome === "DONE" ? "text-[#14713a]" : t.outcomes[0] ? "text-[#8a5a00]" : "text-slate-600"}`}>{t.outcomes[0] ? `${OUTCOME_LABEL[t.outcomes[0].outcome]} · ${fmtDate(t.outcomes[0].at, true)}` : "Not recorded"}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="py-4 text-[14px] text-slate-600">No care tasks on this visit.</p>
        ) : null}

        {activeTab === "history" ? (
          v.events.length ? (
            <ol className="space-y-2 py-2 text-[13.5px]">
              {v.events.map((e) => (
                <li key={e.id} className="border-l-2 border-[#ddd6f6] pl-3">
                  <div className="font-semibold text-[#101828]">{EVENT[e.type] ?? e.type.toLowerCase()}{e.toStatus ? ` → ${(STATUS[e.toStatus]?.label ?? e.toStatus).toLowerCase()}` : ""}</div>
                  <div className="text-slate-600">{who(e.actorId)} · {fmtDate(e.createdAt, true)}</div>
                  {e.reason ? <div className="text-[#344054]">{e.reason}</div> : null}
                </li>
              ))}
            </ol>
          ) : <p className="py-4 text-[14px] text-slate-600">No history yet.</p>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-[#eef0f3] px-4 py-3">
        {assignable ? (
          <ActionPop label="Reassign Carers" icon={<UsersThree size={20} weight="fill" />} tone="primary" size="lg">
            <p className="mb-2 font-semibold">Choose a carer for each place</p>
            {data.slots.map((s) => assignForm(s))}
            <p className="mt-2 text-[12px] text-slate-500">Carers who are not eligible cannot be chosen. The check runs again when you save.</p>
          </ActionPop>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {editable ? (
            <ActionPop label="Edit Visit" icon={<PencilSimple size={18} />} tone="outline">
              <form action={updateVisitAction} className="space-y-2">
                {hidden}
                <input type="hidden" name="callTypeId" value={v.callTypeId} />
                {v.timeLocked ? <input type="hidden" name="timeLocked" value="on" /> : null}
                {v.medicationRequired ? <input type="hidden" name="medicationRequired" value="on" /> : null}
                {v.alertOnLate ? <input type="hidden" name="alertOnLate" value="on" /> : null}
                <p className="font-semibold">Change the day, time or length</p>
                <label className="block"><span className="text-[12.5px] text-slate-600">Date</span><input type="date" name="date" required defaultValue={date} className="input py-1.5" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="text-[12.5px] text-slate-600">Start</span><input type="time" name="start" required defaultValue={hhmm(londonMinute(v.scheduledStart))} className="input py-1.5" /></label>
                  <label><span className="text-[12.5px] text-slate-600">Minutes</span><input type="number" name="durationMin" min={5} max={1440} required defaultValue={planned} className="input py-1.5" /></label>
                </div>
                <label className="block"><span className="text-[12.5px] text-slate-600">Office notes</span><textarea name="notes" defaultValue={v.notes ?? ""} rows={2} className="input py-1.5" /></label>
                {v.timeLocked ? <p className="text-[12.5px] text-[#8a5a00]">This visit’s time is locked. Unlock it on the full visit page first.</p> : null}
                <button className="btn-primary py-1 text-[13.5px]">Save visit</button>
                <p className="text-[12px] text-slate-500">Every carer on the visit is checked for the new time. If one cannot do it, nothing changes. <Link href={`/rota/visits/${v.id}`}>All visit settings</Link></p>
              </form>
            </ActionPop>
          ) : <Link href={`/rota/visits/${v.id}`} className="flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#5b2bb5] text-[14px] font-semibold text-[#5b2bb5] no-underline hover:bg-[#f6f2fd]"><ArrowSquareOut size={18} aria-hidden />View Visit</Link>}
          {canEdit ? (
            <ActionPop label="Add Note" icon={<NotePencil size={18} />} tone="outline" align="right">
              <form action={addVisitNoteAction} className="space-y-2">
                {hidden}
                <p className="font-semibold">Add a note to this visit</p>
                <label className="block"><span className="text-[12.5px] text-slate-600">Type</span>
                  <select name="category" className="input py-1.5"><option value="GENERAL">Note</option><option value="HANDOVER">Handover</option><option value="CONCERN">Concern (raises an exception)</option></select>
                </label>
                <label className="block"><span className="text-[12.5px] text-slate-600">Note</span><textarea name="text" required minLength={2} rows={3} className="input py-1.5" /></label>
                <button className="btn-primary py-1 text-[13.5px]">Add note</button>
              </form>
            </ActionPop>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <Link href={`/rota/visits/${v.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-[#5b2bb5] no-underline hover:bg-[#f6f2fd]"><ArrowSquareOut size={16} aria-hidden />Full visit</Link>
          {editable && swaps.length ? (
            <ActionPop label="Swap shift" icon={<ArrowsLeftRight size={16} />} tone="link" className="[&>summary]:h-8 [&>summary]:px-2 [&>summary]:text-[13px]">
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
          {editable && v.carersRequired > 1 && carers.length < 2 ? (
            <form action={doubleUpAction}>
              {hidden}
              <input type="hidden" name="carersRequired" value="1" />
              <button className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-[#5b2bb5] hover:bg-[#f6f2fd]" title="Change this visit back to one carer">Make single</button>
            </form>
          ) : null}
          {editable ? (
            <ActionPop label="Cancel visit" icon={<Trash size={16} />} tone="danger" align="right" className="ml-auto [&>summary]:h-8 [&>summary]:px-2 [&>summary]:text-[13px]">
              <form action={cancelVisitAction} className="space-y-2">
                {hidden}
                <p className="font-semibold">Cancel this visit</p>
                <label className="block"><span className="text-[12.5px] text-slate-600">Reason</span><input name="reason" required minLength={3} placeholder="e.g. In hospital" className="input py-1.5" /></label>
                <button className="btn-danger py-1 text-[13.5px]">Cancel visit</button>
              </form>
            </ActionPop>
          ) : null}
          {canEdit && ["CANCELLED", "NOT_DELIVERED"].includes(v.status) && v.scheduledStart > new Date() ? (
            <form action={reinstateVisitAction} className="ml-auto">
              {hidden}
              <button className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] font-semibold text-[#5b2bb5] hover:bg-[#f6f2fd]">Reinstate visit</button>
            </form>
          ) : null}
        </div>
        {canEdit && !assignable && !editable && !["CANCELLED", "NOT_DELIVERED"].includes(v.status) ? <p className="text-[12.5px] text-slate-600">{st.label} visits cannot be moved or re-staffed. Clock corrections are on the full visit page.</p> : null}
      </div>
    </aside>
  );
}
