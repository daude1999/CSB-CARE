import { redirect } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { addDays, isIsoDate, londonDate, londonMinute, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName, type VisitRow } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { longDate } from "@/components/rota-ui";
import { TimelineBoard, type BoardCard, type BoardRow, type CardTone } from "@/components/timeline-board";

export const dynamic = "force-dynamic";

/** The board views, in the order the office knows them. The week views open the week planner. */
const VIEWS = {
  "staff-day": "Team Members By Day",
  "staff-area": "Team Members By Area",
  "staff-week": "Team Members By Week",
  "su-day": "Service Users By Day",
  "su-area": "Service Users By Area",
  "route-day": "Visits By Run Route",
} as const;
type View = keyof typeof VIEWS;
const FILTER = { hide: "Hide", include: "Include", only: "Show only" } as const;
type Filter = keyof typeof FILTER;

function tone(v: VisitRow, uncovered: boolean): CardTone {
  if (v.status === "CANCELLED") return "cancelled";
  if (uncovered) return "uncovered";
  if (v.status === "COMPLETED") return "done";
  if (v.status === "IN_PROGRESS") return "progress";
  if (v.status === "MISSED" || v.status === "NOT_DELIVERED") return "missed";
  return v.flags.overdueStart ? "late" : "due";
}

const STATE_WORD: Record<CardTone, string> = { due: "Due", late: "Late", progress: "In progress", done: "Complete", missed: "Missed", cancelled: "Cancelled", uncovered: "No carer" };

function card(v: VisitRow, who: string, uncovered = false): BoardCard {
  const startMin = londonMinute(v.scheduledStart);
  const t = tone(v, uncovered);
  const endMin = startMin + Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  return {
    id: v.id,
    startMin,
    endMin,
    title: who,
    line: `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")} · ${v.reference} - ${v.callType.name}`,
    tone: t,
    double: v.carersRequired > 1,
    tasks: v.tasks.length,
    alert: v.alertOnLate,
    locked: v.timeLocked,
    areaColour: v.area?.colour ?? null,
    label: `${STATE_WORD[t]}: ${who}, ${v.callType.name} at ${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}, reference ${v.reference}${v.carersRequired > 1 ? ", two carers" : ""}${v.tasks.length ? `, ${v.tasks.length} tasks` : ""}`,
  };
}

/**
 * Advanced Rota: the day as a planner board, the way the office reads it in OnePlan. Pick a view, a date and the
 * cancelled and uncovered filters; each visit card opens the visit, where carers are changed through the usual checks.
 */
