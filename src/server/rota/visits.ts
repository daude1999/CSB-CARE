import { randomBytes } from "node:crypto";
import type { AssignmentSlot, Prisma, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate, londonMinute, londonToUtc } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { assignInTx, EligibilityError, isOverlapViolation, lockVisit, unassignInTx } from "./assign";
import { assertInScope, rotaScope, serviceUserWhere, type Scope } from "./scope";

type Tx = Prisma.TransactionClient;

/** A short human reference, unique per organisation (V-YYMMDD-XXXXX). */
export function visitReference(date: string) {
  return `V-${date.slice(2).replaceAll("-", "")}-${randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(5, "0").slice(-5)}`;
}

export interface VisitPatch {
  scheduledStart?: Date;
  scheduledEnd?: Date;
  callTypeId?: string;
  medicationRequired?: boolean;
  timeLocked?: boolean;
  alertOnLate?: boolean;
  carersRequired?: number;
  notes?: string | null;
}

/** Changes a scheduled visit. Every carer still on it is re-checked at the new time; a carer who cannot do it stops the change. */
export async function updateVisitInTx(tx: Tx, scope: Scope, actorId: string, visitId: string, patch: VisitPatch, opts: { source: string; lockVersion?: number; overrideLock?: boolean; keepAutomatic?: boolean }) {
  const v = await lockVisit(tx, scope, visitId);
  if (opts.lockVersion !== undefined && opts.lockVersion !== v.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
  if (v.status !== "SCHEDULED") throw new ValidationError(`A ${v.status.toLowerCase().replace("_", " ")} visit cannot be edited. Use an office correction instead.`);
  const start = patch.scheduledStart ?? v.scheduledStart;
  const end = patch.scheduledEnd ?? v.scheduledEnd;
  const timeChanged = start.getTime() !== v.scheduledStart.getTime() || end.getTime() !== v.scheduledEnd.getTime();
  if (timeChanged && v.timeLocked && !opts.overrideLock) throw new ValidationError("This visit's time is locked. Unlock it first.");
  if (end <= start) throw new ValidationError("The visit must end after it starts");
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw new ValidationError("A visit lasts at most 24 hours");
  if (patch.callTypeId && !(await tx.callType.findFirst({ where: { id: patch.callTypeId, organisationId: scope.organisationId } }))) throw new NotFoundError("Call type");
  const live = await tx.visitAssignment.findMany({ where: { visitId, removedAt: null }, include: { staff: { select: { displayName: true } } } });
  if (patch.carersRequired === 1 && live.some((a) => a.slot === "SECOND")) throw new ValidationError("Remove the second carer before making this a single-carer visit");

  if (timeChanged) {
    const careTaskIds = (await tx.visitTask.findMany({ where: { visitId }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
    for (const a of live) {
      const r = await eligibilityFor(tx, scope.organisationId, { staffId: a.staffId, start, end, slot: a.slot, visitId, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds }, { otherSlotStaffIds: live.filter((x) => x.id !== a.id).map((x) => x.staffId) });
      if (r.state === "NOT_ELIGIBLE") throw new EligibilityError(`${a.staff.displayName} cannot do the new time: ${r.blocking.map((b) => b.message).join("; ")}`, r);
    }
  }
  try {
    const updated = await tx.visit.update({
      where: { id: visitId },
      data: {
        scheduledStart: start,
        scheduledEnd: end,
        date: dbDate(londonDate(start)),
        callTypeId: patch.callTypeId,
        medicationRequired: patch.medicationRequired,
        timeLocked: patch.timeLocked,
        alertOnLate: patch.alertOnLate,
        carersRequired: patch.carersRequired,
        notes: patch.notes === undefined ? undefined : patch.notes,
        lockVersion: { increment: 1 },
        ...(opts.keepAutomatic ? {} : { manuallyChanged: true }),
      },
    });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId, type: "EDITED", actorId, data: { source: opts.source, fields: Object.keys(patch).filter((k) => patch[k as keyof VisitPatch] !== undefined), from: { start: v.scheduledStart, end: v.scheduledEnd }, to: { start, end } } } });
    await audit({ organisationId: scope.organisationId, actorId, action: "visit.updated", entityType: "Visit", entityId: visitId, data: { source: opts.source } }, tx);
    return updated;
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("A carer on this visit is already booked at the new time");
    throw e;
  }
}

export async function updateVisit(ctx: Ctx, visitId: string, lockVersion: number, patch: VisitPatch) {
  const scope = await rotaScope(ctx, "rota.edit");
  try {
    return await db.$transaction((tx) => updateVisitInTx(tx, scope, ctx.userId, visitId, patch, { source: "manual", lockVersion }));
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("A carer on this visit is already booked at the new time");
    throw e;
  }
}

const newVisitSchema = z.object({
  serviceUserId: z.string().min(1, "Choose a service user"),
  callTypeId: z.string().min(1, "Choose a call type"),
  date: z.string().refine(isIsoDate, "Choose a date"),
  startMinute: z.coerce.number().int().min(0).max(1439),
  durationMin: z.coerce.number().int().min(5).max(1440),
  carersRequired: z.coerce.number().int().min(1).max(2).default(1),
  medicationRequired: z.boolean().default(false),
  timeLocked: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
  publish: z.boolean().default(true),
});

/** A one-off visit outside the templates. */
export async function createVisit(ctx: Ctx, input: z.input<typeof newVisitSchema>) {
  const scope = await rotaScope(ctx, "rota.edit");
  const r = newVisitSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the visit");
  const d = r.data;
  return db.$transaction(async (tx) => {
    const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: d.serviceUserId } });
    if (!su) throw new NotFoundError("Service user");
    if (su.status !== "ACTIVE") throw new ValidationError("Visits can only be booked for people whose care is active");
    if (!(await tx.callType.findFirst({ where: { id: d.callTypeId, organisationId: scope.organisationId } }))) throw new NotFoundError("Call type");
    const start = londonToUtc(d.date, d.startMinute);
    const v = await tx.visit.create({
      data: {
        organisationId: scope.organisationId,
        reference: visitReference(d.date),
        serviceUserId: su.id,
        callTypeId: d.callTypeId,
        areaId: su.areaId,
        date: dbDate(d.date),
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + d.durationMin * 60000),
        carersRequired: d.carersRequired,
        medicationRequired: d.medicationRequired,
        timeLocked: d.timeLocked,
        notes: d.notes?.trim() || null,
        manuallyChanged: true,
        publishedAt: d.publish ? new Date() : null,
        createdById: ctx.userId,
      },
    });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: v.id, type: "CREATED", actorId: ctx.userId, toStatus: "SCHEDULED", data: { source: "manual" } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.created", entityType: "Visit", entityId: v.id }, tx);
    return v;
  });
}

