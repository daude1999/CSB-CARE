import type { ReactNode } from "react";
import type { VisitStatus } from "@prisma/client";
import { Bell, CalendarBlank, CaretDown, CaretLeft, CaretRight, CaretUp, CheckSquare, Columns, FileText, List, ListChecks, MagnifyingGlass, Plus, SlidersHorizontal, User, Users } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { checklistOf, listVisits, patternWeek, rotaLookups, suName, type VisitRow } from "@/server/rota/queries";
import { visitInspector } from "@/server/rota/inspector";
import { addDays, fmtLondonDate, fromDbDate, isIsoDate, isoWeek, londonDate, londonMinute, londonTime, mondayOf } from "@/lib/london";
import { bulkVisitsAction } from "@/app/rota-actions";
import { Empty, Flash } from "@/components/ui";
import { dayTimeline } from "@/server/rota/roster";
import { DailyTimeline } from "@/components/daily-timeline";
import { VisitInspector } from "@/components/visit-inspector";
import { AutoSubmitForm } from "@/components/auto-submit";
import { VISIT_LABEL, NotBuiltNotice } from "@/components/rota-ui";
import { ordinalDate } from "@/components/rota-dashboard";
import { weekIsBuilt } from "@/server/rota/build";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(VISIT_LABEL) as VisitStatus[];
const PER_PAGE = [25, 50, 100] as const;
const RISK: Record<string, { label: string; colour: string }> = { LOW: { label: "Low", colour: "#3f9a5b" }, MEDIUM: { label: "Medium", colour: "#e0a526" }, HIGH: { label: "High", colour: "#d9473f" } };

/** Columns a coordinator can add to the table (Column settings). The fifteen default columns are always shown. */
const OPTIONAL = [
  ["area", "Area"],
  ["run", "Run route"],
  ["risk", "Risk"],
  ["end", "End time"],
  ["clockIn", "Clock in"],
  ["clockOut", "Clock out"],
  ["clockDur", "Clocked duration"],
  ["ack", "Acknowledged"],
  ["flags", "Published and locks"],
] as const;
type Optional = (typeof OPTIONAL)[number][0];

const SORTS = {
  ref: (a: VisitRow, b: VisitRow) => a.reference.localeCompare(b.reference),
  date: (a: VisitRow, b: VisitRow) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  status: (a: VisitRow, b: VisitRow) => VISIT_LABEL[a.status].localeCompare(VISIT_LABEL[b.status]),
  su: (a: VisitRow, b: VisitRow) => suName(a.serviceUser).localeCompare(suName(b.serviceUser)),
  time: (a: VisitRow, b: VisitRow) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  duration: (a: VisitRow, b: VisitRow) => (a.scheduledEnd.getTime() - a.scheduledStart.getTime()) - (b.scheduledEnd.getTime() - b.scheduledStart.getTime()),
  carers: (a: VisitRow, b: VisitRow) => coverage(a).filled / a.carersRequired - coverage(b).filled / b.carersRequired,
  call: (a: VisitRow, b: VisitRow) => a.callType.name.localeCompare(b.callType.name),
  carer: (a: VisitRow, b: VisitRow) => carerNames(a).localeCompare(carerNames(b)),
} as const;
type SortKey = keyof typeof SORTS;

const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const dur = (m: number) => (m < 60 ? `${m}m` : hm(m));
const carerNames = (v: VisitRow) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName).join(", ");
function coverage(v: VisitRow) {
  return { filled: v.assignments.filter((a) => a.slot !== "SHADOW").length, required: v.carersRequired };
}

const STATUS_BADGE: Record<VisitStatus, string> = {
  SCHEDULED: "bg-[#f2f4f7] text-[#344054]",
  IN_PROGRESS: "bg-[#e6f0fb] text-[#175cd3]",
  COMPLETED: "bg-[#e7f6ec] text-[#14713a]",
  MISSED: "bg-[#fdecec] text-[#b42318]",
  CANCELLED: "bg-[#f2f4f7] text-[#667085]",
  NOT_DELIVERED: "bg-[#f4f3ff] text-[#5925dc]",
};
const ROW_TINT: Partial<Record<VisitStatus, string>> = { MISSED: "bg-[#fffafa]", COMPLETED: "bg-[#f8fdf9]", IN_PROGRESS: "bg-[#f7fbff]", CANCELLED: "bg-[#fafafa] text-[#667085]" };

