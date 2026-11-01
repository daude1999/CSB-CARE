import type { ReactNode } from "react";
import Link from "@/components/link";
import { DrawerShell } from "@/components/drawer-shell";
import { CarerOption, CHECK_TONE, CoverHeader, PURPLE, QUIET, SafetyChecks } from "@/components/cover-ui";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { AppError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";
import { reasonLabel } from "@/server/rota/missed-calls";
import { coverRecord, findCoverView, SU_INFORMED, type FindCoverView } from "@/server/rota/missed-cover";
import { coverConfirmAction, coverInformedAction, missedEscalateAction } from "@/app/rota-actions";

/**
 * Find Replacement Cover: the slide-out panel on Missed Calls and on a missed-call case. Its state is in the URL
 * (cover=<case id> plus fc* parameters), so closing it returns to the same page with the same filters. Steps: choose
 * (summary, recovery time, top three carers), search staff, review the checks, confirm, and the result.
 */

type Params = Record<string, string | undefined>;

/** Builds links that keep the page's own filters and the panel's state. */
function urls(basePath: string, keep: Params, caseId: string, state: Params) {
  const build = (all: Params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `${basePath}${p.size ? `?${p}` : ""}`;
  };
  return {
    close: build(keep),
    at: (over: Params) => build({ ...keep, cover: caseId, ...state, ...over }),
    hidden: (over: Params = {}) => Object.entries({ ...keep, cover: caseId, ...state, ...over }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null)),
  };
}

type U = ReturnType<typeof urls>;

export async function FindCoverPanel({ ctx, caseId, sp, basePath, keep }: { ctx: Ctx; caseId: string; sp: Params; basePath: string; keep: Params }) {
  const step = sp.fcStep ?? "pick";
  let view: FindCoverView;
  try {
    view = await findCoverView(ctx, caseId, { date: sp.fcDate, time: sp.fcTime, q: sp.fcQ, area: sp.fcArea, all: sp.fcAll === "1", staffId: step === "review" ? sp.fcStaff : undefined });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const close = urls(basePath, keep, caseId, {}).close;
    return (
      <DrawerShell closeHref={close} labelledBy="fc-title">
        <CoverHeader close={close} />
        <div className="p-5"><p role="alert" className="rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[14px] text-[#8a1f1a]">{e.message}</p></div>
      </DrawerShell>
    );
  }
  const state: Params = { fcDate: view.state.recovery ? undefined : view.date, fcTime: view.state.recovery ? undefined : view.time, fcAll: view.all ? "1" : undefined };
  const u = urls(basePath, keep, caseId, state);
  const message = typeof sp.error === "string" ? { error: true, text: sp.error } : typeof sp.ok === "string" ? { error: false, text: sp.ok } : null;
  const showRecord = step === "done" || (!view.state.canFind && view.state.recovery);

  return (
    <DrawerShell closeHref={u.close} labelledBy="fc-title" step={`${step}:${sp.fcStaff ?? ""}:${view.still}`}>
      <CoverHeader close={u.close} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {message ? <p role={message.error ? "alert" : "status"} className={`mb-3 rounded-[6px] px-3 py-2 text-[13.5px] ${message.error ? "bg-[#fde8e8] text-[#8a1f1a]" : "bg-[#e6f4ea] text-[#1e6b2c]"}`}>{message.text}</p> : null}
        <Summary view={view} />
        {showRecord ? (
          <Result ctx={ctx} caseId={caseId} view={view} u={u} />
        ) : !view.state.canFind ? (
          <section aria-label="Cover" className="mt-4 rounded-[8px] border border-slate-200 p-4 text-[14px]">
            <p className="font-medium">Find Cover is not available for this call.</p>
            <p className="mt-1 text-slate-700">{view.state.text}</p>
            <Link href={`/rota/missed/${caseId}`} className="mt-3 inline-block text-[14px]">Open the case</Link>
          </section>
        ) : step === "review" && view.selected ? (
          <Review view={view} u={u} done={u.at({ fcStep: "done", fcStaff: undefined, fcSrc: undefined, fcQ: undefined, fcArea: undefined })} back={u.at({ fcStep: sp.fcSrc === "MANUAL" ? "manual" : undefined, fcStaff: undefined })} source={sp.fcSrc === "MANUAL" ? "MANUAL" : "RECOMMENDED"} />
        ) : step === "manual" ? (
          <Manual view={view} u={u} q={sp.fcQ} area={sp.fcArea} />
        ) : (
          <Pick view={view} u={u} />
        )}
      </div>
    </DrawerShell>
  );
}


