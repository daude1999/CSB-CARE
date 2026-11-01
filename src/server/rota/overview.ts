import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { readinessFor } from "@/server/readiness";
import { exceptionCounts } from "./exceptions";
import { deriveFlags, memberNames, suName } from "./queries";
import { rotaSettings } from "./settings";
import { authorisedBranches, buildWhere, rotaScope, staffDirectoryWhere, visitBranchClause, visitWhere, type Scope } from "./scope";

/**
 * The Rota Dashboard: operational health for a day or a week, for one authorised branch or all of them. Every figure is
 * worked out on read from visits, bookings, absences, availability and readiness, with the same rules as the Daily Rota
 * (deriveFlags), so a figure and the list it links to always agree. No money is shown here.
 */

export type Period = "day" | "week" | "next";
export interface OverviewInput {
  date?: string;
  period?: string;
  branch?: string;
}

const READINESS_ATTENTION = ["NOT_READY", "READY_WITH_RESTRICTIONS", "REVIEW_REQUIRED"] as const;
const visitSelect = {
  id: true,
  reference: true,
  status: true,
  date: true,
  scheduledStart: true,
  scheduledEnd: true,
  actualStart: true,
  actualEnd: true,
  carersRequired: true,
  publishedAt: true,
  serviceUserId: true,
  serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
  callType: { select: { name: true } },
  assignments: { where: { removedAt: null }, select: { slot: true, staffId: true, removedAt: true, reviewReason: true } },
} satisfies Prisma.VisitSelect;
type Row = Prisma.VisitGetPayload<{ select: typeof visitSelect }>;

/** Branches the member may choose: their granted branches, or every branch. */
export const dashboardBranches = authorisedBranches;

/** The visit clause for a scope plus an optional chosen branch (judged by the service user's branch). */
function visitsIn(scope: Scope, branchId: string | null): Prisma.VisitWhereInput {
  const ands: Prisma.VisitWhereInput[] = [visitWhere(scope)];
  if (scope.branchIds) ands.push({ serviceUser: { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] } });
  if (branchId) ands.push(visitBranchClause(scope, branchId));
  return { AND: ands };
}

export function periodRange(date: string, period: Period) {
  if (period === "day") return { from: date, to: date, prevFrom: addDays(date, -7), prevTo: addDays(date, -7) };
  const monday = period === "next" ? addDays(mondayOf(date), 7) : mondayOf(date);
  return { from: monday, to: addDays(monday, 6), prevFrom: addDays(monday, -7), prevTo: addDays(monday, -1) };
}

/** Coverage of one visit: every visit is exactly one of these (carer slots are never counted as visits). */
export function coverageOf(v: { carersRequired: number; assignments: { slot: string }[] }): "full" | "partial" | "none" {
  const booked = v.assignments.filter((a) => a.slot !== "SHADOW").length;
  if (booked >= v.carersRequired) return "full";
  return booked === 0 ? "none" : "partial";
}

/** Mutually exclusive delivery states for the performance panel. */
export function deliveryState(status: string): "completed" | "inProgress" | "due" | "missed" | "notDelivered" | null {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "IN_PROGRESS":
      return "inProgress";
    case "SCHEDULED":
      return "due";
    case "MISSED":
      return "missed";
    case "NOT_DELIVERED":
      return "notDelivered";
    default:
      return null;
  }
}

/**
 * The five headline figures, shared by the Rota Dashboard and the Daily Rota so the two always agree. Cancelled visits
 * must already be left out. Unassigned means at least one carer slot is empty; late excludes visits marked missed.
 */
/**
 * Leaves out a recovery visit (booked through Find Cover for a missed call) when the missed visit it recovers is in the
 * same list, so one care need is counted once and the missed visit stays counted as missed.
 */
export function countedOnce<T extends { id: string; recoveryOfId?: string | null }>(visits: T[]): T[] {
  const ids = new Set(visits.map((v) => v.id));
  return visits.filter((v) => !(v.recoveryOfId && ids.has(v.recoveryOfId)));
}

