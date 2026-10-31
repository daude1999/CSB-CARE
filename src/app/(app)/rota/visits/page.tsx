import type { ReactNode } from "react";
import type { VisitStatus } from "@prisma/client";
import { CalendarBlank, CaretDown, CaretLeft, CaretRight, CheckCircle, Clock, Funnel, Gauge, List, Rows, Users, UsersThree, Warning, WarningCircle, XCircle, CalendarDots } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName } from "@/server/rota/queries";
import { attentionOf, visitKpis } from "@/server/rota/overview";
import { visitInspector } from "@/server/rota/inspector";
import { addDays, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonMinute, londonTime, mondayOf } from "@/lib/london";
import { bulkVisitsAction } from "@/app/rota-actions";
import { Empty, Flash } from "@/components/ui";
import { dayTimeline } from "@/server/rota/roster";
import { DailyTimeline } from "@/components/daily-timeline";
import { VisitInspector } from "@/components/visit-inspector";
import { AutoSubmitForm } from "@/components/auto-submit";
import { CarerSlots, FlagBadges, rotaState, VISIT_LABEL, NotBuiltNotice } from "@/components/rota-ui";
import { ordinalDate } from "@/components/rota-dashboard";
import { weekIsBuilt } from "@/server/rota/build";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(VISIT_LABEL) as VisitStatus[];
const RISK: Record<string, { label: string; colour: string }> = { LOW: { label: "Low", colour: "#3f9a5b" }, MEDIUM: { label: "Medium", colour: "#e0a526" }, HIGH: { label: "High", colour: "#d9473f" } };

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const minsBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60000);

const TILE = {
  lavender: "bg-[#f3f0fc] text-[#6b3fd0]",
  green: "bg-[#ebf7ef] text-[#1c8a4a]",
  amber: "bg-[#fdf4e3] text-[#c27a06]",
  red: "bg-[#fdeeee] text-[#c8323a]",
  orange: "bg-[#fdf1e7] text-[#d0631a]",
} as const;

