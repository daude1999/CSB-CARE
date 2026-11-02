import type { AssignmentSlot, Prisma, RotaSettings, VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, cycleWeekOf, dbDate, isIsoDate, londonDate, mondayOf } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { inRotaPool, rankCarers, rankCarersMany } from "@/server/workforce/eligibility";
import { rotaSettings } from "./settings";
import { authorisedBranches, rotaScope, serviceUserWhere, staffDirectoryWhere, visitBranchClause, visitWhere, type Scope } from "./scope";
import { loadMatchFacts, scoreMatch, type Match } from "./matching";

/**
 * Derived visit indicators. They are computed on read from stored times and settings, so they never go stale:
 * late, short, unassigned and needs-review are not stored statuses.
 */
export interface VisitFlags {
  late: boolean;
  lateBy: number | null;
  short: boolean;
  unassignedSlots: number;
  review: string[];
  overdueStart: boolean;
}

export function deriveFlags(
  v: { status: VisitStatus; scheduledStart: Date; scheduledEnd: Date; actualStart: Date | null; actualEnd: Date | null; carersRequired: number; assignments: { slot: string; removedAt: Date | null; reviewReason: string | null }[] },
  settings: Pick<RotaSettings, "lateAfterMin" | "shortVisitPercent">,
  now = new Date(),
): VisitFlags {
  const live = v.assignments.filter((a) => !a.removedAt);
  const lateMs = settings.lateAfterMin * 60000;
  const startDelay = v.actualStart ? v.actualStart.getTime() - v.scheduledStart.getTime() : null;
  const overdueStart = v.status === "SCHEDULED" && now.getTime() > v.scheduledStart.getTime() + lateMs;
  const late = overdueStart || (startDelay !== null && startDelay > lateMs);
  const planned = v.scheduledEnd.getTime() - v.scheduledStart.getTime();
  const delivered = v.actualStart && v.actualEnd ? v.actualEnd.getTime() - v.actualStart.getTime() : null;
  return {
    late,
    lateBy: startDelay !== null ? Math.round(startDelay / 60000) : overdueStart ? Math.round((now.getTime() - v.scheduledStart.getTime()) / 60000) : null,
    short: v.status === "COMPLETED" && delivered !== null && delivered < (planned * settings.shortVisitPercent) / 100,
    unassignedSlots: ["CANCELLED", "NOT_DELIVERED", "COMPLETED"].includes(v.status) ? 0 : Math.max(0, v.carersRequired - live.filter((a) => a.slot !== "SHADOW").length),
    review: ["SCHEDULED", "MISSED"].includes(v.status) ? live.map((a) => a.reviewReason).filter((x): x is string => !!x) : [],
    overdueStart,
  };
}

export interface VisitFilters {
  date?: string;
  to?: string;
  staffId?: string;
  serviceUserId?: string;
  areaId?: string;
  callTypeId?: string;
  status?: VisitStatus;
  unassigned?: boolean;
  review?: boolean;
  late?: boolean;
  includeCancelled?: boolean;
  q?: string;
  /** A branch chosen in a filter (the service user's branch); one the member may not pick matches nothing. */
  branchId?: string;
}

export const visitListInclude = {
  serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, postcode: true, riskLevel: true } },
  callType: { select: { id: true, name: true } },
  area: { select: { id: true, name: true, colour: true } },
  runRoute: { select: { id: true, name: true, colour: true, textColour: true } },
  assignments: { where: { removedAt: null }, select: { id: true, slot: true, staffId: true, removedAt: true, acknowledgedAt: true, reviewReason: true, eligibility: true, staff: { select: { id: true, displayName: true } } } },
  /** Each task with its latest recorded outcome, for the Daily Rota checklist column. */
  tasks: { select: { id: true, outcomes: { select: { outcome: true }, orderBy: { at: "desc" }, take: 1 } } },
  /** The build that created the visit records the rota pattern week it used (a build can override the calendar). */
  rotaBuild: { select: { cycleWeek: true } },
  _count: { select: { visitNotes: true } },
} satisfies Prisma.VisitInclude;

export type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitListInclude }> & { flags: VisitFlags };