async function transition(tx: Tx, scope: Scope, actorId: string, visitId: string, to: VisitStatus, reason: string, extra: Prisma.VisitUpdateInput = {}, lockVersion?: number) {
  const v = await lockVisit(tx, scope, visitId);
  if (lockVersion !== undefined && lockVersion !== v.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
  try {
    await tx.visit.update({ where: { id: visitId }, data: { status: to, statusChangedAt: new Date(), lockVersion: { increment: 1 }, ...extra } });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("Illegal visit transition")) throw new ValidationError(`A ${v.status.toLowerCase().replace("_", " ")} visit cannot become ${to.toLowerCase().replace("_", " ")}`);
    if (isOverlapViolation(e)) throw new ConflictError("A carer on this visit has since been booked elsewhere at this time. Change the carer first.");
    throw e;
  }
  await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId, type: "STATUS", fromStatus: v.status, toStatus: to, actorId, reason } });
  await audit({ organisationId: scope.organisationId, actorId, action: `visit.${to.toLowerCase()}`, entityType: "Visit", entityId: visitId, data: { from: v.status, reason } }, tx);
  return v;
}

export async function cancelVisitInTx(tx: Tx, scope: Scope, actorId: string, visitId: string, reason: string, lockVersion?: number) {
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for cancelling");
  return transition(tx, scope, actorId, visitId, "CANCELLED", reason.trim(), { cancelReason: reason.trim(), cancelledById: actorId, cancelledAt: new Date(), manuallyChanged: true }, lockVersion);
}

export async function cancelVisit(ctx: Ctx, visitId: string, reason: string, lockVersion?: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction((tx) => cancelVisitInTx(tx, scope, ctx.userId, visitId, reason, lockVersion));
}

/** Brings a cancelled or not-delivered visit back. Carers who were on it are re-checked by the database's double-booking guard. */
export async function reinstateVisit(ctx: Ctx, visitId: string, reason: string, lockVersion?: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for reinstating");
  return db.$transaction(async (tx) => {
    const v = await lockVisit(tx, scope, visitId);
    if (v.scheduledEnd < new Date()) throw new ValidationError("A visit in the past cannot be reinstated");
    return transition(tx, scope, ctx.userId, visitId, "SCHEDULED", reason.trim(), { cancelReason: null, cancelledById: null, cancelledAt: null, notDeliveredReason: null, manuallyChanged: true }, lockVersion);
  });
}

export async function setDoubleUp(ctx: Ctx, visitId: string, carersRequired: 1 | 2, lockVersion?: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction((tx) => updateVisitInTx(tx, scope, ctx.userId, visitId, { carersRequired }, { source: "manual", lockVersion }));
}

