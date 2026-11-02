import { redirect } from "next/navigation";
import { ClockCounterClockwise, PhoneX, UserPlus, Users, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { addDays, fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { suName } from "@/server/rota/queries";
import { PRIORITY_LABEL, PRIORITY_RULE, parseUnassigned, unassignedBoard, type Priority, type UnassignedItem } from "@/server/rota/unassigned";
import { missedCallRegister, STAGE_LABEL, VISIT_STATUS_NOW, type MissedRegister } from "@/server/rota/missed-calls";
import { coverStates } from "@/server/rota/missed-cover";
import { Badge, Empty, Flash, type Tone } from "@/components/ui";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";
import { coverHref, ReplacementCoverPanel } from "@/components/replacement-cover";
import { outstandingCommunication } from "@/server/rota/cover-communication";

export const dynamic = "force-dynamic";

/** How many of each kind of work the page lists before pointing to the full register. */
const SHOWN = 8;
/** Open missed-call cases are looked for over this many days, the Missed Calls page's default custom range. */
const MISSED_DAYS = 30;

const PRIORITY_BADGE: Record<Priority, string> = { URGENT: "bg-[#fdecec] text-[#b42318]", HIGH: "bg-[#fdf3d8] text-[#8a5a00]", NORMAL: "bg-[#eef4ff] text-[#1d4f91]" };
const STAGE_TONE: Record<string, Tone> = { NEW: "rose", INVESTIGATING: "amber", AWAITING_SIGNOFF: "violet", CLOSED: "green" };
const ACTION = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-2.5 text-[13.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
const PRIMARY = `${ACTION} border-[#5b2bb5] bg-[#5b2bb5] text-white hover:bg-[#4c2398] hover:text-white`;
const SECONDARY = `${ACTION} border-[#5b2bb5] bg-white text-[#5b2bb5] hover:bg-[#f6f2fd]`;

/**
 * Visits Needing Attention: the two kinds of visit work the office must act on, side by side on one page. The upper
 * half of each section is a short summary, then the most pressing records with their direct actions, then a link to
 * the full register. Nothing here has its own rules: the figures and rows come from the same services as the
 * Unassigned Visits and Missed Calls pages, and every action opens that page's own workflow (Find Cover, Investigate).
 */
export default async function AttentionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  const showUnassigned = hasOrgPermission(ctx, "rota.view");
  const showMissed = hasOrgPermission(ctx, "rota.monitor");
  if (!showUnassigned && !showMissed) redirect(rotaHome(ctx));

  return (
    <div className="daily-rota -mt-1">
      <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[10px] bg-[#efeafc] text-[#5b2bb5]"><WarningOctagon size={30} weight="duotone" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-[#101828]">Visits Needing Attention</h1>
          <p className="text-[15px] font-semibold text-[#101828]">Upcoming visits without enough carers, and missed calls still to investigate.</p>
        </div>
      </header>
      <Flash searchParams={sp} />
      <div className={`grid grid-cols-1 items-start gap-3 ${showUnassigned && showMissed ? "min-[1400px]:grid-cols-2" : ""}`}>
        {showUnassigned ? <UnassignedSection ctx={ctx} /> : null}
        {showMissed ? <MissedSection ctx={ctx} /> : null}
      </div>
      {hasOrgPermission(ctx, "rota.edit") ? <CommunicationSectionList ctx={ctx} /> : null}
      {sp.cover && hasOrgPermission(ctx, "rota.edit") ? <ReplacementCoverPanel ctx={ctx} sp={sp} basePath="/rota/attention" keep={{}} /> : null}
    </div>
  );
}

function SectionHead({ id, icon, title, count, noun, href, linkLabel }: { id: string; icon: React.ReactNode; title: string; count: number; noun: string; href: string; linkLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#eaecf0] px-4 py-3">
      <span aria-hidden className="text-[#5b2bb5]">{icon}</span>
      <h2 id={id} className="mr-auto text-[18px] font-bold text-[#101828]">
        {title} <span className="ml-1 rounded-full bg-[#f2f4f7] px-2 py-0.5 align-middle text-[13px] font-semibold tabular-nums text-[#344054]" data-testid={`${id}-count`}>{count}<span className="sr-only"> {noun}</span></span>
      </h2>
      <Link href={href} className="text-[14px] font-semibold">{linkLabel}</Link>
    </div>
  );
}

function Figure({ value, label, tone = "text-[#101828]", href, testId }: { value: number; label: string; tone?: string; href?: string; testId?: string }) {
  const body = <><strong data-testid={testId} className={`block text-[20px] font-bold leading-6 tabular-nums ${value ? tone : "text-[#101828]"}`}>{value}</strong><span className="block text-[12.5px] text-[#475467]">{label}</span></>;
  return href ? <Link href={href} className="block px-3 py-2 text-inherit no-underline hover:bg-[#f9fafb]">{body}</Link> : <div className="px-3 py-2">{body}</div>;
}

function Coverage({ item }: { item: UnassignedItem }) {
  const required = Math.min(2, item.visit.carersRequired);
  const filled = required - item.openSlots.length;
  const words = filled === 0 ? (required > 1 ? "both carers missing" : "no carer allocated") : "one carer missing";
  return (
    <span title={`${filled} of ${required} carers booked: ${words}`} className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${filled === 0 ? "bg-[#fdecec] text-[#b42318]" : "bg-[#fdf3d8] text-[#8a5a00]"}`}>
      <Users size={15} weight="fill" aria-hidden />{filled}/{required}<span className="sr-only"> carers, {words}</span>
    </span>
  );
}

async function UnassignedSection({ ctx }: { ctx: Ctx }) {
  // The same board as Unassigned Visits on "This Week": today and the next six days, most urgent first.
  const f = parseUnassigned({ when: "week" }, londonDate());
  const board = await unassignedBoard(ctx, f);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const list = "/rota/unassigned?when=week";
  const rows = board.all.slice(0, SHOWN);
  return (
    <section aria-labelledby="attention-unassigned" className="min-w-0 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white" data-testid="attention-unassigned">
      <SectionHead id="attention-unassigned" icon={<WarningOctagon size={22} weight="bold" />} title="Unassigned Visits" count={board.summary.visits} noun="unassigned visits" href={list} linkLabel="Open Unassigned Visits" />
      <div className="grid grid-cols-2 divide-x divide-[#f2f4f7] border-b border-[#eaecf0] sm:grid-cols-4">
        <Figure value={board.summary.visits} label="Visits this week" testId="att-un-visits" href={list} />
        <Figure value={board.summary.urgent} label="Urgent" tone="text-[#b42318]" href={`${list}&priority=URGENT`} testId="att-un-urgent" />
        <Figure value={board.summary.partial} label="Partly staffed" tone="text-[#8a5a00]" href={`${list}&staffing=partial`} />
        <Figure value={board.summary.slots} label="Empty carer places" />
      </div>
      {rows.length ? (
        <ul className="divide-y divide-[#f2f4f7]" aria-label="Most urgent unassigned visits">
          {rows.map((it) => {
            const v = it.visit;
            const date = fromDbDate(v.date);
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[14px]" data-testid="attention-unassigned-row">
                <div className="w-[118px] shrink-0 tabular-nums">
                  <span className="block font-semibold text-[#101828]">{fmtLondonDate(date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="block text-[13px] text-[#475467]">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
                </div>
                <div className="min-w-0 flex-1 basis-[180px]">
                  <Link href={`/rota/service-users/${v.serviceUser.id}`} className="block truncate font-semibold text-[#3b1f99]">{suName(v.serviceUser)}</Link>
                  <span className="block truncate text-[13px] text-[#475467]" title={it.reason}>{v.callType.name}{v.area ? ` · ${v.area.name}` : ""} · {it.reason}</span>
                </div>
                <span title={it.why} className={`inline-flex rounded-[6px] px-2 py-0.5 text-[13px] font-semibold ${PRIORITY_BADGE[it.priority]}`}>{PRIORITY_LABEL[it.priority]}<span className="sr-only">: {it.why}</span></span>
                <Coverage item={it} />
                <span className="ml-auto flex gap-1.5">
                  {canEdit ? (
                    <>
                      <Link href={coverHref("/rota/attention", {}, { id: v.id })} scroll={false} className={PRIMARY} aria-label={`Find cover for ${suName(v.serviceUser)} at ${londonTime(v.scheduledStart)}: recommended carers`}><UserPlus size={16} aria-hidden />Find Cover</Link>
                      <Link href={`${coverHref("/rota/attention", {}, { id: v.id })}&fcStep=manual`} scroll={false} className={SECONDARY} aria-label={`Choose a carer by hand for ${suName(v.serviceUser)} at ${londonTime(v.scheduledStart)}`}>Manual</Link>
                    </>
                  ) : <Link href={`/rota/visits?date=${fromDbDate(v.date)}&visit=${v.id}`} className={SECONDARY}>View</Link>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <div className="p-4"><Empty>No upcoming visits are short of a carer in the next 7 days.</Empty></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#eaecf0] px-4 py-2.5 text-[13.5px]">
        <span className="mr-auto text-[#475467]">{board.summary.visits > rows.length ? `Showing the ${rows.length} most urgent of ${board.summary.visits}.` : "Upcoming visits only."} <span className="sr-only">{PRIORITY_RULE}</span></span>
        {board.summary.visits > rows.length ? <Link href={list} className="font-semibold">See all {board.summary.visits}</Link> : null}
        <Link href="/rota/unassigned?tab=history" className="inline-flex items-center gap-1 font-semibold"><ClockCounterClockwise size={16} aria-hidden />Coverage History</Link>
      </div>
    </section>
  );
}

async function MissedSection({ ctx }: { ctx: Ctx }) {
  // The Missed Calls register itself, filtered to cases that are still open over the last 30 days.
  const today = londonDate();
  const filters = { period: "custom", from: addDays(today, -(MISSED_DAYS - 1)), to: today, stage: "open" };
  const reg: MissedRegister = await missedCallRegister(ctx, filters);
  const list = `/rota/missed?${new URLSearchParams(filters)}`;
  const rows = reg.rows.slice(0, SHOWN);
  const covers = await coverStates(ctx, rows.map((r) => r.id));
  const canWork = hasOrgPermission(ctx, "rota.edit");
  const open = reg.rows.length;
  const notInvestigated = reg.rows.filter((r) => !r.reasonCode).length;
  const pastDeadline = reg.rows.filter((r) => r.overdue).length;
  const escalated = reg.rows.filter((r) => r.escalatedAt).length;
  return (
    <section aria-labelledby="attention-missed" className="min-w-0 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white" data-testid="attention-missed">
      <SectionHead id="attention-missed" icon={<PhoneX size={22} weight="bold" />} title="Missed Calls" count={open} noun="open missed-call cases" href={list} linkLabel="Open Missed Calls" />
      <div className="grid grid-cols-2 divide-x divide-[#f2f4f7] border-b border-[#eaecf0] sm:grid-cols-4">
        <Figure value={open} label={`Open cases, last ${MISSED_DAYS} days`} testId="att-mc-open" href={list} />
        <Figure value={notInvestigated} label="No reason recorded" tone="text-[#7a5200]" href={`${list}&smart=uninvestigated`} testId="att-mc-uninvestigated" />
        <Figure value={pastDeadline} label="Past deadline" tone="text-[#b42318]" href={`/rota/missed?${new URLSearchParams({ ...filters, stage: "overdue" })}`} />
        <Figure value={escalated} label="Escalated" tone="text-[#b42318]" href={`/rota/missed?${new URLSearchParams({ ...filters, stage: "escalated" })}`} />
      </div>
      {rows.length ? (
        <ul className="divide-y divide-[#f2f4f7]" aria-label="Open missed calls, newest first">
          {rows.map((r) => {
            const cover = covers.get(r.id);
            const warnings = [r.overdue ? "Past investigation deadline" : null, r.highRisk ? "High-risk service user" : null, r.escalatedAt ? "Escalated" : null, r.repeatCount ? `Carer missed ${r.repeatCount} recently` : null, !r.coordinatorId ? "No coordinator" : null].filter((w): w is string => !!w);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[14px]" data-testid="attention-missed-row">
                <div className="w-[118px] shrink-0 tabular-nums">
                  <span className="block font-semibold text-[#101828]">{fmtLondonDate(londonDate(r.visit.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="block text-[13px] text-[#475467]">Due {londonTime(r.visit.scheduledStart)}</span>
                </div>
                <div className="min-w-0 flex-1 basis-[180px]">
                  <Link href={`/rota/service-users/${r.visit.serviceUser.id}`} className="block truncate font-semibold text-[#3b1f99]">{r.serviceUserName}</Link>
                  <span className="block truncate text-[13px] text-[#475467]">{r.carerName ?? "No carer was booked"} · {VISIT_STATUS_NOW[r.visit.status]}</span>
                  {warnings.length ? <span className="block truncate text-[12.5px] font-medium text-[#9b231d]" title={warnings.join(", ")}>{warnings.join(" · ")}</span> : null}
                </div>
                <Badge tone={STAGE_TONE[r.stage] ?? "slate"}>{STAGE_LABEL[r.stage]}</Badge>
                <span className="ml-auto flex gap-1.5">
                  {cover?.canFind && canWork ? <Link href={coverHref("/rota/attention", {}, { id: r.id, mode: "recovery" })} scroll={false} className={SECONDARY} aria-label={`Find recovery cover for ${r.visit.reference}`}><UserPlus size={16} aria-hidden />Find Cover</Link> : null}
                  {cover?.kind === "booked" ? <Badge tone="green">Cover booked</Badge> : null}
                  <Link href={`/rota/missed/${r.id}`} className={PRIMARY} aria-label={`Investigate ${r.visit.reference}`}>Investigate</Link>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <div className="p-4"><Empty>No open missed-call cases in the last {MISSED_DAYS} days.</Empty></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#eaecf0] px-4 py-2.5 text-[13.5px]">
        <span className="mr-auto text-[#475467]">{open > rows.length ? `Showing the newest ${rows.length} of ${open}.` : `Cases from ${fmtLondonDate(filters.from, { day: "numeric", month: "short" })} to today.`} Closed cases stay in Missed Calls.</span>
        {open > rows.length ? <Link href={list} className="font-semibold">See all {open}</Link> : null}
        <Link href="/rota/missed" className="font-semibold">All missed calls</Link>
      </div>
    </section>
  );
}

/**
 * Communication still owed to service users after cover was arranged: not yet contacted, attempted without
 * confirmation, or arrangements changed since they were told. Each row shows who is responsible and when it is due,
 * and opens the same Find Cover panel on its Contact & communication tab, so the coordinator can finish the record.
 */
async function CommunicationSectionList({ ctx }: { ctx: Ctx }) {
  const { items, total } = await outstandingCommunication(ctx);
  const rows = items.slice(0, SHOWN);
  const tone = (k: string) => (k === "NOT_CONTACTED" ? "rose" : "amber") as Tone;
  return (
    <section aria-labelledby="attention-comms" className="mt-3 min-w-0 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white" data-testid="attention-comms">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#eaecf0] px-4 py-3">
        <span aria-hidden className="text-[#5b2bb5]"><ChatCircleText size={22} weight="bold" /></span>
        <h2 id="attention-comms" className="mr-auto text-[18px] font-bold text-[#101828]">
          Communication Outstanding <span className="ml-1 rounded-full bg-[#f2f4f7] px-2 py-0.5 align-middle text-[13px] font-semibold tabular-nums text-[#344054]" data-testid="attention-comms-count">{total}<span className="sr-only"> visits with communication outstanding</span></span>
        </h2>
        <span className="text-[13px] text-[#475467]">After cover was arranged through Find Cover</span>
      </div>
      {rows.length ? (
        <ul className="divide-y divide-[#f2f4f7]" aria-label="Visits with communication outstanding, soonest due first">
          {rows.map((it) => (
            <li key={it.visitId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[14px]" data-testid="attention-comms-row">
              <div className="w-[118px] shrink-0 tabular-nums">
                <span className="block font-semibold text-[#101828]">{fmtLondonDate(londonDate(it.start), { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="block text-[13px] text-[#475467]">{londonTime(it.start)}–{londonTime(it.end)}</span>
              </div>
              <div className="min-w-0 flex-1 basis-[180px]">
                <Link href={`/rota/service-users/${it.serviceUserId}`} className="block truncate font-semibold text-[#3b1f99]">{it.serviceUser}</Link>
                <span className="block truncate text-[13px] text-[#475467]">{it.reference} · Responsible: {it.owner}</span>
              </div>
              <Badge tone={tone(it.state.kind)}>{it.state.label}</Badge>
              <span className={`text-[13px] tabular-nums ${it.overdue ? "font-semibold text-[#b42318]" : "text-[#475467]"}`}>{it.state.followUp ? "Follow-up due" : "Due"} {fmtLondonDate(londonDate(it.dueAt), { day: "numeric", month: "short" })} {londonTime(it.dueAt)}{it.overdue ? " (overdue)" : ""}</span>
              <span className="ml-auto flex gap-1.5">
                <Link href={coverHref("/rota/attention", {}, it.caseId ? { id: it.caseId, mode: "recovery", tab: "comms" } : { id: it.visitId, tab: "comms" })} scroll={false} className={PRIMARY} aria-label={`Record communication for ${it.serviceUser}, ${it.reference}`}>Record communication</Link>
              </span>
            </li>
          ))}
        </ul>
      ) : <div className="p-4"><Empty>No communication is outstanding for cover arranged in the last day or the next two weeks.</Empty></div>}
      {total > rows.length ? <p className="border-t border-[#eaecf0] px-4 py-2.5 text-[13.5px] text-[#475467]">Showing the {rows.length} due soonest of {total}.</p> : null}
    </section>
  );
}