export function visitKpis(all: { id: string; recoveryOfId?: string | null; status: string; flags: { unassignedSlots: number; late: boolean } }[]) {
  const visits = countedOnce(all);
  const total = visits.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const completed = visits.filter((v) => v.status === "COMPLETED").length;
  const unassigned = visits.filter((v) => v.flags.unassignedSlots > 0).length;
  const missed = visits.filter((v) => v.status === "MISSED").length;
  const late = visits.filter((v) => v.flags.late && v.status !== "MISSED").length;
  return {
    total,
    completed,
    unassigned,
    missed,
    late,
    cards: {
      scheduled: { value: total },
      completed: { value: completed, percent: pct(completed) },
      unassigned: { value: unassigned, percent: pct(unassigned) },
      missed: { value: missed, percent: pct(missed) },
      late: { value: late, percent: pct(late) },
    },
  };
}

/**
 * Visits that need action, shared by the Rota Dashboard and the Daily Rota: missed visits; upcoming visits with no carer;
 * upcoming double-ups with only one carer; and visits still not started past the late threshold. A visit can be in two
 * lists, so callers count distinct visits for a total.
 */
export function attentionOf<T extends { id: string; status: string; carersRequired: number; scheduledEnd: Date; flags: { unassignedSlots: number; overdueStart: boolean } }>(visits: T[], now: Date) {
  const upcoming = visits.filter((v) => v.scheduledEnd > now && ["SCHEDULED", "IN_PROGRESS"].includes(v.status));
  return {
    missed: visits.filter((v) => v.status === "MISSED"),
    unassigned: upcoming.filter((v) => v.flags.unassignedSlots > 0 && v.flags.unassignedSlots === v.carersRequired),
    partial: upcoming.filter((v) => v.carersRequired > 1 && v.flags.unassignedSlots > 0 && v.flags.unassignedSlots < v.carersRequired),
    late: visits.filter((v) => v.status === "SCHEDULED" && v.flags.overdueStart),
  };
}

