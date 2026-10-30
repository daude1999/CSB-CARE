import type { AlertSeverity, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, visitWhere, type Scope } from "./scope";

/**
 * The exceptions register: every rota alert (late, missed, overrun, not delivered, short visit, allocation review,
 * readiness) with an owner, a deadline and escalation. Built on RotaAlert so the monitor, the dashboard and this
 * register count the same records. Escalation is in-app only; nothing is sent outside the platform.
 */

export const EXCEPTION_KINDS: Record<string, string> = {
  LATE: "Late call",
  MISSED: "Missed call",
  OVERRUN: "Not clocked out",
  NOT_DELIVERED: "Not delivered",
  SHORT_VISIT: "Short visit",
  ALLOCATION_REVIEW: "Allocation needs review",
  READINESS: "Readiness at clock-in",
  UNASSIGNED: "Unassigned after a build",
  CONCERN: "Concern noted on a visit",
  MISSED_MEDICATION: "Missed medication",
  MEDICATION_NOT_TAKEN: "Medication refused or not given",
  CLOCK_CORRECTION: "Clock correction request",
};

/**
 * How long the office has to resolve each kind of exception before it is escalated to the care managers. Calls that
 * may leave someone without care are the shortest; review work that can wait for the next working day is the longest.
 */
const DEADLINE_MIN: Record<string, number> = { MISSED_MEDICATION: 30, MEDICATION_NOT_TAKEN: 60, MISSED: 30, LATE: 30, NOT_DELIVERED: 60, OVERRUN: 60, READINESS: 60, CONCERN: 240, SHORT_VISIT: 1440, ALLOCATION_REVIEW: 1440, UNASSIGNED: 1440 };
export function exceptionDeadline(kind: string, from = new Date()) {
  return new Date(from.getTime() + (DEADLINE_MIN[kind] ?? 1440) * 60_000);
}

export const filtersSchema = z.object({
  state: z.enum(["open", "closed", "overdue", "all"]).catch("open"),
  kind: z.string().max(40).optional().catch(undefined),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional().catch(undefined),
  area: z.string().max(40).optional().catch(undefined),
  owner: z.string().max(40).optional().catch(undefined),
});
export type ExceptionFilters = z.infer<typeof filtersSchema>;

async function visibleWhere(scope: Scope, f: ExceptionFilters, now: Date): Promise<Prisma.RotaAlertWhereInput> {
  const and: Prisma.RotaAlertWhereInput[] = [];
  // Area-limited members see alerts for visits in their areas, and alerts that are not about a visit.
  if (scope.areaIds || f.area) {
    const alertVisits = (await db.rotaAlert.findMany({ where: { organisationId: scope.organisationId, visitId: { not: null } }, select: { visitId: true }, distinct: ["visitId"] })).map((x) => x.visitId as string);
    const visits = await db.visit.findMany({ where: { ...visitWhere(scope), ...(f.area ? { areaId: f.area } : {}), id: { in: alertVisits } }, select: { id: true } });
    const ids = visits.map((v) => v.id);
    and.push(f.area ? { visitId: { in: ids } } : { OR: [{ visitId: null }, { visitId: { in: ids } }] });
  }
  if (f.state === "open") and.push({ resolvedAt: null });
  if (f.state === "closed") and.push({ resolvedAt: { not: null } });
  if (f.state === "overdue") and.push({ resolvedAt: null, deadline: { lt: now } });
  if (f.kind) and.push({ kind: f.kind });
  if (f.severity) and.push({ severity: f.severity });
  if (f.owner === "none") and.push({ ownerId: null });
  else if (f.owner) and.push({ ownerId: f.owner });
  return { organisationId: scope.organisationId, ...(and.length ? { AND: and } : {}) };
}

