import type { AbsenceKind, VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, fmtLondonDate, fromDbDate, hhmm, isIsoDate, isoWeekday, londonDate, londonTime, londonToUtc, mondayOf } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { weekIsBuilt } from "./build";
import { listVisits, rotaLookups, suName, weekDates } from "./queries";
import { staffDirectoryWhere } from "./scope";

/**
 * The roster: the week as one row per carer (or per service user), the rota's home screen. Each visit is a block
 * coloured by its state (done, missed, upcoming, draft, needs review), leave and unavailable time are shaded on the
 * carer's day, and every carer shows booked hours against their weekly limit. All data comes from the same scoped
 * queries as the rest of the rota; moves still go through the assignment service.
 */

export type ChipTone = "ok" | "review" | "empty" | "done" | "cancelled" | "missed" | "draft" | "active";
export interface RosterChip {
  visitId: string;
  slot: "PRIMARY" | "SECOND" | "SHADOW";
  lockVersion: number;
  href: string;
  time: string;
  label: string;
  title: string;
  tone: ChipTone;
  movable: boolean;
}
export interface CellShade {
  tone: "leave" | "sick" | "unavailable" | "requested";
  label: string;
}
export interface RosterRow {
  id: string;
  name: string;
  sub: string;
  href?: string;
  /** Booked minutes against the weekly limit, when the carer has one. */
  over?: boolean;
  cells: RosterChip[][];
  shades?: (CellShade | null)[];
}

/** A visit's colour on the roster. Pure, so the key on screen and the tests use the same rule. */
export function chipTone(v: { status: VisitStatus; published: boolean; review: boolean; empty?: boolean }): ChipTone {
  if (v.status === "CANCELLED") return "cancelled";
  if (v.status === "COMPLETED") return "done";
  if (v.status === "IN_PROGRESS") return "active";
  if (v.status === "MISSED" || v.status === "NOT_DELIVERED") return "missed";
  if (v.empty) return "empty";
  if (v.review) return "review";
  return v.published ? "ok" : "draft";
}

const ABSENCE_LABEL: Record<AbsenceKind, string> = { HOLIDAY: "Holiday", SICKNESS: "Sick", COMPASSIONATE: "Compassionate leave", TRAINING: "Training", UNPAID: "Unpaid leave", OTHER: "Absent" };

/** What to shade on one carer's day: an absence wins over a working-pattern gap. Pure. */
export function dayShade(
  date: string,
  absences: { kind: AbsenceKind; status: string; startsAt: Date; endsAt: Date }[],
  pattern: { kind: "AVAILABLE" | "UNAVAILABLE"; weekday: number; startMinute: number; endMinute: number; effectiveFrom: Date; effectiveTo: Date | null }[],
): CellShade | null {
  const from = londonToUtc(date, 0);
  const to = londonToUtc(addDays(date, 1), 0);
  const abs = absences.find((a) => a.startsAt < to && a.endsAt > from);
  if (abs) {
    const part = abs.startsAt > from || abs.endsAt < to ? ` ${londonTime(abs.startsAt > from ? abs.startsAt : from)}–${abs.endsAt < to ? londonTime(abs.endsAt) : "24:00"}` : "";
    if (abs.status === "REQUESTED") return { tone: "requested", label: `${ABSENCE_LABEL[abs.kind]} requested${part}` };
    return { tone: abs.kind === "SICKNESS" ? "sick" : "leave", label: `${ABSENCE_LABEL[abs.kind]}${part}` };
  }
  const wd = isoWeekday(date);
  const off = pattern.filter((p) => p.kind === "UNAVAILABLE" && p.weekday === wd && fromDbDate(p.effectiveFrom) <= date && (!p.effectiveTo || fromDbDate(p.effectiveTo) >= date));
  if (off.length) return { tone: "unavailable", label: off.map((p) => (p.startMinute === 0 && p.endMinute >= 1440 ? "Unavailable" : `Unavailable ${hhmm(p.startMinute)}–${hhmm(Math.min(p.endMinute, 1440))}`)).join(", ") };
  return null;
}

export interface RosterFilters {
  week?: string;
  area?: string;
  view?: string;
  cancelled?: boolean;
  all?: boolean;
}

