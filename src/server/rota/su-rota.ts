import type { VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, cycleWeekOf, dbDate, fromDbDate, isIsoDate, londonDate, mondayOf } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, visitWhere } from "./scope";
import { rotaSettings } from "./settings";

/**
 * One service user's own rota for one week (Service User Profile -> Visits -> Rota). It reads the same Visit rows as
 * the Daily Rota, the Weekly Planner and Carer My Visits: nothing is copied, so a change made anywhere shows here.
 */

export const SU_ROTA_FILTERS = ["all", "scheduled", "in_progress", "completed", "missed", "unassigned", "cancelled"] as const;
export type SuRotaFilter = (typeof SU_ROTA_FILTERS)[number];
export const SU_ROTA_FILTER_LABEL: Record<SuRotaFilter, string> = { all: "All", scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", missed: "Missed", unassigned: "Unassigned", cancelled: "Cancelled" };

const STATUS_OF: Partial<Record<SuRotaFilter, VisitStatus>> = { scheduled: "SCHEDULED", in_progress: "IN_PROGRESS", completed: "COMPLETED", missed: "MISSED", cancelled: "CANCELLED" };

export function parseSuRotaFilter(v: string | undefined): SuRotaFilter {
  return (SU_ROTA_FILTERS as readonly string[]).includes(v ?? "") ? (v as SuRotaFilter) : "all";
}

/** The Monday of the week to show: the week of `date` when it is a valid date, otherwise this week. */
export function suRotaWeek(date: string | undefined) {
  return mondayOf(date && isIsoDate(date) ? date : londonDate());
}

export async function serviceUserRota(ctx: Ctx, serviceUserId: string, weekStart: string, filter: SuRotaFilter) {
  const scope = await rotaScope(ctx);
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true } });
  if (!su) throw new NotFoundError("Service user");
  const monday = mondayOf(weekStart);
  const sunday = addDays(monday, 6);
  const settings = await rotaSettings(db, scope.organisationId);
  const rows = await db.visit.findMany({
    where: { ...visitWhere(scope), serviceUserId, date: { gte: dbDate(monday), lte: dbDate(sunday) } },
    orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }],
    select: {
      id: true, reference: true, date: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, actualEnd: true,
      carersRequired: true, manuallyChanged: true, timeLocked: true, publishedAt: true, templateId: true, cancelReason: true, lockVersion: true,
      callType: { select: { name: true } },
      missedCallCase: { select: { id: true, stage: true } },
      assignments: { where: { removedAt: null }, select: { slot: true, position: true, reviewReason: true, staff: { select: { id: true, displayName: true } } } },
    },
  });
  const visits = rows.map((v) => {
    const carers = v.assignments.filter((a) => a.slot !== "SHADOW").length;
    const open = v.status === "SCHEDULED" || v.status === "IN_PROGRESS" ? Math.max(0, v.carersRequired - carers) : 0;
    const warnings: string[] = [];
    if (v.manuallyChanged) warnings.push("Manual change");
    if (v.timeLocked) warnings.push("Time locked");
    if (v.status === "SCHEDULED" && !v.publishedAt) warnings.push("Not published");
    if (v.assignments.some((a) => a.reviewReason)) warnings.push("Needs review");
    if (open) warnings.push(open === v.carersRequired ? "No carer" : `${open} carer place${open === 1 ? "" : "s"} open`);
    return { ...v, date: fromDbDate(v.date), durationMin: Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000), openPlaces: open, warnings };
  });
  const matches = (f: SuRotaFilter, v: (typeof visits)[number]) => (f === "all" ? true : f === "unassigned" ? v.openPlaces > 0 : v.status === STATUS_OF[f]);
  const counts = Object.fromEntries(SU_ROTA_FILTERS.map((f) => [f, visits.filter((v) => matches(f, v)).length])) as Record<SuRotaFilter, number>;
  return {
    weekStart: monday,
    weekEnd: sunday,
    cycleWeek: cycleWeekOf(monday, fromDbDate(settings.anchorMonday), settings.cycleLength),
    visits: visits.filter((v) => matches(filter, v)),
    counts,
  };
}
