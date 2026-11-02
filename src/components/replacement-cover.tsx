import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { DrawerShell } from "@/components/drawer-shell";
import { CarerOption, CHECK_TONE, CoverHeader, PURPLE, QUIET, SafetyChecks } from "@/components/cover-ui";
import { CommunicationSection } from "@/components/cover-communication";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { coverRecord } from "@/server/rota/missed-cover";
import { communicationStates, COMMS_LABEL } from "@/server/rota/cover-communication";
import { coverTargetFrom, coverWorkspaceOrMessage, MODE_TEXT, SLOT_LABEL, type CoverMode, type CoverWorkspace, type RecoveryCover, type VisitCover } from "@/server/rota/replacement-cover";
import { coverBookAction, coverConfirmAction, missedEscalateAction } from "@/app/rota-actions";

/**
 * Find Replacement Cover: the one slide-out panel used by Unassigned Visits, Missed Calls (register and case), the
 * Daily Rota's Visit Details, the visit page, Sickness & Holiday Cover and Visits Needing Attention. It is opened by a
 * link (cover=<visit or case id>, fcMode=fill|replace|recovery, fcSlot) and keeps its state in the URL, so closing it
 * returns to the same page with the same filters. Two tabs keep the two jobs apart: "Cover" books a carer (pick,
 * search, review, confirm, result) and "Contact & communication" records what the service user or their
 * representative was told. Saving one never does the other.
 */

type Params = Record<string, string | undefined>;

/** The panel's own query parameters. Everything else on the page is kept. */
export const COVER_PARAMS = ["cover", "fcMode", "fcSlot", "fcStep", "fcStaff", "fcSrc", "fcQ", "fcArea", "fcAll", "fcDate", "fcTime", "fcTab", "fcSaved", "slot", "ctab", "pick", "mq", "ptab"];

/** A link that opens the panel from any page, keeping that page's own parameters. */
export function coverHref(basePath: string, keep: Params, target: { id: string; mode?: CoverMode; slot?: string; tab?: "comms" }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v && !COVER_PARAMS.includes(k) && k !== "ok" && k !== "error") p.set(k, v);
  p.set("cover", target.id);
  if (target.mode) p.set("fcMode", target.mode);
  if (target.slot) p.set("fcSlot", target.slot);
  if (target.tab) p.set("fcTab", target.tab);
  return `${basePath}?${p}`;
}

function urls(basePath: string, keep: Params, state: Params) {
  const clean = Object.fromEntries(Object.entries(keep).filter(([k]) => !COVER_PARAMS.includes(k) && k !== "ok" && k !== "error"));
  const build = (all: Params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `${basePath}${p.size ? `?${p}` : ""}`;
  };
  return {
    close: build(clean),
    at: (over: Params) => build({ ...clean, ...state, ...over }),
    hidden: (over: Params = {}) => Object.entries({ ...clean, ...state, ...over }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null)),
  };
}
type U = ReturnType<typeof urls>;

const BADGE = { red: "bg-[#fde8e8] text-[#8a1f1a]", amber: "bg-[#fdf3dc] text-[#7a5200]", slate: "bg-slate-100 text-slate-700" } as const;
/** A dot on the tab for the communication state; the state itself is read out to screen readers. */
const STATE_DOT: Record<string, string> = { NOT_CONTACTED: "bg-[#d92d20]", ATTEMPTED: "bg-[#dc8a00]", UPDATE_NEEDED: "bg-[#dc8a00]", INFORMED: "bg-[#12873a]", NOT_APPLICABLE: "bg-slate-400" };

