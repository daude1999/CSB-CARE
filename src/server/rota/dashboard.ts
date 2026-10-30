import "server-only";
import { missedMedsCount } from "@/server/care/medication";
import { db } from "@/lib/db";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonDayBounds, mondayOf } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { exceptionCounts } from "./exceptions";
import { listVisits, suName } from "./queries";
import { rotaScope, serviceUserWhere, visitWhere } from "./scope";

/**
 * The Rota dashboard, laid out in the order the office already works in OnePlan: one date drives the page, then the
 * call outcomes for that date, then people and reminders, then the conflict and holiday counters. Every figure is
 * counted from live records when the page opens, and each one links to the list behind it.
 */

export interface Reminder {
  text: string;
  due: string;
  account: string;
  href: string;
  type: "Service user" | "Team member";
  overdueDays: number;
}

const REMINDER_WINDOW_DAYS = 14;

export async function rotaDashboard(ctx: Ctx, input: { date?: string; areaId?: string }) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const today = londonDate();
  const date = input.date && isIsoDate(input.date) ? input.date : today;
  const { rows, settings } = await listVisits(ctx, { date, areaId: input.areaId, includeCancelled: true });
  const live = rows.filter((v) => v.status !== "CANCELLED");
  const onDuty = new Set(live.filter((v) => v.status !== "NOT_DELIVERED").flatMap((v) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staffId)));
  const calls = {
    total: live.length,
    /** Not started and not yet late: still to come. */
    due: live.filter((v) => v.status === "SCHEDULED" && !v.flags.late).length,
    inProgress: live.filter((v) => v.status === "IN_PROGRESS").length,
    cancelled: rows.length - live.length,
    /** Double-ups with one of their two carers. */
    partDoubleUps: live.filter((v) => v.carersRequired > 1 && v.flags.unassignedSlots > 0 && v.flags.unassignedSlots < v.carersRequired).length,
    staffOnDuty: onDuty.size,
    complete: live.filter((v) => v.status === "COMPLETED").length,
    late: live.filter((v) => v.flags.late && v.status !== "MISSED").length,
    missed: live.filter((v) => v.status === "MISSED").length,
    notDelivered: live.filter((v) => v.status === "NOT_DELIVERED").length,
    unassigned: live.filter((v) => v.flags.unassignedSlots > 0).length,
    review: live.filter((v) => v.flags.review.length > 0).length,
    lateAfterMin: settings.lateAfterMin,
    /** Null while medication records are switched off, so no figure is shown. */
    missedMeds: await missedMedsCount(org, live.map((v) => v.id)),
  };

  const canPeople = hasOrgPermission(ctx, "serviceUser.view");
  const canStaff = hasOrgPermission(ctx, "staff.directory");
  const suScope = serviceUserWhere(scope);
  const horizon = dbDate(addDays(today, REMINDER_WINDOW_DAYS));
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86_400_000);

  const weekStart = mondayOf(date);
  const [serviceUsers, team, plans, risks, absenceRequests, templates, holidaysDue, notes, exceptions, builds] = await Promise.all([
    canPeople
      ? db.serviceUser.findMany({ where: { AND: [suScope, { status: { in: ["ACTIVE", "PAUSED", "ASSESSMENT"] } }] }, select: { id: true, firstName: true, lastName: true, preferredName: true, postcode: true, status: true, area: { select: { name: true, colour: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] })
      : Promise.resolve([]),
    canStaff
      ? db.staffMember.findMany({ where: { organisationId: org, employmentStatus: { not: "ARCHIVED" }, hrMissing: false }, select: { id: true, displayName: true, jobTitle: true, employmentStatus: true, workPhone: true, userId: true }, orderBy: { displayName: "asc" } })
      : Promise.resolve([]),
    canPeople
      ? db.carePlan.findMany({ where: { organisationId: org, status: "ACTIVE", reviewDue: { lte: horizon }, serviceUser: suScope }, select: { reviewDue: true, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } } } })
      : Promise.resolve([]),
    canPeople
      ? db.riskAssessment.findMany({ where: { organisationId: org, status: "ACTIVE", reviewDue: { lte: horizon }, serviceUser: suScope }, select: { id: true, title: true, reviewDue: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } })
      : Promise.resolve([]),
    canStaff ? db.staffAbsence.findMany({ where: { organisationId: org, status: "REQUESTED", endsAt: { gte: now } }, select: { kind: true, startsAt: true, staff: { select: { displayName: true } } } }) : Promise.resolve([]),
    db.visitTemplate.findMany({ where: { organisationId: org, enabled: true, ...(scope.areaIds ? { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : {}) }, select: { carersRequired: true, preferredStaff1Id: true, preferredStaff2Id: true } }),
    db.staffAbsence.count({ where: { organisationId: org, status: "APPROVED", startsAt: { gte: now, lte: soon } } }),
    (() => {
      const { start, end } = londonDayBounds(date);
      return db.visitNote.count({ where: { organisationId: org, createdAt: { gte: start, lt: end }, visit: visitWhere(scope) } });
    })(),
    hasOrgPermission(ctx, "rota.monitor") ? exceptionCounts(ctx) : Promise.resolve(null),
    db.rotaBuild.count({ where: { organisationId: org, weekStart: dbDate(weekStart), status: "BUILT" } }),
  ]);

  // A template conflict is a slot with no carer, or a carer who has left or is no longer in HR.
  const gone = new Set((await db.staffMember.findMany({ where: { organisationId: org, OR: [{ employmentStatus: "ARCHIVED" }, { hrMissing: true }] }, select: { id: true } })).map((s) => s.id));
  const templateConflicts = templates.filter((t) => {
    const ids = [t.preferredStaff1Id, t.carersRequired > 1 ? t.preferredStaff2Id : null].slice(0, t.carersRequired);
    return ids.some((id) => !id || gone.has(id));
  }).length;

  const overdue = (due: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000));
  const reminders: Reminder[] = [
    ...plans.map((p) => ({ text: "Care plan review", due: fromDbDate(p.reviewDue!), account: suName(p.serviceUser), href: `/rota/care-plans/${p.serviceUser.id}`, type: "Service user" as const })),
    ...risks.map((r) => ({ text: `Risk review: ${r.title}`, due: fromDbDate(r.reviewDue), account: suName(r.serviceUser), href: `/rota/risks/${r.id}`, type: "Service user" as const })),
    ...absenceRequests.map((a) => ({ text: `${a.kind.charAt(0)}${a.kind.slice(1).toLowerCase()} request to decide`, due: londonDate(a.startsAt), account: a.staff.displayName, href: "/workforce/absences", type: "Team member" as const })),
  ]
    .map((r) => ({ ...r, overdueDays: overdue(r.due) }))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 100);

  return {
    date,
    today,
    calls,
    serviceUsers: serviceUsers.map((s) => ({ ...s, name: suName(s) })),
    team,
    canPeople,
    canStaff,
    reminders,
    counters: { rotaConflicts: calls.review, templateConflicts, holidaysDue, notes },
    exceptions,
    /** No visits on the date and no build for its week: the rota for that week has not been built yet. */
    notBuilt: rows.length === 0 && builds === 0 ? { weekStart } : null,
  };
}