export async function rotaOverview(ctx: Ctx, input: OverviewInput) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const today = londonDate();
  const date = input.date && isIsoDate(input.date) ? input.date : today;
  const period: Period = input.period === "week" || input.period === "next" ? input.period : "day";
  const branches = await dashboardBranches(scope);
  const branch = input.branch && branches.some((b) => b.id === input.branch) ? input.branch : null;
  const range = periodRange(date, period);
  const settings = await rotaSettings(db, org);
  const now = new Date();
  const where = visitsIn(scope, branch);

  const load = (from: string, to: string) => db.visit.findMany({ where: { AND: [where, { date: { gte: dbDate(from), lte: dbDate(to) }, status: { not: "CANCELLED" } }] }, select: visitSelect, orderBy: [{ scheduledStart: "asc" }, { id: "asc" }] });
  const [rows, prevCount, coverageRows] = await Promise.all([
    load(range.from, range.to),
    db.visit.count({ where: { AND: [where, { date: { gte: dbDate(range.prevFrom), lte: dbDate(range.prevTo) }, status: { not: "CANCELLED" } }] } }),
    load(date, addDays(date, 6)),
  ]);
  const flagged = (list: Row[]) => list.map((v) => ({ ...v, flags: deriveFlags(v, settings, now) }));
  const visits = flagged(rows);
  const total = visits.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // ── KPI cards ── Late and unassigned overlap the delivery states, so the five cards are not meant to add up.
  const base = visitKpis(visits);
  const { unassigned, late } = base;
  const kpis = { ...base.cards, scheduled: { value: total, previous: prevCount }, late: { ...base.cards.late, thresholdMin: settings.lateAfterMin } };

  // ── Performance ── Each visit is in exactly one state; the slices add up to the total.
  const states = { completed: 0, inProgress: 0, due: 0, missed: 0, notDelivered: 0 };
  for (const v of visits) {
    const s = deliveryState(v.status);
    if (s) states[s]++;
  }
  const performance = { total, states, future: range.from > today, completedPercent: pct(states.completed), unassigned, late };

  // ── Needs attention ── Outstanding work only: upcoming open slots, currently late visits (not started), missed
  // visits in the period, part-staffed double-ups still to come; plus staff whose readiness affects allocation.
  const attentionVisits = attentionOf(visits, now);

  // ── Staffing ── Care staff in scope (and branch), today's absences, and recorded unavailability.
  const staffWhere: Prisma.StaffMemberWhereInput = { ...staffDirectoryWhere(scope, { status: "all" }), employmentStatus: "ACTIVE", hrMissing: false, ...(branch ? { branchId: branch } : {}) };
  const staff = await db.staffMember.findMany({ where: staffWhere, select: { id: true, displayName: true } });
  const ids = staff.map((s) => s.id);
  const dayStart = londonToUtc(date, 0);
  const dayEnd = londonToUtc(addDays(date, 1), 0);
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const [absences, unavailable, readiness] = await Promise.all([
    db.staffAbsence.findMany({ where: { organisationId: org, staffId: { in: ids }, status: "APPROVED", startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { staffId: true, kind: true } }),
    db.staffAvailability.findMany({ where: { organisationId: org, staffId: { in: ids }, kind: "UNAVAILABLE", weekday, startMinute: { lte: 0 }, endMinute: { gte: 1440 }, effectiveFrom: { lte: dbDate(date) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(date) } }] }, select: { staffId: true } }),
    hasOrgPermission(ctx, "readiness.view") || hasOrgPermission(ctx, "rota.view") ? readinessFor(db, org, ids, { date }) : Promise.resolve(new Map()),
  ]);
  const sick = new Set(absences.filter((a) => a.kind === "SICKNESS").map((a) => a.staffId));
  const leave = new Set(absences.filter((a) => a.kind !== "SICKNESS").map((a) => a.staffId));
  const holiday = new Set(absences.filter((a) => a.kind === "HOLIDAY").map((a) => a.staffId));
  const offAllDay = new Set(unavailable.map((u) => u.staffId));
  const restricted = staff.filter((s) => (READINESS_ATTENTION as readonly string[]).includes(readiness.get(s.id)?.status ?? "")).map((s) => s.id);
  const notReady = new Set(staff.filter((s) => readiness.get(s.id)?.status === "NOT_READY").map((s) => s.id));
  const available = staff.filter((s) => !sick.has(s.id) && !leave.has(s.id) && !offAllDay.has(s.id) && !notReady.has(s.id)).length;
  const staffing = { carers: staff.length, available, onLeave: holiday.size, otherLeave: leave.size - holiday.size, sick: sick.size, unavailable: offAllDay.size, restrictions: restricted.length };

  const attention = {
    ...Object.fromEntries(Object.entries(attentionVisits).map(([k, v]) => [k, v.length])),
    readiness: restricted.length,
    /** Distinct visits needing action (a visit in two lists counts once), plus staff with readiness problems. */
    total: new Set(Object.values(attentionVisits).flat().map((v) => v.id)).size + restricted.length,
  } as { missed: number; unassigned: number; partial: number; late: number; readiness: number; total: number };

  // ── Seven-day coverage ── from the selected date; a day with no visits and no build is "not built".
  const cov = flagged(coverageRows).filter((v) => v.status !== "NOT_DELIVERED");
  const builtWeeks = new Set(
    (await db.rotaBuild.findMany({ where: { ...buildWhere(scope), weekStart: { gte: dbDate(mondayOf(date)), lte: dbDate(mondayOf(addDays(date, 6))) }, status: "BUILT" }, select: { weekStart: true } })).map((b) => fromDbDate(b.weekStart)),
  );
  const coverage = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(date, i);
    const dayVisits = cov.filter((v) => fromDbDate(v.date) === d);
    const c = { full: 0, partial: 0, none: 0 };
    for (const v of dayVisits) c[coverageOf(v)]++;
    return { date: d, ...c, total: dayVisits.length, notBuilt: dayVisits.length === 0 && !builtWeeks.has(mondayOf(d)) };
  });

  // ── Insights ── real conditions only, each with a link.
  const tomorrow = addDays(today, 1);
  const nextMonday = addDays(mondayOf(today), 7);
  const [tomorrowGaps, leaveNextWeek, suAbsences, unpublished, notBuiltWeeks, flaggedBookings, exceptions, prevAllocated] = await Promise.all([
    db.visit.findMany({ where: { AND: [where, { date: dbDate(tomorrow), status: "SCHEDULED" }] }, select: { carersRequired: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } } }),
    db.staffAbsence.findMany({ where: { organisationId: org, staffId: { in: ids }, status: "APPROVED", kind: "HOLIDAY", startsAt: { lt: londonToUtc(addDays(nextMonday, 7), 0) }, endsAt: { gt: londonToUtc(nextMonday, 0) } }, select: { staffId: true } }),
    db.serviceUserAbsence.findMany({ where: { organisationId: org, cancelledAt: null, startsAt: { lt: new Date(now.getTime() + 7 * 86_400_000) }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], serviceUser: { AND: [visitsServiceUser(scope), branch ? { branchId: branch } : {}] } }, select: { serviceUserId: true } }),
    db.visit.count({ where: { AND: [where, { status: "SCHEDULED", publishedAt: null, scheduledStart: { gt: now } }] } }),
    notBuiltAhead(scope, today),
    db.visitAssignment.count({ where: { organisationId: org, removedAt: null, reviewReason: { not: null }, visit: { AND: [where, { status: "SCHEDULED", scheduledStart: { gt: now } }] } } }),
    hasOrgPermission(ctx, "rota.monitor") ? exceptionCounts(ctx) : Promise.resolve(null),
    period === "day" ? Promise.resolve(null) : allocatedShare(where, range.prevFrom, range.prevTo, settings),
  ]);
  const gaps = tomorrowGaps.reduce((n, v) => n + Math.max(0, v.carersRequired - v.assignments.length), 0);
  const completion = total ? Math.round(((total - unassigned) / total) * 1000) / 10 : null;
  const insights: { tone: "ok" | "warn" | "bad" | "info"; text: string; href: string; detail?: string }[] = [];
  if (completion !== null) insights.push({ tone: completion >= 99 ? "ok" : completion >= 95 ? "warn" : "bad", text: `Rota completion: ${completion}%`, detail: prevAllocated !== null && prevAllocated !== undefined ? `${completion - prevAllocated >= 0 ? "+" : ""}${(completion - prevAllocated).toFixed(1)}pp vs the week before` : undefined, href: `/rota/unassigned?from=${range.from > today ? range.from : today}&days=7` });
  if (gaps) insights.push({ tone: "bad", text: `${gaps} staffing gap${gaps === 1 ? "" : "s"} tomorrow`, href: `/rota/visits?date=${tomorrow}&view=unassigned${branch ? `&branch=${branch}` : ""}` });
  const onLeaveNext = new Set(leaveNextWeek.map((l) => l.staffId)).size;
  if (onLeaveNext) insights.push({ tone: "info", text: `${onLeaveNext} carer${onLeaveNext === 1 ? "" : "s"} on annual leave next week`, href: `/rota/cover?from=${nextMonday}&days=7&kind=HOLIDAY` });
  const suAway = new Set(suAbsences.map((a) => a.serviceUserId)).size;
  if (suAway) insights.push({ tone: "info", text: `${suAway} service user${suAway === 1 ? "" : "s"} with a planned absence in the next 7 days`, href: "/rota/service-users" });
  if (flaggedBookings) insights.push({ tone: "warn", text: `${flaggedBookings} booking${flaggedBookings === 1 ? "" : "s"} flagged after sickness, leave or an HR change`, href: "/rota/cover" });
  if (notBuiltWeeks.length) insights.push({ tone: "warn", text: `${notBuiltWeeks.length} of the next 4 weeks not built yet`, detail: `from w/c ${notBuiltWeeks[0]}`, href: `/rota/build?week=${notBuiltWeeks[0]}` });
  if (unpublished) insights.push({ tone: "warn", text: `${unpublished} upcoming visit${unpublished === 1 ? "" : "s"} not published to carers`, href: "/rota/build" });
  if (exceptions?.overdue) insights.push({ tone: "bad", text: `${exceptions.overdue} overdue exception${exceptions.overdue === 1 ? "" : "s"}`, href: "/rota/exceptions" });

  return { date, today, period, range, branch, branches, kpis, performance, attention, staffing, coverage, insights, attentionHrefs: attentionLinks(date, range, branch) };
}