export async function ReplacementCoverPanel({ ctx, sp, basePath, keep, fallback = "fill" }: { ctx: Ctx; sp: Params; basePath: string; keep: Params; fallback?: CoverMode }) {
  const target = coverTargetFrom(sp, fallback);
  if (!target) return null;
  // Older links (Monitor alerts, Generate & Optimise) ask for the manual list with ctab=manual.
  const step = sp.fcStep ?? (sp.ctab === "manual" ? "manual" : "pick");
  const tab = sp.fcTab === "comms" ? "comms" : "cover";
  const ws = await coverWorkspaceOrMessage(ctx, target, { date: sp.fcDate, time: sp.fcTime, q: sp.fcQ, area: sp.fcArea, all: sp.fcAll === "1", staffId: step === "review" && tab === "cover" ? sp.fcStaff : undefined });
  const base: Params = { cover: target.id, fcMode: target.mode === fallback ? undefined : target.mode, fcSlot: target.slot };
  if ("error" in ws) {
    const close = urls(basePath, keep, {}).close;
    return (
      <DrawerShell closeHref={close} labelledBy="fc-title">
        <CoverHeader close={close} />
        <div className="p-5"><p role="alert" className="rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[14px] text-[#8a1f1a]">{ws.error}</p></div>
      </DrawerShell>
    );
  }
  const state: Params = {
    ...base,
    fcSlot: ws.kind === "visit" ? ws.slot ?? undefined : undefined,
    fcDate: ws.kind === "recovery" && !ws.view.state.recovery ? ws.view.date : undefined,
    fcTime: ws.kind === "recovery" && !ws.view.state.recovery ? ws.view.time : undefined,
    fcAll: ws.kind === "recovery" && ws.view.all ? "1" : undefined,
  };
  const u = urls(basePath, keep, state);
  const message = typeof sp.error === "string" ? { error: true, text: sp.error } : typeof sp.ok === "string" ? { error: false, text: sp.ok } : null;
  const comms = ws.comms ? (await communicationStates(ctx, [ws.comms.visitId])).get(ws.comms.visitId) ?? null : null;
  const text = MODE_TEXT[ws.mode];

  return (
    <DrawerShell closeHref={u.close} labelledBy="fc-title" step={`${tab}:${step}:${sp.fcStaff ?? ""}:${ws.kind === "recovery" ? ws.view.still : ws.slot}`}>
      <CoverHeader close={u.close} title={text.title} subtitle={text.subtitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" data-scroll>
        {message ? <p role={message.error ? "alert" : "status"} className={`mb-3 mt-3 rounded-[6px] px-3 py-2 text-[13.5px] ${message.error ? "bg-[#fde8e8] text-[#8a1f1a]" : "bg-[#e6f4ea] text-[#1e6b2c]"}`}>{message.text}</p> : null}
        <Summary ws={ws} />
        <nav aria-label="Find Cover sections" className="mt-3 grid grid-cols-2 rounded-[8px] border border-[#d0d5dd] p-0.5">
          <Link href={u.at({ fcTab: undefined })} scroll={false} aria-current={tab === "cover" ? "page" : undefined} className={`flex min-h-9 items-center justify-center px-1 py-1 text-center leading-tight rounded-[6px] text-[14px] font-semibold no-underline ${tab === "cover" ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>Cover</Link>
          <Link href={u.at({ fcTab: "comms" })} scroll={false} aria-current={tab === "comms" ? "page" : undefined} className={`flex min-h-9 items-center justify-center px-1 py-1 text-center leading-tight gap-1.5 rounded-[6px] text-[14px] font-semibold no-underline ${tab === "comms" ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>
            Contact &amp; communication
            {comms && tab !== "comms" ? <span title={COMMS_LABEL[comms.kind]} className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[comms.kind]}`}><span className="sr-only">: {COMMS_LABEL[comms.kind]}</span></span> : null}
          </Link>
        </nav>
        {tab === "comms" && ws.comms ? (
          <CommunicationSection ctx={ctx} target={ws.comms} back={u.at({ fcTab: "comms" })} savedToken={sp.fcSaved} token={randomUUID()} />
        ) : ws.kind === "recovery" ? (
          <RecoveryCoverTab ctx={ctx} ws={ws} u={u} step={step} sp={sp} />
        ) : (
          <VisitCoverTab ws={ws} u={u} step={step} sp={sp} comms={comms?.kind ?? null} />
        )}
      </div>
    </DrawerShell>
  );
}

function Summary({ ws }: { ws: CoverWorkspace }) {
  const s = ws.summary;
  return (
    <section aria-label={ws.kind === "recovery" ? "The missed visit" : "The visit"} className="mt-4 rounded-[8px] border border-slate-200 bg-[#faf9fd] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[16px] text-slate-900">{s.serviceUser}</b>
        <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${BADGE[s.badge.tone]}`}>{s.badge.text}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[132px_1fr] gap-x-3 gap-y-1 text-[13.5px]">
        {s.rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-slate-500">{r.k}</dt>
            <dd className={r.strong ? "font-semibold text-slate-900" : "text-slate-900"}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ── Picking a carer (shared by every kind of cover) ─────────────────────

function Recommended({ ws, u, reviewHidden }: { ws: CoverWorkspace; u: U; reviewHidden: Params }) {
  return (
    <form method="get" id="fc-pick">
      {u.hidden({ ...reviewHidden, fcStep: "review", fcSrc: "RECOMMENDED" })}
      <h3 className="mb-2 mt-5 text-[15px] font-semibold text-slate-900">Recommended carers</h3>
      {ws.recommended.length ? (
        <>
          <ol className="space-y-2" aria-label="Recommended carers">{ws.recommended.map((c, i) => <CarerOption key={c.id} c={c} rank={i} name="rec" />)}</ol>
          <p className="mt-2 text-[12.5px] text-slate-500">Only carers who pass every hard rule (HR checks, training, readiness, leave, clashes and the service user&apos;s restrictions) are shown. Familiarity, area and hours decide the order. Travel time is not calculated.</p>
        </>
      ) : (
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4" role="status">
          <p className="text-[15px] font-semibold text-slate-900">No suitable carers available</p>
          <p className="mt-1 text-[13.5px] text-slate-700">Nobody you can book passes every check for this time. Search staff by hand to see why, try another time, or escalate to a manager. A carer who fails a hard rule can never be booked from here.</p>
        </div>
      )}
    </form>
  );
}

function Manual({ ws, u, q, area, reviewHidden }: { ws: CoverWorkspace; u: U; q?: string; area?: string; reviewHidden: Params }) {
  return (
    <>
      <h3 className="mb-2 mt-5 text-[15px] font-semibold text-slate-900">Search staff</h3>
      <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Search staff">
        {u.hidden({ fcStep: "manual", fcQ: undefined, fcArea: undefined })}
        <label className="min-w-[160px] flex-1"><span className="label">Name or area</span><input type="search" name="fcQ" defaultValue={q ?? ""} className="input w-full" /></label>
        <label><span className="label">Area</span><select name="fcArea" defaultValue={area ?? ""} className="input w-[150px]"><option value="">Any area</option>{ws.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <button className={QUIET}>Search</button>
      </form>
      <form method="get" id="fc-manual" className="mt-3">
        {u.hidden({ ...reviewHidden, fcStep: "review", fcSrc: "MANUAL" })}
        {ws.list.length ? <ul className="space-y-2" aria-label="Staff">{ws.list.map((c) => <CarerOption key={c.id} c={c} rank={null} name="man" />)}</ul> : <p className="rounded-[8px] border border-slate-200 p-3 text-[13.5px] text-slate-600">Nobody matches this search.</p>}
        <p className="mt-2 text-[12.5px] text-slate-500">Greyed-out carers fail a hard rule and cannot be chosen. A carer you choose here goes through exactly the same checks when you confirm.</p>
      </form>
    </>
  );
}

function Actions({ ws, u, reviewForm, manual, more }: { ws: CoverWorkspace; u: U; reviewForm: string | null; manual: boolean; more: ReactNode }) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {reviewForm ? <button form={reviewForm} className={PURPLE}>{MODE_TEXT[ws.mode].review}</button> : null}
        {manual ? <Link href={u.at({ fcStep: "manual" })} scroll={false} className={QUIET}>Search Staff Manually</Link> : <Link href={u.at({ fcStep: undefined, fcQ: undefined, fcArea: undefined })} scroll={false} className={QUIET}>Back to recommendations</Link>}
      </div>
      <details className="mt-3 text-[13.5px]" id="fc-escalate" open={!ws.recommended.length ? true : undefined}>
        <summary className="cursor-pointer font-medium text-slate-700">More options</summary>
        <ul className="mt-2 space-y-1.5 pl-1">{more}</ul>
      </details>
    </div>
  );
}

function WarningsAndReason({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <fieldset className="rounded-[8px] border border-[#ecd29a] bg-[#fffaf0] p-3">
      <legend className="px-1 text-[14px] font-semibold text-[#7a5200]">Review {warnings.length === 1 ? "this warning" : "these warnings"}</legend>
      <ul className="space-y-1.5">
        {warnings.map((w, i) => (
          <li key={w}><label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="ack" value={w} required className="mt-0.5 h-4 w-4 accent-[#6b46c9]" id={`fc-ack-${i}`} /> <span>I have reviewed: {w}</span></label></li>
        ))}
      </ul>
      <label className="mt-2 block"><span className="label">Why this carer is right despite the warnings</span><textarea name="warningReason" required minLength={5} maxLength={1000} rows={2} className="input w-full" /></label>
      <p className="mt-1 text-[12.5px] text-slate-600">Your name, the warnings and this reason are kept in the visit history.</p>
    </fieldset>
  );
}

function ReviewDetails({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-2 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 rounded-[8px] border border-slate-200 p-3 text-[13.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>
      ))}
    </dl>
  );
}

function CommsNudge({ u, kind }: { u: U; kind: string | null }) {
  const outstanding = !kind || kind === "NOT_CONTACTED" || kind === "ATTEMPTED" || kind === "UPDATE_NEEDED";
  return (
    <div className={`mt-3 rounded-[8px] border p-3 text-[13.5px] ${outstanding ? "border-[#ecd29a] bg-[#fffaf0]" : "border-slate-200"}`}>
      <p><b className="font-semibold">Service user communication: </b>{kind ? COMMS_LABEL[kind as keyof typeof COMMS_LABEL] : COMMS_LABEL.NOT_CONTACTED}.</p>
      <p className="mt-0.5 text-slate-600">Booking cover does not record that anyone was told. Recording communication does not book cover.</p>
      <Link href={u.at({ fcTab: "comms" })} scroll={false} className="mt-2 inline-block font-semibold">Open Contact &amp; communication</Link>
    </div>
  );
}

// ── Fill and replace (an existing visit) ────────────────────────────────

function VisitCoverTab({ ws, u, step, sp, comms }: { ws: VisitCover; u: U; step: string; sp: Params; comms: string | null }) {
  if (step === "done") return <VisitDone ws={ws} u={u} comms={comms} />;
  if (!ws.canBook) {
    return (
      <section aria-label="Cover" className="mt-4 rounded-[8px] border border-slate-200 p-4 text-[14px]">
        <p className="font-medium">Cover cannot be booked from here.</p>
        <p className="mt-1 text-slate-700">{ws.blocked}</p>
        <Link href={`/rota/visits/${ws.summary.visitId}`} className="mt-3 inline-block text-[14px]">Open the visit</Link>
      </section>
    );
  }
  const slotNav = ws.slots.length > 1 ? (
    <nav aria-label={ws.mode === "fill" ? "Carer place to fill" : "Carer to replace"} className="mt-3 flex flex-wrap gap-1.5">
      {ws.slots.map((s) => <Link key={s.slot} href={u.at({ fcSlot: s.slot, fcStep: step === "manual" ? "manual" : undefined, fcStaff: undefined })} scroll={false} aria-current={s.slot === ws.slot ? "true" : undefined} className={`rounded-full border px-3 py-0.5 text-[13px] font-semibold no-underline ${s.slot === ws.slot ? "border-[#5b2bb5] bg-[#5b2bb5] text-white" : "border-[#d0d5dd] bg-white text-[#344054]"}`}>{s.label}{s.current ? `: ${s.current}` : ""}</Link>)}
    </nav>
  ) : null;
  const more = (
    <>
      <li><Link href={`/rota/advanced?date=${ws.date}`}>View staff availability for {fmtLondonDate(ws.date, { weekday: "short", day: "numeric", month: "short" })}</Link></li>
      <li><Link href="/rota/cover">Open Sickness &amp; Holiday Cover</Link></li>
      <li><Link href={`/rota/visits/${ws.summary.visitId}`}>Open the visit (change its time, or make it single)</Link></li>
    </>
  );
  if (step === "review" && ws.selected) return <VisitReview ws={ws} u={u} sp={sp} />;
  if (step === "manual") {
    return (
      <>
        {slotNav}
        <Manual ws={ws} u={u} q={sp.fcQ} area={sp.fcArea} reviewHidden={{}} />
        <Actions ws={ws} u={u} reviewForm={ws.list.some((c) => c.state !== "NOT_ELIGIBLE") ? "fc-manual" : null} manual={false} more={more} />
      </>
    );
  }
  return (
    <>
      {slotNav}
      <Recommended ws={ws} u={u} reviewHidden={{}} />
      <Actions ws={ws} u={u} reviewForm={ws.recommended.length ? "fc-pick" : null} manual more={more} />
    </>
  );
}

function VisitReview({ ws, u, sp }: { ws: VisitCover; u: U; sp: Params }) {
  const sel = ws.selected!;
  const blocked = sel.result.state === "NOT_ELIGIBLE";
  const warnings = sel.result.warnings.map((w) => w.message);
  const source = sp.fcSrc === "MANUAL" ? "MANUAL" : "RECOMMENDED";
  const back = u.at({ fcStep: source === "MANUAL" ? "manual" : undefined, fcStaff: undefined });
  const text = MODE_TEXT[ws.mode];
  return (
    <section aria-labelledby="fc-review" className="mt-4">
      <h3 id="fc-review" className="text-[16px] font-semibold text-slate-900" data-autofocus tabIndex={-1}>{ws.mode === "fill" ? "Review Replacement Cover" : "Review Replacement"}</h3>
      <ReviewDetails rows={[
        ["Service user", ws.summary.serviceUser],
        ["Visit", ws.summary.rows.find((r) => r.k === "Visit")?.v ?? ws.summary.reference],
        [ws.mode === "fill" ? "Place to fill" : "Replacing", ws.current ? `${ws.current.name} (${SLOT_LABEL[ws.slot!]})` : SLOT_LABEL[ws.slot!]],
        ["Care worker", <b key="c">{sel.candidate.name}</b>],
        ["Other carer", ws.carersRequired < 2 ? "None (one-carer visit)" : ws.others.length ? `${ws.others.join(", ")} stays booked, unchanged` : "The other place is empty"],
        ["Care tasks", ws.careTasks.length ? ws.careTasks.join(", ") : "None listed on the visit"],
        ["Eligibility", blocked ? "Not eligible" : sel.result.state === "REQUIRES_REVIEW" ? "Allowed, with warnings to review" : "Passes every check"],
      ]} />
      <h4 className="mb-1.5 mt-4 text-[14.5px] font-semibold text-slate-900">Safety checks</h4>
      <SafetyChecks checks={sel.checks} />
      <p className="mt-1.5 text-[12.5px] text-slate-500">Checked now against HR and the rota. Everything is checked again when you confirm.</p>
      {blocked ? (
        <p role="alert" className="mt-4 rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[13.5px] text-[#8a1f1a]">{sel.candidate.name} cannot be booked: {sel.result.blocking.map((b) => b.message).join("; ")}. <Link href={back} scroll={false}>Choose someone else</Link></p>
      ) : (
        <form action={coverBookAction} className="mt-4 space-y-3">
          <input type="hidden" name="back" value={u.at({ fcStep: "review", fcStaff: sel.candidate.id, fcSrc: source })} />
          <input type="hidden" name="done" value={u.at({ fcStep: "done", fcStaff: undefined, fcSrc: undefined, fcQ: undefined, fcArea: undefined })} />
          <input type="hidden" name="mode" value={ws.mode} />
          <input type="hidden" name="visitId" value={ws.summary.visitId} />
          <input type="hidden" name="slot" value={ws.slot!} />
          <input type="hidden" name="staffId" value={sel.candidate.id} />
          <input type="hidden" name="lockVersion" value={ws.lockVersion} />
          <input type="hidden" name="expectStaffId" value={ws.current?.staffId ?? ""} />
          <input type="hidden" name="source" value={sel.rank !== null && source === "RECOMMENDED" ? "RECOMMENDED" : "MANUAL"} />
          {sel.rank !== null ? <input type="hidden" name="rank" value={sel.rank} /> : null}
          {ws.mode === "replace" ? <label className="block"><span className="label">Why is {ws.current?.name ?? "the carer"} being replaced?</span><input name="replaceReason" required minLength={3} maxLength={300} className="input w-full" placeholder="For example: called in sick" /></label> : null}
          <WarningsAndReason warnings={warnings} />
          <div className="flex flex-wrap gap-2">
            <button className={PURPLE}>{text.confirm}</button>
            <Link href={back} scroll={false} className={QUIET}>Choose someone else</Link>
          </div>
          <p className="text-[12.5px] text-slate-500">Saving checks everything again with the visit locked. If the visit changed or someone else filled this place in the meantime, nothing is saved and you are told why.{ws.mode === "replace" ? ` ${ws.current?.name ?? "The booked carer"} is taken off this visit only; any other carer stays.` : ""}</p>
        </form>
      )}
    </section>
  );
}

function VisitDone({ ws, u, comms }: { ws: VisitCover; u: U; comms: string | null }) {
  const open = ws.mode === "fill" && ws.slots.length > 0 && ws.canBook;
  return (
    <section aria-labelledby="fc-done" className="mt-4">
      <div className="rounded-[8px] border border-[#b7dfc0] bg-[#f1faf3] p-3.5">
        <h3 id="fc-done" className="text-[16px] font-semibold text-[#1e6b2c]" data-autofocus tabIndex={-1}>{open ? "Cover partly booked" : "Cover booked"}</h3>
        <p className="mt-1 text-[13.5px] text-slate-800">{ws.summary.rows.find((r) => r.k === "Booked now")?.v}</p>
        {open ? <p className="mt-1 text-[13.5px] font-medium text-[#7a5200]">{ws.slots.length} more carer {ws.slots.length === 1 ? "place is" : "places are"} empty on this visit.</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {open ? <Link href={u.at({ fcStep: undefined, fcSlot: ws.slots[0]!.slot })} scroll={false} className={PURPLE}>Fill {ws.slots[0]!.label}</Link> : null}
          <Link href={`/rota/visits?date=${ws.date}&visit=${ws.summary.visitId}`} className={QUIET}>Open the Daily Rota</Link>
          <Link href={`/rota/visits/${ws.summary.visitId}`} className={QUIET}>Open the visit</Link>
        </div>
      </div>
      <CommsNudge u={u} kind={comms} />
    </section>
  );
}

// ── Recovery (a missed call) ────────────────────────────────────────────

function TimeForm({ ws, u, step }: { ws: RecoveryCover; u: U; step?: string }) {
  const view = ws.view;
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

async function RecoveryCoverTab({ ctx, ws, u, step, sp }: { ctx: Ctx; ws: RecoveryCover; u: U; step: string; sp: Params }) {
  const view = ws.view;
  const s = view.summary;
  const showRecord = step === "done" || (!view.state.canFind && view.state.recovery);
  if (showRecord) return <RecoveryResult ctx={ctx} ws={ws} u={u} />;
  if (!view.state.canFind) {
    return (
      <section aria-label="Cover" className="mt-4 rounded-[8px] border border-slate-200 p-4 text-[14px]">
        <p className="font-medium">Find Cover is not available for this call.</p>
        <p className="mt-1 text-slate-700">{view.state.text}</p>
        <Link href={`/rota/missed/${s.caseId}`} className="mt-3 inline-block text-[14px]">Open the case</Link>
      </section>
    );
  }
  if (step === "review" && ws.selected) return <RecoveryReview ws={ws} u={u} sp={sp} />;
  const more = (
    <>
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
    </>
  );
  if (step === "manual") {
    return (
      <>
        <TimeForm ws={ws} u={u} step="manual" />
        <Manual ws={ws} u={u} q={sp.fcQ} area={sp.fcArea} reviewHidden={{}} />
        <Actions ws={ws} u={u} reviewForm={!view.timeError && ws.list.some((c) => c.state !== "NOT_ELIGIBLE") ? "fc-manual" : null} manual={false} more={more} />
      </>
    );
  }
  return (
    <>
      <TimeForm ws={ws} u={u} />
      {view.timeError ? null : <Recommended ws={ws} u={u} reviewHidden={{}} />}
      <Actions ws={ws} u={u} reviewForm={ws.recommended.length && !view.timeError ? "fc-pick" : null} manual more={more} />
    </>
  );
}

function RecoveryReview({ ws, u, sp }: { ws: RecoveryCover; u: U; sp: Params }) {
  const view = ws.view;
  const sel = ws.selected!;
  const s = view.summary;
  const start = view.state.recovery?.scheduledStart ?? view.window?.start ?? s.start;
  const end = view.state.recovery?.scheduledEnd ?? view.window?.end ?? s.end;
  const blocked = sel.result.state === "NOT_ELIGIBLE";
  const warnings = sel.result.warnings.map((w) => w.message);
  const source = sp.fcSrc === "MANUAL" ? "MANUAL" : "RECOMMENDED";
  const back = u.at({ fcStep: source === "MANUAL" ? "manual" : undefined, fcStaff: undefined });
  return (
    <section aria-labelledby="fc-review" className="mt-4">
      <h3 id="fc-review" className="text-[16px] font-semibold text-slate-900" data-autofocus tabIndex={-1}>Review Replacement Cover</h3>
      <ReviewDetails rows={[
        ["Service user", s.serviceUser],
        ["Original visit", s.reference],
        ["Missed appointment", `${fmtLondonDate(s.date, { weekday: "short", day: "numeric", month: "short" })} ${londonTime(s.start)}–${londonTime(s.end)}`],
        ["Replacement", <b key="r">{sel.candidate.name}</b>],
        ["Recovery visit", `${view.state.recovery ? `${view.state.recovery.reference}, ` : "New visit, "}${fmtLondonDate(londonDate(start), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(start)}–${londonTime(end)}`],
        ["Duration", `${s.minutes} min`],
        ["Staffing", `${view.slot === "SECOND" ? "Second" : "First"} of ${s.carersRequired} ${s.carersRequired === 1 ? "carer" : "carers"}`],
        ["Eligibility", blocked ? "Not eligible" : sel.result.state === "REQUIRES_REVIEW" ? "Allowed, with warnings to review" : "Passes every check"],
      ]} />
      <h4 className="mb-1.5 mt-4 text-[14.5px] font-semibold text-slate-900">Safety checks</h4>
      <SafetyChecks checks={sel.checks} />
      <p className="mt-1.5 text-[12.5px] text-slate-500">Checked now against HR and the rota. Everything is checked again when you confirm.</p>
      {blocked ? (
        <p role="alert" className="mt-4 rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[13.5px] text-[#8a1f1a]">{sel.candidate.name} cannot be booked: {sel.result.blocking.map((b) => b.message).join("; ")}.</p>
      ) : (
        <form action={coverConfirmAction} className="mt-4 space-y-3">
          <input type="hidden" name="back" value={u.at({ fcStep: "review", fcStaff: sel.candidate.id, fcSrc: source })} />
          <input type="hidden" name="done" value={u.at({ fcStep: "done", fcStaff: undefined, fcSrc: undefined, fcQ: undefined, fcArea: undefined })} />
          <input type="hidden" name="caseId" value={s.caseId} />
          <input type="hidden" name="staffId" value={sel.candidate.id} />
          <input type="hidden" name="date" value={view.date} />
          <input type="hidden" name="time" value={view.time} />
          <input type="hidden" name="source" value={sel.rank !== null && source === "RECOMMENDED" ? "RECOMMENDED" : "MANUAL"} />
          {sel.rank !== null ? <input type="hidden" name="rank" value={sel.rank + 1} /> : null}
          {ws.recommended.map((r) => <input key={r.id} type="hidden" name="suggested" value={r.id} />)}
          <input type="hidden" name="seenRecoveryId" value={view.state.recovery?.id ?? ""} />
          <WarningsAndReason warnings={warnings} />
          <div className="flex flex-wrap gap-2">
            <button className={PURPLE}>Confirm Cover</button>
            <Link href={back} scroll={false} className={QUIET}>Choose someone else</Link>
          </div>
          <p className="text-[12.5px] text-slate-500">Confirming books {sel.candidate.name} on a new recovery visit and tells them in the app if they have a sign-in. The missed call stays missed and its investigation stays open.</p>
        </form>
      )}
    </section>
  );
}

async function RecoveryResult({ ctx, ws, u }: { ctx: Ctx; ws: RecoveryCover; u: U }) {
  const view = ws.view;
  const caseId = view.summary.caseId;
  const r = await coverRecord(ctx, caseId);
  const rv = r.recovery;
  const live = r.covers.filter((x) => x.recoveryVisit.id === rv?.id);
  const lateNote = rv && view.c.visit.status !== "MISSED" ? "The booked carer has since clocked in on the original visit. Check whether the recovery visit is still needed." : null;
  const comms = rv ? (await communicationStates(ctx, [rv.id])).get(rv.id)?.kind ?? null : null;
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
      <CommsNudge u={u} kind={comms} />
      <h4 className="mb-1.5 mt-4 text-[14.5px] font-semibold text-slate-900">What has happened so far</h4>
      <ul className="divide-y divide-slate-100 rounded-[8px] border border-slate-200 text-[13.5px]" aria-label="Cover progress">
        {r.facts.map((f) => (
          <li key={f.label} className="flex gap-2.5 px-3 py-2">
            <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${f.done ? CHECK_TONE.ok.cls : CHECK_TONE.info.cls}`}>{f.done ? "✓" : "·"}</span>
            <span><b className="font-medium">{f.label}</b>: {f.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