/** The carer coverage badge: carers booked of carers needed. A part-staffed visit is amber, never shown as failed. */
function Coverage({ v }: { v: VisitRow }) {
  if (v.status === "CANCELLED" || v.status === "NOT_DELIVERED") return <span className="text-[#98a2b3]">—</span>;
  const { filled, required } = coverage(v);
  const tone = filled >= required ? "bg-[#e7f6ec] text-[#14713a]" : filled === 0 ? "bg-[#fdecec] text-[#b42318]" : "bg-[#fdf3d8] text-[#8a5a00]";
  const words = filled >= required ? "fully staffed" : filled === 0 ? "no carer booked" : "partly staffed";
  return <span title={`${filled} of ${required} carer${required === 1 ? "" : "s"} booked: ${words}`} className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone}`}><Users size={15} weight="fill" aria-hidden />{filled}/{required}<span className="sr-only"> carers, {words}</span></span>;
}

/** Truthful checklist indicator: no tasks, all done, some recorded as not done or refused, or still to record. */
function Checklist({ v, href }: { v: VisitRow; href: string }) {
  const c = checklistOf(v.tasks);
  if (!c.total) return <span className="text-[#98a2b3]" title="No care tasks on this visit">—<span className="sr-only">No care tasks</span></span>;
  const allDone = c.done === c.total;
  const problem = c.recorded > c.done;
  const title = allDone ? `All ${c.total} care tasks done` : `${c.done} of ${c.total} done${problem ? `, ${c.recorded - c.done} not done or refused` : ""}${c.outstanding ? `, ${c.outstanding} not recorded` : ""}`;
  const tone = allDone ? "text-[#15803d]" : problem ? "text-[#b54708]" : "text-[#475467]";
  return (
    <Link href={href} title={title} aria-label={`Care tasks: ${title}`} className={`inline-flex items-center gap-1 rounded px-0.5 text-[12px] font-semibold tabular-nums no-underline ${tone}`}>
      {allDone ? <CheckSquare size={19} weight="fill" aria-hidden /> : <ListChecks size={19} weight={problem ? "bold" : "regular"} aria-hidden />}
      {allDone ? null : <span>{c.done}/{c.total}</span>}
    </Link>
  );
}

function alertsOf(v: VisitRow) {
  const out: string[] = [];
  if (v.flags.late && v.status !== "MISSED") out.push(v.flags.lateBy ? `Late by ${v.flags.lateBy} minutes` : "Late");
  for (const r of v.flags.review) out.push(`Needs review: ${r}`);
  if (v.flags.short) out.push("Shorter than planned");
  if (v.medicationRequired) out.push("Medication prompt on this visit");
  return out;
}

const BTN = "flex h-10 items-center gap-2 rounded-[8px] px-4 text-[14.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
const SEL = "h-10 w-full appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px] text-[#101828]";

function FilterSelect({ name, label, value, children }: { name: string; label: string; value: string; children: ReactNode }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value} className={SEL}>{children}</select>
      <CaretDown size={15} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#344054]" />
    </label>
  );
}

/**
 * Daily Rota — Live View, laid out to the owner's approved reference (31 Oct 2026, modernised OnePlan style): no figures
 * above the table; the day's visits as a compact live list with filters, bulk actions, column settings, sorting and
 * pages; a Visit Details drawer when a visit is chosen. Day figures are on the Rota Dashboard. Planner opens the
 * Advanced Rota for the same day; the carer timeline is still available from Actions.
 */
export default async function DailyRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])) as Record<string, string | undefined>;
  const ctx = await requireRotaPage();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const today = londonDate();
  const status = STATUSES.includes(sp.status as VisitStatus) ? (sp.status as VisitStatus) : undefined;
  const lk = await rotaLookups(ctx);
  const branch = sp.branch && lk.branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const area = sp.area && lk.areas.some((a) => a.id === sp.area && (!branch || a.branchId === branch)) ? sp.area : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const filters = { date, branchId: branch, areaId: area, staffId: sp.carer || undefined, serviceUserId: sp.su || undefined, callTypeId: sp.call || undefined, status, unassigned: sp.view === "unassigned", review: sp.view === "review", late: sp.view === "late", includeCancelled: sp.cancelled === "1" || status === "CANCELLED", q };
  const { rows: all, settings, truncated } = await listVisits(ctx, filters);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canPublish = hasOrgPermission(ctx, "rota.build");
  const layout = sp.layout === "timeline" ? "timeline" : "list";
  const cols = new Set((sp.cols ?? "").split(",").filter((c): c is Optional => OPTIONAL.some(([k]) => k === c)));
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : "time";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const per = PER_PAGE.find((n) => String(n) === sp.per) ?? 25;
  const rows = [...all].sort((a, b) => (dir === "asc" ? 1 : -1) * SORTS[sort](a, b) || a.scheduledStart.getTime() - b.scheduledStart.getTime() || a.reference.localeCompare(b.reference));
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const page = Math.min(pages, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const shown = rows.slice((page - 1) * per, page * per);
  const inspector = sp.visit ? await visitInspector(ctx, sp.visit) : null;
  const timeline = layout === "timeline" ? await dayTimeline(ctx, date, all, lk) : null;
  const notBuilt = all.length === 0 && !q && !(await weekIsBuilt(ctx, date));

  const params: Record<string, string | undefined> = { date: date === today ? undefined : date, branch, area, carer: sp.carer, su: sp.su, call: sp.call, status: sp.status, view: sp.view, cancelled: sp.cancelled, q, layout: layout === "timeline" ? "timeline" : undefined, cols: cols.size ? [...cols].join(",") : undefined, sort: sort === "time" ? undefined : sort, dir: dir === "asc" ? undefined : dir, per: per === 25 ? undefined : String(per), page: page === 1 ? undefined : String(page), visit: inspector ? inspector.visit.id : undefined };
  const url = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
    return `/rota/visits${s ? `?${s}` : ""}`;
  };
  const back = url({ date });
  const branchName = branch ? lk.branches.find((b) => b.id === branch)?.name : lk.branches.length === 1 ? lk.branches[0]!.name : "All branches";
  const areas = lk.areas.filter((a) => !branch || a.branchId === branch);
  const staffOpts = lk.staff.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const suOpts = lk.serviceUsers.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const more = [branch && lk.branches.length > 1 ? 1 : 0, sp.call, sp.view, sp.cancelled === "1" ? "1" : undefined].filter(Boolean).length;
  const only = sp.view === "late" ? "late visits" : sp.view === "review" ? "visits with an allocation to review" : sp.view === "unassigned" ? "visits short of a carer" : null;
  const plannerHref = `/rota/advanced?${new URLSearchParams(Object.entries({ date, area, carer: sp.carer }).filter((e): e is [string, string] => !!e[1]))}`;
  const hiddenExcept = (skip: string[]) => Object.entries(params).filter(([k, v]) => v && !skip.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const sortHead = (key: SortKey, label: ReactNode, extra = "") => {
    const active = sort === key;
    return (
      <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`whitespace-nowrap px-2.5 py-2.5 text-left text-[13.5px] font-semibold text-[#101828] ${extra}`}>
        <Link href={url({ sort: key === "time" ? undefined : key, dir: active && dir === "asc" ? "desc" : undefined, page: undefined })} className="inline-flex items-center gap-1 text-inherit no-underline hover:text-[#5b2bb5]">
          {label}{active ? (dir === "asc" ? <CaretUp size={11} weight="fill" aria-hidden /> : <CaretDown size={11} weight="fill" aria-hidden />) : null}
        </Link>
      </th>
    );
  };
  const visible = 15 + cols.size - (canEdit ? 0 : 1);

  return (
    <div className="daily-rota -mt-1">
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <span aria-hidden className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[10px] bg-[#efeafc] text-[#5b2bb5]"><CalendarBlank size={30} weight="duotone" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-[#101828]">Daily Rota – Live View</h1>
          <p className="text-[15px] font-semibold text-[#101828]">{ordinalDate(date)} · {branchName}</p>
        </div>
        <AutoSubmitForm label="Day" className="flex items-center gap-2">
          {hiddenExcept(["date", "page", "visit"])}
          <Link href={url({ date: addDays(date, -1), page: undefined, visit: undefined })} aria-label="Previous day" className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50"><CaretLeft size={18} weight="bold" aria-hidden /></Link>
          <label className="flex h-10 items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3"><CalendarBlank size={18} aria-hidden className="text-[#344054]" /><span className="sr-only">Date</span><input type="date" name="date" defaultValue={date} className="bg-transparent text-[14px] font-semibold text-[#101828]" /></label>
          <Link href={url({ date: addDays(date, 1), page: undefined, visit: undefined })} aria-label="Next day" className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50"><CaretRight size={18} weight="bold" aria-hidden /></Link>
          {date !== today ? <Link href={url({ date: undefined, page: undefined, visit: undefined })} className="px-1 text-[14px] font-semibold text-[#5b2bb5]">Today</Link> : null}
        </AutoSubmitForm>
        <nav aria-label="Rota view" className="flex gap-1">
          <Link href={url({ layout: undefined })} aria-current={layout === "list" ? "page" : undefined} className={`${BTN} ${layout === "list" ? "bg-[#5b2bb5] text-white" : "border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50"}`}><List size={19} weight="bold" aria-hidden />List</Link>
          <Link href={plannerHref} className={`${BTN} border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50`}><CalendarBlank size={19} aria-hidden />Planner</Link>
        </nav>
        {canEdit ? <Link href={`/rota/visits/new?date=${date}`} className={`${BTN} bg-[#5b2bb5] text-white hover:bg-[#4c2398]`}><Plus size={18} weight="bold" aria-hidden />Add Visit</Link> : null}
      </header>
      <Flash searchParams={sp} />

      <div className="mb-3 flex flex-wrap items-start gap-2.5">
        <AutoSubmitForm label="Filters" className="grid min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1.15fr)_repeat(4,minmax(0,1fr))]">
          {hiddenExcept(["area", "status", "su", "carer", "q", "page", "visit"])}
          <label className="relative min-w-0">
            <span className="sr-only">Search visits by service user, carer or reference</span>
            <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search visits…" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px] text-[#101828] placeholder:text-[#667085]" />
          </label>
          <FilterSelect name="area" label="Area" value={area ?? ""}><option value="">Area: All Areas</option>{areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}</FilterSelect>
          <FilterSelect name="status" label="Status" value={sp.status ?? ""}><option value="">Status: All</option>{STATUSES.map((s) => <option key={s} value={s}>Status: {VISIT_LABEL[s]}</option>)}</FilterSelect>
          <FilterSelect name="su" label="Service user" value={sp.su ?? ""}><option value="">Service User: All</option>{suOpts.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</FilterSelect>
          <FilterSelect name="carer" label="Team member" value={sp.carer ?? ""}><option value="">Team Member: All</option>{staffOpts.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</FilterSelect>
        </AutoSubmitForm>
        <div className="flex gap-2.5">
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><SlidersHorizontal size={19} aria-hidden />More Filters{more ? <span className="rounded-full bg-[#5b2bb5] px-2 text-[12.5px] text-white">{more}</span> : null}</summary>
            <form method="get" className="absolute right-0 z-40 mt-1 grid w-[300px] gap-2.5 rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {hiddenExcept(["branch", "call", "view", "cancelled", "page", "visit"])}
              {lk.branches.length > 1 ? <label><span className="label">Branch</span><select name="branch" defaultValue={branch ?? ""} className="input"><option value="">All my branches</option>{lk.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : null}
              <label><span className="label">Service call</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label><span className="label">Show only</span><select name="view" defaultValue={sp.view ?? ""} className="input"><option value="">All visits</option><option value="unassigned">Short of a carer (uncovered)</option><option value="late">Late</option><option value="review">Allocation to review</option></select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Include cancelled visits</label>
              <div className="flex gap-2"><button className="btn-primary">Apply</button><Link href={url({ branch: undefined, call: undefined, view: undefined, cancelled: undefined, q: undefined, carer: undefined, su: undefined, status: undefined, area: undefined, page: undefined })} className="btn-secondary">Clear all</Link></div>
            </form>
          </details>
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] bg-[#5b2bb5] px-4 text-[14.5px] font-semibold text-white hover:bg-[#4c2398] [&::-webkit-details-marker]:hidden">Actions<CaretDown size={15} weight="bold" aria-hidden /></summary>
            <ul className="absolute right-0 z-40 mt-1 w-[240px] rounded-[10px] border border-[#e4e7ec] bg-white py-1 text-[14px] shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {canEdit ? <li><Link href={`/rota/visits/new?date=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Add visit</Link></li> : null}
              <li><Link href={url({ cancelled: sp.cancelled === "1" ? undefined : "1", page: undefined })} className="block px-3 py-2 no-underline hover:bg-slate-50">{sp.cancelled === "1" ? "Hide cancelled visits" : "Show cancelled visits"}</Link></li>
              <li><Link href={url({ layout: layout === "timeline" ? undefined : "timeline" })} className="block px-3 py-2 no-underline hover:bg-slate-50">{layout === "timeline" ? "Back to the list" : "Carer timeline for the day"}</Link></li>
              <li><Link href={`/rota/unassigned?from=${date}&days=1`} className="block px-3 py-2 no-underline hover:bg-slate-50">Unassigned visits (with suggestions)</Link></li>
              <li><Link href={`/rota/print?date=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Printable rota</Link></li>
              <li><Link href={`/rota/cover?from=${date}&days=1`} className="block px-3 py-2 no-underline hover:bg-slate-50">Sickness &amp; holiday cover</Link></li>
              {canPublish ? <li><Link href={`/rota/build?week=${mondayOf(date)}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Build or publish this week</Link></li> : null}
              {canPublish && date >= today ? <li><Link href={`/rota/optimise?from=${date}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Generate &amp; Optimise</Link></li> : null}
              <li><Link href={`/rota/planner?week=${mondayOf(date)}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Weekly Planner (drag and drop)</Link></li>
              <li><Link href="/rota/templates" className="block px-3 py-2 no-underline hover:bg-slate-50">Daily templates</Link></li>
            </ul>
          </details>
        </div>
      </div>
      {notBuilt ? <NotBuiltNotice date={date} canBuild={canPublish} /> : null}
      {only || status || q ? <p className="mb-2 rounded-[8px] bg-[#fdf6e8] px-3 py-1.5 text-[14px] text-[#5c3d00]" role="note">Showing {only ?? (status ? `${VISIT_LABEL[status].toLowerCase()} visits` : "visits")}{q ? ` matching “${q}”` : ""}. <Link href={url({ view: undefined, status: undefined, q: undefined, page: undefined })}>Show every visit</Link></p> : null}

      <div className={`grid grid-cols-1 items-start gap-4 ${inspector ? "xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_350px]" : ""}`}>
        {layout === "list" ? (
          <section aria-label="Visits" className="min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
              {canEdit ? (
                <form id="bulk" action={bulkVisitsAction} className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
                  <input type="hidden" name="back" value={back} />
                  <label className="relative"><span className="sr-only">Bulk action</span>
                    <select name="kind" required defaultValue="" className="h-10 w-[200px] appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px] text-[#101828]">
                      <option value="" disabled>Bulk Actions…</option>
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
                    <CaretDown size={15} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                  </label>
                  <button className="h-10 rounded-[8px] bg-[#5b2bb5] px-4 text-[14.5px] font-semibold text-white hover:bg-[#4c2398]">Go</button>
                  <details className="relative">
                    <summary className="flex h-10 cursor-pointer list-none items-center px-1.5 text-[13.5px] font-medium text-[#5b2bb5] [&::-webkit-details-marker]:hidden">Action options</summary>
                    <div className="absolute left-0 z-30 mt-1 grid w-[300px] gap-2 rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
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
              ) : null}
              <details className="relative ml-auto">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-medium text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><Columns size={18} aria-hidden />Columns{cols.size ? <span className="rounded-full bg-[#efeafc] px-1.5 text-[12px] font-semibold text-[#5b2bb5]">+{cols.size}</span> : null}</summary>
                <form method="get" className="absolute right-0 z-30 mt-1 w-[240px] rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
                  {hiddenExcept(["cols"])}
                  <fieldset>
                    <legend className="mb-1.5 text-[13px] font-semibold text-[#101828]">Extra columns</legend>
                    {OPTIONAL.map(([k, label]) => <label key={k} className="flex items-center gap-2 py-0.5 text-[14px]"><input type="checkbox" name="cols" value={k} defaultChecked={cols.has(k)} className="h-4 w-4" />{label}</label>)}
                  </fieldset>
                  <div className="mt-2 flex gap-2"><button className="btn-primary py-1">Apply</button><Link href={url({ cols: undefined })} className="btn-secondary py-1">Default</Link></div>
                </form>
              </details>
            </div>

            {shown.length ? (
              <div className="relative min-w-0 overflow-x-auto border-t border-[#eaecf0]">
                <table className="w-full border-collapse whitespace-nowrap text-[14px]">
                  <caption className="sr-only">Visits on {fmtLondonDate(date)}</caption>
                  <thead className="bg-[#f9fafb]">
                    <tr className="border-b border-[#eaecf0]">
                      {canEdit ? <th scope="col" className="w-10 px-3 py-2.5"><SelectAll form="bulk" name="visitIds" label="Select all visits on this page" /></th> : null}
                      {sortHead("ref", "Ref")}
                      {sortHead("date", <><CalendarBlank size={15} aria-hidden className="text-[#475467]" />Date</>)}
                      {sortHead("status", "Status")}
                      {sortHead("su", "Service User")}
                      {sortHead("time", "Time")}
                      {cols.has("end") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">End</th> : null}
                      {sortHead("duration", "Duration")}
                      {sortHead("carers", "Carers")}
                      {sortHead("call", "Service Call")}
                      {sortHead("carer", "Team Member")}
                      <th scope="col" className="px-1.5 py-2.5 text-center" title="Alerts"><Bell size={17} weight="fill" aria-hidden className="mx-auto text-[#475467]" /><span className="sr-only">Alerts</span></th>
                      <th scope="col" className="px-1.5 py-2.5 text-center" title="Notes"><FileText size={17} aria-hidden className="mx-auto text-[#475467]" /><span className="sr-only">Notes</span></th>
                      <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold" title="Position in the recurring rota pattern">Week</th>
                      <th scope="col" className="px-1.5 py-2.5 text-center" title="Calendar (ISO) week"><CalendarBlank size={17} aria-hidden className="mx-auto text-[#475467]" /><span className="sr-only">Calendar week</span></th>
                      <th scope="col" className="px-2 py-2.5 text-center" title="Visit checklist (care tasks)"><ListChecks size={18} aria-hidden className="mx-auto text-[#475467]" /><span className="sr-only">Visit checklist</span></th>
                      {cols.has("area") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Area</th> : null}
                      {cols.has("run") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Run route</th> : null}
                      {cols.has("risk") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Risk</th> : null}
                      {cols.has("clockIn") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Clock in</th> : null}
                      {cols.has("clockOut") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Clock out</th> : null}
                      {cols.has("clockDur") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Clocked</th> : null}
                      {cols.has("ack") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Acknowledged</th> : null}
                      {cols.has("flags") ? <th scope="col" className="px-2.5 py-2.5 text-left text-[13.5px] font-semibold">Published / locks</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => {
                      const selected = inspector?.visit.id === v.id;
                      const open = url({ visit: v.id, tab: undefined });
                      const carers = v.assignments.filter((a) => a.slot !== "SHADOW");
                      const alerts = alertsOf(v);
                      const notes = v._count.visitNotes + (v.notes ? 1 : 0);
                      const pw = patternWeek(v, settings);
                      const risk = v.serviceUser.riskLevel ? RISK[v.serviceUser.riskLevel] : null;
                      const vd = fromDbDate(v.date);
                      return (
                        <tr key={v.id} aria-selected={selected || undefined} className={`border-b border-[#f2f4f7] last:border-0 ${selected ? "bg-[#eef4ff] outline outline-2 -outline-offset-2 outline-[#84adff]" : ROW_TINT[v.status] ?? ""} hover:bg-[#f9f8fe]`}>
                          {canEdit ? <td className="px-3 py-2"><input type="checkbox" form="bulk" name="visitIds" value={v.id} aria-label={`Select ${v.reference}`} className="h-4 w-4" /></td> : null}
                          <td className="px-2.5 py-2 tabular-nums"><Link href={open} className="text-[#101828] no-underline hover:underline" aria-label={`Open details of visit ${v.reference}`}>{v.reference}</Link></td>
                          <td className="px-2.5 py-2 tabular-nums">{fmtLondonDate(vd, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                          <td className="px-2.5 py-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold ${STATUS_BADGE[v.status]}`}><span aria-hidden className="h-2 w-2 rounded-full bg-current" />{VISIT_LABEL[v.status]}</span></td>
                          <td className="px-2.5 py-2"><Link href={`/rota/service-users/${v.serviceUser.id}`} className="inline-flex items-center gap-1.5 font-semibold text-[#3b1f99] underline decoration-[#c4b5f4] underline-offset-2 hover:decoration-[#3b1f99]"><User size={17} aria-hidden className="text-[#5b2bb5]" />{suName(v.serviceUser)}</Link></td>
                          <td className="px-2.5 py-2 tabular-nums">{londonTime(v.scheduledStart)}</td>
                          {cols.has("end") ? <td className="px-2.5 py-2 tabular-nums">{londonTime(v.scheduledEnd)}</td> : null}
                          <td className="px-2.5 py-2 tabular-nums">{dur(mins(v.scheduledStart, v.scheduledEnd))}</td>
                          <td className="px-2.5 py-2"><Coverage v={v} /></td>
                          <td className="max-w-[140px] truncate px-2.5 py-2" title={v.callType.name}>{v.callType.name}</td>
                          <td className="max-w-[150px] truncate px-2.5 py-2" title={carerNames(v) || "No carer booked"}>
                            {carers.length ? carers.map((a, i) => <span key={a.id}>{i ? ", " : ""}<Link href={`/rota/staff/${a.staff.id}`} title={a.reviewReason ? `Needs review: ${a.reviewReason}` : undefined} className={`underline underline-offset-2 ${a.reviewReason ? "text-[#b54708] decoration-[#f5c27a]" : "text-[#14713a] decoration-[#9fd6b2]"}`}>{a.staff.displayName}</Link></span>) : <span className="text-[#b42318]">{v.status === "CANCELLED" ? "—" : "Unassigned"}</span>}
                          </td>
                          <td className="px-1.5 py-2 text-center">{alerts.length ? <Link href={open} title={alerts.join("\n")} aria-label={`Alerts: ${alerts.join("; ")}`} className="inline-flex text-[#c4320a]"><Bell size={18} weight="fill" aria-hidden /></Link> : <span title="No alerts" className="inline-flex text-[#d0d5dd]"><Bell size={18} aria-hidden /><span className="sr-only">No alerts</span></span>}</td>
                          <td className="px-1.5 py-2 text-center">{notes ? <Link href={url({ visit: v.id, tab: "notes" })} title={`${notes} note${notes === 1 ? "" : "s"}`} aria-label={`${notes} note${notes === 1 ? "" : "s"}`} className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-[#344054] no-underline"><FileText size={18} weight="fill" aria-hidden />{notes > 1 ? notes : null}</Link> : <span title="No notes" className="inline-flex text-[#d0d5dd]"><FileText size={18} aria-hidden /><span className="sr-only">No notes</span></span>}</td>
                          <td className="px-2.5 py-2">{pw ? `Week ${pw}` : <span className="text-[#98a2b3]" title="A one-off visit, not part of the rota pattern">—<span className="sr-only">Not in the rota pattern</span></span>}</td>
                          <td className="px-1.5 py-2 text-center tabular-nums" title={`Calendar week ${isoWeek(vd)}`}>{isoWeek(vd)}</td>
                          <td className="px-2 py-2 text-center"><Checklist v={v} href={url({ visit: v.id, tab: "tasks" })} /></td>
                          {cols.has("area") ? <td className="px-2.5 py-2">{v.area ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: v.area.colour }} />{v.area.name}</span> : "—"}</td> : null}
                          {cols.has("run") ? <td className="px-2.5 py-2">{v.runRoute ? <span className="rounded px-1.5 py-0.5 text-[13px]" style={{ background: v.runRoute.colour, color: v.runRoute.textColour }}>{v.runRoute.name}</span> : "—"}</td> : null}
                          {cols.has("risk") ? <td className="px-2.5 py-2">{risk ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: risk.colour }} />{risk.label}</span> : "—"}</td> : null}
                          {cols.has("clockIn") ? <td className="px-2.5 py-2 tabular-nums">{v.actualStart ? londonTime(v.actualStart) : "—"}</td> : null}
                          {cols.has("clockOut") ? <td className="px-2.5 py-2 tabular-nums">{v.actualEnd ? londonTime(v.actualEnd) : "—"}</td> : null}
                          {cols.has("clockDur") ? <td className="px-2.5 py-2 tabular-nums">{v.actualStart && v.actualEnd ? dur(mins(v.actualStart, v.actualEnd)) : "—"}</td> : null}
                          {cols.has("ack") ? <td className="px-2.5 py-2">{carers.length ? (carers.every((a) => a.acknowledgedAt) ? "Yes" : carers.some((a) => a.acknowledgedAt) ? "Partly" : "No") : "—"}</td> : null}
                          {cols.has("flags") ? <td className="px-2.5 py-2 text-[13px] text-[#475467]">{[v.publishedAt ? "Published" : v.status === "SCHEDULED" ? "Not published" : null, v.timeLocked ? "Time locked" : null].filter(Boolean).join(" · ") || "—"}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border-t border-[#eaecf0] p-4"><Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty></div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-[#eaecf0] px-3.5 py-3">
              <p data-testid="visit-count" data-total={rows.length} className="text-[14px] text-[#344054]" aria-live="polite">Showing {rows.length ? (page - 1) * per + 1 : 0} to {(page - 1) * per + shown.length} of {rows.length} visit{rows.length === 1 ? "" : "s"}</p>
              {pages > 1 ? (
                <nav aria-label="Visit pages" className="flex items-center gap-1">
                  {page > 1 ? <Link href={url({ page: String(page - 1) })} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretLeft size={14} weight="bold" aria-hidden /></Link> : null}
                  {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => (
                    <span key={n} className="flex items-center gap-1">
                      {i && n - arr[i - 1]! > 1 ? <span className="px-0.5 text-[#667085]">…</span> : null}
                      <Link href={url({ page: n === 1 ? undefined : String(n) })} aria-current={n === page ? "page" : undefined} className={`flex h-8 min-w-8 items-center justify-center rounded-[6px] border px-2 text-[13px] tabular-nums no-underline ${n === page ? "border-[#5b2bb5] bg-[#5b2bb5] font-semibold text-white" : "border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50"}`}>{n}</Link>
                    </span>
                  ))}
                  {page < pages ? <Link href={url({ page: String(page + 1) })} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretRight size={14} weight="bold" aria-hidden /></Link> : null}
                </nav>
              ) : null}
              <AutoSubmitForm label="Rows per page" className="ml-auto flex items-center gap-3">
                {hiddenExcept(["per", "page"])}
                <label htmlFor="per" className="text-[14px] text-[#344054]">Rows per page</label>
                <span className="relative"><select id="per" name="per" defaultValue={String(per)} className="h-10 appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px]">{PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}</select><CaretDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" /></span>
              </AutoSubmitForm>
            </div>
            {truncated ? <p className="px-3.5 pb-3 text-[13px] text-[#8a5a00]">Showing the first 1,000 visits of the day. Narrow the filters to see the rest.</p> : null}
            <p className="sr-only">{visible} columns. Week is the visit&apos;s place in the rota pattern; the calendar column is the ISO week number.</p>
          </section>
        ) : (
          <section aria-label="Carer timeline" className="min-w-0 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white">
            {timeline && all.length ? (
              <DailyTimeline
                rows={timeline.rows}
                axisStart={timeline.axisStart}
                axisEnd={timeline.axisEnd}
                nowMinute={date === today ? londonMinute(new Date()) : null}
                selected={inspector?.visit.id ?? null}
                focusMinute={inspector && fromDbDate(inspector.visit.date) === date ? londonMinute(inspector.visit.scheduledStart) : null}
                hrefFor={(id) => url({ visit: id })}
                heading={<>Team members ({timeline.rows.filter((r) => r.id !== "unassigned").length})</>}
              />
            ) : <div className="p-4"><Empty>No visits match these filters on {fmtLondonDate(date)}.</Empty></div>}
            <p className="border-t border-[#eef0f3] px-3 py-2 text-[12.5px] text-[#475467]">One row per team member. Choose a visit to see its details. <Link href={url({ layout: undefined })}>Back to the list</Link></p>
          </section>
        )}

        {inspector ? (
          <div className="xl:sticky xl:top-2">
            <VisitInspector data={inspector} tab={sp.tab ?? "details"} back={back} closeHref={url({ visit: undefined, tab: undefined })} />
          </div>
        ) : sp.visit ? <p className="text-[13px] text-slate-600">That visit is not available to you, or no longer exists.</p> : null}
      </div>
    </div>
  );
}