const moveSchema = z.object({
  visitId: z.string().min(1),
  slot: z.enum(["PRIMARY", "SECOND", "SHADOW"]),
  lockVersion: z.number().int().nonnegative().optional(),
  toDate: z.string().refine(isIsoDate, "Choose the day to move the visit to"),
  /** The carer who should do the visit after the move; null leaves the slot empty. */
  staffId: z.string().min(1).nullable(),
  acceptWarnings: z.boolean().default(false),
});

/**
 * The planner's drag to another day (and optionally another carer): one visit moves, at the same time of day, in one
 * transaction. The dragged carer leaves the slot if someone else is to do it, the new time is checked for everyone
 * still on the visit, and the new carer goes through the shared assignment path. Only this visit changes; its
 * recurring template is untouched (the visit is marked as changed by hand so a later template update leaves it alone).
 */
export async function moveVisit(ctx: Ctx, raw: z.input<typeof moveSchema> | Record<string, unknown>) {
  const r = moveSchema.safeParse(raw);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the move");
  const d = r.data;
  const scope = await rotaScope(ctx, "rota.edit");
  try {
    return await db.$transaction(
      async (tx) => {
        const v = await lockVisit(tx, scope, d.visitId);
        if (d.lockVersion !== undefined && d.lockVersion !== v.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
        if (v.status !== "SCHEDULED") throw new ValidationError(`A ${v.status.toLowerCase().replace("_", " ")} visit cannot be moved to another day`);
        const fromDate = londonDate(v.scheduledStart);
        if (d.toDate !== fromDate && v.timeLocked) throw new ValidationError("This visit's time is locked. Unlock it before moving it to another day.");
        if (d.toDate !== fromDate && londonToUtc(d.toDate, londonMinute(v.scheduledStart)) < new Date()) throw new ValidationError("A visit cannot be moved into the past");
        const current = await tx.visitAssignment.findFirst({ where: { visitId: v.id, slot: d.slot, removedAt: null } });
        if (current && current.staffId !== d.staffId) await unassignInTx(tx, scope, ctx.userId, { visitId: v.id, slot: d.slot, reason: "Moved in the planner" });
        if (d.toDate !== fromDate) {
          const start = londonToUtc(d.toDate, londonMinute(v.scheduledStart));
          await updateVisitInTx(tx, scope, ctx.userId, v.id, { scheduledStart: start, scheduledEnd: new Date(start.getTime() + (v.scheduledEnd.getTime() - v.scheduledStart.getTime())) }, { source: "planner" });
        }
        if (d.staffId && d.staffId !== current?.staffId) await assignInTx(tx, scope, ctx.userId, { visitId: v.id, slot: d.slot, staffId: d.staffId, acceptWarnings: d.acceptWarnings }, { source: "planner" });
        return tx.visit.findUniqueOrThrow({ where: { id: v.id } });
      },
      { isolationLevel: "ReadCommitted", timeout: 15_000 },
    );
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("A carer is already booked at that time. Reload and choose someone else.");
    throw e;
  }
}

export type BulkAction =
  | { kind: "assign"; staffId: string; slot: AssignmentSlot; acceptWarnings?: boolean }
  | { kind: "unassign"; slot: AssignmentSlot; reason: string }
  | { kind: "cancel"; reason: string }
  | { kind: "nudge"; minutes: number }
  | { kind: "lock"; locked: boolean }
  | { kind: "publish" }
  | { kind: "activate"; reason: string }
  | { kind: "editTime"; startMinute: number }
  | { kind: "editDuration"; minutes: number }
  | { kind: "editService"; callTypeId: string }
  | { kind: "alert"; on: boolean }
  | { kind: "doubleUp"; carers: 1 | 2 };

export interface BulkResult {
  visitId: string;
  reference: string;
  ok: boolean;
  message?: string;
}

/**
 * Applies one action to many visits. Each visit is validated and saved in its own transaction, so one refusal never
 * undoes the others, and the result lists exactly what succeeded and what was refused and why.
 */
export async function bulkVisits(ctx: Ctx, visitIds: string[], action: BulkAction): Promise<BulkResult[]> {
  const scope = await rotaScope(ctx, action.kind === "publish" ? "rota.build" : "rota.edit");
  if (!visitIds.length) throw new ValidationError("Select at least one visit");
  if (visitIds.length > 500) throw new ValidationError("Select at most 500 visits at a time");
  if (action.kind === "nudge" && (!Number.isInteger(action.minutes) || action.minutes === 0 || Math.abs(action.minutes) > 240)) throw new ValidationError("Move times by 1 to 240 minutes");
  if (action.kind === "editTime" && (!Number.isInteger(action.startMinute) || action.startMinute < 0 || action.startMinute > 1439)) throw new ValidationError("Enter a start time");
  if (action.kind === "editDuration" && (!Number.isInteger(action.minutes) || action.minutes < 5 || action.minutes > 1440)) throw new ValidationError("A visit lasts 5 minutes to 24 hours");
  if (action.kind === "activate" && action.reason.trim().length < 3) throw new ValidationError("Give a reason for activating");
  if (action.kind === "editService" && !(await db.callType.findFirst({ where: { id: action.callTypeId, organisationId: scope.organisationId, active: true } }))) throw new NotFoundError("Service call");
  const refs = new Map((await db.visit.findMany({ where: { id: { in: visitIds }, organisationId: scope.organisationId }, select: { id: true, reference: true } })).map((v) => [v.id, v.reference]));
  const results: BulkResult[] = [];
  for (const visitId of visitIds) {
    const reference = refs.get(visitId);
    if (!reference) {
      results.push({ visitId, reference: "—", ok: false, message: "Visit not found" });
      continue;
    }
    try {
      await db.$transaction(async (tx) => {
        switch (action.kind) {
          case "assign":
            await assignInTx(tx, scope, ctx.userId, { visitId, slot: action.slot, staffId: action.staffId, acceptWarnings: action.acceptWarnings }, { source: "bulk" });
            break;
          case "unassign":
            await unassignInTx(tx, scope, ctx.userId, { visitId, slot: action.slot, reason: action.reason });
            break;
          case "cancel":
            await cancelVisitInTx(tx, scope, ctx.userId, visitId, action.reason);
            break;
          case "nudge": {
            const v = await lockVisit(tx, scope, visitId);
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { scheduledStart: new Date(v.scheduledStart.getTime() + action.minutes * 60000), scheduledEnd: new Date(v.scheduledEnd.getTime() + action.minutes * 60000) }, { source: "bulk" });
            break;
          }
          case "lock":
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { timeLocked: action.locked }, { source: "bulk", overrideLock: true });
            break;
          case "publish": {
            const v = await lockVisit(tx, scope, visitId);
            if (v.publishedAt) return;
            await tx.visit.update({ where: { id: visitId }, data: { publishedAt: new Date(), lockVersion: { increment: 1 } } });
            await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId, type: "PUBLISHED", actorId: ctx.userId } });
            break;
          }
          case "activate": {
            const v = await lockVisit(tx, scope, visitId);
            if (v.scheduledEnd < new Date()) throw new ValidationError("A visit in the past cannot be activated");
            await transition(tx, scope, ctx.userId, visitId, "SCHEDULED", action.reason.trim(), { cancelReason: null, cancelledById: null, cancelledAt: null, notDeliveredReason: null, manuallyChanged: true });
            break;
          }
          case "editTime": {
            const v = await lockVisit(tx, scope, visitId);
            const start = londonToUtc(londonDate(v.scheduledStart), action.startMinute);
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { scheduledStart: start, scheduledEnd: new Date(start.getTime() + (v.scheduledEnd.getTime() - v.scheduledStart.getTime())) }, { source: "bulk" });
            break;
          }
          case "editDuration": {
            const v = await lockVisit(tx, scope, visitId);
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { scheduledEnd: new Date(v.scheduledStart.getTime() + action.minutes * 60000) }, { source: "bulk" });
            break;
          }
          case "editService":
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { callTypeId: action.callTypeId }, { source: "bulk" });
            break;
          case "alert":
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { alertOnLate: action.on }, { source: "bulk" });
            break;
          case "doubleUp":
            await updateVisitInTx(tx, scope, ctx.userId, visitId, { carersRequired: action.carers }, { source: "bulk" });
            break;
        }
      });
      results.push({ visitId, reference, ok: true });
    } catch (e) {
      results.push({ visitId, reference, ok: false, message: isOverlapViolation(e) ? "A carer is already booked at that time" : (e as Error).message });
    }
  }
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: `visit.bulk.${action.kind}`, entityType: "Visit", entityId: "bulk", data: { requested: visitIds.length, succeeded: results.filter((r) => r.ok).length } });
  return results;
}

/** One visit with everything the visit page shows, scoped to the caller. */
export async function getVisit(ctx: Ctx, visitId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const v = await db.visit.findUnique({
    where: { id: visitId },
    include: {
      serviceUser: { select: { id: true, firstName: true, lastName: true, reference: true, postcode: true, carerGenderPreference: true, areaId: true } },
      callType: true,
      area: true,
      runRoute: true,
      assignments: { orderBy: { assignedAt: "asc" }, include: { staff: { select: { id: true, displayName: true, jobTitle: true } } } },
      tasks: { orderBy: { position: "asc" }, include: { outcomes: { orderBy: { at: "desc" } } } },
      clocks: { orderBy: { createdAt: "asc" } },
      visitNotes: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  assertInScope(scope, v, "Visit");
  return v;
}

export function dayRange(date: string) {
  return { gte: dbDate(date), lte: dbDate(date) };
}