export async function listVisits(ctx: Ctx, f: VisitFilters, take = 1000): Promise<{ rows: VisitRow[]; settings: RotaSettings; truncated: boolean }> {
  const scope = await rotaScope(ctx, "rota.view");
  const settings = await rotaSettings(db, scope.organisationId);
  const date = f.date && isIsoDate(f.date) ? f.date : londonDate();
  const to = f.to && isIsoDate(f.to) && f.to >= date ? f.to : date;
  const base: Prisma.VisitWhereInput = {
    ...visitWhere(scope),
    date: { gte: dbDate(date), lte: dbDate(to) },
    ...(f.status ? { status: f.status } : f.includeCancelled ? {} : { status: { not: "CANCELLED" } }),
    ...(f.serviceUserId ? { serviceUserId: f.serviceUserId } : {}),
    ...(f.areaId ? { areaId: f.areaId } : {}),
    ...(f.callTypeId ? { callTypeId: f.callTypeId } : {}),
    ...(f.staffId ? { assignments: { some: { staffId: f.staffId, removedAt: null } } } : {}),
    ...(f.q
      ? { OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { firstName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { postcode: { contains: f.q, mode: "insensitive" } } }, { assignments: { some: { removedAt: null, staff: { displayName: { contains: f.q, mode: "insensitive" } } } } }] }
      : {}),
  };
  const where: Prisma.VisitWhereInput = f.branchId ? { AND: [base, visitBranchClause(scope, f.branchId)] } : base;
  const rows = await db.visit.findMany({ where, include: visitListInclude, orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }], take: take + 1 });
  const now = new Date();
  let out = rows.slice(0, take).map((r) => ({ ...r, flags: deriveFlags(r, settings, now) }));
  if (f.unassigned) out = out.filter((r) => r.flags.unassignedSlots > 0);
  if (f.review) out = out.filter((r) => r.flags.review.length > 0);
  if (f.late) out = out.filter((r) => r.flags.late && r.status !== "MISSED");
  return { rows: out, settings, truncated: rows.length > take };
}

/** Lists for filter controls, scoped like everything else. */
export async function rotaLookups(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const [areas, callTypes, careTasks, serviceUsers, staff, routes, branches, settings] = await Promise.all([
    db.area.findMany({ where: { organisationId: org, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, orderBy: { name: "asc" } }),
    db.callType.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    db.careTask.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), status: { in: ["ACTIVE", "PAUSED", "ASSESSMENT"] } }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, areaId: true, branchId: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, { status: "all" }), employmentStatus: { not: "ARCHIVED" } }, select: { id: true, displayName: true, jobTitle: true, employmentStatus: true, hrMissing: true, branchId: true, areas: { select: { areaId: true } }, profile: { select: { rotaEnabled: true } } }, orderBy: { displayName: "asc" } }),
    db.runRouteTemplate.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    authorisedBranches(scope),
    rotaSettings(db, org),
  ]);
  // `staff` names everyone in scope (for history and labels); `carers` is the HR-fed pool that pickers and staff rows offer.
  const carers = staff.filter((s) => inRotaPool(settings, s));
  return { scope, areas, callTypes, careTasks, serviceUsers, staff, carers, routes, branches };
}

/**
 * The visit's position in the recurring rota pattern (Week 1…cycle length): the week its build used, or for a visit made
 * from a template without a build record, the cycle week of its date. Null for a one-off visit, which has no pattern.
 */
export function patternWeek(v: { date: Date; templateId: string | null; rotaBuild: { cycleWeek: number } | null }, settings: Pick<RotaSettings, "anchorMonday" | "cycleLength">) {
  if (v.rotaBuild) return v.rotaBuild.cycleWeek;
  if (!v.templateId) return null;
  return cycleWeekOf(mondayOf(v.date.toISOString().slice(0, 10)), settings.anchorMonday.toISOString().slice(0, 10), settings.cycleLength);
}

/** The visit's checklist: tasks, how many have a recorded outcome, and how many were done. */
export function checklistOf(tasks: { outcomes: { outcome: string }[] }[]) {
  const recorded = tasks.filter((t) => t.outcomes.length > 0).length;
  const done = tasks.filter((t) => t.outcomes[0]?.outcome === "DONE").length;
  return { total: tasks.length, recorded, done, outstanding: tasks.length - recorded };
}

export const suName = (su: { firstName: string; lastName: string; preferredName?: string | null }) => `${su.preferredName || su.firstName} ${su.lastName}`;

export function weekDates(monday: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The staff a branch- or area-limited member may allocate (null = anyone in the organisation). */
export async function allocatableStaffIds(scope: Scope): Promise<string[] | null> {
  if (!scope.areaIds && !scope.branchIds) return null;
  return (await db.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, { status: "all" }), employmentStatus: { not: "ARCHIVED" } }, select: { id: true } })).map((s) => s.id);
}

