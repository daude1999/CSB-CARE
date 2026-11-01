import type { MissedCallStage, Prisma, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate, londonDayBounds, londonToUtc, mondayOf, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { missedMedsCount } from "@/server/care/medication";
import { storeEvidenceFile } from "@/server/compliance/evidence";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { exceptionDeadline } from "./exceptions";
import { countedOnce } from "./overview";
import { deriveFlags, suName } from "./queries";
import { rotaScope, visitWhere, type Scope } from "./scope";
import { rotaSettings } from "./settings";

/**
 * Missed Calls. Every visit the call sweep marks missed opens one case, which is investigated (reason, replacement care,
 * follow-up actions, comments and evidence), given an outcome and signed off by a care manager who did not investigate
 * it. Cases are never deleted. Escalation and notifications stay inside the platform; nothing is sent outside it.
 */

type Db = Prisma.TransactionClient | typeof db;

// ── Reference lists ──────────────────────────────────────────────────────

/** Why the call was missed. `carer` = counts towards the care worker's repeat-offender total. */
export const MISSED_REASONS: Record<string, { label: string; carer: boolean }> = {
  CARER_SICKNESS: { label: "Carer sickness or emergency", carer: true },
  CARER_NO_SHOW: { label: "Carer did not attend", carer: true },
  CARER_TRAVEL: { label: "Travel, traffic or vehicle problem", carer: true },
  CARER_LATE: { label: "Carer arrived after the missed threshold", carer: true },
  ROTA_ERROR: { label: "Rota or scheduling error", carer: false },
  UNASSIGNED: { label: "Nobody was assigned", carer: false },
  CLIENT_UNAVAILABLE: { label: "Client not home or in hospital", carer: false },
  ACCESS: { label: "Access problem (key safe, door, pets)", carer: false },
  NOT_CLOCKED: { label: "Visit delivered but not clocked", carer: false },
  CLIENT_CANCELLED: { label: "Client cancelled, not recorded", carer: false },
  SYSTEM: { label: "Phone or system failure", carer: false },
  OTHER: { label: "Other (explained in the findings)", carer: true },
};

export const REPLACEMENT_TYPES: Record<string, string> = {
  REPLACEMENT_VISIT: "Replacement visit by another carer",
  CARER_ARRIVED_LATE: "The booked carer arrived late",
  FAMILY_COVERED: "Family or friend covered the call",
  CLIENT_DECLINED: "Client declined a replacement",
  NOT_NEEDED: "Not needed (client away or call not required)",
  NONE_POSSIBLE: "No replacement was possible",
};

/** `delivered` outcomes mean the client did get their care, so they are not counted as missed in the repeat rules. */
export const OUTCOMES: Record<string, { label: string; delivered: boolean }> = {
  MISSED_CARER: { label: "Missed: care worker at fault", delivered: false },
  MISSED_OFFICE: { label: "Missed: office or rota at fault", delivered: false },
  MISSED_OUTSIDE: { label: "Missed: outside our control", delivered: false },
  DELIVERED_NOT_CLOCKED: { label: "Not missed: delivered but not clocked", delivered: true },
  DELIVERED_LATE: { label: "Not missed: delivered late", delivered: true },
  NOT_REQUIRED: { label: "Not missed: the call was not required", delivered: true },
};

export const STAGE_LABEL: Record<MissedCallStage, string> = { NEW: "New", INVESTIGATING: "Investigating", AWAITING_SIGNOFF: "Awaiting sign-off", CLOSED: "Closed" };

export const OPEN_STAGES: MissedCallStage[] = ["NEW", "INVESTIGATING", "AWAITING_SIGNOFF"];

// ── Opening cases ────────────────────────────────────────────────────────

/** Opens the case for a visit that has just been marked missed. Idempotent: one case per visit. */
export async function openMissedCase(tx: Db, v: { id: string; organisationId: string; serviceUserId: string; areaId: string | null; callTypeId: string; scheduledStart: Date }, now = new Date()) {
  const existing = await tx.missedCallCase.findUnique({ where: { visitId: v.id }, select: { id: true } });
  if (existing) return existing;
  const booked = await tx.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null, slot: { not: "SHADOW" } }, select: { staffId: true, slot: true }, orderBy: { slot: "asc" } });
  const staffId = booked.find((a) => a.slot === "PRIMARY")?.staffId ?? booked[0]?.staffId ?? null;
  const c = await tx.missedCallCase.create({
    data: { organisationId: v.organisationId, visitId: v.id, staffId, serviceUserId: v.serviceUserId, areaId: v.areaId, callTypeId: v.callTypeId, scheduledStart: v.scheduledStart, detectedAt: now, deadline: exceptionDeadline("MISSED", now) },
    select: { id: true },
  });
  await tx.missedCallComment.create({ data: { organisationId: v.organisationId, caseId: c.id, authorId: "system", kind: "SYSTEM", body: staffId ? "Missed call detected: nobody clocked in." : "Missed call detected: nobody clocked in and no carer was assigned." } });
  return c;
}

/** Opens cases for missed visits that have none (visits marked missed before this module, or by imported data). */
export async function syncMissedCases(organisationId?: string) {
  const visits = await db.visit.findMany({
    where: { ...(organisationId ? { organisationId } : {}), status: "MISSED", missedCallCase: null },
    select: { id: true, organisationId: true, serviceUserId: true, areaId: true, callTypeId: true, scheduledStart: true, statusChangedAt: true },
    take: 2000,
  });
  for (const v of visits) await db.$transaction((tx) => openMissedCase(tx, v, v.statusChangedAt));
  return visits.length;
}

// ── Scope ────────────────────────────────────────────────────────────────

export function caseScope(scope: Scope): Prisma.MissedCallCaseWhereInput {
  // A case without an area is judged by its visit (and so its service user), so it cannot cross branches.
  return scope.areaIds ? { organisationId: scope.organisationId, AND: [{ OR: [{ areaId: { in: scope.areaIds } }, { areaId: null, visit: visitWhere(scope) }] }] } : { organisationId: scope.organisationId };
}

async function caseInScope(ctx: Ctx, caseId: string, perm: "rota.monitor" | "rota.edit" = "rota.edit") {
  const scope = await rotaScope(ctx, perm);
  const c = await db.missedCallCase.findFirst({ where: { ...caseScope(scope), id: caseId } });
  if (!c) throw new NotFoundError("Missed call");
  return { c, scope };
}

