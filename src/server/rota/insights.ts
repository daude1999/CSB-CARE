import { db } from "@/lib/db";
import { addDays, dbDate, isIsoDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { estimateVisit, loadEstimateFacts, totals, type EstimateTotals, type VisitEstimate } from "@/server/finance/estimates";
import { exceptionCounts } from "./exceptions";
import { listVisits, suName } from "./queries";
import { rotaScope, staffDirectoryWhere } from "./scope";

/**
 * Rota Insights: the week's visit, workforce, finance and operational figures, each worked out on read from the visits,
 * bookings, absences, staff profiles and rate cards, so they agree with the screens they link to. Money figures are
 * estimates from rate cards (see finance/estimates.ts) and are shown only to roles that can see finance; verified
 * figures come from approved pay and invoice runs and are kept apart.
 */

export interface Breakdown {
  key: string;
  label: string;
  t: EstimateTotals;
}

const minutesOf = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;

export async function rotaInsights(ctx: Ctx, input: { week?: string; areaId?: string }) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const today = londonDate();
  const week = mondayOf(input.week && isIsoDate(input.week) ? input.week : today);
  const to = addDays(week, 6);
  const now = new Date();
  const { rows, truncated } = await listVisits(ctx, { date: week, to, areaId: input.areaId || undefined, includeCancelled: true }, 6000);
  const live = rows.filter((v) => v.status !== "CANCELLED");

  // ── Visits ──
  const visits = {
    scheduled: live.length,
    allocated: live.filter((v) => v.flags.unassignedSlots === 0 && v.status !== "NOT_DELIVERED").length,
    unallocated: live.filter((v) => v.flags.unassignedSlots > 0 && v.flags.unassignedSlots === v.carersRequired).length,
    partDoubleUps: live.filter((v) => v.carersRequired > 1 && v.flags.unassignedSlots > 0 && v.flags.unassignedSlots < v.carersRequired).length,
    openSlots: live.reduce((n, v) => n + v.flags.unassignedSlots, 0),
    completed: live.filter((v) => v.status === "COMPLETED").length,
    inProgress: live.filter((v) => v.status === "IN_PROGRESS").length,
    due: live.filter((v) => v.status === "SCHEDULED" && !v.flags.late).length,
    late: live.filter((v) => v.flags.late && v.status !== "MISSED").length,
    missed: live.filter((v) => v.status === "MISSED").length,
    notDelivered: live.filter((v) => v.status === "NOT_DELIVERED").length,
    cancelled: rows.length - live.length,
    review: live.filter((v) => v.flags.review.length > 0).length,
    unpublished: live.filter((v) => !v.publishedAt && v.status === "SCHEDULED").length,
    completionPercent: 0,
  };
  visits.completionPercent = visits.scheduled ? Math.round((visits.allocated / visits.scheduled) * 1000) / 10 : 0;

  // ── Workforce ──
  const staffWhere = { ...staffDirectoryWhere(scope, { status: "all" }), employmentStatus: { not: "ARCHIVED" as const } };
  const staff = await db.staffMember.findMany({ where: staffWhere, select: { id: true, displayName: true, employmentStatus: true } });
  const staffIds = staff.map((s) => s.id);
  const dayStart = londonToUtc(today, 0);
  const dayEnd = londonToUtc(addDays(today, 1), 0);
  const [absences, profiles, upcoming] = await Promise.all([
    db.staffAbsence.findMany({ where: { organisationId: org, staffId: { in: staffIds }, status: "APPROVED", startsAt: { lt: londonToUtc(addDays(to, 1), 0) }, endsAt: { gt: londonToUtc(week, 0) } }, select: { staffId: true, kind: true, startsAt: true, endsAt: true } }),
    db.rotaStaffProfile.findMany({ where: { organisationId: org, staffId: { in: staffIds } }, select: { staffId: true, maxWeeklyMinutes: true } }),
    db.staffAbsence.count({ where: { organisationId: org, staffId: { in: staffIds }, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { gte: now, lt: new Date(now.getTime() + 14 * 86_400_000) } } }),
  ]);
  const absentToday = absences.filter((a) => a.startsAt < dayEnd && a.endsAt > dayStart);
  const bookedToday = new Set(live.filter((v) => londonDate(v.scheduledStart) === today && v.status !== "NOT_DELIVERED").flatMap((v) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staffId)));
  const weekMinutes = new Map<string, number>();
  for (const v of live) {
    if (v.status === "NOT_DELIVERED") continue;
    for (const a of v.assignments) if (a.slot !== "SHADOW") weekMinutes.set(a.staffId, (weekMinutes.get(a.staffId) ?? 0) + minutesOf(v.scheduledStart, v.scheduledEnd));
  }
  const limits = new Map(profiles.map((p) => [p.staffId, p.maxWeeklyMinutes]));
  const withLimit = staff.filter((s) => limits.get(s.id));
  const capacityMinutes = withLimit.reduce((n, s) => n + (limits.get(s.id) ?? 0), 0);
  const allocatedWithLimit = withLimit.reduce((n, s) => n + (weekMinutes.get(s.id) ?? 0), 0);
  const overtime = staff
    .filter((s) => limits.get(s.id) && (weekMinutes.get(s.id) ?? 0) > limits.get(s.id)!)
    .map((s) => ({ id: s.id, name: s.displayName, hours: Math.round(((weekMinutes.get(s.id) ?? 0) / 60) * 10) / 10, limit: Math.round((limits.get(s.id)! / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - b.limit - (a.hours - a.limit));
  const reviewBookings = live.reduce((n, v) => n + v.assignments.filter((a) => a.eligibility === "REQUIRES_REVIEW" && ["SCHEDULED", "MISSED"].includes(v.status)).length, 0);
  const workforce = {
    active: staff.filter((s) => s.employmentStatus === "ACTIVE").length,
    availableToday: staff.filter((s) => s.employmentStatus === "ACTIVE" && !absentToday.some((a) => a.staffId === s.id)).length,
    allocatedToday: bookedToday.size,
    onLeaveToday: new Set(absentToday.filter((a) => a.kind !== "SICKNESS").map((a) => a.staffId)).size,
    sickToday: new Set(absentToday.filter((a) => a.kind === "SICKNESS").map((a) => a.staffId)).size,
    absentThisWeek: new Set(absences.map((a) => a.staffId)).size,
    upcomingAbsences: upcoming,
    weekAllocatedHours: Math.round(([...weekMinutes.values()].reduce((n, m) => n + m, 0) / 60) * 10) / 10,
    capacityHours: Math.round((capacityMinutes / 60) * 10) / 10,
    utilisationPercent: capacityMinutes ? Math.round((allocatedWithLimit / capacityMinutes) * 1000) / 10 : null,
    carersWithLimit: withLimit.length,
    overtime,
    reviewBookings,
    shortage: visits.openSlots,
  };

  // ── Care hours ──
  const careMinutes = live.filter((v) => v.status !== "NOT_DELIVERED").reduce((n, v) => n + minutesOf(v.scheduledStart, v.scheduledEnd), 0);
  const carerMinutes = live.filter((v) => v.status !== "NOT_DELIVERED").reduce((n, v) => n + minutesOf(v.scheduledStart, v.scheduledEnd) * v.carersRequired, 0);
  const completedMinutes = live.filter((v) => v.status === "COMPLETED").reduce((n, v) => n + (v.actualStart && v.actualEnd ? minutesOf(v.actualStart, v.actualEnd) : minutesOf(v.scheduledStart, v.scheduledEnd)), 0);
  const hours = { scheduledCare: Math.round((careMinutes / 60) * 10) / 10, scheduledCarer: Math.round((carerMinutes / 60) * 10) / 10, completedCare: Math.round((completedMinutes / 60) * 10) / 10 };

  // ── Finance (estimates, finance roles only) ──
  let finance: null | {
    total: EstimateTotals;
    byBranch: Breakdown[];
    byFunder: Breakdown[];
    lowestByServiceUser: Breakdown[];
    issues: { kind: string; count: number }[];
    onCostPercent: number;
    costPerVisitPence: number | null;
    costPerCareHourPence: number | null;
    revenuePerCareHourPence: number | null;
    verified: { payRunsPence: number; payRuns: number; invoiceRunsPence: number; invoiceRuns: number };
  } = null;
  if (hasOrgPermission(ctx, "finance.view")) {
    const facts = await loadEstimateFacts(db, org, week, to, [...new Set(live.map((v) => v.serviceUserId))]);
    const est = new Map<string, VisitEstimate>();
    for (const v of live) est.set(v.id, estimateVisit({ ...v, assignments: v.assignments.map((a) => ({ staffId: a.staffId, slot: a.slot })) }, facts));
    const all = [...est.values()];
    const total = totals(all);
    const users = await db.serviceUser.findMany({ where: { organisationId: org, id: { in: [...new Set(live.map((v) => v.serviceUserId))] } }, select: { id: true, firstName: true, lastName: true, preferredName: true, branchId: true, branch: { select: { name: true } } } });
    const userById = new Map(users.map((u) => [u.id, u]));
    const group = (keyOf: (v: (typeof live)[number], e: VisitEstimate) => [string, string]) => {
      const m = new Map<string, { label: string; list: VisitEstimate[] }>();
      for (const v of live) {
        const e = est.get(v.id)!;
        const [k, label] = keyOf(v, e);
        const g = m.get(k) ?? { label, list: [] };
        g.list.push(e);
        m.set(k, g);
      }
      return [...m].map(([key, g]) => ({ key, label: g.label, t: totals(g.list) }));
    };
    const funders = new Map<string, string>();
    for (const list of facts.packages.values()) for (const p of list) if (p.funder) funders.set(p.funder.id, p.funder.name);
    const issues = new Map<string, number>();
    for (const e of all) for (const i of new Set(e.issues.map((x) => x.kind))) issues.set(i, (issues.get(i) ?? 0) + 1);
    const [payRuns, invoiceRuns] = await Promise.all([
      db.payRun.findMany({ where: { organisationId: org, status: "APPROVED", periodStart: dbDate(week) }, select: { totalPence: true } }),
      db.invoiceRun.findMany({ where: { organisationId: org, status: "APPROVED", periodStart: dbDate(week) }, select: { totalPence: true } }),
    ]);
    const careH = total.minutes / 60;
    finance = {
      total,
      byBranch: group((v) => {
        const u = userById.get(v.serviceUserId);
        return [u?.branchId ?? "none", u?.branch?.name ?? "No branch"];
      }).sort((a, b) => a.label.localeCompare(b.label)),
      byFunder: group((_, e) => [e.funderId ?? "none", e.funderId ? funders.get(e.funderId) ?? "Funder" : "No funded package"]).sort((a, b) => b.t.pricedRevenuePence - a.t.pricedRevenuePence),
      lowestByServiceUser: group((v) => [v.serviceUserId, suName(v.serviceUser)])
        .filter((g) => g.t.pricedVisits > 0)
        .sort((a, b) => a.t.marginPence - b.t.marginPence)
        .slice(0, 10),
      issues: [...issues].map(([kind, count]) => ({ kind, count })),
      onCostPercent: facts.onCostPercent,
      costPerVisitPence: total.pricedVisits ? Math.round(total.pricedCostPence / total.pricedVisits) : null,
      costPerCareHourPence: careH ? Math.round(total.costPence / careH) : null,
      revenuePerCareHourPence: careH ? Math.round(total.revenuePence / careH) : null,
      verified: { payRunsPence: payRuns.reduce((n, r) => n + r.totalPence, 0), payRuns: payRuns.length, invoiceRunsPence: invoiceRuns.reduce((n, r) => n + r.totalPence, 0), invoiceRuns: invoiceRuns.length },
    };
  }

  const exceptions = hasOrgPermission(ctx, "rota.monitor") ? await exceptionCounts(ctx) : null;
  const upcomingOpen = live.filter((v) => v.flags.unassignedSlots > 0 && v.scheduledStart > now).length;

  return { week, to, today, truncated, visits, workforce, hours, finance, operational: { exceptions, upcomingOpen, review: visits.review, unpublished: visits.unpublished, upcomingAbsences: upcoming } };
}

export type RotaInsights = Awaited<ReturnType<typeof rotaInsights>>;