/** The register for one page: rows, counts that match them and the people who may own an exception. */
export async function listExceptions(ctx: Ctx, input: Record<string, string | undefined>, opts: { take?: number } = {}) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const f = filtersSchema.parse(input);
  const now = new Date();
  const where = await visibleWhere(scope, f, now);
  const [rows, open, overdue, owners] = await Promise.all([
    db.rotaAlert.findMany({ where, orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { severity: "desc" }, { deadline: { sort: "asc", nulls: "last" } }, { raisedAt: "desc" }], take: opts.take ?? 300 }),
    db.rotaAlert.count({ where: await visibleWhere(scope, { ...f, state: "open" }, now) }),
    db.rotaAlert.count({ where: await visibleWhere(scope, { ...f, state: "overdue" }, now) }),
    possibleOwners(scope.organisationId),
  ]);
  const visits = await db.visit.findMany({ where: { id: { in: rows.map((r) => r.visitId).filter((x): x is string => !!x) } }, select: { id: true, reference: true, scheduledStart: true, area: { select: { name: true, colour: true } } } });
  const byVisit = new Map(visits.map((v) => [v.id, v]));
  const names = new Map(owners.map((o) => [o.userId, o.name]));
  const resolvers = await db.user.findMany({ where: { id: { in: rows.map((r) => r.resolvedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  for (const u of resolvers) if (!names.has(u.id)) names.set(u.id, u.name);
  return { f, rows: rows.map((r) => ({ ...r, visit: r.visitId ? byVisit.get(r.visitId) ?? null : null, overdue: !r.resolvedAt && !!r.deadline && r.deadline < now })), open, overdue, owners, names };
}

/** Members who work the rota: the only people an exception can be given to. */
async function possibleOwners(organisationId: string) {
  const ms = await db.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] }, user: { deactivatedAt: null } }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  return ms.map((m) => ({ userId: m.userId, name: m.user.name }));
}

async function alertInScope(ctx: Ctx, alertId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const a = await db.rotaAlert.findFirst({ where: { id: alertId, organisationId: scope.organisationId } });
  if (!a) throw new NotFoundError("Exception");
  if (a.visitId && scope.areaIds && !(await db.visit.findFirst({ where: { ...visitWhere(scope), id: a.visitId }, select: { id: true } }))) throw new NotFoundError("Exception");
  return { a, scope };
}

export async function assignExceptionOwner(ctx: Ctx, alertId: string, ownerId: string) {
  const { a, scope } = await alertInScope(ctx, alertId);
  if (a.resolvedAt) throw new ConflictError("This exception is already resolved");
  if (!(await possibleOwners(scope.organisationId)).some((o) => o.userId === ownerId)) throw new ValidationError("Choose a manager or coordinator in your organisation");
  await db.$transaction(async (tx) => {
    await tx.rotaAlert.update({ where: { id: a.id }, data: { ownerId, ownerAssignedAt: new Date() } });
    if (ownerId !== ctx.userId) {
      await tx.notification.createMany({ data: [{ organisationId: scope.organisationId, userId: ownerId, type: "rota.exception.assigned", title: `You own an exception: ${a.message}`, body: a.message, reason: `${ctx.userName} gave you this exception to resolve.`, actionUrl: "/rota/exceptions?owner=" + ownerId, dueAt: a.deadline, dedupeKey: `exception-owner:${a.id}:${ownerId}` }], skipDuplicates: true });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.exception.owner", entityType: "RotaAlert", entityId: a.id, data: { ownerId } }, tx);
  });
}

/** Escalates to the organisation's care managers, in-app. Manual escalation needs a note; the tick escalates overdue ones itself. */
export async function escalateException(ctx: Ctx, alertId: string, note: string) {
  if (note.trim().length < 5) throw new ValidationError("Say why this needs a manager");
  const { a, scope } = await alertInScope(ctx, alertId);
  if (a.resolvedAt) throw new ConflictError("This exception is already resolved");
  if (a.escalatedAt) throw new ConflictError("This exception has already been escalated");
  await db.$transaction(async (tx) => {
    await escalate(tx, a, note.trim(), ctx.userId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.exception.escalated", entityType: "RotaAlert", entityId: a.id, data: { note: note.trim() } }, tx);
  });
}

async function escalate(tx: Prisma.TransactionClient, a: { id: string; organisationId: string; message: string; severity: AlertSeverity }, note: string, actorId: string | null) {
  const managers = await tx.membership.findMany({ where: { organisationId: a.organisationId, roles: { hasSome: ["CARE_MANAGER", "ORG_ADMIN"] }, user: { deactivatedAt: null } }, select: { userId: true } });
  await tx.rotaAlert.update({ where: { id: a.id }, data: { escalatedAt: new Date(), escalationState: "ESCALATED", escalationNote: note } });
  await tx.notification.createMany({
    data: managers.filter((m) => m.userId !== actorId).map((m) => ({ organisationId: a.organisationId, userId: m.userId, type: "rota.exception.escalated", title: `Escalated: ${a.message}`, body: note, reason: "You manage care delivery for this organisation.", actionUrl: "/rota/exceptions?state=open", dedupeKey: `exception-escalated:${a.id}:${m.userId}` })),
    skipDuplicates: true,
  });
}

/** Resolves an exception with what was done and, where there is one, the evidence. The record stays. */
export async function resolveException(ctx: Ctx, alertId: string, input: { resolution: string; evidenceNote?: string }) {
  if (input.resolution.trim().length < 3) throw new ValidationError("Say what was done");
  const { a, scope } = await alertInScope(ctx, alertId);
  if (a.resolvedAt) throw new ConflictError("This exception is already resolved");
  await db.$transaction(async (tx) => {
    await tx.rotaAlert.update({ where: { id: a.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: input.resolution.trim(), evidenceNote: input.evidenceNote?.trim() || null, escalationState: a.escalatedAt ? "RESOLVED_AFTER_ESCALATION" : a.escalationState } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.alert.resolved", entityType: "RotaAlert", entityId: a.id, data: { kind: a.kind, evidence: Boolean(input.evidenceNote?.trim()) } }, tx);
  });
}

/** Run with the call sweep: open exceptions past their deadline are escalated once, in-app. */
export async function escalateOverdueExceptions(now = new Date()) {
  const due = await db.rotaAlert.findMany({ where: { resolvedAt: null, escalatedAt: null, deadline: { lt: now } }, take: 500 });
  for (const a of due) {
    await db.$transaction((tx) => escalate(tx, a, `Not resolved by its deadline (${a.deadline?.toISOString()})`, null));
  }
  return due.length;
}

export const canWorkExceptions = (ctx: Ctx) => hasOrgPermission(ctx, "rota.edit");

/** Open and overdue exceptions the person can see, for the Rota Dashboard. Same rules as the register. */
export async function exceptionCounts(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const now = new Date();
  const f = filtersSchema.parse({});
  const [open, overdue] = await Promise.all([
    db.rotaAlert.count({ where: await visibleWhere(scope, { ...f, state: "open" }, now) }),
    db.rotaAlert.count({ where: await visibleWhere(scope, { ...f, state: "overdue" }, now) }),
  ]);
  return { open, overdue };
}
