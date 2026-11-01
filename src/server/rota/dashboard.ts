import "server-only";
import { missedMedsCount } from "@/server/care/medication";
import { db } from "@/lib/db";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonDayBounds, mondayOf } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { exceptionCounts } from "./exceptions";
import { countedOnce } from "./overview";
import { listVisits, suName } from "./queries";
import { authorisedBranches, buildWhere, rotaScope, serviceUserWhere, staffDirectoryWhere, templateScopeWhere, visitBranchClause, visitWhere } from "./scope";
import { readinessFor } from "@/server/readiness";
import { staffBirthdays, upcoming } from "@/server/workforce/birthdays";
import { londonToUtc } from "@/lib/london";

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
export const BIRTHDAY_WINDOW_DAYS = 30;

/** A team member's rota position on the dashboard date, most important first. */
export type TeamDayStatus = "Off sick" | "On leave" | "Not ready" | "On rota" | "Off rota";

/**
 * Outstanding reminders the member may see, most urgent first: care plan and risk reviews due within the window or
 * overdue (service-user records), and leave requests still to decide (staff directory). Branch-limited like the rest.
 */
export async function activeReminders(ctx: Ctx, opts: { branchId?: string; limit?: number; windowDays?: number } = {}): Promise<Reminder[]> {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const today = londonDate();
  const now = new Date();
  const horizon = dbDate(addDays(today, opts.windowDays ?? REMINDER_WINDOW_DAYS));
  const branches = await authorisedBranches(scope);
  const branchId = opts.branchId && branches.some((b) => b.id === opts.branchId) ? opts.branchId : undefined;
  const suScope = branchId ? { AND: [serviceUserWhere(scope), { branchId }] } : serviceUserWhere(scope);
  const staffScope = { ...staffDirectoryWhere(scope, { status: "all" }), ...(branchId ? { branchId } : {}) };
  const canPeople = hasOrgPermission(ctx, "serviceUser.view");
  const canStaff = hasOrgPermission(ctx, "staff.directory");
  const [plans, risks, absenceRequests] = await Promise.all([
    canPeople
      ? db.carePlan.findMany({ where: { organisationId: org, status: "ACTIVE", reviewDue: { lte: horizon }, serviceUser: suScope }, select: { reviewDue: true, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } } } })
      : Promise.resolve([]),
    canPeople
      ? db.riskAssessment.findMany({ where: { organisationId: org, status: "ACTIVE", reviewDue: { lte: horizon }, serviceUser: suScope }, select: { id: true, title: true, reviewDue: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } })
      : Promise.resolve([]),
    canStaff ? db.staffAbsence.findMany({ where: { organisationId: org, staff: staffScope, status: "REQUESTED", endsAt: { gte: now } }, select: { kind: true, startsAt: true, staff: { select: { displayName: true } } } }) : Promise.resolve([]),
  ]);
  const overdue = (due: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000));
  const all: Reminder[] = [
    ...plans.map((p) => ({ text: "Care plan review", due: fromDbDate(p.reviewDue!), account: suName(p.serviceUser), href: `/rota/care-plans/${p.serviceUser.id}`, type: "Service user" as const })),
    ...risks.map((r) => ({ text: `Risk review: ${r.title}`, due: fromDbDate(r.reviewDue), account: suName(r.serviceUser), href: `/rota/risks/${r.id}`, type: "Service user" as const })),
    ...absenceRequests.map((a) => ({ text: `${a.kind.charAt(0)}${a.kind.slice(1).toLowerCase()} request to decide`, due: londonDate(a.startsAt), account: a.staff.displayName, href: "/workforce/absences", type: "Team member" as const })),
  ]
    .map((r) => ({ ...r, overdueDays: overdue(r.due) }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.account.localeCompare(b.account));
  return opts.limit ? all.slice(0, opts.limit) : all;
}