function Tile({ label, value, icon, tone, href, active, title }: { label: string; value: number; icon: ReactNode; tone: keyof typeof TILE; href: string; active: boolean; title?: string }) {
  return (
    <Link href={href} title={title} aria-current={active ? "true" : undefined} className={`flex min-w-0 items-center gap-3 rounded-[10px] px-4 py-2.5 no-underline hover:shadow-[0_1px_6px_rgba(16,24,40,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6b3fd0] ${TILE[tone].split(" ")[0]} ${active ? "ring-2 ring-[#6b3fd0]/40" : ""}`}>
      <span aria-hidden className={`shrink-0 ${TILE[tone].split(" ")[1]}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-[#0b1530]">{label}</span>
        <span data-value className="block text-[24px] font-bold leading-tight tabular-nums text-[#0b1530]">{value.toLocaleString("en-GB")}</span>
      </span>
    </Link>
  );
}

function AttnItem({ icon, tone, title, text, count, href, active }: { icon: ReactNode; tone: "red" | "amber" | "lavender" | "orange"; title: string; text: string; count: number; href: string; active: boolean }) {
  const t = { red: ["bg-[#fff6f6]", "text-[#c8323a]"], amber: ["bg-[#fffaf1]", "text-[#c27a06]"], lavender: ["bg-[#f8f6fe]", "text-[#6b3fd0]"], orange: ["bg-[#fff8f2]", "text-[#d0631a]"] }[tone];
  return (
    <li>
      <Link href={href} aria-current={active ? "true" : undefined} className={`flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 no-underline hover:shadow-[0_1px_4px_rgba(16,24,40,0.10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6b3fd0] ${t[0]} ${active ? "border-[#6b3fd0]" : "border-[#eef0f3]"}`}>
        <span aria-hidden className={`shrink-0 ${t[1]}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold text-[#0b1530]">{title}</span>
          <span className="block truncate text-[13px] text-[#475467]">{text}</span>
        </span>
        <span className={`text-[15px] font-semibold tabular-nums ${count ? t[1] : "text-slate-400"}`}>{count}</span>
        <CaretRight size={16} aria-hidden className="text-[#344054]" />
      </Link>
    </li>
  );
}

const SEL = "h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#0b1530]";

/**
 * Daily Rota, laid out to the owner's approved design (31 Oct 2026): the day's figures at the top, then filters, then
 * Needs attention on the left, the carers' timeline in the middle (one row per team member, each visit a card titled by
 * the service user) and the chosen visit's details on the right. The List layout keeps every column and bulk action.
 */
export default async function DailyRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const today = londonDate();
  const status = STATUSES.includes(sp.status as VisitStatus) ? (sp.status as VisitStatus) : undefined;
  const lk = await rotaLookups(ctx);
  const branch = sp.branch && lk.branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const area = sp.area && lk.areas.some((a) => a.id === sp.area && (!branch || a.branchId === branch)) ? sp.area : undefined;
  const where = { date, branchId: branch, areaId: area };
  const filters = { ...where, staffId: sp.carer || undefined, serviceUserId: sp.su || undefined, callTypeId: sp.call || undefined, status, unassigned: sp.view === "unassigned", review: sp.view === "review", late: sp.view === "late", includeCancelled: sp.cancelled === "1", q: sp.q?.trim() || undefined };
  const narrowed = !!(filters.staffId || filters.serviceUserId || filters.callTypeId || status || sp.view || filters.includeCancelled || filters.q);
  // The figures and Needs attention always describe the whole day in the chosen branch and area; the other filters
  // narrow only the timeline or list, so a figure never changes because you are looking at part of the day.
  const [{ rows, truncated }, whole] = await Promise.all([listVisits(ctx, filters), narrowed ? listVisits(ctx, where) : Promise.resolve(null)]);
  const dayRows = whole?.rows ?? rows;
  const k = visitKpis(dayRows);
  const now = new Date();
  const attn = attentionOf(dayRows, now);
  const attnTotal = new Set(Object.values(attn).flat().map((v) => v.id)).size;
  const review = dayRows.filter((v) => v.flags.review.length > 0 && ["SCHEDULED", "MISSED"].includes(v.status)).length;
  const notBuilt = dayRows.length === 0 && !(await weekIsBuilt(ctx, date));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canPublish = hasOrgPermission(ctx, "rota.build");
  const layout = sp.layout === "list" ? "list" : "timeline";
  const timeline = layout === "timeline" ? await dayTimeline(ctx, date, rows, lk) : null;
  const inspector = layout === "timeline" && sp.visit ? await visitInspector(ctx, sp.visit) : null;
  const params = { date: date === today ? undefined : date, branch, area, carer: sp.carer, su: sp.su, call: sp.call, status: sp.status, view: sp.view, cancelled: sp.cancelled, q: sp.q, layout: layout === "list" ? "list" : undefined };
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const url = (extra: Record<string, string | undefined>) => { const q = qs(extra); return `/rota/visits${q ? `?${q}` : ""}`; };
  const back = url({ visit: inspector ? inspector.visit.id : undefined, date });
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const scheduled = live.reduce((n, r) => n + minsBetween(r.scheduledStart, r.scheduledEnd), 0);
  const clocked = live.reduce((n, r) => n + (r.actualStart && r.actualEnd ? minsBetween(r.actualStart, r.actualEnd) : 0), 0);
  const unassigned = rows.reduce((n, r) => n + r.flags.unassignedSlots, 0);
  const only = sp.view === "late" ? "late visits" : sp.view === "review" ? "visits with an allocation to review" : sp.view === "unassigned" ? "unassigned visits" : status ? `${VISIT_LABEL[status].toLowerCase()} visits` : null;
  const clearView = { status: undefined, view: undefined };
  const extraFilters = [sp.call, sp.view, sp.cancelled === "1" ? "1" : undefined, sp.q?.trim()].filter(Boolean).length;
  const areas = lk.areas.filter((a) => !branch || a.branchId === branch);
  const staffOpts = lk.staff.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const suOpts = lk.serviceUsers.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const unassignedTimes = attn.unassigned.length ? `${londonTime(attn.unassigned[0]!.scheduledStart)} – ${londonTime(attn.unassigned[attn.unassigned.length - 1]!.scheduledStart)}` : "No upcoming visits without a carer";
  const carerRows = timeline ? timeline.rows.filter((r) => r.id !== "unassigned").length : 0;
  const segBtn = (active: boolean) => `flex h-10 items-center gap-2 rounded-[8px] px-4 text-[14.5px] font-medium no-underline ${active ? "bg-[#6b3fd0] text-white" : "border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50"}`;
  const segSoft = (active: boolean) => `flex h-10 items-center gap-2 rounded-[8px] px-4 text-[14.5px] font-medium no-underline ${active ? "bg-[#efeafc] text-[#5a3aa8]" : "border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50"}`;

  return (
    <div className="daily-rota -mt-1">
      <header className="mb-3 grid grid-cols-1 items-center gap-4 2xl:grid-cols-[minmax(280px,auto)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#6b3fd0]">Rostering &amp; Care Management</p>
          <h1 className="text-[30px] font-bold leading-tight text-[#0b1530]">Daily Rota</h1>
          <p className="mt-1 flex items-center gap-2 text-[18px] text-[#0b1530]"><CalendarBlank size={22} aria-hidden />{ordinalDate(date)}</p>
        </div>
        <section aria-label="The day's figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Tile label="Scheduled" value={k.total} tone="lavender" icon={<CalendarBlank size={30} />} href={url(clearView)} active={false} title="Visits on this day, not counting cancelled ones" />
          <Tile label="Completed" value={k.completed} tone="green" icon={<CheckCircle size={32} />} href={url({ ...clearView, status: "COMPLETED" })} active={status === "COMPLETED"} />
          <Tile label="Unassigned" value={k.unassigned} tone="amber" icon={<UsersThree size={32} />} href={url({ ...clearView, view: "unassigned" })} active={sp.view === "unassigned"} title="Visits with at least one carer slot not filled" />
          <Tile label="Missed" value={k.missed} tone="red" icon={<Warning size={32} />} href={url({ ...clearView, status: "MISSED" })} active={status === "MISSED"} />
          <Tile label="Late" value={k.late} tone="orange" icon={<Clock size={32} />} href={url({ ...clearView, view: "late" })} active={sp.view === "late"} title="Started, or still not started, after the late threshold in Rota Settings" />
        </section>
      </header>
      <Flash searchParams={sp} />

      <AutoSubmitForm label="Filters" className="mb-3 grid grid-cols-2 items-end gap-3 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <input type="hidden" name="date" value={date} />
        {params.layout ? <input type="hidden" name="layout" value={params.layout} /> : null}
        {sp.call ? <input type="hidden" name="call" value={sp.call} /> : null}
        {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
        {sp.cancelled === "1" ? <input type="hidden" name="cancelled" value="1" /> : null}
        {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
        <label className="min-w-0"><span className="mb-1 block text-[13.5px] font-medium text-[#0b1530]">Branch</span>
          <select name="branch" defaultValue={branch ?? ""} className={SEL}>{lk.branches.length > 1 ? <option value="">All my branches</option> : null}{lk.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="min-w-0"><span className="mb-1 block text-[13.5px] font-medium text-[#0b1530]">Area</span>
          <select name="area" defaultValue={area ?? ""} className={SEL}><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label className="min-w-0"><span className="mb-1 block text-[13.5px] font-medium text-[#0b1530]">Team member</span>
          <select name="carer" defaultValue={sp.carer ?? ""} className={SEL}><option value="">All team members</option>{staffOpts.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select>
        </label>
        <label className="min-w-0"><span className="mb-1 block text-[13.5px] font-medium text-[#0b1530]">Service user</span>
          <select name="su" defaultValue={sp.su ?? ""} className={SEL}><option value="">All service users</option>{suOpts.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select>
        </label>
        <label className="min-w-0"><span className="mb-1 block text-[13.5px] font-medium text-[#0b1530]">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className={SEL}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{VISIT_LABEL[s]}</option>)}</select>
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-3 xl:col-span-1 xl:justify-end">
          <Link href={url({ date: addDays(date, -1) })} aria-label="Previous day" className="flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50"><CaretLeft size={18} aria-hidden /></Link>
          <label className="flex h-10 items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px]"><span className="sr-only">Date</span><input type="date" name="date" defaultValue={date} className="bg-transparent text-[14px] text-[#0b1530]" /></label>
          <Link href={url({ date: addDays(date, 1) })} aria-label="Next day" className="flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50"><CaretRight size={18} aria-hidden /></Link>
          {date !== today ? <Link href={url({ date: undefined })} className="flex h-10 items-center px-2 text-[14px] font-medium text-[#5a3aa8]">Today</Link> : null}
        </div>
      </AutoSubmitForm>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="Day or week" className="flex gap-1.5">
          <Link href={url({})} aria-current="page" className={segBtn(true)}><CalendarBlank size={18} aria-hidden />Day</Link>
          <Link href={`/rota/planner?week=${mondayOf(date)}${area ? `&area=${area}` : ""}`} className={segBtn(false)}><CalendarDots size={18} aria-hidden />Week</Link>
        </nav>
        <span aria-hidden className="mx-2 hidden h-8 w-px bg-[#d0d5dd] sm:block" />
        <nav aria-label="Rota layout" className="flex gap-1.5">
          <Link href={url({ layout: undefined })} aria-current={layout === "timeline" ? "page" : undefined} className={segSoft(layout === "timeline")}><Rows size={18} aria-hidden />Timeline</Link>
          <Link href={url({ layout: "list" })} aria-current={layout === "list" ? "page" : undefined} className={segSoft(layout === "list")}><List size={18} aria-hidden />List</Link>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-medium text-[#0b1530] hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><Funnel size={18} aria-hidden />Filter{extraFilters ? <span className="rounded-full bg-[#6b3fd0] px-2 text-[12.5px] font-semibold text-white">{extraFilters}</span> : null}</summary>
            <form method="get" className="absolute right-0 z-40 mt-1 grid w-[300px] gap-2.5 rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {Object.entries(params).filter(([key, v]) => v && !["call", "view", "cancelled", "q"].includes(key)).map(([key, v]) => <input key={key} type="hidden" name={key} value={v} />)}
              <label><span className="label">Service call</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label><span className="label">Show only</span><select name="view" defaultValue={sp.view ?? ""} className="input"><option value="">All visits</option><option value="late">Late</option><option value="unassigned">Unassigned</option><option value="review">Needs review</option></select></label>
              <label><span className="label">Search</span><input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, postcode, reference" className="input" /></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Include cancelled visits</label>
              <div className="flex gap-2"><button className="btn-primary">Apply</button><Link href={url({ call: undefined, view: undefined, cancelled: undefined, q: undefined, carer: undefined, su: undefined, status: undefined })} className="btn-secondary">Clear all</Link></div>
            </form>
          </details>
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-medium text-[#0b1530] hover:bg-slate-50 [&::-webkit-details-marker]:hidden">Actions<CaretDown size={15} aria-hidden /></summary>
            <ul className="absolute right-0 z-40 mt-1 w-[230px] rounded-[10px] border border-[#e4e7ec] bg-white py-1 text-[14px] shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {canEdit ? <li><Link href={`/rota/visits/new?date=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Add visit</Link></li> : null}
              <li><Link href={url({ cancelled: sp.cancelled === "1" ? undefined : "1" })} className="block px-3 py-2 no-underline hover:bg-slate-50">{sp.cancelled === "1" ? "Hide cancelled visits" : "Show cancelled visits"}</Link></li>
              <li><Link href={`/rota/print?date=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Printable rota</Link></li>
              <li><Link href={`/rota/cover?from=${date}&days=1`} className="block px-3 py-2 no-underline hover:bg-slate-50">Sickness &amp; holiday cover</Link></li>
              {canPublish ? <li><Link href={`/rota/build?week=${mondayOf(date)}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Build or publish this week</Link></li> : null}
              <li><Link href={`/rota/advanced?date=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Advanced Rota</Link></li>
              <li><Link href={`/rota/planner?week=${mondayOf(date)}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Weekly Planner (drag and drop)</Link></li>
              <li><Link href="/rota/templates" className="block px-3 py-2 no-underline hover:bg-slate-50">Daily templates</Link></li>
            </ul>
          </details>
          {canEdit ? <Link href={`/rota/visits/new?date=${date}`} className="flex h-10 items-center gap-2 rounded-[8px] border border-[#6b3fd0] bg-white px-4 text-[14.5px] font-semibold text-[#5a3aa8] no-underline hover:bg-[#f6f3fd]">Add Visit</Link> : null}
          {canPublish && date >= today ? <Link href={`/rota/optimise?from=${date}`} className="flex h-10 items-center gap-2 rounded-[8px] bg-[#6b3fd0] px-4 text-[14.5px] font-semibold text-white no-underline hover:bg-[#5a33b5]"><Gauge size={18} aria-hidden />Optimise Rota</Link> : null}
        </div>
      </div>
      {notBuilt ? <NotBuiltNotice date={date} canBuild={canPublish} /> : null}
      {only ? <p className="mb-2 rounded-[8px] bg-[#fdf4e3] px-3 py-1.5 text-[14px] text-[#5c3d00]" role="note">Showing {only} only. <Link href={url(clearView)}>Show every visit</Link></p> : null}

      {timeline ? (
        <div className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-[264px_minmax(0,1fr)] ${inspector ? "xl:grid-cols-[256px_minmax(0,1fr)_400px] 2xl:grid-cols-[268px_minmax(0,1fr)_452px]" : ""}`}>
          <section aria-labelledby="attn-h" className="rounded-[10px] border border-[#e4e7ec] bg-white px-2.5 py-3">
            <div className="mb-1 flex items-center gap-2 px-1">
              <WarningCircle size={26} weight="fill" className="text-[#e5484d]" aria-hidden />
              <h2 id="attn-h" className="text-[18px] font-bold text-[#0b1530]">Needs attention</h2>
              <span className="ml-auto flex h-7 min-w-7 items-center justify-center rounded-full bg-[#fdeeee] px-2 text-[14px] font-semibold tabular-nums text-[#c8323a]" title="Distinct visits needing action">{attnTotal}</span>
            </div>
            <p className="mb-2 px-1 text-[13px] text-[#475467]">Visits that need your action {date === today ? "today" : "on this day"}.</p>
            <ul className="space-y-2">
              <AttnItem icon={<Warning size={24} />} tone="red" title="Missed visits" text={attn.missed.length ? `${attn.missed.length} not completed` : "Visits not completed."} count={attn.missed.length} href={url({ ...clearView, status: "MISSED" })} active={status === "MISSED"} />
              <AttnItem icon={<UsersThree size={24} />} tone="amber" title="Unassigned visits" text={unassignedTimes} count={attn.unassigned.length} href={url({ ...clearView, view: "unassigned" })} active={sp.view === "unassigned"} />
              <AttnItem icon={<Users size={24} />} tone="lavender" title="Partial double-ups" text={attn.partial.length ? `1 of 2 carers on ${attn.partial.length} visit${attn.partial.length === 1 ? "" : "s"}` : "Every double-up has two carers."} count={attn.partial.length} href={url({ ...clearView, view: "unassigned" })} active={false} />
              <AttnItem icon={<Clock size={24} />} tone="orange" title="Late visits" text={`Not started, over the late threshold`} count={attn.late.length} href={url({ ...clearView, view: "late" })} active={sp.view === "late"} />
              {review ? <AttnItem icon={<XCircle size={24} />} tone="amber" title="Allocations to review" text="Flagged after sickness, leave or an HR change" count={review} href={url({ ...clearView, view: "review" })} active={sp.view === "review"} /> : null}
            </ul>
          </section>

          <section aria-label="Day timeline" className="min-w-0 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white">
            {rows.length ? (
              <DailyTimeline
                rows={timeline.rows}
                axisStart={timeline.axisStart}
                axisEnd={timeline.axisEnd}
                nowMinute={date === today ? londonMinute(now) : null}
                selected={inspector?.visit.id ?? null}
                focusMinute={inspector && fromDbDate(inspector.visit.date) === date ? londonMinute(inspector.visit.scheduledStart) : null}
                hrefFor={(id) => url({ visit: id })}
                heading={<>Team members ({carerRows})</>}
              />
            ) : <div className="p-4"><Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty></div>}
            <p className="border-t border-[#eef0f3] px-3 py-2 text-[12.5px] text-[#475467]"><span className="tabular-nums">{live.length}</span> visits shown · <span className="tabular-nums">{hm(scheduled)}</span> scheduled{unassigned ? <> · <span className="font-medium tabular-nums text-[#8a5a00]">{unassigned}</span> empty carer slot{unassigned === 1 ? "" : "s"}</> : null}. Choose a visit to see its details. To drag visits between carers or days, use the <Link href={`/rota/planner?week=${mondayOf(date)}`}>Weekly Planner</Link>.{truncated ? " Showing the first 1,000 visits; narrow the filters to see the rest." : ""}</p>
          </section>

          {inspector ? (
            <div className="lg:col-span-2 xl:sticky xl:top-2 xl:col-span-1">
              <VisitInspector data={inspector} tab={sp.tab ?? "details"} back={back} closeHref={url({})} />
            </div>
          ) : sp.visit ? <p className="text-[13px] text-slate-600 lg:col-span-2">That visit is not available to you, or no longer exists.</p> : null}
        </div>
      ) : null}

      {layout === "list" ? <section className="panel" aria-label="Visits">
        {only ? <p className="mb-2 rounded bg-[#fff6db] px-3 py-1.5 text-[14px]" role="note">You are looking at {only} only. <Link href={`/rota/visits?date=${date}`}>Show every visit</Link></p> : null}

        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          {canEdit ? (
            <form id="bulk" action={bulkVisitsAction} className="flex flex-wrap items-end gap-2" aria-label="Bulk actions">
              <input type="hidden" name="back" value={back} />
              <label><span className="sr-only">Bulk action</span>
                <select name="kind" className="input w-[200px]" required defaultValue="">
                  <option value="" disabled>Bulk actions…</option>
                  <option value="cancel">Cancel Visits</option>
                  <option value="activate">Activate Visits</option>
                  <option value="assign">Reassign Visits</option>
                  <option value="unassign">Unassign Visits</option>
                  <option value="lock">Add Rota Lock(s)</option>
                  <option value="unlock">Remove Rota Lock(s)</option>
                  <option value="editTime">Edit Times</option>
                  <option value="editDuration">Edit Duration</option>
                  <option value="editService">Edit Service Name</option>
                  <option value="addAlert">Add Alerts</option>
                  <option value="removeAlert">Remove Alerts</option>
                  <option value="shadow">Add Shadow Shifts</option>
                  <option value="doubleUp">Convert To Double Up</option>
                  <option value="single">Revert Double Up To Single</option>
                  <option value="nudge">Nudge Times</option>
                  {canPublish ? <option value="publish">Publish to carers</option> : null}
                </select>
              </label>
              <button className="btn-primary bg-[#13703c]">Go</button>
              <details className="relative">
                <summary className="cursor-pointer pb-2 text-[13.5px] text-[#1d4f91]">Action options</summary>
                <div className="absolute left-0 z-20 mt-1 grid w-[300px] gap-2 rounded border border-slate-200 bg-white p-3 shadow-lg">
                  <label><span className="label text-[12px]">Team member (reassign, shadow)</span><select name="staffId" className="input"><option value="">Choose…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                  <label><span className="label text-[12px]">Slot</span><select name="slot" className="input"><option value="PRIMARY">Carer 1</option><option value="SECOND">Carer 2</option><option value="SHADOW">Shadow</option></select></label>
                  <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept warnings</label>
                  <label><span className="label text-[12px]">Minutes (nudge)</span><input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} className="input" /></label>
                  <label><span className="label text-[12px]">New start time (edit times)</span><input type="time" name="time" className="input" /></label>
                  <label><span className="label text-[12px]">Duration in minutes (edit duration)</span><input type="number" name="duration" min={5} max={1440} step={5} className="input" /></label>
                  <label><span className="label text-[12px]">Service call (edit service name)</span><select name="callTypeId" className="input"><option value="">Choose…</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label><span className="label text-[12px]">Reason (cancel, activate, unassign)</span><input name="reason" className="input" /></label>
                </div>
              </details>
            </form>
          ) : <span />}
          <form method="get" className="flex items-center gap-2" role="search">
            {Object.entries(params).filter(([k, v]) => k !== "q" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label htmlFor="rota-q" className="text-[14px] font-semibold">Search:</label>
            <input id="rota-q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, postcode, ref" className="input w-[200px]" />
          </form>
        </div>

        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto rounded border border-slate-200">
            <table className="table whitespace-nowrap text-[13.5px] [&_td]:py-1.5 [&_th]:py-2">
              <thead>
                <tr>
                  {canEdit ? <th className="w-8"><SelectAll form="bulk" name="visitIds" label="Select all visits" /></th> : null}
                  <th>Ref</th><th>Date</th><th>Status</th><th title="Acknowledged by the carer"><span aria-hidden>Ack</span><span className="sr-only">Acknowledged by the carer</span></th><th title="Single or double-up">Link</th><th title="Area">Area</th><th title="Run route">Run</th><th title="Risk rating">Risk</th>
                  <th>Service user</th>
                  <th className="text-right">Sched start</th><th className="text-right">Sched end</th><th className="text-right">Sched dur</th>
                  <th className="text-right">Clock in</th><th className="text-right">Clock out</th><th className="text-right">Clock dur</th>
                  <th>Team member</th><th>Service call</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const st = rotaState(v);
                  const carers = v.assignments.filter((a) => a.slot !== "SHADOW");
                  const acked = carers.length > 0 && carers.every((a) => a.acknowledgedAt);
                  const risk = v.serviceUser.riskLevel ? RISK[v.serviceUser.riskLevel] : null;
                  return (
                    <tr key={v.id} className={st.tint}>
                      {canEdit ? <td><input type="checkbox" form="bulk" name="visitIds" value={v.id} aria-label={`Select ${v.reference}`} className="h-4 w-4" /></td> : null}
                      <td><Link href={`/rota/visits/${v.id}`}>{v.reference}</Link></td>
                      <td className="tabular-nums">{fmtLondonDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                      <td className="font-medium">{st.label}</td>
                      <td className="text-center">{acked ? <span className="text-[#13703c]" title="Acknowledged">✓<span className="sr-only">Acknowledged</span></span> : <span className="text-slate-500" title="Not acknowledged">✗<span className="sr-only">Not acknowledged</span></span>}</td>
                      <td className="text-center" title={v.carersRequired > 1 ? "Double-up (two carers)" : "Single carer"}>{v.carersRequired > 1 ? "2" : "1"}<span className="sr-only">{v.carersRequired > 1 ? " carers" : " carer"}</span></td>
                      <td className="text-center">{v.area ? <span title={v.area.name} className="inline-block h-3 w-3 rounded-full align-middle" style={{ background: v.area.colour }}><span className="sr-only">{v.area.name}</span></span> : <span className="text-slate-400" title="No area">–</span>}</td>
                      <td className="text-center">{v.runRoute ? <span title={v.runRoute.name} className="rounded px-1.5" style={{ background: v.runRoute.colour, color: v.runRoute.textColour }}>{v.runRoute.name.slice(0, 3)}<span className="sr-only">{v.runRoute.name.slice(3)}</span></span> : "–"}</td>
                      <td className="text-center">{risk ? <span title={`${risk.label} risk`} className="inline-block h-3 w-3 rounded-[2px] align-middle" style={{ background: risk.colour }}><span className="sr-only">{risk.label} risk</span></span> : "–"}</td>
                      <td><Link href={`/rota/service-users/${v.serviceUser.id}`}>{suName(v.serviceUser)}</Link> <span className="text-slate-500">{v.serviceUser.postcode ?? ""}</span></td>
                      <td className="text-right tabular-nums">{londonTime(v.scheduledStart)}</td>
                      <td className="text-right tabular-nums">{londonTime(v.scheduledEnd)}</td>
                      <td className="text-right tabular-nums">{hm(minsBetween(v.scheduledStart, v.scheduledEnd))}</td>
                      <td className="text-right tabular-nums">{v.actualStart ? londonTime(v.actualStart) : ""}</td>
                      <td className="text-right tabular-nums">{v.actualEnd ? londonTime(v.actualEnd) : ""}</td>
                      <td className="text-right tabular-nums">{v.actualStart && v.actualEnd ? hm(minsBetween(v.actualStart, v.actualEnd)) : ""}</td>
                      <td><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                      <td>{v.callType.name}{v.medicationRequired ? <span className="ml-1 text-[12px] text-slate-500">· med prompt</span> : null}</td>
                      <td><span className="flex gap-1">{v.timeLocked ? <span className="text-[12px] text-slate-600">Locked</span> : null}{!v.publishedAt && v.status === "SCHEDULED" ? <span className="text-[12px] text-slate-600">Not published</span> : null}<FlagBadges flags={{ ...v.flags, late: false }} /></span></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td colSpan={canEdit ? 11 : 10} className="text-right">Totals ({live.length} visits{unassigned ? `, ${unassigned} empty carer slots` : ""})</td>
                  <td className="text-right">Sched</td>
                  <td className="text-right tabular-nums">{hm(scheduled)}</td>
                  <td colSpan={2} className="text-right">Clocked</td>
                  <td className="text-right tabular-nums">{hm(clocked)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty>
        )}
        {truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">Showing the first 1,000 visits. Narrow the filters to see the rest.</p> : null}
        <p className="mt-2 text-[12.5px] text-slate-500">Row colours: late pale yellow, in progress pale blue, complete pale green, missed pale red; the status is always written out too. Hover the area dot, run route and risk square for their names.</p>
      </section> : null}
    </div>
  );
}