/** Carers ranked for one slot of a visit (eligible first), with each person's reasons, for the assign picker. */
export async function visitCandidates(ctx: Ctx, visit: { id: string; serviceUserId: string; areaId: string | null; scheduledStart: Date; scheduledEnd: Date; timeLocked: boolean; assignments: { slot: string; staffId: string; removedAt: Date | null }[] }, slot: AssignmentSlot) {
  const scope = await rotaScope(ctx, "rota.view");
  const others = visit.assignments.filter((a) => !a.removedAt && a.slot !== slot).map((a) => a.staffId);
  const careTaskIds = (await db.visitTask.findMany({ where: { visitId: visit.id }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
  const allowed = await allocatableStaffIds(scope);
  return slotCandidates(scope.organisationId, { visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, start: visit.scheduledStart, end: visit.scheduledEnd, timeLocked: visit.timeLocked, careTaskIds, otherSlotStaffIds: others }, slot, allowed ?? undefined);
}

/**
 * The ranking behind visitCandidates for any time window, including a visit that does not exist yet (a recovery visit
 * for a missed call): the eligibility service judges everyone, then the match score orders the people it allows.
 */
export async function slotCandidates(organisationId: string, v: { visitId: string | null; serviceUserId: string; areaId: string | null; start: Date; end: Date; timeLocked: boolean; careTaskIds: string[]; otherSlotStaffIds: string[] }, slot: AssignmentSlot, staffIds?: string[]) {
  const ranked = await rankCarers(db, organisationId, { start: v.start, end: v.end, slot, visitId: v.visitId, serviceUserId: v.serviceUserId, areaId: v.areaId, timeLocked: v.timeLocked, careTaskIds: v.careTaskIds }, staffIds);
  const list = ranked.filter((r) => !v.otherSlotStaffIds.includes(r.result.staffId));
  const facts = await loadMatchFacts(db, organisationId, list.filter((r) => r.result.state !== "NOT_ELIGIBLE").map((r) => r.result.staffId), { id: v.visitId, serviceUserId: v.serviceUserId, start: v.start, end: v.end });
  return orderByMatch(list.map((r) => toCandidate(r, scoreMatch(r.result.state, r.result.staffId, { areaId: v.areaId, start: v.start, end: v.end }, facts))));
}

type Ranked = Awaited<ReturnType<typeof rankCarers>>[number];
function toCandidate(r: Ranked, m: Match) {
  return { id: r.result.staffId, name: r.staff?.displayName ?? "", state: r.result.state, readiness: r.result.readiness?.status ?? null, reasons: [...r.result.blocking, ...r.result.warnings].map((x) => x.message), advice: r.result.advice.map((x) => x.message), score: m.score, explain: m.explain, continuity: m.continuity, weekHours: m.weekHours };
}
const STATE_ORDER = { ELIGIBLE: 0, REQUIRES_REVIEW: 1, NOT_ELIGIBLE: 2 } as const;
/** Allowed carers first, best score first; a score never lifts a carer above the eligibility order's hard line. */
function orderByMatch<T extends { state: keyof typeof STATE_ORDER; score: number | null; name: string }>(list: T[]) {
  return list.sort((a, b) => (a.state === "NOT_ELIGIBLE" ? 1 : 0) - (b.state === "NOT_ELIGIBLE" ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1) || STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
}
export type Candidate = ReturnType<typeof toCandidate>;

type CandidateVisit = Parameters<typeof visitCandidates>[1];

/** visitCandidates for a list of visits in one pass (shared fact loading), keyed by visit id. */
export async function visitCandidatesMany(ctx: Ctx, visits: { visit: CandidateVisit; slot: AssignmentSlot }[]) {
  const scope = await rotaScope(ctx, "rota.view");
  const tasks = await db.visitTask.findMany({ where: { visitId: { in: visits.map((v) => v.visit.id) } }, select: { visitId: true, careTaskId: true } });
  const others = visits.map(({ visit, slot }) => visit.assignments.filter((a) => !a.removedAt && a.slot !== slot).map((a) => a.staffId));
  const allowed = await allocatableStaffIds(scope);
  const ranked = await rankCarersMany(db, scope.organisationId, visits.map(({ visit, slot }, i) => ({ start: visit.scheduledStart, end: visit.scheduledEnd, slot, visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: visit.timeLocked, careTaskIds: tasks.filter((t) => t.visitId === visit.id).map((t) => t.careTaskId).filter((x): x is string => !!x), otherSlotStaffIds: others[i] })));
  const out = new Map<string, Candidate[]>();
  for (const [i, { visit }] of visits.entries()) {
    const list = ranked[i]!.filter((r) => !others[i]!.includes(r.result.staffId) && (!allowed || allowed.includes(r.result.staffId)));
    const facts = await loadMatchFacts(db, scope.organisationId, list.filter((r) => r.result.state !== "NOT_ELIGIBLE").map((r) => r.result.staffId), { id: visit.id, serviceUserId: visit.serviceUserId, start: visit.scheduledStart, end: visit.scheduledEnd });
    out.set(visit.id, orderByMatch(list.map((r) => toCandidate(r, scoreMatch(r.result.state, r.result.staffId, { areaId: visit.areaId, start: visit.scheduledStart, end: visit.scheduledEnd }, facts)))));
  }
  return out;
}

/** Display names for the people who acted on records (audit actors), limited to the caller's organisation. */
export async function memberNames(ctx: Ctx, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length || !ctx.organisationId) return new Map<string, string>();
  const ms = await db.membership.findMany({ where: { organisationId: ctx.organisationId, userId: { in: ids } }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(ms.map((m) => [m.userId, m.user.name]));
}