/** Managers and coordinators in the organisation: the only people a case or an action can be given to. */
export async function caseWorkers(organisationId: string) {
  const ms = await db.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] }, user: { deactivatedAt: null } }, select: { userId: true, roles: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  return ms.map((m) => ({ userId: m.userId, name: m.user.name, manager: m.roles.some((r) => r === "CARE_MANAGER" || r === "ORG_ADMIN") }));
}

async function managers(tx: Db, organisationId: string) {
  return (await tx.membership.findMany({ where: { organisationId, roles: { hasSome: ["CARE_MANAGER", "ORG_ADMIN"] }, user: { deactivatedAt: null } }, select: { userId: true } })).map((m) => m.userId);
}

async function notify(tx: Db, organisationId: string, userIds: string[], n: { type: string; title: string; body: string; reason: string; caseId: string; key: string; dueAt?: Date | null }) {
  if (!userIds.length) return;
  await tx.notification.createMany({
    data: [...new Set(userIds)].map((userId) => ({ organisationId, userId, type: n.type, title: n.title, body: n.body, reason: n.reason, actionUrl: `/rota/missed/${n.caseId}`, dueAt: n.dueAt ?? null, dedupeKey: `${n.key}:${userId}` })),
    skipDuplicates: true,
  });
}

/** Writes a case change only if nobody else changed it since the form was opened. */
async function guardedUpdate(tx: Db, id: string, lockVersion: number | undefined, data: Prisma.MissedCallCaseUpdateInput) {
  const r = await tx.missedCallCase.updateMany({ where: { id, ...(lockVersion !== undefined ? { lockVersion } : {}) }, data: { ...(data as Prisma.MissedCallCaseUpdateManyMutationInput), lockVersion: { increment: 1 } } });
  if (!r.count) throw new ConflictError("Someone else changed this missed call while you were working on it. Reload the page and try again.");
}

export function requireOpen(c: { stage: MissedCallStage }, allowed: MissedCallStage[] = ["NEW", "INVESTIGATING"]) {
  if (!allowed.includes(c.stage)) throw new ConflictError(c.stage === "CLOSED" ? "This case is closed. Reopen it first." : "This case is waiting for a manager's sign-off. Ask a manager to send it back first.");
}

export const nextStage = (s: MissedCallStage): MissedCallStage => (s === "NEW" ? "INVESTIGATING" : s);

// ── Filters, KPIs and the register ───────────────────────────────────────

export const missedFiltersSchema = z.object({
  period: z.enum(["day", "week", "month", "custom"]).catch("week"),
  date: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  carer: z.string().max(40).optional().catch(undefined),
  su: z.string().max(40).optional().catch(undefined),
  branch: z.string().max(40).optional().catch(undefined),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "MISSED", "CANCELLED", "NOT_DELIVERED"]).optional().catch(undefined),
  call: z.string().max(40).optional().catch(undefined),
  reason: z.string().max(40).optional().catch(undefined),
  stage: z.enum(["open", "NEW", "INVESTIGATING", "AWAITING_SIGNOFF", "CLOSED", "escalated", "overdue", "all"]).catch("all"),
  coordinator: z.string().max(40).optional().catch(undefined),
  smart: z.enum(["repeat", "highrisk", "uninvestigated"]).optional().catch(undefined),
});
export type MissedFilters = z.infer<typeof missedFiltersSchema>;

/** The first and last London date of the chosen period. A custom range is capped at a year. */
export function periodRange(f: Pick<MissedFilters, "period" | "date" | "from" | "to">, today = londonDate()) {
  const anchor = f.date && isIsoDate(f.date) ? f.date : today;
  if (f.period === "day") return { from: anchor, to: anchor };
  if (f.period === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    const [y, m] = from.split("-").map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from, to };
  }
  if (f.period === "custom") {
    let from = f.from && isIsoDate(f.from) ? f.from : addDays(today, -29);
    let to = f.to && isIsoDate(f.to) ? f.to : today;
    if (from > to) [from, to] = [to, from];
    if (addDays(from, 366) < to) from = addDays(to, -366);
    return { from, to };
  }
  const from = mondayOf(anchor);
  return { from, to: addDays(from, 6) };
}

/** Previous and next anchor dates for the date navigator. */
export function periodStep(f: Pick<MissedFilters, "period" | "date">, today = londonDate()) {
  const anchor = f.date && isIsoDate(f.date) ? f.date : today;
  if (f.period === "day") return { prev: addDays(anchor, -1), next: addDays(anchor, 1) };
  if (f.period === "month") {
    const [y, m] = anchor.split("-").map(Number) as [number, number];
    const shift = (n: number) => new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
    return { prev: shift(-1), next: shift(1) };
  }
  return { prev: addDays(anchor, -7), next: addDays(anchor, 7) };
}

const bounds = (from: string, to: string) => ({ gte: londonDayBounds(from).start, lt: londonDayBounds(to).end });

const caseInclude = {
  visit: {
    select: {
      id: true, reference: true, status: true, scheduledStart: true, scheduledEnd: true, carersRequired: true,
      callType: { select: { id: true, name: true } },
      area: { select: { id: true, name: true, colour: true, branchId: true, branch: { select: { id: true, name: true } } } },
      serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, riskLevel: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true }, take: 1 } } },
    },
  },
  actions: { where: { doneAt: null }, select: { id: true } },
} satisfies Prisma.MissedCallCaseInclude;
type CaseRow = Prisma.MissedCallCaseGetPayload<{ include: typeof caseInclude }>;

export const isHighRisk = (su: { riskLevel: string | null; risks: { id: string }[] }) => su.riskLevel === "HIGH" || su.risks.length > 0;
/** A case counts in the repeat rules unless the investigation found the client got their care, or it was not the carer's doing. */
const countsAsMissed = (c: { outcome: string | null }) => !(c.outcome && OUTCOMES[c.outcome]?.delivered);
const carerAttributable = (c: { outcome: string | null; reasonCode: string | null }) => countsAsMissed(c) && (!c.reasonCode || MISSED_REASONS[c.reasonCode]?.carer !== false) && c.outcome !== "MISSED_OFFICE" && c.outcome !== "MISSED_OUTSIDE";