function visitsServiceUser(scope: Scope): Prisma.ServiceUserWhereInput {
  const ands: Prisma.ServiceUserWhereInput[] = [];
  if (scope.areaIds) ands.push({ OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] });
  if (scope.branchIds) ands.push({ OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] });
  return ands.length ? { AND: ands } : {};
}

async function notBuiltAhead(scope: Scope, today: string) {
  const weeks = Array.from({ length: 4 }, (_, i) => addDays(mondayOf(today), 7 * (i + 1)));
  const built = new Set((await db.rotaBuild.findMany({ where: { ...buildWhere(scope), weekStart: { in: weeks.map(dbDate) }, status: "BUILT" }, select: { weekStart: true } })).map((b) => fromDbDate(b.weekStart)));
  const withVisits = new Set((await db.visit.groupBy({ by: ["date"], where: { ...visitWhere(scope), date: { gte: dbDate(weeks[0]!), lte: dbDate(addDays(weeks[3]!, 6)) } } })).map((g) => mondayOf(fromDbDate(g.date))));
  return weeks.filter((w) => !built.has(w) && !withVisits.has(w));
}

async function allocatedShare(where: Prisma.VisitWhereInput, from: string, to: string, settings: Awaited<ReturnType<typeof rotaSettings>>) {
  const rows = await db.visit.findMany({ where: { AND: [where, { date: { gte: dbDate(from), lte: dbDate(to) }, status: { not: "CANCELLED" } }] }, select: { status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, actualEnd: true, carersRequired: true, assignments: { where: { removedAt: null }, select: { slot: true, removedAt: true, reviewReason: true } } } });
  if (!rows.length) return null;
  const open = rows.filter((v) => deriveFlags(v, settings).unassignedSlots > 0).length;
  return Math.round(((rows.length - open) / rows.length) * 1000) / 10;
}

