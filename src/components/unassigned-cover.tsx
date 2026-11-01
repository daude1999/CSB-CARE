import type { ReactNode } from "react";
import { ArrowLeft, CalendarBlank, CheckCircle, Clock, Heartbeat, Info, MagnifyingGlass, MapPin, ShieldWarning, UserPlus, Users, WarningCircle, X, XCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { Ctx } from "@/server/auth/rbac";
import { fmtLondonDate, fromDbDate, londonTime } from "@/lib/london";
import { suName, type Candidate } from "@/server/rota/queries";
import { coverOptions, headline, type CheckState } from "@/server/rota/unassigned-cover";
import { priorityOf, PRIORITY_LABEL } from "@/server/rota/unassigned";
import { confirmCoverAction } from "@/app/rota-actions";

const SLOT_LABEL = { PRIMARY: "Carer 1", SECOND: "Carer 2", SHADOW: "Shadow" } as const;
const STATE = { ELIGIBLE: { label: "Eligible", cls: "bg-[#e7f6ec] text-[#14713a]" }, REQUIRES_REVIEW: { label: "Check first", cls: "bg-[#fdf3d8] text-[#8a5a00]" }, NOT_ELIGIBLE: { label: "Not eligible", cls: "bg-[#fdecec] text-[#b42318]" } } as const;
const RISK: Record<string, string> = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" };
const CHECK_ICON: Record<CheckState, ReactNode> = {
  ok: <CheckCircle size={18} weight="fill" className="text-[#14713a]" aria-hidden />,
  warn: <WarningCircle size={18} weight="fill" className="text-[#b54708]" aria-hidden />,
  fail: <XCircle size={18} weight="fill" className="text-[#b42318]" aria-hidden />,
  info: <Info size={18} className="text-[#475467]" aria-hidden />,
};
const CHECK_WORD: Record<CheckState, string> = { ok: "Passed", warn: "Warning", fail: "Fails", info: "Note" };

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 py-[5px] text-[14px] text-[#101828]">
      <span aria-hidden className="mt-[1px] shrink-0 text-[#344054]">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The conflict or availability point that matters most for a carer, from their eligibility reasons. */
function availability(c: Candidate) {
  const r = c.reasons.find((x) => /^(Already booked|On approved|Has requested|Not available|Outside their usual)/.test(x));
  return r ?? (c.state === "NOT_ELIGIBLE" ? "Available, but other checks fail" : "Available at this time");
}

/**
 * Find Cover, in the Daily Rota's inspector style: the selected visit, then Recommended | Manual, then Review
 * Assignment. Everything is in the URL (cover, slot, ctab, pick, mq), so it works from the keyboard and without
 * scripts, and a reload never loses the coordinator's place. Nothing is booked until Confirm on the review step.
 */
export async function UnassignedCover({ ctx, sp, back, url }: { ctx: Ctx; sp: Record<string, string | undefined>; back: string; url: (p?: Record<string, string | undefined>) => string }) {
  const data = await coverOptions(ctx, sp.cover ?? "", { slot: sp.slot, q: sp.mq, pick: sp.pick });
  const close = url({ cover: undefined, slot: undefined, ctab: undefined, pick: undefined, mq: undefined, ptab: undefined });
  const shell = (body: ReactNode, footer?: ReactNode) => (
    <aside aria-labelledby="fc-title" className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)] xl:max-h-[calc(100vh-150px)]">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <UserPlus size={22} weight="duotone" className="text-[#5b2bb5]" aria-hidden />
        <h2 id="fc-title" className="text-[18px] font-bold text-[#101828]">Find Cover</h2>
        <Link href={close} aria-label="Close Find Cover" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[#344054] hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5b2bb5]"><X size={19} weight="bold" aria-hidden /></Link>
      </div>
      <div className="flex-1 overflow-y-auto">{body}</div>
      {footer ? <div className="border-t border-[#eef0f3] px-4 py-3">{footer}</div> : null}
    </aside>
  );
  if (!data) return shell(<p className="px-4 pb-4 text-[14px] text-slate-600">That visit is not available to you, or no longer exists.</p>);

  const { visit: v, live, openSlots, slot, assignable } = data;
  const p = priorityOf({ status: v.status, scheduledStart: v.scheduledStart, riskLevel: v.serviceUser.riskLevel }, new Date());
  const planned = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  const ctab = sp.ctab === "manual" ? "manual" : sp.ctab === "review" && data.pick ? "review" : "rec";
  const pickId = data.pick?.candidate.id;

  const visitBlock = (
    <section aria-label="Selected visit" className="mx-4 mb-2 rounded-[8px] bg-[#f6f3fd] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-[#101828]">{suName(v.serviceUser)}</p>
          <p className="text-[13px] text-[#475467]">Ref: <span>{v.reference}</span></p>
        </div>
        <span title={p.why} className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[13px] font-semibold ${p.priority === "URGENT" ? "bg-[#fdecec] text-[#b42318]" : p.priority === "HIGH" ? "bg-[#fdf3d8] text-[#8a5a00]" : "bg-[#eef4ff] text-[#1d4f91]"}`}>{PRIORITY_LABEL[p.priority]}</span>
      </div>
      <Row icon={<CalendarBlank size={18} />}>{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })}, {londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)} ({planned} min)</Row>
      <Row icon={<Heartbeat size={18} />}>{v.callType.name}</Row>
      <Row icon={<MapPin size={18} />}>{v.area?.name ?? "No area"}</Row>
      {v.serviceUser.riskLevel ? <Row icon={<ShieldWarning size={18} />}>{RISK[v.serviceUser.riskLevel]}</Row> : null}
      <Row icon={<Users size={18} />}>
        Carers needed: {Math.min(2, v.carersRequired)} · booked: {live.length ? live.map((a) => a.staff.displayName).join(", ") : "none"}
        {slot ? <span className="block font-semibold text-[#b42318]">To fill: {SLOT_LABEL[slot]}</span> : null}
      </Row>
      {openSlots.length > 1 ? (
        <nav aria-label="Carer place to fill" className="mt-1 flex gap-1.5">
          {openSlots.map((s) => <Link key={s} href={url({ slot: s, pick: undefined, ctab: ctab === "review" ? undefined : sp.ctab })} aria-current={s === slot ? "true" : undefined} className={`rounded-full border px-3 py-0.5 text-[13px] font-semibold no-underline ${s === slot ? "border-[#5b2bb5] bg-[#5b2bb5] text-white" : "border-[#d0d5dd] bg-white text-[#344054]"}`}>{SLOT_LABEL[s]}</Link>)}
        </nav>
      ) : null}
    </section>
  );

  if (!assignable || !slot) {
    return shell(<>{visitBlock}<p className="px-4 pb-4 text-[14px] text-[#344054]">{!assignable ? "This visit can no longer be staffed from here (it has started, finished or been cancelled)." : "Every carer place on this visit is now filled."} <Link href={`/rota/visits?date=${fromDbDate(v.date)}&visit=${v.id}`}>Open in Daily Rota</Link></p></>);
  }

  if (ctab === "review" && data.pick) {
    const { candidate: c, result, checks } = data.pick;
    const warnings = result.warnings.map((w) => w.message);
    const blocked = result.state === "NOT_ELIGIBLE";
    return shell(
      <>
        <div className="px-4 pb-1"><Link href={url({ ctab: sp.ptab === "manual" ? "manual" : undefined })} className="inline-flex items-center gap-1 text-[13.5px] font-semibold"><ArrowLeft size={15} aria-hidden />Back to carers</Link></div>
        <h3 className="px-4 pb-2 text-[16px] font-bold text-[#101828]">Review Assignment</h3>
        <dl className="mx-4 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[8px] border border-[#e4e7ec] px-3 py-2.5 text-[14px]">
          <dt className="text-[#475467]">Service user</dt><dd className="font-semibold text-[#101828]">{suName(v.serviceUser)}</dd>
          <dt className="text-[#475467]">Date and time</dt><dd>{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })}, {londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</dd>
          <dt className="text-[#475467]">Care worker</dt><dd className="font-semibold text-[#101828]">{c.name}</dd>
          <dt className="text-[#475467]">Place</dt><dd>{SLOT_LABEL[slot]}{v.carersRequired > 1 ? ` of a double-up${live.length ? ` (with ${live.map((a) => a.staff.displayName).join(", ")}, unchanged)` : ""}` : ""}</dd>
          <dt className="text-[#475467]">Care tasks</dt><dd>{data.careTasks.length ? data.careTasks.join(", ") : "None listed on the visit"}</dd>
        </dl>
        <h4 className="px-4 pt-1 text-[13.5px] font-semibold text-[#101828]">Checks, run again just now</h4>
        <ul className="px-4 pb-2">
          {checks.map((k, i) => (
            <li key={`${k.label}-${i}`} className="flex items-start gap-2 border-b border-[#f2f4f7] py-1.5 text-[13.5px] last:border-0">
              <span className="mt-[1px]">{CHECK_ICON[k.state]}</span>
              <span className="min-w-0 flex-1"><span className="font-semibold text-[#101828]">{k.label}</span><span className="sr-only"> ({CHECK_WORD[k.state]})</span><span className="block text-[#475467]">{k.text}</span></span>
            </li>
          ))}
        </ul>
      </>,
      blocked ? (
        <p className="rounded-[8px] bg-[#fdecec] px-3 py-2 text-[14px] text-[#a3242c]" role="alert">{c.name} cannot be booked for this visit now. <Link href={url({ ctab: undefined, pick: undefined })}>Choose someone else</Link></p>
      ) : (
        <form action={confirmCoverAction} className="space-y-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="visitId" value={v.id} />
          <input type="hidden" name="slot" value={slot} />
          <input type="hidden" name="staffId" value={c.id} />
          <input type="hidden" name="lockVersion" value={v.lockVersion} />
          {warnings.map((w) => <input key={w} type="hidden" name="warning" value={w} />)}
          {warnings.length ? (
            <div className="rounded-[8px] bg-[#fdf4e3] px-3 py-2 text-[13.5px] text-[#7a4b00]">
              <p className="font-semibold">Read before booking</p>
              <ul className="ml-4 list-disc">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              <label className="mt-1.5 flex items-start gap-2 font-semibold"><input type="checkbox" name="acknowledged" required className="mt-0.5 h-4 w-4" />I have read these warnings and want to book {c.name}</label>
            </div>
          ) : null}
          <button className="flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[#5b2bb5] text-[15px] font-semibold text-white hover:bg-[#4c2398] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]">Confirm Assignment</button>
          <p className="text-[12px] text-[#475467]">Saving checks everything again, with the visit locked. If the visit changed or the carer was booked elsewhere in the meantime, nothing is saved and you will be told why.</p>
        </form>
      ),
    );
  }

  const option = (c: Candidate, i: number | null) => {
    const selected = c.id === pickId;
    const label = i === 0 ? { label: "Best match", cls: "bg-[#e7f6ec] text-[#14713a]" } : STATE[c.state];
    const areas = data.areas.get(c.id) ?? [];
    const body = (
      <>
        <span aria-hidden className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[#5b2bb5]" : "border-[#98a2b3]"}`}>{selected ? <span className="h-2 w-2 rounded-full bg-[#5b2bb5]" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-semibold text-[#101828]">{c.name}</span><span className={`rounded-[6px] px-1.5 py-0.5 text-[12.5px] font-semibold ${label.cls}`}>{label.label}</span>{c.score !== null ? <span className="text-[12.5px] tabular-nums text-[#667085]" title={c.explain.map((e) => `${e.points > 0 ? "+" : ""}${e.points} ${e.text}`).join("\n")}>score {c.score}</span> : null}</span>
          {i !== null ? <span className="block text-[13px] text-[#344054]">{headline(c)}</span> : (
            <span className="block text-[13px] text-[#344054]">{availability(c)}{areas.length ? ` · ${areas.join(", ")}` : " · no area set"}</span>
          )}
          {c.state === "NOT_ELIGIBLE" ? <span className="block text-[12.5px] text-[#b42318]">Cannot be assigned: {c.reasons.slice(0, 2).join("; ")}</span> : c.reasons.length ? <span className="block text-[12.5px] text-[#8a5a00]">Check: {c.reasons.slice(0, 2).join("; ")}</span> : null}
        </span>
      </>
    );
    const cls = `flex items-start gap-2.5 rounded-[8px] border px-3 py-2 no-underline ${selected ? "border-[#5b2bb5] bg-[#f6f3fd]" : "border-[#e4e7ec] bg-white"}`;
    return (
      <li key={c.id}>
        {c.state === "NOT_ELIGIBLE" ? <div className={`${cls} opacity-80`} aria-disabled="true">{body}</div> : <Link href={url({ pick: c.id, ctab: ctab === "manual" ? "manual" : undefined })} aria-current={selected ? "true" : undefined} aria-label={`Select ${c.name}`} className={`${cls} text-inherit hover:border-[#5b2bb5]`}>{body}</Link>}
      </li>
    );
  };

  return shell(
    <>
      {visitBlock}
      <nav aria-label="How to choose a carer" className="mx-4 mb-2 grid grid-cols-2 rounded-[8px] border border-[#d0d5dd] p-0.5">
        <Link href={url({ ctab: undefined, pick: data.recommended.some((c) => c.id === pickId) ? pickId : undefined })} aria-current={ctab === "rec" ? "page" : undefined} className={`flex h-9 items-center justify-center rounded-[6px] text-[14px] font-semibold no-underline ${ctab === "rec" ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>Recommended</Link>
        <Link href={url({ ctab: "manual" })} aria-current={ctab === "manual" ? "page" : undefined} className={`flex h-9 items-center justify-center rounded-[6px] text-[14px] font-semibold no-underline ${ctab === "manual" ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>Manual</Link>
      </nav>
      {ctab === "rec" ? (
        <div className="px-4 pb-3">
          <h3 className="mb-1.5 text-[15px] font-bold text-[#101828]">Recommended care workers ({data.recommended.length})</h3>
          {data.recommended.length ? <ol className="space-y-1.5">{data.recommended.map((c, i) => option(c, i))}</ol> : <p className="rounded-[8px] bg-[#fdecec] px-3 py-2 text-[14px] text-[#a3242c]">Nobody passes the checks for this time. Try Manual to see why each person is not available, or move the visit.</p>}
          <p className="mt-2 text-[12px] text-[#475467]">Only carers the eligibility rules allow are recommended; a score never overrides a failed check. Ranked on continuity, area, preferences, weekly hours and the time gap between bookings (not travel time).</p>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <form method="get" role="search" className="relative mb-2">
            {Object.entries({ ...Object.fromEntries(new URL(url({ mq: undefined, pick: undefined }), "http://x").searchParams) }).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            <label className="sr-only" htmlFor="mq">Search care workers by name</label>
            <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input id="mq" type="search" name="mq" defaultValue={sp.mq ?? ""} placeholder="Search care workers by name..." className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px] placeholder:text-[#667085]" />
          </form>
          <p className="mb-1.5 text-[12.5px] text-[#475467]">{sp.mq ? `${data.manual.length} match${data.manual.length === 1 ? "" : "es"} for “${sp.mq}”` : `${data.list.length} care workers in your branches, allowed first`}{(data.list.length) > data.manual.length && !sp.mq ? ` (first ${data.manual.length}; search to find others)` : ""}. Same checks as the recommendations.</p>
          {data.manual.length ? <ul className="space-y-1.5">{data.manual.map((c) => option(c, null))}</ul> : <p className="text-[14px] text-slate-600">No care worker matches that name.</p>}
        </div>
      )}
    </>,
    <>
      {pickId ? (
        <Link href={url({ ctab: "review", ptab: ctab === "manual" ? "manual" : undefined })} className="flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[#5b2bb5] text-[15px] font-semibold text-white no-underline hover:bg-[#4c2398]">Review Assignment</Link>
      ) : <p className="flex h-11 items-center justify-center rounded-[8px] border border-dashed border-[#d0d5dd] text-[14px] text-[#475467]">Select a care worker to review the assignment</p>}
      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#475467]"><Clock size={14} aria-hidden />Nobody is booked until you confirm on the next step.</p>
    </>,
  );
}