/** Care workers and service users over the repeat thresholds, for a window ending on `endDate`. */
async function repeatSets(scope: Scope, endDate: string, settings: { repeatOffenderCount: number; repeatClientCount: number; repeatWindowDays: number }) {
  const startDate = addDays(endDate, -(settings.repeatWindowDays - 1));
  const recent = await db.missedCallCase.findMany({ where: { ...caseScope(scope), scheduledStart: bounds(startDate, endDate) }, select: { staffId: true, serviceUserId: true, outcome: true, reasonCode: true } });
  const byStaff = new Map<string, number>();
  const bySu = new Map<string, number>();
  for (const c of recent) {
    if (c.staffId && carerAttributable(c)) byStaff.set(c.staffId, (byStaff.get(c.staffId) ?? 0) + 1);
    if (countsAsMissed(c)) bySu.set(c.serviceUserId, (bySu.get(c.serviceUserId) ?? 0) + 1);
  }
  const keep = (m: Map<string, number>, n: number) => new Map([...m].filter(([, v]) => v >= n));
  return { staff: keep(byStaff, settings.repeatOffenderCount), serviceUsers: keep(bySu, settings.repeatClientCount), window: { from: startDate, to: endDate } };
}

/** The Missed Calls register: rows for the filters, the six management figures and the four call rings for the period. */
export async function missedCallRegister(ctx: Ctx, input: Record<string, string | string[] | undefined>, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const flat = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]));
  const f = missedFiltersSchema.parse(flat);
  const today = londonDate(now);
  const range = periodRange(f, today);
  const settings = await rotaSettings(db, scope.organisationId);
  await syncMissedCases(scope.organisationId);

  // Branch narrows the caller's own areas and can never widen them.
  const branchAreas = f.branch ? (await db.area.findMany({ where: { organisationId: scope.organisationId, branchId: f.branch }, select: { id: true } })).map((a) => a.id).filter((id) => !scope.areaIds || scope.areaIds.includes(id)) : null;
  const base: Prisma.MissedCallCaseWhereInput = { AND: [caseScope(scope), ...(branchAreas ? [{ areaId: { in: branchAreas } }] : [])] };
  const inPeriod: Prisma.MissedCallCaseWhereInput = { AND: [base, { scheduledStart: bounds(range.from, range.to) }] };

  const repeatEnd = range.to < today ? range.to : today;
  const [periodCases, repeats, dayN, weekN, monthN] = await Promise.all([
    db.missedCallCase.findMany({ where: inPeriod, include: caseInclude, orderBy: { scheduledStart: "desc" } }),
    repeatSets(scope, repeatEnd, settings),
    db.missedCallCase.count({ where: { AND: [base, { scheduledStart: bounds(today, today) }] } }),
    db.missedCallCase.count({ where: { AND: [base, { scheduledStart: bounds(mondayOf(today), addDays(mondayOf(today), 6)) }] } }),
    db.missedCallCase.count({ where: { AND: [base, { scheduledStart: bounds(periodRange({ period: "month" }, today).from, periodRange({ period: "month" }, today).to) }] } }),
  ]);

  const uninvestigated = (c: CaseRow) => c.stage !== "CLOSED" && !c.reasonCode;
  const overdue = (c: CaseRow) => c.stage !== "CLOSED" && !!c.deadline && c.deadline < now && !c.reasonCode;
  const kpis = {
    total: periodCases.length,
    today: dayN,
    thisWeek: weekN,
    thisMonth: monthN,
    repeatOffenders: repeats.staff.size,
    highRisk: periodCases.filter((c) => isHighRisk(c.visit.serviceUser)).length,
    uninvestigated: periodCases.filter(uninvestigated).length,
    uninvestigatedOverdue: periodCases.filter(overdue).length,
    resolved: periodCases.filter((c) => c.stage === "CLOSED").length,
    repeatClients: repeats.serviceUsers.size,
    escalated: periodCases.filter((c) => c.escalatedAt && c.stage !== "CLOSED").length,
  };

  const q = f.q?.toLowerCase();
  const staffIds = [...new Set(periodCases.map((c) => c.staffId).concat(periodCases.map((c) => c.replacementStaffId)).filter((x): x is string => !!x))];
  const staff = new Map((await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: staffIds } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  const rows = periodCases.filter((c) => {
    if (f.carer && c.staffId !== f.carer) return false;
    if (f.su && c.serviceUserId !== f.su) return false;
    if (f.status && c.visit.status !== f.status) return false;
    if (f.call && c.callTypeId !== f.call) return false;
    if (f.reason === "none" ? !!c.reasonCode : f.reason && c.reasonCode !== f.reason) return false;
    if (f.coordinator === "none" ? !!c.coordinatorId : f.coordinator && c.coordinatorId !== f.coordinator) return false;
    if (f.stage === "open" && c.stage === "CLOSED") return false;
    if (f.stage === "escalated" && !(c.escalatedAt && c.stage !== "CLOSED")) return false;
    if (f.stage === "overdue" && !overdue(c)) return false;
    if (["NEW", "INVESTIGATING", "AWAITING_SIGNOFF", "CLOSED"].includes(f.stage) && c.stage !== f.stage) return false;
    if (f.smart === "repeat" && !(c.staffId && repeats.staff.has(c.staffId))) return false;
    if (f.smart === "highrisk" && !isHighRisk(c.visit.serviceUser)) return false;
    if (f.smart === "uninvestigated" && !uninvestigated(c)) return false;
    if (q) {
      const hay = `${suName(c.visit.serviceUser)} ${c.staffId ? staff.get(c.staffId) ?? "" : ""} ${c.visit.reference}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // The four call rings for the same period and branch, as on the Monitor.
  const visits = await db.visit.findMany({
    where: { AND: [visitWhere(scope), branchAreas ? { areaId: { in: branchAreas } } : {}], date: { gte: dbDate(range.from), lte: dbDate(range.to) }, status: { not: "CANCELLED" } },
    select: { id: true, recoveryOfId: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, actualEnd: true, carersRequired: true, assignments: { select: { slot: true, removedAt: true, reviewReason: true } } },
  });
  // A recovery visit booked for a missed call in the same period is the same care need: count it once.
  const counted = countedOnce(visits);
  const rings = {
    total: counted.length,
    complete: counted.filter((v) => v.status === "COMPLETED").length,
    late: visits.filter((v) => v.status !== "MISSED" && deriveFlags(v, settings, now).late).length,
    missed: visits.filter((v) => v.status === "MISSED").length,
    missedMeds: await missedMedsCount(scope.organisationId, visits.map((v) => v.id)),
    lateAfterMin: settings.lateAfterMin,
  };

  const coordinatorIds = [...new Set(rows.map((r) => r.coordinatorId).filter((x): x is string => !!x))];
  const users = new Map((await db.user.findMany({ where: { id: { in: coordinatorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    f, range, today, settings, kpis, rings, repeatWindow: repeats.window,
    rows: rows.map((c) => ({
      ...c,
      carerName: c.staffId ? staff.get(c.staffId) ?? "Former staff member" : null,
      serviceUserName: suName(c.visit.serviceUser),
      highRisk: isHighRisk(c.visit.serviceUser),
      repeatCount: c.staffId ? repeats.staff.get(c.staffId) ?? 0 : 0,
      clientRepeatCount: repeats.serviceUsers.get(c.serviceUserId) ?? 0,
      coordinatorName: c.coordinatorId ? users.get(c.coordinatorId) ?? "A member" : null,
      overdue: overdue(c),
      openActions: c.actions.length,
    })),
  };
}
export type MissedRegister = Awaited<ReturnType<typeof missedCallRegister>>;

/** Lists for the filter selects, limited to the caller's scope. */
export async function missedLookups(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const org = scope.organisationId;
  const [staff, serviceUsers, branches, callTypes, workers] = await Promise.all([
    db.staffMember.findMany({ where: { organisationId: org, hrMissing: false }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    db.serviceUser.findMany({ where: { organisationId: org, ...(scope.areaIds ? { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : {}) }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: { lastName: "asc" } }),
    db.branch.findMany({ where: { organisationId: org, ...(scope.branchIds ? { id: { in: scope.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.callType.findMany({ where: { organisationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    caseWorkers(org),
  ]);
  return { staff, serviceUsers: serviceUsers.map((s) => ({ id: s.id, name: suName(s) })), branches, callTypes, workers };
}

// ── One case ─────────────────────────────────────────────────────────────

export async function getMissedCase(ctx: Ctx, caseId: string, now = new Date()) {
  const { c, scope } = await caseInScope(ctx, caseId, "rota.monitor");
  const settings = await rotaSettings(db, scope.organisationId);
  const full = await db.missedCallCase.findUniqueOrThrow({
    where: { id: c.id },
    include: {
      visit: { select: { id: true, reference: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, carersRequired: true, notDeliveredReason: true, callType: { select: { name: true } }, area: { select: { name: true, colour: true } }, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, riskLevel: true, riskSummary: true, phone: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true }, take: 1 } } } } },
      actions: { orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }] },
      comments: { orderBy: { createdAt: "asc" } },
    },
  });
  const since = new Date(now.getTime() - 90 * 86400000);
  const [carer, replacement, carerHistory, clientHistory, workers, evidence, repeats, auditTrail] = await Promise.all([
    full.staffId ? db.staffMember.findFirst({ where: { id: full.staffId, organisationId: scope.organisationId }, select: { id: true, displayName: true, workPhone: true } }) : null,
    full.replacementStaffId ? db.staffMember.findFirst({ where: { id: full.replacementStaffId, organisationId: scope.organisationId }, select: { id: true, displayName: true } }) : null,
    full.staffId ? db.missedCallCase.findMany({ where: { ...caseScope(scope), staffId: full.staffId, id: { not: full.id }, scheduledStart: { gte: since } }, orderBy: { scheduledStart: "desc" }, take: 10, include: { visit: { select: { callType: { select: { name: true } }, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } } }) : [],
    db.missedCallCase.findMany({ where: { ...caseScope(scope), serviceUserId: full.serviceUserId, id: { not: full.id }, scheduledStart: { gte: since } }, orderBy: { scheduledStart: "desc" }, take: 10, include: { visit: { select: { callType: { select: { name: true } } } } } }),
    caseWorkers(scope.organisationId),
    db.evidenceDocument.findMany({ where: { organisationId: scope.organisationId, linkedType: "MISSED_CALL", linkedId: full.id }, select: { id: true, filename: true, sizeBytes: true, scanStatus: true, createdAt: true } }),
    repeatSets(scope, londonDate(now), settings),
    db.auditLog.findMany({ where: { organisationId: scope.organisationId, entityType: "MissedCallCase", entityId: full.id }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, actorId: true, createdAt: true } }),
  ]);
  const historyStaff = new Map((await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: clientHistory.map((h) => h.staffId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  const people = new Set<string>([...full.comments.map((x) => x.authorId), ...full.actions.flatMap((a) => [a.ownerId, a.createdById, a.doneById ?? ""]), ...auditTrail.map((a) => a.actorId ?? ""), full.coordinatorId ?? "", full.reasonRecordedById ?? "", full.replacementById ?? "", full.submittedById ?? "", full.signedOffById ?? "", full.escalatedById ?? ""]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [...people].filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  names.set("system", "System");
  // Candidates for the replacement carer, best first, judged by the eligibility service for the missed visit's time.
  const canWork = hasOrgPermission(ctx, "rota.edit");
  const canSignOff = hasOrgPermission(ctx, "rota.missed.signoff");
  const investigatedBy = [full.submittedById, full.reasonRecordedById].filter((x): x is string => !!x);
  return {
    c: full, carer, replacement, carerHistory, clientHistory, historyStaff, workers, evidence, names, auditTrail, settings,
    highRisk: isHighRisk(full.visit.serviceUser),
    carerRepeat: full.staffId ? repeats.staff.get(full.staffId) ?? 0 : 0,
    clientRepeat: repeats.serviceUsers.get(full.serviceUserId) ?? 0,
    overdue: full.stage !== "CLOSED" && !full.reasonCode && !!full.deadline && full.deadline < now,
    canWork, canSignOff,
    /** Separation of duties: whoever investigated cannot sign off. */
    ownCase: investigatedBy.includes(ctx.userId),
  };
}

/** Staff who could have covered the call, for the replacement picker. */
export async function replacementCandidates(ctx: Ctx, caseId: string) {
  const { scope } = await caseInScope(ctx, caseId, "rota.monitor");
  return db.staffMember.findMany({ where: { organisationId: scope.organisationId, hrMissing: false, employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
}

// ── Working a case ───────────────────────────────────────────────────────

const optLock = (n: number | undefined) => (Number.isInteger(n) ? n : undefined);

export async function assignCoordinator(ctx: Ctx, caseId: string, coordinatorId: string, lockVersion?: number) {
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c, OPEN_STAGES);
  if (!(await caseWorkers(scope.organisationId)).some((w) => w.userId === coordinatorId)) throw new ValidationError("Choose a coordinator or manager in your organisation");
  await db.$transaction(async (tx) => {
    await guardedUpdate(tx, c.id, optLock(lockVersion), { coordinatorId, coordinatorAssignedAt: new Date(), stage: nextStage(c.stage) });
    if (coordinatorId !== ctx.userId) await notify(tx, scope.organisationId, [coordinatorId], { type: "rota.missed.assigned", title: "You are investigating a missed call", body: `${ctx.userName} made you the responsible coordinator.`, reason: "You were given this missed call to investigate.", caseId: c.id, key: `missed-coord:${c.id}:${Date.now()}`, dueAt: c.deadline });
    await syncAlert(tx, c.visitId, { ownerId: coordinatorId, ownerAssignedAt: new Date() });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.coordinator", entityType: "MissedCallCase", entityId: c.id, data: { coordinatorId } }, tx);
  });
}

const reasonSchema = z.object({
  reasonCode: z.string().refine((s) => s in MISSED_REASONS, "Choose a reason for the missed call"),
  reasonDetail: z.string().trim().max(500).optional(),
  findings: z.string().trim().min(10, "Say what the investigation found (at least 10 characters)").max(4000),
  lockVersion: z.number().int().optional(),
});
export async function recordReason(ctx: Ctx, caseId: string, input: z.input<typeof reasonSchema>) {
  const p = reasonSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the reason");
  if (p.data.reasonCode === "OTHER" && !p.data.reasonDetail) throw new ValidationError("Say what the other reason was");
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c);
  await db.$transaction(async (tx) => {
    await guardedUpdate(tx, c.id, p.data.lockVersion, { reasonCode: p.data.reasonCode, reasonDetail: p.data.reasonDetail || null, findings: p.data.findings, reasonRecordedById: ctx.userId, reasonRecordedAt: new Date(), stage: nextStage(c.stage), ...(c.coordinatorId ? {} : { coordinatorId: ctx.userId, coordinatorAssignedAt: new Date() }) });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.reason", entityType: "MissedCallCase", entityId: c.id, data: { reasonCode: p.data.reasonCode, changed: !!c.reasonCode } }, tx);
  });
}

const replacementSchema = z.object({
  replacementType: z.string().refine((s) => s in REPLACEMENT_TYPES, "Choose what happened about the client's care"),
  replacementStaffId: z.string().max(40).optional(),
  arrivedAt: z.string().optional(),
  clientInformed: z.string().trim().min(2, "Say whether the client or family was told, and how").max(300),
  note: z.string().trim().max(2000).optional(),
  acceptWarnings: z.boolean().optional(),
  lockVersion: z.number().int().optional(),
});
/** Records how the client's care was covered. A replacement carer goes through the eligibility service like any assignment. */
export async function recordReplacement(ctx: Ctx, caseId: string, input: z.input<typeof replacementSchema>) {
  const p = replacementSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the replacement details");
  const d = p.data;
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c);
  const visit = await db.visit.findUniqueOrThrow({ where: { id: c.visitId }, select: { id: true, date: true, scheduledStart: true, scheduledEnd: true, serviceUserId: true, areaId: true, timeLocked: true, tasks: { select: { careTaskId: true } } } });
  let arrivedAt: Date | null = null;
  if (d.arrivedAt) {
    const m = parseHhmm(d.arrivedAt);
    if (m === null) throw new ValidationError("Arrival time must be a time such as 09:05");
    arrivedAt = londonToUtc(londonDate(visit.scheduledStart), m);
    if (arrivedAt < visit.scheduledStart) arrivedAt = new Date(arrivedAt.getTime() + 86400000);
  }
  let warnings: string[] = [];
  if (d.replacementType === "REPLACEMENT_VISIT") {
    if (!d.replacementStaffId) throw new ValidationError("Choose the replacement carer");
    if (d.replacementStaffId === c.staffId) throw new ValidationError("The replacement must be a different carer; choose \"The booked carer arrived late\" instead");
    if (!arrivedAt) throw new ValidationError("Give the time the replacement carer arrived");
    const staff = await db.staffMember.findFirst({ where: { id: d.replacementStaffId, organisationId: scope.organisationId }, select: { id: true } });
    if (!staff) throw new NotFoundError("Staff member");
    const length = visit.scheduledEnd.getTime() - visit.scheduledStart.getTime();
    const r = await eligibilityFor(db, scope.organisationId, { staffId: staff.id, start: arrivedAt, end: new Date(arrivedAt.getTime() + length), slot: "PRIMARY", visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: false, careTaskIds: visit.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x) });
    const blocking = r.blocking;
    if (blocking.length) throw new ValidationError(`This carer is not eligible: ${blocking.map((b) => b.message).join("; ")}`);
    warnings = r.warnings.map((w) => w.message);
    if (warnings.length && !d.acceptWarnings) throw new ValidationError(`Check these before recording: ${warnings.join("; ")}. Tick "Accept warnings" to record anyway.`);
  } else if (d.replacementType === "CARER_ARRIVED_LATE" && !arrivedAt) {
    throw new ValidationError("Give the time the carer arrived");
  }
  await db.$transaction(async (tx) => {
    await guardedUpdate(tx, c.id, d.lockVersion, {
      replacementType: d.replacementType,
      replacementStaffId: d.replacementType === "REPLACEMENT_VISIT" ? d.replacementStaffId : null,
      replacementArrivedAt: arrivedAt,
      clientInformed: d.clientInformed,
      replacementNote: d.note || null,
      replacementWarnings: warnings,
      replacementById: ctx.userId,
      replacementAt: new Date(),
      stage: nextStage(c.stage),
    });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.replacement", entityType: "MissedCallCase", entityId: c.id, data: { type: d.replacementType, staffId: d.replacementStaffId ?? null, warnings } }, tx);
    if (d.replacementType === "NONE_POSSIBLE") {
      await notify(tx, scope.organisationId, await managers(tx, scope.organisationId), { type: "rota.missed.nocare", title: "A client went without a call", body: "No replacement care was possible for a missed call.", reason: "You manage care delivery for this organisation.", caseId: c.id, key: `missed-nocare:${c.id}` });
    }
  });
}

const actionSchema = z.object({ text: z.string().trim().min(3, "Say what needs doing").max(500), ownerId: z.string().min(1, "Choose who will do it"), due: z.string().refine(isIsoDate, "Choose a due date") });
export async function addFollowUp(ctx: Ctx, caseId: string, input: z.input<typeof actionSchema>) {
  const p = actionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the action");
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c, OPEN_STAGES);
  if (!(await caseWorkers(scope.organisationId)).some((w) => w.userId === p.data.ownerId)) throw new ValidationError("Choose a coordinator or manager in your organisation");
  if (p.data.due < londonDate()) throw new ValidationError("The due date cannot be in the past");
  const dueAt = londonDayBounds(p.data.due).end;
  await db.$transaction(async (tx) => {
    const a = await tx.missedCallAction.create({ data: { organisationId: scope.organisationId, caseId: c.id, text: p.data.text, ownerId: p.data.ownerId, dueAt: new Date(dueAt.getTime() - 1000), createdById: ctx.userId } });
    await tx.missedCallCase.update({ where: { id: c.id }, data: { stage: nextStage(c.stage), lockVersion: { increment: 1 } } });
    if (p.data.ownerId !== ctx.userId) await notify(tx, scope.organisationId, [p.data.ownerId], { type: "rota.missed.action", title: `Follow-up action: ${p.data.text}`, body: `${ctx.userName} gave you a follow-up action on a missed call.`, reason: "You own this follow-up action.", caseId: c.id, key: `missed-action:${a.id}`, dueAt: a.dueAt });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.action.added", entityType: "MissedCallCase", entityId: c.id, data: { actionId: a.id, ownerId: p.data.ownerId, due: p.data.due } }, tx);
  });
}

export async function completeFollowUp(ctx: Ctx, actionId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const a = await db.missedCallAction.findFirst({ where: { id: actionId, organisationId: scope.organisationId } });
  if (!a) throw new NotFoundError("Action");
  await caseInScope(ctx, a.caseId);
  if (a.doneAt) throw new ConflictError("This action is already done");
  await db.$transaction(async (tx) => {
    const r = await tx.missedCallAction.updateMany({ where: { id: a.id, doneAt: null }, data: { doneAt: new Date(), doneById: ctx.userId } });
    if (!r.count) throw new ConflictError("This action is already done");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.action.done", entityType: "MissedCallCase", entityId: a.caseId, data: { actionId: a.id } }, tx);
  });
}

export async function addCaseComment(ctx: Ctx, caseId: string, body: string) {
  const text = body.trim();
  if (text.length < 2) throw new ValidationError("Write a comment first");
  if (text.length > 4000) throw new ValidationError("Comments are limited to 4,000 characters");
  const { c, scope } = await caseInScope(ctx, caseId);
  await db.$transaction(async (tx) => {
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, body: text } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.comment", entityType: "MissedCallCase", entityId: c.id }, tx);
  });
}

/** Stores an evidence file in the secure store and lists it on the case. Downloads go through a permission check. */
export async function addCaseEvidence(ctx: Ctx, caseId: string, file: { name: string; type: string; bytes: Buffer }, description?: string) {
  const { c, scope } = await caseInScope(ctx, caseId);
  const doc = await storeEvidenceFile(scope.organisationId, ctx.userId, file, { description: description?.trim() || undefined, linkedType: "MISSED_CALL", linkedId: c.id });
  await db.$transaction(async (tx) => {
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, kind: "EVIDENCE", body: description?.trim() || doc.filename, evidenceId: doc.id } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.evidence", entityType: "MissedCallCase", entityId: c.id, data: { evidenceId: doc.id } }, tx);
  });
  return doc;
}

/** Evidence on a missed call, for people who may see the case. */
export async function readCaseEvidence(ctx: Ctx, evidenceId: string) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const doc = await db.evidenceDocument.findFirst({ where: { id: evidenceId, organisationId: scope.organisationId, linkedType: "MISSED_CALL" } });
  if (!doc || !doc.linkedId) throw new NotFoundError("Evidence");
  await caseInScope(ctx, doc.linkedId, "rota.monitor");
  if (doc.scanStatus === "INFECTED") throw new ForbiddenError("This file failed the malware scan and cannot be downloaded");
  const { storage } = await import("@/server/storage");
  const bytes = await storage().get(doc.storageKey);
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "evidence.downloaded", entityType: "EvidenceDocument", entityId: doc.id });
  return { doc, bytes };
}

/** Keeps the Exceptions register in step with the case, so nobody works the same missed call twice. */
async function syncAlert(tx: Db, visitId: string, data: Prisma.RotaAlertUpdateManyMutationInput) {
  await tx.rotaAlert.updateMany({ where: { visitId, kind: "MISSED", resolvedAt: null }, data });
}

async function escalateCase(tx: Db, c: { id: string; organisationId: string; visitId: string }, note: string, actorId: string | null) {
  const now = new Date();
  await tx.missedCallCase.update({ where: { id: c.id }, data: { escalatedAt: now, escalatedById: actorId, escalationNote: note, lockVersion: { increment: 1 } } });
  await syncAlert(tx, c.visitId, { escalatedAt: now, escalationState: "ESCALATED", escalationNote: note });
  await tx.missedCallComment.create({ data: { organisationId: c.organisationId, caseId: c.id, authorId: actorId ?? "system", kind: "SYSTEM", body: `Escalated to the care managers: ${note}` } });
  await notify(tx, c.organisationId, (await managers(tx, c.organisationId)).filter((m) => m !== actorId), { type: "rota.missed.escalated", title: "Missed call escalated", body: note, reason: "You manage care delivery for this organisation.", caseId: c.id, key: `missed-escalated:${c.id}` });
}

export async function escalateMissedCase(ctx: Ctx, caseId: string, note: string) {
  if (note.trim().length < 5) throw new ValidationError("Say why this needs a manager");
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c, OPEN_STAGES);
  if (c.escalatedAt) throw new ConflictError("This missed call has already been escalated");
  await db.$transaction(async (tx) => {
    await escalateCase(tx, c, note.trim(), ctx.userId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.escalated", entityType: "MissedCallCase", entityId: c.id, data: { note: note.trim() } }, tx);
  });
}

/** Run with the call sweep: open cases with no reason past their deadline go to the care managers once, in-app. */
export async function escalateOverdueCases(now = new Date()) {
  const due = await db.missedCallCase.findMany({ where: { stage: { in: ["NEW", "INVESTIGATING"] }, reasonCode: null, escalatedAt: null, deadline: { lt: now } }, take: 500 });
  for (const c of due) {
    await db.$transaction(async (tx) => {
      const fresh = await tx.missedCallCase.findUnique({ where: { id: c.id }, select: { escalatedAt: true } });
      if (fresh?.escalatedAt) return;
      await escalateCase(tx, c, "Not investigated by its deadline", null);
      await audit({ organisationId: c.organisationId, actorId: null, action: "rota.missed.escalated", entityType: "MissedCallCase", entityId: c.id, data: { automatic: true } }, tx);
    });
  }
  return due.length;
}

const outcomeSchema = z.object({
  outcome: z.string().refine((s) => s in OUTCOMES, "Choose the investigation outcome"),
  preventable: z.enum(["yes", "no"], { message: "Say whether it was preventable" }),
  outcomeNote: z.string().trim().min(10, "Summarise the outcome and what will stop it happening again (at least 10 characters)").max(4000),
  lockVersion: z.number().int().optional(),
});
/** The investigator records the outcome and sends the case to the care managers for sign-off. */
export async function submitForSignOff(ctx: Ctx, caseId: string, input: z.input<typeof outcomeSchema>) {
  const p = outcomeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the outcome");
  const { c, scope } = await caseInScope(ctx, caseId);
  requireOpen(c);
  if (!c.reasonCode) throw new ValidationError("Record the reason for the missed call first");
  if (!c.replacementType) throw new ValidationError("Record the replacement care arrangements first");
  await db.$transaction(async (tx) => {
    await guardedUpdate(tx, c.id, p.data.lockVersion, { outcome: p.data.outcome, preventable: p.data.preventable === "yes", outcomeNote: p.data.outcomeNote, submittedById: ctx.userId, submittedAt: new Date(), stage: "AWAITING_SIGNOFF" });
    await notify(tx, scope.organisationId, (await managers(tx, scope.organisationId)).filter((m) => m !== ctx.userId), { type: "rota.missed.signoff", title: "A missed-call investigation needs your sign-off", body: `${ctx.userName} recorded the outcome: ${OUTCOMES[p.data.outcome]!.label}.`, reason: "Care managers sign off missed-call investigations.", caseId: c.id, key: `missed-submit:${c.id}:${c.lockVersion}` });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.submitted", entityType: "MissedCallCase", entityId: c.id, data: { outcome: p.data.outcome, preventable: p.data.preventable === "yes" } }, tx);
  });
}

/** A care manager who did not investigate the case signs it off (closing it), or sends it back with a note. */
export async function signOffMissedCase(ctx: Ctx, caseId: string, input: { decision: "approve" | "return"; note: string; lockVersion?: number }) {
  requireOrgPermission(ctx, "rota.missed.signoff");
  const { c, scope } = await caseInScope(ctx, caseId);
  if (c.stage !== "AWAITING_SIGNOFF") throw new ConflictError("This case is not waiting for sign-off");
  if (c.submittedById === ctx.userId || c.reasonRecordedById === ctx.userId) throw new ForbiddenError("You investigated this missed call, so another manager must sign it off");
  const note = input.note.trim();
  if (input.decision === "return" && note.length < 5) throw new ValidationError("Say what needs to change");
  await db.$transaction(async (tx) => {
    if (input.decision === "approve") {
      const now = new Date();
      await guardedUpdate(tx, c.id, input.lockVersion, { stage: "CLOSED", signedOffById: ctx.userId, signedOffAt: now, signOffNote: note || null });
      await tx.rotaAlert.updateMany({ where: { visitId: c.visitId, kind: "MISSED", resolvedAt: null }, data: { resolvedAt: now, resolvedById: ctx.userId, resolution: `Missed-call investigation signed off: ${OUTCOMES[c.outcome ?? ""]?.label ?? "closed"}`, escalationState: c.escalatedAt ? "RESOLVED_AFTER_ESCALATION" : "NONE" } });
    } else {
      await guardedUpdate(tx, c.id, input.lockVersion, { stage: "INVESTIGATING", submittedAt: null, submittedById: null });
      await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, body: `Sent back for more investigation: ${note}` } });
    }
    const to = [c.submittedById, c.coordinatorId].filter((x): x is string => !!x && x !== ctx.userId);
    await notify(tx, scope.organisationId, to, { type: "rota.missed.decided", title: input.decision === "approve" ? "Missed-call investigation signed off" : "Missed-call investigation sent back", body: note || "Signed off.", reason: "You investigated this missed call.", caseId: c.id, key: `missed-decided:${c.id}:${c.lockVersion}` });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: input.decision === "approve" ? "rota.missed.signedoff" : "rota.missed.returned", entityType: "MissedCallCase", entityId: c.id, data: { note } }, tx);
  });
}

export async function reopenMissedCase(ctx: Ctx, caseId: string, reason: string) {
  requireOrgPermission(ctx, "rota.missed.signoff");
  if (reason.trim().length < 5) throw new ValidationError("Say why the case is being reopened");
  const { c, scope } = await caseInScope(ctx, caseId);
  if (c.stage !== "CLOSED") throw new ConflictError("Only a closed case can be reopened");
  await db.$transaction(async (tx) => {
    await guardedUpdate(tx, c.id, undefined, { stage: "INVESTIGATING", reopenedAt: new Date(), reopenReason: reason.trim(), signedOffAt: null, signedOffById: null, submittedAt: null, submittedById: null });
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, kind: "SYSTEM", body: `Reopened: ${reason.trim()}` } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.reopened", entityType: "MissedCallCase", entityId: c.id, data: { reason: reason.trim() } }, tx);
  });
}

/** Bulk actions from the register. Each case is checked on its own; the result says how many were done and skipped. */
export async function bulkMissed(ctx: Ctx, caseIds: string[], action: "assign" | "escalate", input: { coordinatorId?: string; note?: string }) {
  if (!caseIds.length) throw new ValidationError("Tick at least one missed call");
  if (caseIds.length > 200) throw new ValidationError("Choose 200 or fewer at a time");
  if (action === "assign" && !input.coordinatorId) throw new ValidationError("Choose a coordinator");
  if (action === "escalate" && (input.note ?? "").trim().length < 5) throw new ValidationError("Say why these need a manager");
  let done = 0;
  const skipped: string[] = [];
  for (const id of caseIds) {
    try {
      if (action === "assign") await assignCoordinator(ctx, id, input.coordinatorId!);
      else await escalateMissedCase(ctx, id, input.note!);
      done++;
    } catch (e) {
      if (e instanceof ValidationError && action === "assign") throw e;
      skipped.push((e as Error).message);
    }
  }
  return { done, skipped };
}

// ── Histories ────────────────────────────────────────────────────────────

/** Every missed call for one care worker or one service user, newest first, for their record's "Missed calls" tab. */
export async function missedHistory(ctx: Ctx, who: { staffId?: string; serviceUserId?: string }, range?: { from?: string; to?: string }) {
  const scope = await rotaScope(ctx, "rota.monitor");
  if (!who.staffId && !who.serviceUserId) throw new ValidationError("Choose a person");
  const from = range?.from && isIsoDate(range.from) ? range.from : addDays(londonDate(), -365);
  const to = range?.to && isIsoDate(range.to) ? range.to : londonDate();
  const rows = await db.missedCallCase.findMany({
    where: { ...caseScope(scope), ...(who.staffId ? { staffId: who.staffId } : { serviceUserId: who.serviceUserId }), scheduledStart: bounds(from, to) },
    include: { visit: { select: { reference: true, status: true, callType: { select: { name: true } }, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    orderBy: { scheduledStart: "desc" },
    take: 500,
  });
  const staff = new Map((await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: rows.map((r) => r.staffId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  return { from, to, rows: rows.map((r) => ({ ...r, carerName: r.staffId ? staff.get(r.staffId) ?? "Former staff member" : null, serviceUserName: suName(r.visit.serviceUser) })) };
}

export const reasonLabel = (code: string | null) => (code ? MISSED_REASONS[code]?.label ?? code : null);
export const outcomeLabel = (code: string | null) => (code ? OUTCOMES[code]?.label ?? code : null);
export const VISIT_STATUS_NOW: Record<VisitStatus, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "Carer arrived late (in progress)", COMPLETED: "Delivered late", MISSED: "Missed", CANCELLED: "Cancelled", NOT_DELIVERED: "Not delivered" };

// ── Exports ──────────────────────────────────────────────────────────────

/** The register as Excel or PDF, with the same filters, scope and figures as the page. Selected rows only when ids are given. */
export async function exportMissedCalls(ctx: Ctx, input: Record<string, string | string[] | undefined>, format: "xlsx" | "pdf") {
  const organisationId = requireOrgPermission(ctx, "report.export");
  const { toPdf, toXlsx } = await import("@/server/reports/export-files");
  const reg = await missedCallRegister(ctx, input);
  const pick = (Array.isArray(input.ids) ? input.ids : input.ids ? String(input.ids).split(",") : []).filter(Boolean);
  const rows = pick.length ? reg.rows.filter((r) => pick.includes(r.id)) : reg.rows;
  const { fmtLondonDate, londonTime } = await import("@/lib/london");
  const users = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.signedOffById).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const k = reg.kpis;
  const table = {
    title: "Missed calls",
    subtitle: `${fmtLondonDate(reg.range.from)} to ${fmtLondonDate(reg.range.to)} · ${rows.length} missed ${rows.length === 1 ? "call" : "calls"}${pick.length ? " (selected)" : ""} · exported ${fmtLondonDate(londonDate())} ${londonTime(new Date())} by ${ctx.userName}`,
    summary: [
      ["Total missed calls", k.total], ["Repeat offenders (workers)", k.repeatOffenders], ["High-risk missed visits", k.highRisk],
      ["Uninvestigated", k.uninvestigated], ["Resolved", k.resolved], ["Repeat service-user incidents", k.repeatClients],
    ] as [string, number][],
    columns: ["Ref", "Date", "Time", "Care worker", "Repeat (window)", "Service user", "High risk", "Branch / area", "Visit type", "Visit now", "Reason", "Findings", "Replacement care", "Stage", "Coordinator", "Escalated", "Outcome", "Preventable", "Signed off by", "Signed off"],
    widths: [5, 4, 3, 6, 3, 6, 3, 5, 4, 4, 6, 9, 6, 4, 5, 3, 6, 3, 5, 4],
    rows: rows.map((r) => [
      r.visit.reference, fmtLondonDate(londonDate(r.scheduledStart)), londonTime(r.scheduledStart), r.carerName ?? "Unassigned", r.repeatCount || "", r.serviceUserName, r.highRisk ? "Yes" : "No",
      r.visit.area ? `${r.visit.area.branch?.name ? `${r.visit.area.branch.name} · ` : ""}${r.visit.area.name}` : "", r.visit.callType.name, VISIT_STATUS_NOW[r.visit.status], reasonLabel(r.reasonCode) ?? "Not recorded", r.findings ?? "",
      r.replacementType ? REPLACEMENT_TYPES[r.replacementType] ?? r.replacementType : "Not recorded", STAGE_LABEL[r.stage], r.coordinatorName ?? "", r.escalatedAt ? "Yes" : "No", outcomeLabel(r.outcome) ?? "",
      r.preventable === null ? "" : r.preventable ? "Yes" : "No", r.signedOffById ? users.get(r.signedOffById) ?? "" : "", r.signedOffAt ? fmtLondonDate(londonDate(r.signedOffAt)) : "",
    ]),
  };
  const body = format === "xlsx" ? await toXlsx(table) : await toPdf(table);
  await audit({ organisationId, actorId: ctx.userId, action: "rota.missed.exported", entityType: "MissedCallCase", entityId: "register", data: { format, rows: rows.length, from: reg.range.from, to: reg.range.to, selected: pick.length } });
  return { body, name: `csb-missed-calls-${reg.range.from}-to-${reg.range.to}.${format}`, type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" };
}

/** Open missed calls with no reason recorded yet, in the caller's areas, for the Rota Dashboard. Null without monitor access. */
export async function uninvestigatedCount(ctx: Ctx) {
  if (!hasOrgPermission(ctx, "rota.monitor")) return null;
  const scope = await rotaScope(ctx, "rota.monitor");
  return db.missedCallCase.count({ where: { ...caseScope(scope), stage: { not: "CLOSED" }, reasonCode: null } });
}