function attentionLinks(date: string, range: { from: string; to: string }, branch: string | null) {
  const b = branch ? `&branch=${branch}` : "";
  const day = range.from === range.to;
  return {
    missed: day ? `/rota/visits?date=${date}&layout=list&status=MISSED${b}` : "/rota/missed",
    unassigned: `/rota/visits?date=${day ? date : londonDate()}&view=unassigned${b}`,
    partial: `/rota/unassigned?from=${day ? date : range.from}&days=${day ? 1 : 7}`,
    late: `/rota/visits?date=${day ? date : londonDate()}&view=late${b}`,
    readiness: "/rota/readiness",
  };
}

// ── Recent activity ──

const ACTIVITY_LABEL: Record<string, string> = {
  CREATED: "Visit created",
  ASSIGNED: "Carer assigned",
  REASSIGNED: "Carer reassigned",
  UNASSIGNED: "Carer removed",
  EDITED: "Visit changed",
  PUBLISHED: "Visit published",
  SWAPPED: "Shift swapped",
};

function statusLabel(to: string | null, from: string | null) {
  if (to === "CANCELLED") return "Visit cancelled";
  if (from === "CANCELLED" && to === "SCHEDULED") return "Visit reinstated";
  if (to === "MISSED") return "Visit missed";
  if (to === "COMPLETED") return "Visit completed";
  if (to === "IN_PROGRESS") return "Visit started";
  if (to === "NOT_DELIVERED") return "Recorded not delivered";
  return "Status changed";
}

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * Recorded rota events, newest first: visit history for visits the member may see, plus whole-rota events (built,
 * published, rolled forward) for members without branch limits. Clocking and task ticks are left out.
 */
