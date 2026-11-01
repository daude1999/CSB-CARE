import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { branchWhere, memberScope, serviceUserWhere, visitWhere, type Scope } from "@/server/rota/scope";

/** A change against the same time yesterday. Only figures with a real comparison carry one. */
export interface Trend {
  today: number;
  yesterday: number;
  /** True when a rise is good news (completed visits), false when it is bad news (missed visits). */
  upIsGood: boolean;
}

export interface DailySeries {
  /** Oldest first, ending with today so far. */
  days: { date: string; value: number }[];
}

/** The Rostering figures and previews on the Overview. Null when the person may not see the rota. */
export interface RotaSnapshot {
  completedToday: number;
  pendingToday: number;
  missedToday: number;
  completedTrend: Trend;
  missedTrend: Trend;
  completedSeries: DailySeries;
  missedSeries: DailySeries;
  /**
   * Carers booked on at least one of today's visits that is still going ahead (not cancelled or not delivered),
   * shadow shifts excluded: the Rota Dashboard's "staff on duty".
   */
  staffOnRota: number;
}

const DAYS = 7;

async function scopeFor(ctx: Ctx): Promise<Scope | null> {
  if (!ctx.organisationId) return null;
  return { organisationId: ctx.organisationId, ...(await memberScope(ctx.userId, ctx.organisationId)) };
}

export async function rotaSnapshot(ctx: Ctx, now = new Date()): Promise<RotaSnapshot | null> {
  if (!hasOrgPermission(ctx, "rota.view")) return null;
  const scope = await scopeFor(ctx);
  if (!scope) return null;
  const today = londonDate(now);
  const yesterday = addDays(today, -1);
  const from = addDays(today, -(DAYS - 1));
  const sameTimeYesterday = new Date(now.getTime() - 86_400_000);
  const where = visitWhere(scope);

  const [byDay, completedByNowYesterday, missedByNowYesterday, todays] = await Promise.all([
    db.visit.groupBy({ by: ["date", "status"], where: { ...where, date: { gte: dbDate(from), lte: dbDate(today) }, status: { in: ["COMPLETED", "MISSED"] } }, _count: { _all: true } }),
    db.visit.count({ where: { ...where, date: dbDate(yesterday), status: "COMPLETED", actualEnd: { lte: sameTimeYesterday } } }),
    db.visit.count({ where: { ...where, date: dbDate(yesterday), status: "MISSED", statusChangedAt: { lte: sameTimeYesterday } } }),
    db.visit.findMany({
      where: { ...where, date: dbDate(today), status: { notIn: ["CANCELLED"] } },
      select: { status: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { staff: { select: { id: true } } } } },
    }),
  ]);

  const series = (status: string): DailySeries => ({
    days: Array.from({ length: DAYS }, (_, i) => {
      const date = addDays(from, i);
      const row = byDay.find((r) => r.status === status && r.date.toISOString().slice(0, 10) === date);
      return { date, value: row?._count._all ?? 0 };
    }),
  });
  const count = (status: string) => todays.filter((v) => v.status === status).length;

  const onRota = new Set(todays.filter((v) => v.status !== "NOT_DELIVERED").flatMap((v) => v.assignments.map((a) => a.staff.id)));

  return {
    completedToday: count("COMPLETED"),
    pendingToday: count("SCHEDULED"),
    missedToday: count("MISSED"),
    completedTrend: { today: count("COMPLETED"), yesterday: completedByNowYesterday, upIsGood: true },
    missedTrend: { today: count("MISSED"), yesterday: missedByNowYesterday, upIsGood: false },
    completedSeries: series("COMPLETED"),
    missedSeries: series("MISSED"),
    staffOnRota: onRota.size,
  };
}

/** Service users currently receiving care, within the person's branch and area grants. */
export async function activeServiceUsers(ctx: Ctx): Promise<number | null> {
  if (!hasOrgPermission(ctx, "serviceUser.view")) return null;
  const scope = await scopeFor(ctx);
  return scope ? db.serviceUser.count({ where: { ...serviceUserWhere(scope), status: "ACTIVE" } }) : null;
}

/** Staff in employment (from the HR projection), within the person's branch grants. */
export async function activeStaff(ctx: Ctx): Promise<number | null> {
  if (!hasOrgPermission(ctx, "staff.directory")) return null;
  const scope = await scopeFor(ctx);
  return scope ? db.staffMember.count({ where: { organisationId: scope.organisationId, employmentStatus: "ACTIVE", hrMissing: false, ...branchWhere<Prisma.StaffMemberWhereInput>(scope) } }) : null;
}

/** Policy acknowledgements signed on each of the last seven days. */
export async function signOffSeries(ctx: Ctx, now = new Date()): Promise<DailySeries | null> {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "staff.view")) return null;
  const today = londonDate(now);
  const from = addDays(today, -(DAYS - 1));
  const rows = await db.acknowledgement.findMany({
    where: { organisationId: ctx.organisationId, acknowledgedAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`) } },
    select: { acknowledgedAt: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) if (r.acknowledgedAt) counts.set(londonDate(r.acknowledgedAt), (counts.get(londonDate(r.acknowledgedAt)) ?? 0) + 1);
  return { days: Array.from({ length: DAYS }, (_, i) => ({ date: addDays(from, i), value: counts.get(addDays(from, i)) ?? 0 })) };
}