function Summary({ view }: { view: FindCoverView }) {
  const s = view.summary;
  const ago = s.minutesSince >= 60 ? `${Math.floor(s.minutesSince / 60)} h ${s.minutesSince % 60} min ago` : `${s.minutesSince} min ago`;
  const urgent = s.highRisk ? { cls: "bg-[#fde8e8] text-[#8a1f1a]", text: "High risk: arrange cover now" } : s.minutesSince <= 120 ? { cls: "bg-[#fdf3dc] text-[#7a5200]", text: "Urgent: missed within the last 2 hours" } : { cls: "bg-slate-100 text-slate-700", text: "Standard priority" };
  const row = (k: string, v: ReactNode) => (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </>
  );
  return (
    <section aria-label="The missed visit" className="mt-4 rounded-[8px] border border-slate-200 bg-[#faf9fd] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[16px] text-slate-900">{s.serviceUser}</b>
        <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${urgent.cls}`}>{urgent.text}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[132px_1fr] gap-x-3 gap-y-1 text-[13.5px]">
        {row("Visit", <>{fmtLondonDate(s.date, { weekday: "short", day: "numeric", month: "short" })} · {londonTime(s.start)}–{londonTime(s.end)} ({s.minutes} min)</>)}
        {row("Visit type", `${s.callType}${s.area ? ` · ${s.area}` : ""}`)}
        {row("Booked carer", s.original.length ? s.original.join(" and ") : "Nobody was assigned")}
        {row("Reason", s.reason ? reasonLabel(s.reason) : "Not recorded yet")}
        {row("Carers needed", <>{s.carersRequired} · <b>{view.still} still to cover</b></>)}
        {row("Missed", `${ago} (${s.reference})`)}
      </dl>
    </section>
  );
}


function TimeForm({ view, u, step }: { view: FindCoverView; u: U; step?: string }) {
  if (view.state.recovery) return <p className="mt-4 text-[13.5px] text-slate-700">Recovery visit <b>{view.state.recovery.reference}</b> is already booked for {fmtLondonDate(londonDate(view.state.recovery.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} {londonTime(view.state.recovery.scheduledStart)}. Choose the {view.slot === "SECOND" ? "second" : "first"} carer for it.</p>;
  return (
    <form method="get" className="mt-4 rounded-[8px] border border-slate-200 p-3" aria-label="Proposed recovery time">
      {u.hidden({ fcDate: undefined, fcTime: undefined, fcStep: step })}
      <p className="mb-2 text-[13.5px] font-medium text-slate-800">The original time has passed, so cover is a new recovery visit. When should it start?</p>
      <div className="flex flex-wrap items-end gap-2">
        <label><span className="label">Date</span><input type="date" name="fcDate" defaultValue={view.date} className="input w-[160px]" /></label>
        <label><span className="label">Start time</span><input type="time" name="fcTime" defaultValue={view.time} step={300} className="input w-[120px]" /></label>
        <button className={QUIET}>Update carers</button>
      </div>
      {view.timeError ? <p role="alert" className="mt-2 text-[13px] text-[#8a1f1a]" data-autofocus tabIndex={-1}>{view.timeError}</p> : <p className="mt-1.5 text-[12.5px] text-slate-500">Same length as the missed visit ({view.summary.minutes} min). Carers are checked for this time.</p>}
    </form>
  );
}

function Pick({ view, u }: { view: FindCoverView; u: U }) {
  return (
    <>
      <TimeForm view={view} u={u} />
      <form method="get" id="fc-pick">
        {u.hidden({ fcStep: "review", fcSrc: "RECOMMENDED" })}
        <h3 className="mb-2 mt-5 text-[15px] font-semibold text-slate-900">Recommended carers</h3>
        {view.timeError ? null : view.recommended.length ? (
          <>
            <ol className="space-y-2" aria-label="Recommended carers">{view.recommended.map((c, i) => <CarerOption key={c.id} c={c} rank={i} name="rec" />)}</ol>
            <p className="mt-2 text-[12.5px] text-slate-500">Only carers who pass every hard rule (HR checks, training, readiness, leave, clashes and the service user&apos;s restrictions) are shown. Familiarity, area and hours decide the order. Travel time is not calculated.</p>
          </>
        ) : <NoCarers view={view} u={u} />}
      </form>
      <Actions view={view} u={u} reviewForm={view.recommended.length && !view.timeError ? "fc-pick" : null} manual />
    </>
  );
}

function NoCarers({ view, u }: { view: FindCoverView; u: U }) {
  return (
    <div className={`rounded-[8px] border p-4 ${view.summary.highRisk ? "border-[#e8b4b0] bg-[#fdf1f1]" : "border-slate-200 bg-slate-50"}`} role="status">
      <p className="text-[15px] font-semibold text-slate-900">No suitable carers available</p>
      <p className="mt-1 text-[13.5px] text-slate-700">Nobody you can book passes every check for this time. Try another time, search staff by hand, or escalate to a manager. A carer who fails a hard rule can never be booked from here.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={u.at({ fcStep: "manual" })} scroll={false} className={QUIET}>Search Staff Manually</Link>
        <a href="#fc-escalate" className={QUIET}>Escalate to Manager</a>
      </div>
    </div>
  );
}

function Actions({ view, u, reviewForm, manual }: { view: FindCoverView; u: U; reviewForm: string | null; manual?: boolean }) {
  const s = view.summary;
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {reviewForm ? <button form={reviewForm} className={PURPLE}>Review Cover</button> : null}
        {manual ? <Link href={u.at({ fcStep: "manual" })} scroll={false} className={QUIET}>Search Staff Manually</Link> : <Link href={u.at({ fcStep: undefined, fcQ: undefined, fcArea: undefined })} scroll={false} className={QUIET}>Back to recommendations</Link>}
      </div>
      <details className="mt-3 text-[13.5px]" id="fc-escalate" open={!view.recommended.length && !view.timeError ? true : undefined}>
        <summary className="cursor-pointer font-medium text-slate-700">More options</summary>
        <ul className="mt-2 space-y-1.5 pl-1">
          <li><Link href={`/rota/advanced?date=${view.date}`}>View staff availability for {fmtLondonDate(view.date, { weekday: "short", day: "numeric", month: "short" })}</Link></li>
          {view.canWiden ? <li>{view.all ? <Link href={u.at({ fcAll: undefined })} scroll={false}>Search only the service user&apos;s branch</Link> : <Link href={u.at({ fcAll: "1" })} scroll={false}>Search other branches you can book from</Link>}</li> : null}
          <li><Link href="/rota/cover">Open Sickness &amp; Holiday Cover</Link></li>
          <li>
            {s.escalatedAt ? <span className="text-slate-600">Already escalated to the care managers.</span> : (
              <form action={missedEscalateAction} className="mt-1 flex flex-wrap gap-2">
                <input type="hidden" name="back" value={u.at({})} />
                <input type="hidden" name="caseId" value={s.caseId} />
                <input name="note" required minLength={5} className="input min-w-0 flex-1" defaultValue={view.recommended.length ? "" : "No suitable carer available to cover this missed call."} aria-label="Why a manager is needed" placeholder="Why a manager is needed" />
                <button className="inline-flex items-center rounded-[6px] border border-[#b42a23] bg-white px-3 py-2 text-[14px] font-medium text-[#b42a23] hover:bg-[#fdf1f1]">Escalate to Manager</button>
              </form>
            )}
          </li>
        </ul>
      </details>
    </div>
  );
}

function Manual({ view, u, q, area }: { view: FindCoverView; u: U; q?: string; area?: string }) {
  return (
    <>
      <TimeForm view={view} u={u} step="manual" />
      <h3 className="mb-2 mt-5 text-[15px] font-semibold text-slate-900">Search staff</h3>
      <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Search staff">
        {u.hidden({ fcStep: "manual", fcQ: undefined, fcArea: undefined })}
        <label className="min-w-[160px] flex-1"><span className="label">Name or area</span><input type="search" name="fcQ" defaultValue={q ?? ""} className="input w-full" /></label>
        <label><span className="label">Area</span><select name="fcArea" defaultValue={area ?? ""} className="input w-[150px]"><option value="">Any area</option>{view.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <button className={QUIET}>Search</button>
      </form>
      <form method="get" id="fc-manual" className="mt-3">
        {u.hidden({ fcStep: "review", fcSrc: "MANUAL" })}
        {view.list.length ? <ul className="space-y-2" aria-label="Staff">{view.list.map((c) => <CarerOption key={c.id} c={c} rank={null} name="man" />)}</ul> : <p className="rounded-[8px] border border-slate-200 p-3 text-[13.5px] text-slate-600">Nobody matches this search.</p>}
        <p className="mt-2 text-[12.5px] text-slate-500">Greyed-out carers fail a hard rule and cannot be chosen. A carer you choose here goes through exactly the same checks when you confirm.</p>
      </form>
      <Actions view={view} u={u} reviewForm={view.list.some((c) => c.state !== "NOT_ELIGIBLE") ? "fc-manual" : null} />
    </>
  );
}

function Review({ view, u, done, back, source }: { view: FindCoverView; u: U; done: string; back: string; source: "RECOMMENDED" | "MANUAL" }) {
  const sel = view.selected!;
  const s = view.summary;
  const start = view.state.recovery?.scheduledStart ?? view.window?.start ?? s.start;
  const end = view.state.recovery?.scheduledEnd ?? view.window?.end ?? s.end;
  const blocked = sel.result.state === "NOT_ELIGIBLE";
  const warnings = sel.result.warnings.map((w) => w.message);
  const row = (k: string, v: ReactNode) => (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </>
  );
  return (
    <section aria-labelledby="fc-review" className="mt-4">
      <h3 id="fc-review" className="text-[16px] font-semibold text-slate-900" data-autofocus tabIndex={-1}>Review Replacement Cover</h3>
      <dl className="mt-2 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 rounded-[8px] border border-slate-200 p-3 text-[13.5px]">
        {row("Service user", s.serviceUser)}
        {row("Original visit", s.reference)}
        {row("Missed appointment", `${fmtLondonDate(s.date, { weekday: "short", day: "numeric", month: "short" })} ${londonTime(s.start)}–${londonTime(s.end)}`)}
        {row("Replacement", <b>{sel.candidate.name}</b>)}
        {row("Recovery visit", <>{view.state.recovery ? `${view.state.recovery.reference}, ` : "New visit, "}{fmtLondonDate(londonDate(start), { weekday: "short", day: "numeric", month: "short" })} {londonTime(start)}–{londonTime(end)}</>)}
        {row("Duration", `${s.minutes} min`)}
        {row("Staffing", `${view.slot === "SECOND" ? "Second" : "First"} of ${s.carersRequired} ${s.carersRequired === 1 ? "carer" : "carers"}`)}
        {row("Eligibility", blocked ? "Not eligible" : sel.result.state === "REQUIRES_REVIEW" ? "Allowed, with warnings to review" : "Passes every check")}
      </dl>

      <h4 className="mb-1.5 mt-4 text-[14.5px] font-semibold text-slate-900">Safety checks</h4>
      <SafetyChecks checks={sel.checks} />
      <p className="mt-1.5 text-[12.5px] text-slate-500">Checked now against HR and the rota. Everything is checked again when you confirm.</p>

      {blocked ? (
        <p role="alert" className="mt-4 rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[13.5px] text-[#8a1f1a]">{sel.candidate.name} cannot be booked: {sel.result.blocking.map((b) => b.message).join("; ")}.</p>
      ) : (
        <form action={coverConfirmAction} className="mt-4">
          <input type="hidden" name="back" value={u.at({ fcStep: "review", fcStaff: sel.candidate.id, fcSrc: source })} />
          <input type="hidden" name="done" value={done} />
          <input type="hidden" name="caseId" value={s.caseId} />
          <input type="hidden" name="staffId" value={sel.candidate.id} />
          <input type="hidden" name="date" value={view.date} />
          <input type="hidden" name="time" value={view.time} />
          <input type="hidden" name="source" value={sel.rank !== null && source === "RECOMMENDED" ? "RECOMMENDED" : "MANUAL"} />
          {sel.rank !== null ? <input type="hidden" name="rank" value={sel.rank} /> : null}
          {view.recommended.map((r) => <input key={r.id} type="hidden" name="suggested" value={r.id} />)}
          <input type="hidden" name="seenRecoveryId" value={view.state.recovery?.id ?? ""} />
          {warnings.length ? (
            <fieldset className="rounded-[8px] border border-[#ecd29a] bg-[#fffaf0] p-3">
              <legend className="px-1 text-[14px] font-semibold text-[#7a5200]">Review {warnings.length === 1 ? "this warning" : "these warnings"}</legend>
              <ul className="space-y-1.5">
                {warnings.map((w, i) => (
                  <li key={w}><label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="ack" value={w} required className="mt-0.5 h-4 w-4 accent-[#6b46c9]" id={`fc-ack-${i}`} /> <span>I have reviewed: {w}</span></label></li>
                ))}
              </ul>
              <label className="mt-2 block"><span className="label">Why this carer is right despite the warnings</span><textarea name="warningReason" required minLength={5} maxLength={1000} rows={2} className="input w-full" /></label>
              <p className="mt-1 text-[12.5px] text-slate-600">Your name, the warnings and this reason are kept in the case history.</p>
            </fieldset>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={PURPLE}>Confirm Cover</button>
            <Link href={back} scroll={false} className={QUIET}>Choose someone else</Link>
          </div>
          <p className="mt-2 text-[12.5px] text-slate-500">Confirming books {sel.candidate.name} on the rota and tells them in the app if they have a sign-in. The missed call stays missed and its investigation stays open.</p>
        </form>
      )}
    </section>
  );
}

async function Result({ ctx, caseId, view, u }: { ctx: Ctx; caseId: string; view: FindCoverView; u: U }) {
  const r = await coverRecord(ctx, caseId);
  const rv = r.recovery;
  const live = r.covers.filter((x) => x.recoveryVisit.id === rv?.id);
  const lateNote = rv && view.c.visit.status !== "MISSED" ? "The booked carer has since clocked in on the original visit. Check whether the recovery visit is still needed." : null;
  return (
    <section aria-labelledby="fc-done" className="mt-4">
      {rv ? (
        <div className="rounded-[8px] border border-[#b7dfc0] bg-[#f1faf3] p-3.5">
          <h3 id="fc-done" className="text-[16px] font-semibold text-[#1e6b2c]" data-autofocus tabIndex={-1}>{view.still ? "Cover partly booked" : "Cover booked"}</h3>
          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13.5px]">
            <dt className="text-slate-600">Recovery visit</dt><dd><Link href={`/rota/visits/${rv.id}`}>{rv.reference}</Link>, {fmtLondonDate(londonDate(rv.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} {londonTime(rv.scheduledStart)}–{londonTime(rv.scheduledEnd)}</dd>
            <dt className="text-slate-600">Replacement</dt><dd>{live.map((x) => `${x.staffName} (${x.slot === "SECOND" ? "second" : "first"} carer)`).join(", ") || "Nobody now"}</dd>
            <dt className="text-slate-600">Carer told</dt><dd>{live.map((x) => (x.notifyStatus === "IN_APP" ? `${x.staffName}: in-app notification${x.notificationReadAt ? ", opened" : ", not opened yet"}` : `${x.staffName}: no sign-in linked, phone them`)).join("; ")}</dd>
            <dt className="text-slate-600">Missed visit</dt><dd>{view.summary.reference} stays recorded as missed; the investigation stays open.</dd>
          </dl>
          {view.still ? <p className="mt-2 text-[13.5px] font-medium text-[#7a5200]">{view.still} more {view.still === 1 ? "carer is" : "carers are"} needed on this double-up.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {view.still && view.state.canFind ? <Link href={u.at({ fcStep: undefined })} scroll={false} className={PURPLE}>Find the second carer</Link> : null}
            <Link href={`/rota/visits?date=${londonDate(rv.scheduledStart)}`} className={QUIET}>Open the Daily Rota</Link>
            <Link href={`/rota/missed/${caseId}`} className={QUIET}>Open the case</Link>
          </div>
        </div>
      ) : <p id="fc-done" className="rounded-[8px] border border-slate-200 p-3 text-[14px]">No recovery visit is booked now{r.covers.length ? " (the last one was cancelled)" : ""}.</p>}
      {lateNote ? <p role="alert" className="mt-3 rounded-[6px] bg-[#fdf3dc] px-3 py-2 text-[13.5px] text-[#7a5200]">{lateNote}</p> : null}

      <h4 className="mb-1.5 mt-4 text-[14.5px] font-semibold text-slate-900">What has happened so far</h4>
      <ul className="divide-y divide-slate-100 rounded-[8px] border border-slate-200 text-[13.5px]" aria-label="Cover progress">
        {r.facts.map((f) => (
          <li key={f.label} className="flex gap-2.5 px-3 py-2">
            <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${f.done ? CHECK_TONE.ok.cls : CHECK_TONE.info.cls}`}>{f.done ? "✓" : "·"}</span>
            <span><b className="font-medium">{f.label}</b>: {f.text}</span>
          </li>
        ))}
      </ul>

      {r.canWork && view.c.stage !== "CLOSED" ? (
        <form action={coverInformedAction} className="mt-4 rounded-[8px] border border-slate-200 p-3">
          <input type="hidden" name="back" value={u.at({ fcStep: "done" })} />
          <input type="hidden" name="caseId" value={caseId} />
          <p className="mb-2 text-[14px] font-medium">Has the service user or their representative been told?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
            <label><span className="label">Status</span><select name="status" required defaultValue={view.c.suInformedStatus ?? ""} className="input w-full"><option value="" disabled>Choose…</option>{Object.entries(SU_INFORMED).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span className="label">Who, how, when</span><input name="note" maxLength={300} defaultValue={view.c.suInformedNote ?? ""} className="input w-full" placeholder="Daughter by phone at 14:05" /></label>
          </div>
          <button className={`${QUIET} mt-2`}>Save</button>
          <p className="mt-1 text-[12.5px] text-slate-500">This records what you did. The platform does not phone, text or email anyone.</p>
        </form>
      ) : null}
    </section>
  );
}