export async function rotaActivity(ctx: Ctx, f: { branch?: string; q?: string; take?: number; skip?: number } = {}) {
  const scope = await rotaScope(ctx, "rota.view");
  const branches = await dashboardBranches(scope);
  const branch = f.branch && branches.some((b) => b.id === f.branch) ? f.branch : null;
  const take = Math.min(f.take ?? 8, 200);
  const q = f.q?.trim();
  const events = await db.visitEvent.findMany({
    where: {
      organisationId: scope.organisationId,
      type: { in: ["CREATED", "ASSIGNED", "REASSIGNED", "UNASSIGNED", "EDITED", "PUBLISHED", "SWAPPED", "STATUS"] },
      visit: { AND: [visitsIn(scope, branch), q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { serviceUser: { lastName: { contains: q, mode: "insensitive" } } }, { serviceUser: { firstName: { contains: q, mode: "insensitive" } } }] } : {}] },
    },
    select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, reason: true, data: true, createdAt: true, visit: { select: { id: true, reference: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: take + (f.skip ?? 0) + 1,
  });
  const unrestricted = !scope.areaIds && !scope.branchIds && !branch && !q;
  const whole = unrestricted
    ? await db.auditLog.findMany({ where: { organisationId: scope.organisationId, action: { in: ["rota.built", "rota.published", "rota.rolled_forward", "rota.plan.applied"] } }, select: { id: true, action: true, actorId: true, data: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: take + (f.skip ?? 0) + 1 })
    : [];
  const staffIds = new Set<string>();
  for (const e of events) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    for (const k of ["staffId", "previousStaffId"]) if (typeof d[k] === "string") staffIds.add(d[k] as string);
  }
  const [names, staff] = await Promise.all([memberNames(ctx, [...events.map((e) => e.actorId), ...whole.map((w) => w.actorId)]), db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: [...staffIds] } }, select: { id: true, displayName: true } })]);
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));
  const rows = [
    ...events.map((e) => {
      const d = (e.data ?? {}) as Record<string, unknown>;
      const who = typeof d.staffId === "string" ? staffName.get(d.staffId) : undefined;
      const from = d.from as { start?: string } | undefined;
      const to = d.to as { start?: string } | undefined;
      const moved = from?.start && to?.start && from.start !== to.start ? ` (${hhmm(new Date(from.start))} → ${hhmm(new Date(to.start))})` : "";
      const activity = e.type === "STATUS" ? statusLabel(e.toStatus, e.fromStatus) : e.type === "EDITED" && moved ? "Visit time changed" : ACTIVITY_LABEL[e.type] ?? e.type;
      const extra = e.type === "ASSIGNED" || e.type === "REASSIGNED" ? (who ? ` · ${who}` : "") : e.type === "EDITED" ? moved : e.reason ? ` · ${e.reason}` : "";
      return { id: e.id, at: e.createdAt, activity, details: `${e.visit.reference} – ${suName(e.visit.serviceUser)}${extra}`, by: e.actorId ? names.get(e.actorId) ?? "A team member" : "System", href: `/rota/visits/${e.visit.id}` };
    }),
    ...whole.map((w) => {
      const d = (w.data ?? {}) as Record<string, unknown>;
      const label = { "rota.built": "Rota built", "rota.published": "Rota published", "rota.rolled_forward": "Rota rolled forward", "rota.plan.applied": "Optimised plan applied" }[w.action] ?? w.action;
      const week = typeof d.weekStart === "string" ? `w/c ${d.weekStart}` : typeof d.from === "string" ? `${d.from}` : "";
      return { id: w.id, at: w.createdAt, activity: label, details: week || "Whole rota", by: w.actorId ? names.get(w.actorId) ?? "A team member" : "System", href: "/rota/build" };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const skip = f.skip ?? 0;
  return { rows: rows.slice(skip, skip + take), more: rows.length > skip + take, branch, branches };
}