export async function rosterWeek(ctx: Ctx, f: RosterFilters, chipHref: (visitId: string) => string) {
  const today = londonDate();
  const week = mondayOf(f.week && isIsoDate(f.week) ? f.week : today);
  const dates = weekDates(week);
  const view = f.view === "clients" ? "clients" : "carers";
  const [{ rows: visits, truncated }, lk] = await Promise.all([listVisits(ctx, { date: week, to: addDays(week, 6), areaId: f.area || undefined, includeCancelled: !!f.cancelled }, 4000), rotaLookups(ctx)]);
  const scope = lk.scope;
  const notBuilt = visits.length === 0 && !(await weekIsBuilt(ctx, week));
  const from = londonToUtc(week, 0);
  const to = londonToUtc(addDays(week, 7), 0);
  const staffIds = lk.staff.map((s) => s.id);
  const [absences, pattern, profiles] = await Promise.all([
    db.staffAbsence.findMany({ where: { organisationId: scope.organisationId, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { lt: to }, endsAt: { gt: from }, staff: staffDirectoryWhere(scope, { status: "all" }) }, select: { staffId: true, kind: true, status: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" } }),
    db.staffAvailability.findMany({ where: { organisationId: scope.organisationId, staffId: { in: staffIds }, kind: "UNAVAILABLE" }, select: { staffId: true, kind: true, weekday: true, startMinute: true, endMinute: true, effectiveFrom: true, effectiveTo: true } }),
    db.rotaStaffProfile.findMany({ where: { organisationId: scope.organisationId, staffId: { in: staffIds } }, select: { staffId: true, maxWeeklyMinutes: true } }),
  ]);
  const limit = new Map(profiles.map((p) => [p.staffId, p.maxWeeklyMinutes]));

  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const blank = () => dates.map((): RosterChip[] => []);
  const byRow = new Map<string, { cells: RosterChip[][]; minutes: number }>();
  const unassigned = blank();
  const counts = { visits: 0, draft: 0, emptySlots: 0, review: 0, missed: 0 };

  for (const v of visits) {
    const di = dayIndex.get(londonDate(v.scheduledStart));
    if (di === undefined) continue;
    const time = londonTime(v.scheduledStart);
    const name = suName(v.serviceUser);
    const movable = v.status === "SCHEDULED" || v.status === "MISSED";
    const minutes = (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000;
    const published = !!v.publishedAt;
    if (v.status !== "CANCELLED") {
      counts.visits++;
      if (!published && v.status === "SCHEDULED") counts.draft++;
      if (v.status === "MISSED") counts.missed++;
      counts.emptySlots += v.flags.unassignedSlots;
    }
    const span = `${v.callType.name} ${time}–${londonTime(v.scheduledEnd)}`;
    const state = published ? "" : " · draft, not yet published";
    if (view === "clients") {
      const row = byRow.get(v.serviceUserId) ?? { cells: blank(), minutes: 0 };
      const carers = v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName);
      const review = v.assignments.some((a) => a.reviewReason) && movable;
      row.cells[di]!.push({ visitId: v.id, slot: "PRIMARY", lockVersion: v.lockVersion, href: chipHref(v.id), time, label: carers.length ? carers.join(" & ") : "Unassigned", title: `${span}${state}`, tone: chipTone({ status: v.status, published, review, empty: v.flags.unassignedSlots > 0 && movable }), movable: false });
      if (v.status !== "CANCELLED") row.minutes += minutes;
      byRow.set(v.serviceUserId, row);
      if (review) counts.review++;
      continue;
    }
    for (const a of v.assignments) {
      const row = byRow.get(a.staffId) ?? { cells: blank(), minutes: 0 };
      const review = !!a.reviewReason && movable;
      if (review) counts.review++;
      row.cells[di]!.push({ visitId: v.id, slot: a.slot as RosterChip["slot"], lockVersion: v.lockVersion, href: chipHref(v.id), time, label: `${name}${a.slot === "SHADOW" ? " (shadow)" : v.carersRequired > 1 ? " (2)" : ""}`, title: `${span}${state}${review ? ` · Needs review: ${a.reviewReason}` : ""}`, tone: chipTone({ status: v.status, published, review }), movable });
      if (v.status !== "CANCELLED" && a.slot !== "SHADOW") row.minutes += minutes;
      byRow.set(a.staffId, row);
    }
    if (v.flags.unassignedSlots > 0 && v.status !== "CANCELLED") {
      const slot = v.assignments.some((a) => a.slot === "PRIMARY") ? "SECOND" : "PRIMARY";
      unassigned[di]!.push({ visitId: v.id, slot, lockVersion: v.lockVersion, href: chipHref(v.id), time, label: `${name}${v.carersRequired > 1 ? " (2)" : ""}`, title: `${span} · drag to a carer to assign`, tone: "empty", movable });
    }
  }

  const fmtH = (m: number) => `${(m / 60).toFixed(1)} h`;
  let rows: RosterRow[];
  if (view === "clients") {
    const sus = lk.serviceUsers.filter((s) => byRow.has(s.id) || (f.all && (!f.area || s.areaId === f.area)));
    rows = sus.map((s) => {
      const r = byRow.get(s.id) ?? { cells: blank(), minutes: 0 };
      return { id: s.id, name: suName(s), sub: `${fmtH(r.minutes)} of care`, href: `/rota/service-users/${s.id}`, cells: r.cells };
    });
  } else {
    const absent = new Set(absences.map((a) => a.staffId));
    // Carers shown: everyone booked this week, carers away this week (so the gap is visible), and with "all", everyone.
    const pool = new Set(lk.carers.map((s) => s.id));
    const staffRows = lk.staff.filter((s) => byRow.has(s.id) || absent.has(s.id) || (pool.has(s.id) && (f.area ? f.all && s.areas.some((a) => a.areaId === f.area) : !!f.all)));
    const listed = new Set(staffRows.map((s) => s.id));
    const visiting = new Map(visits.flatMap((v) => v.assignments.filter((a) => !listed.has(a.staffId)).map((a) => [a.staffId, a.staff.displayName] as const)));
    const shadesFor = (id: string) => dates.map((d) => dayShade(d, absences.filter((a) => a.staffId === id), pattern.filter((p) => p.staffId === id)));
    rows = [
      { id: "unassigned", name: "Unassigned", sub: `${unassigned.flat().length} visits to cover`, cells: unassigned },
      ...staffRows.map((s) => {
        const r = byRow.get(s.id) ?? { cells: blank(), minutes: 0 };
        const max = limit.get(s.id);
        return { id: s.id, name: s.displayName, sub: max ? `${fmtH(r.minutes)} of ${fmtH(max)}` : `${fmtH(r.minutes)} booked`, over: !!max && r.minutes > max, href: `/rota/staff/${s.id}`, cells: r.cells, shades: shadesFor(s.id) };
      }),
      ...[...visiting].map(([id, name]) => {
        const r = byRow.get(id) ?? { cells: blank(), minutes: 0 };
        return { id, name, sub: `${fmtH(r.minutes)} · another branch`, cells: r.cells };
      }),
    ];
  }

  return {
    week,
    today,
    view,
    dates,
    days: dates.map((d) => ({ date: d, label: fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" }), today: d === today })),
    rows,
    counts,
    notBuilt,
    truncated,
    areas: lk.areas,
    staff: lk.staff,
  };
}

export interface TimelineBlock {
  id: string;
  href: string;
  start: number;
  end: number;
  label: string;
  sub: string;
  title: string;
  tone: ChipTone;
  /** The visit itself, so a page can select it; one visit can appear on two carers' rows (a double-up). */
  visitId: string;
  slot: "PRIMARY" | "SECOND" | "SHADOW" | "OPEN";
  call: string;
  span: string;
  status: VisitStatus;
  double: boolean;
}
export interface TimelineRow {
  id: string;
  name: string;
  sub: string;
  /** The run route most of this carer's visits that day belong to, when they have one. */
  run?: string | null;
  href?: string;
  over?: boolean;
  shade?: CellShade | null;
  blocks: TimelineBlock[];
}

function mostCommon(list: string[]) {
  const n = new Map<string, number>();
  for (const x of list) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * One day as a timeline, one row per carer (plus Unassigned), for the Daily Rota. Takes the visits the page already
 * loaded with its filters, so search, area and status limits apply unchanged.
 */
export async function dayTimeline(ctx: Ctx, date: string, visits: Awaited<ReturnType<typeof listVisits>>["rows"], lookups?: Awaited<ReturnType<typeof rotaLookups>>) {
  const lk = lookups ?? (await rotaLookups(ctx));
  const scope = lk.scope;
  const from = londonToUtc(date, 0);
  const to = londonToUtc(addDays(date, 1), 0);
  const ids = [...new Set(visits.flatMap((v) => v.assignments.map((a) => a.staffId)))];
  const [absences, pattern] = await Promise.all([
    db.staffAbsence.findMany({ where: { organisationId: scope.organisationId, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { lt: to }, endsAt: { gt: from }, staff: staffDirectoryWhere(scope, { status: "all" }) }, select: { staffId: true, kind: true, status: true, startsAt: true, endsAt: true } }),
    db.staffAvailability.findMany({ where: { organisationId: scope.organisationId, staffId: { in: ids }, kind: "UNAVAILABLE", weekday: isoWeekday(date) }, select: { staffId: true, kind: true, weekday: true, startMinute: true, endMinute: true, effectiveFrom: true, effectiveTo: true } }),
  ]);
  const minute = (d: Date) => Math.round((d.getTime() - from.getTime()) / 60000);
  const rows = new Map<string, TimelineRow>();
  const unassigned: TimelineRow = { id: "unassigned", name: "Unassigned", sub: "", blocks: [] };
  const names = new Map(lk.staff.map((s) => [s.id, s]));
  const runs = new Map<string, string[]>();
  for (const v of visits) {
    const published = !!v.publishedAt;
    const movable = v.status === "SCHEDULED" || v.status === "MISSED";
    const base = { start: minute(v.scheduledStart), end: minute(v.scheduledEnd), href: `/rota/visits/${v.id}` };
    const label = suName(v.serviceUser);
    const span = `${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)}`;
    const more = { visitId: v.id, call: v.callType.name, span, status: v.status, double: v.carersRequired > 1 };
    if (v.runRoute) for (const a of v.assignments) runs.set(a.staffId, [...(runs.get(a.staffId) ?? []), v.runRoute.name]);
    for (const a of v.assignments) {
      const review = !!a.reviewReason && movable;
      const row = rows.get(a.staffId) ?? { id: a.staffId, name: a.staff.displayName, sub: "", href: names.has(a.staffId) ? `/rota/staff/${a.staffId}` : undefined, blocks: [] };
      row.blocks.push({ ...base, ...more, slot: a.slot, id: `${v.id}:${a.slot}`, label: `${label}${a.slot === "SHADOW" ? " (shadow)" : v.carersRequired > 1 ? " (2)" : ""}`, sub: `${span} · ${v.callType.name}`, title: `${label}, ${v.callType.name} ${span}${published ? "" : " · draft, not yet published"}${review ? ` · Needs review: ${a.reviewReason}` : ""}`, tone: chipTone({ status: v.status, published, review }) });
      rows.set(a.staffId, row);
    }
    if (v.status === "CANCELLED" && !v.assignments.length) {
      unassigned.blocks.push({ ...base, ...more, slot: "OPEN", id: `${v.id}:cancelled`, label, sub: `${span} · cancelled`, title: `${label}, ${v.callType.name} ${span} · cancelled`, tone: "cancelled" });
    } else if (v.flags.unassignedSlots > 0 && v.status !== "CANCELLED") {
      unassigned.blocks.push({ ...base, ...more, slot: "OPEN", id: `${v.id}:open`, label, sub: `${span} · ${v.flags.unassignedSlots} carer${v.flags.unassignedSlots === 1 ? "" : "s"} needed`, title: `${label}, ${v.callType.name} ${span} · no carer yet`, tone: "empty" });
    }
  }
  // Carers away today appear even with nothing booked, so the gap is visible.
  for (const a of absences) if (!rows.has(a.staffId) && names.has(a.staffId)) rows.set(a.staffId, { id: a.staffId, name: names.get(a.staffId)!.displayName, sub: "", href: `/rota/staff/${a.staffId}`, blocks: [] });
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of list) {
    const mins = r.blocks.filter((b) => b.tone !== "cancelled" && !b.label.endsWith("(shadow)")).reduce((n, b) => n + (b.end - b.start), 0);
    r.sub = `${r.blocks.length} visit${r.blocks.length === 1 ? "" : "s"} · ${(mins / 60).toFixed(1)} h`;
    r.shade = dayShade(date, absences.filter((x) => x.staffId === r.id), pattern.filter((p) => p.staffId === r.id));
    r.run = mostCommon(runs.get(r.id) ?? []);
  }
  unassigned.sub = `${unassigned.blocks.length} visit${unassigned.blocks.length === 1 ? "" : "s"} to cover`;
  const all = [unassigned, ...list];
  const times = all.flatMap((r) => r.blocks.flatMap((b) => [b.start, b.end]));
  const axisStart = Math.min(7 * 60, ...times.map((t) => Math.floor(t / 60) * 60));
  const axisEnd = Math.max(22 * 60, ...times.map((t) => Math.ceil(t / 60) * 60));
  return { rows: all, axisStart: Math.max(0, axisStart), axisEnd: Math.min(24 * 60, axisEnd) };
}