export async function rotaDashboard(ctx: Ctx, input: { date?: string; areaId?: string; branchId?: string }) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const today = londonDate();
  const date = input.date && isIsoDate(input.date) ? input.date : today;
  // A branch is honoured only when the member may choose it; anything else falls back to all of their branches.
  const branches = await authorisedBranches(scope);
  const branchId = input.branchId && branches.some((b) => b.id === input.branchId) ? input.branchId : undefined;
  const { rows, settings } = await listVisits(ctx, { date, areaId: input.areaId, branchId, includeCancelled: true });
  const live = rows.filter((v) => v.status !== "CANCELLED");
  const onDuty = new Set(live.filter((v) => v.status !== "NOT_DELIVERED").flatMap((v) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staffId)));
  const calls = {
    total: countedOnce(live).length,
    /** Not started and not yet late: still to come. */
    due: live.filter((v) => v.status === "SCHEDULED" && !v.flags.late).length,
    inProgress: live.filter((v) => v.status === "IN_PROGRESS").length,
    cancelled: rows.length - live.length,
    /** Double-ups with one of their two carers. */
    partDoubleUps: live.filter((v) => v.carersRequired > 1 && v.flags.unassignedSlots > 0 && v.flags.unassignedSlots < v.carersRequired).length,
    staffOnDuty: onDuty.size,
    complete: countedOnce(live).filter((v) => v.status === "COMPLETED").length,
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
  const suScope = branchId ? { AND: [serviceUserWhere(scope), { branchId }] } : serviceUserWhere(scope);
  const now = new Date();
  const soon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86_400_000);

  const weekStart = mondayOf(date);
  // Team members, their absences and holidays follow the same branch and area limits as the visits on this page.
  const staffScope = { ...staffDirectoryWhere(scope, { status: "all" }), ...(branchId ? { branchId } : {}) };
  const staffInScope = { organisationId: org, staff: staffScope };
  const [serviceUsers, team, reminders, templates, holidaysDue, notes, exceptions, builds] = await Promise.all([
    canPeople
      ? db.serviceUser.findMany({ where: { AND: [suScope, { status: { in: ["ACTIVE", "PAUSED", "ASSESSMENT"] } }] }, select: { id: true, firstName: true, lastName: true, preferredName: true, postcode: true, status: true, dateOfBirth: true, area: { select: { name: true, colour: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] })
      : Promise.resolve([]),
    canStaff
      ? db.staffMember.findMany({ where: { ...staffScope, employmentStatus: { not: "ARCHIVED" } }, select: { id: true, displayName: true, preferredName: true, jobTitle: true, employmentStatus: true, workPhone: true, userId: true, hrMissing: true }, orderBy: { displayName: "asc" } })
      : Promise.resolve([]),
    activeReminders(ctx, { branchId, limit: 100 }),
    db.visitTemplate.findMany({ where: { organisationId: org, enabled: true, ...templateScopeWhere(scope) }, select: { carersRequired: true, preferredStaff1Id: true, preferredStaff2Id: true } }),
    db.staffAbsence.count({ where: { ...staffInScope, status: "APPROVED", startsAt: { gte: now, lte: soon } } }),
    (() => {
      const { start, end } = londonDayBounds(date);
      return db.visitNote.count({ where: { organisationId: org, createdAt: { gte: start, lt: end }, visit: branchId ? { AND: [visitWhere(scope), visitBranchClause(scope, branchId)] } : visitWhere(scope) } });
    })(),
    hasOrgPermission(ctx, "rota.monitor") ? exceptionCounts(ctx) : Promise.resolve(null),
    db.rotaBuild.count({ where: { ...buildWhere(scope), weekStart: dbDate(weekStart), status: "BUILT" } }),
  ]);

  // A template conflict is a slot with no carer, or a carer who has left or is no longer in HR.
  const gone = new Set((await db.staffMember.findMany({ where: { organisationId: org, OR: [{ employmentStatus: "ARCHIVED" }, { hrMissing: true }] }, select: { id: true } })).map((s) => s.id));
  const templateConflicts = templates.filter((t) => {
    const ids = [t.preferredStaff1Id, t.carersRequired > 1 ? t.preferredStaff2Id : null].slice(0, t.carersRequired);
    return ids.some((id) => !id || gone.has(id));
  }).length;

  // Next scheduled visit for each listed service user, from the visits the member may see.
  const suIds = serviceUsers.map((s) => s.id);
  const nextVisits = suIds.length
    ? await db.visit.groupBy({ by: ["serviceUserId"], where: { ...visitWhere(scope), serviceUserId: { in: suIds }, status: "SCHEDULED", scheduledStart: { gte: now } }, _min: { scheduledStart: true } })
    : [];
  const nextOf = new Map(nextVisits.map((n) => [n.serviceUserId, n._min.scheduledStart]));

  // Each team member's position on the date: approved sickness or leave first, then readiness, then whether they hold a
  // carer booking that day. Uses the same records as Staffing on the other rota screens.
  const teamIds = team.map((t) => t.id);
  const dayStart = londonToUtc(date, 0);
  const dayEnd = londonToUtc(addDays(date, 1), 0);
  const [absent, readiness] = teamIds.length
    ? await Promise.all([
        db.staffAbsence.findMany({ where: { organisationId: org, staffId: { in: teamIds }, status: "APPROVED", startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { staffId: true, kind: true } }),
        readinessFor(db, org, teamIds, { date }),
      ])
    : [[], new Map()] as const;
  const sick = new Set(absent.filter((a) => a.kind === "SICKNESS").map((a) => a.staffId));
  const away = new Set(absent.filter((a) => a.kind !== "SICKNESS").map((a) => a.staffId));
  const statusOf = (id: string): TeamDayStatus => (sick.has(id) ? "Off sick" : away.has(id) ? "On leave" : readiness.get(id)?.status === "NOT_READY" ? "Not ready" : onDuty.has(id) ? "On rota" : "Off rota");

  const suBirthdays = canPeople ? upcoming(serviceUsers.filter((s) => s.dateOfBirth).map((s) => ({ id: s.id, name: suName(s), dateOfBirth: fromDbDate(s.dateOfBirth!), href: `/rota/service-users/${s.id}` })), today, BIRTHDAY_WINDOW_DAYS) : null;
  const teamBirthdays = canStaff ? await staffBirthdays(ctx, teamIds, today, BIRTHDAY_WINDOW_DAYS) : null;

  return {
    date,
    today,
    branches,
    branchId: branchId ?? null,
    calls,
    nextVisit: nextOf,
    teamStatus: new Map(team.map((t) => [t.id, { status: statusOf(t.id), readiness: readiness.get(t.id)?.status ?? null }])),
    birthdays: { serviceUsers: suBirthdays, team: teamBirthdays },
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