export default async function AdvancedRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "staff-day";
  if (view === "staff-week") redirect(`/rota/planner?week=${mondayOf(date)}${sp.area ? `&area=${sp.area}` : ""}`);
  const cancelled: Filter = sp.cancelled && sp.cancelled in FILTER ? (sp.cancelled as Filter) : "hide";
  const uncovered: Filter = sp.uncovered && sp.uncovered in FILTER ? (sp.uncovered as Filter) : "include";
  const [{ rows: all, truncated }, lk] = await Promise.all([listVisits(ctx, { date, areaId: sp.area || undefined, includeCancelled: cancelled !== "hide", staffId: sp.carer || undefined }), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");

  let visits = all;
  if (cancelled === "only") visits = visits.filter((v) => v.status === "CANCELLED");
  if (uncovered === "only") visits = visits.filter((v) => v.flags.unassignedSlots > 0);
  if (uncovered === "hide") visits = visits.filter((v) => v.flags.unassignedSlots === 0);

  const rows: BoardRow[] = [];
  if (view === "staff-day" || view === "staff-area") {
    const unassigned = visits.filter((v) => v.flags.unassignedSlots > 0 && v.status !== "CANCELLED");
    rows.push({ key: "none", label: "Unassigned", danger: true, sub: `${unassigned.length} visit${unassigned.length === 1 ? "" : "s"}`, cards: unassigned.map((v) => card(v, suName(v.serviceUser), true)) });
    const byStaff = new Map<string, { name: string; cards: BoardCard[]; minutes: number; areas: Map<string, number> }>();
    for (const v of visits) {
      for (const a of v.assignments) {
        const r = byStaff.get(a.staffId) ?? { name: a.staff.displayName, cards: [] as BoardCard[], minutes: 0, areas: new Map<string, number>() };
        r.cards.push(card(v, `${suName(v.serviceUser)}${a.slot === "SHADOW" ? " (shadow)" : ""}`));
        if (v.status !== "CANCELLED" && a.slot !== "SHADOW") r.minutes += (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000;
        const area = v.area?.name ?? "No area";
        r.areas.set(area, (r.areas.get(area) ?? 0) + 1);
        byStaff.set(a.staffId, r);
      }
    }
    const list = [...byStaff.entries()].map(([id, r]) => ({ id, ...r, mainArea: [...r.areas.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "No area" }));
    list.sort((a, b) => (view === "staff-area" ? a.mainArea.localeCompare(b.mainArea) : 0) || a.name.localeCompare(b.name));
    for (const r of list) rows.push({ key: r.id, label: <Link href={`/rota/staff/${r.id}`}>{r.name}</Link>, sub: `${(r.minutes / 60).toFixed(1)} h`, group: view === "staff-area" ? r.mainArea : undefined, cards: r.cards });
  } else if (view === "su-day" || view === "su-area") {
    const bySu = new Map<string, { name: string; area: string; cards: BoardCard[] }>();
    for (const v of visits) {
      const r = bySu.get(v.serviceUser.id) ?? { name: suName(v.serviceUser), area: v.area?.name ?? "No area", cards: [] as BoardCard[] };
      const carers = v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName);
      r.cards.push(card(v, carers.length ? carers.join(" & ") : "No carer", v.flags.unassignedSlots > 0 && v.status !== "CANCELLED"));
      bySu.set(v.serviceUser.id, r);
    }
    const list = [...bySu.entries()].sort((a, b) => (view === "su-area" ? a[1].area.localeCompare(b[1].area) : 0) || a[1].name.localeCompare(b[1].name));
    for (const [id, r] of list) rows.push({ key: id, label: <Link href={`/rota/service-users/${id}`}>{r.name}</Link>, sub: `${r.cards.length} visit${r.cards.length === 1 ? "" : "s"}`, group: view === "su-area" ? r.area : undefined, cards: r.cards });
  } else {
    const byRoute = new Map<string, { name: string; cards: BoardCard[] }>();
    for (const v of visits) {
      const key = v.runRoute?.id ?? "none";
      const r = byRoute.get(key) ?? { name: v.runRoute?.name ?? "Not on a run route", cards: [] as BoardCard[] };
      const carers = v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName);
      r.cards.push(card(v, `${suName(v.serviceUser)}${carers.length ? ` · ${carers.join(" & ")}` : ""}`, v.flags.unassignedSlots > 0 && v.status !== "CANCELLED"));
      byRoute.set(key, r);
    }
    for (const [key, r] of [...byRoute.entries()].sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : a[1].name.localeCompare(b[1].name)))) rows.push({ key, label: r.name, sub: `${r.cards.length} visits`, cards: r.cards });
  }

  const starts = visits.map((v) => londonMinute(v.scheduledStart));
  const ends = visits.map((v) => londonMinute(v.scheduledStart) + (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  const fromMin = Math.min(7 * 60, ...starts.map((s) => Math.floor(s / 60) * 60));
  const toMin = Math.min(24 * 60, Math.max(22 * 60, ...ends.map((e) => Math.ceil(e / 60) * 60)));
  const nowMin = date === londonDate() ? londonMinute(new Date()) : null;
  const params = { date, view, cancelled: sp.cancelled, uncovered: sp.uncovered, area: sp.area, carer: sp.carer, refresh: sp.refresh };
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();

  return (
    <>
      {sp.refresh === "1" ? <AutoRefresh seconds={60} /> : null}
      <PageHeader title="Advanced Rota" back="/rota" subtitle="The day as a planner board in half-hour slots. Open a card to change its carer or time; every change is checked against holidays, HR checks and clashes first. Use Team Members By Week to drag visits between carers." />
      <Flash searchParams={sp} />

      <section aria-label="Board controls" className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <form method="get" className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
          <input type="hidden" name="date" value={date} />
          <label><span className="label text-[12px]">View</span>
            <select name="view" defaultValue={view} className="input">{Object.entries(VIEWS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label><span className="label text-[12px]">Cancelled</span>
            <select name="cancelled" defaultValue={cancelled} className="input">{Object.entries(FILTER).map(([k, l]) => <option key={k} value={k}>{l} cancelled</option>)}</select>
          </label>
          <label><span className="label text-[12px]">Uncovered</span>
            <select name="uncovered" defaultValue={uncovered} className="input">{Object.entries(FILTER).map(([k, l]) => <option key={k} value={k}>{l} uncovered</option>)}</select>
          </label>
          <label><span className="label text-[12px]">Area</span>
            <select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <span className="flex items-center gap-3 pb-1"><label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="refresh" value="1" defaultChecked={sp.refresh === "1"} className="h-4 w-4" /> Auto refresh</label>
          <button className="btn-primary">Show</button></span>
        </form>
        <div className="flex flex-col items-end gap-2">
          <form method="get" className="flex items-center gap-1.5">
            {Object.entries(params).filter(([k, v]) => k !== "date" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Link href={`/rota/advanced?${qs({ date: addDays(date, -1) })}`} className="btn-secondary px-2.5" aria-label="Previous day"><CaretLeft size={18} weight="bold" /></Link>
            <label className="sr-only" htmlFor="adv-date">Date</label>
            <input id="adv-date" type="date" name="date" defaultValue={date} className="input w-[150px]" />
            <button className="btn-secondary">Go</button>
            <Link href={`/rota/advanced?${qs({ date: addDays(date, 1) })}`} className="btn-secondary px-2.5" aria-label="Next day"><CaretRight size={18} weight="bold" /></Link>
          </form>
          <details className="relative">
            <summary className="btn-primary cursor-pointer list-none">Actions ▾</summary>
            <ul className="absolute right-0 z-30 mt-1 w-[220px] rounded border border-slate-200 bg-white py-1 text-[14px] shadow-lg">
              {canEdit ? <li><Link href={`/rota/visits/new?date=${date}`} className="block px-3 py-2 hover:bg-slate-50">Add visit</Link></li> : null}
              <li><Link href={`/rota/visits?date=${date}`} className="block px-3 py-2 hover:bg-slate-50">To Daily Rota</Link></li>
              <li><Link href="/workforce/absences" className="block px-3 py-2 hover:bg-slate-50">View holidays</Link></li>
              <li><Link href="/rota/templates/planner" className="block px-3 py-2 hover:bg-slate-50">To templates</Link></li>
            </ul>
          </details>
        </div>
      </section>

      <h2 className="mb-2 text-[22px] font-semibold text-[#2f6b3a]">{longDate(date)} · {VIEWS[view]}</h2>
      <TimelineBoard rows={rows} fromMin={fromMin} toMin={toMin} nowMin={nowMin} caption={view.startsWith("su") ? "Service user" : view === "route-day" ? "Run route" : "Team member"} />
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate-600">
        <span><span className="mr-1 inline-block h-3 w-3 border border-[#b9cbe6] bg-[#e8eff9] align-middle" />Due</span>
        <span><span className="mr-1 inline-block h-3 w-3 border border-[#e2c25b] bg-[#fff3c9] align-middle" />Late</span>
        <span><span className="mr-1 inline-block h-3 w-3 border border-[#7cc4e4] bg-[#d6f0fa] align-middle" />In progress</span>
        <span><span className="mr-1 inline-block h-3 w-3 border border-[#8fcb9d] bg-[#e1f3e5] align-middle" />Complete</span>
        <span><span className="mr-1 inline-block h-3 w-3 border border-[#e39a9a] bg-[#fbe0e0] align-middle" />Missed</span>
        <span><span className="mr-1 inline-block h-3 w-3 border border-dashed border-[#d9473f] align-middle" />No carer</span>
        <span>The red line is the time now. Each card&apos;s state is also read out to screen readers.</span>
      </p>
      {truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">Showing the first 1,000 visits. Choose an area to see the rest.</p> : null}
    </>
  );
}
