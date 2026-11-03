import { reconcileMedicationLead } from "@/server/care/medication-lead";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, VisitStatus } from "@prisma/client";
import { MAX_CARERS, parsePlace, placeData, placeKey, placeLabel, placeNumber, type PlaceKey } from "@/lib/carer-places";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { dbDate, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonMinute, londonToUtc } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { assignInTx, EligibilityError, isOverlapViolation, lockVisit, unassignInTx } from "./assign";
import { checkCompleteInput, completeVisitInTx } from "./complete-calls";
import { assertInScope, rotaScope, serviceUserWhere, visitWhere, type Scope } from "./scope";

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
  if (patch.carersRequired !== undefined) {
    if (!Number.isInteger(patch.carersRequired) || patch.carersRequired < 1 || patch.carersRequired > MAX_CARERS) throw new ValidationError(`A visit needs 1 to ${MAX_CARERS} carers`);
    // Lowering the number never removes anyone silently: the coordinator takes the carers off the higher places first.
    const beyond = live.filter((a) => (placeNumber(placeKey(a)) ?? 0) > patch.carersRequired!).sort((a, b) => a.position - b.position);
    if (beyond.length) {
      const who = beyond.map((a) => `${a.staff.displayName} (${placeLabel(placeKey(a))})`).join(", ");
      throw new ValidationError(patch.carersRequired === 1 && beyond.length === 1 && beyond[0]!.slot === "SECOND" ? "Remove the second carer before making this a single-carer visit" : `Remove ${who} before lowering this visit to ${patch.carersRequired} carer${patch.carersRequired === 1 ? "" : "s"}`);
    }
  }
  // One visit per template and day (a database rule that keeps rebuilds from duplicating). Moving a recurring visit onto
  // a day that already has its visit from the same template would break it, so say so instead of failing.
  const newDate = londonDate(start);
  if (newDate !== fromDbDate(v.date) && start < new Date()) throw new ValidationError("A visit cannot be moved into the past");
  if (v.templateId && newDate !== fromDbDate(v.date)) {
    const twin = await tx.visit.findFirst({ where: { templateId: v.templateId, date: dbDate(newDate), id: { not: v.id } }, select: { reference: true, status: true } });
    if (twin) throw new ConflictError(`This service user already has this regular call on ${fmtLondonDate(newDate, { weekday: "long", day: "numeric", month: "long" })} (${twin.reference}${twin.status === "CANCELLED" ? ", cancelled" : ""}). Change that visit instead, or cancel this one.`);
  }

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
    // A visit newly marked for medication support, or moved to a time when a medicine is due, may now need a lead.
    if (patch.medicationRequired || timeChanged) await reconcileMedicationLead(tx, scope.organisationId, visitId, actorId);
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
  carersRequired: z.coerce.number({ invalid_type_error: "Enter how many carers are needed" }).int("Enter a whole number of carers").min(1, "A visit needs at least one carer").max(MAX_CARERS, `A visit can need at most ${MAX_CARERS} carers`).default(1),
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

/**
 * Cancels a visit. `charge` is the office's decision: true charges the cancellation, false does not, and null (used when
 * care ends or the person is away) leaves it to the funder's short-notice rule.
 */
export async function cancelVisitInTx(tx: Tx, scope: Scope, actorId: string, visitId: string, reason: string, lockVersion?: number, charge: boolean | null = null) {
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for cancelling");
  const why = charge === null ? reason.trim() : `${reason.trim()} (${charge ? "charged" : "not charged"})`;
  return transition(tx, scope, actorId, visitId, "CANCELLED", why, { cancelReason: reason.trim(), cancelledById: actorId, cancelledAt: new Date(), cancellationCharge: charge, manuallyChanged: true }, lockVersion);
}

export async function cancelVisit(ctx: Ctx, visitId: string, reason: string, lockVersion?: number, charge: boolean | null = null) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction((tx) => cancelVisitInTx(tx, scope, ctx.userId, visitId, reason, lockVersion, charge));
}

/** Brings a cancelled or not-delivered visit back. Carers who were on it are re-checked by the database's double-booking guard. */
export async function reinstateVisit(ctx: Ctx, visitId: string, reason: string, lockVersion?: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for reinstating");
  return db.$transaction((tx) => reinstateInTx(tx, scope, ctx.userId, visitId, reason, lockVersion));
}

/** Changes how many carers a visit needs. Carers already booked stay; lowering is refused while a higher place is filled. */
export async function setCarersRequired(ctx: Ctx, visitId: string, carersRequired: number, lockVersion?: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction((tx) => updateVisitInTx(tx, scope, ctx.userId, visitId, { carersRequired }, { source: "manual", lockVersion }));
}

/** Older name, kept for callers that only switch between one and two carers. */
export const setDoubleUp = setCarersRequired;

const moveSchema = z.object({
  visitId: z.string().min(1),
  slot: z.string().transform((v, c) => parsePlace(v) ?? (c.addIssue({ code: "custom", message: "Choose a carer place" }), z.NEVER)),
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
        const current = await tx.visitAssignment.findFirst({ where: { visitId: v.id, ...placeData(d.slot), removedAt: null } });
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
  | { kind: "assign"; staffId: string; slot: PlaceKey; acceptWarnings?: boolean }
  | { kind: "unassign"; slot: PlaceKey; reason: string }
  | { kind: "cancel"; reason: string; charge: boolean }
  | { kind: "nudge"; minutes: number }
  | { kind: "lock"; locked: boolean }
  | { kind: "publish" }
  | { kind: "activate"; reason: string }
  | { kind: "editTime"; startMinute: number }
  | { kind: "editDuration"; minutes: number }
  | { kind: "editService"; callTypeId: string }
  | { kind: "alert"; on: boolean }
  /** Change Carers Needed: sets the number of carers (1 to MAX_CARERS). */
  | { kind: "doubleUp"; carers: number }
  /** Convert To Double Up (one carer to two) or Revert Double Up To Single (two to one). */
  | { kind: "convert"; to: "double" | "single" }
  /** Complete Calls: the office confirms the care was delivered. Actual times and reviewed versions are per visit. */
  | { kind: "complete"; reason: string; verifiedBy: string; confirmed: boolean; perVisit?: Record<string, { actualStart?: string; actualEnd?: string; lockVersion?: number }> };

/** updated: the visit changed. unchanged: it was already as asked. refused: a rule stopped it (the reason says which). error: something unexpected; nothing changed. */
export type BulkOutcome = "updated" | "unchanged" | "refused" | "error";

export interface BulkResult {
  visitId: string;
  reference: string;
  /** True when nothing went wrong (updated or unchanged). */
  ok: boolean;
  outcome: BulkOutcome;
  message?: string;
  warnings?: string[];
}

/** The permission each bulk action needs. Publishing is part of building the rota; Complete Calls is a record correction. */
export function bulkPermission(kind: BulkAction["kind"]) {
  return kind === "publish" ? ("rota.build" as const) : kind === "complete" ? ("rota.clockCorrect" as const) : ("rota.edit" as const);
}

type Step = { changed: boolean; message?: string; warnings?: string[] };
const same = (message: string): Step => ({ changed: false, message });

class DryRun extends Error {
  constructor(readonly step: Step) {
    super("dry run");
  }
}

/** Brings a cancelled or not-delivered visit back to scheduled. Shared by the visit page's Reinstate and bulk Activate. */
async function reinstateInTx(tx: Tx, scope: Scope, actorId: string, visitId: string, reason: string, lockVersion?: number) {
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for reinstating");
  const v = await lockVisit(tx, scope, visitId);
  if (v.scheduledEnd < new Date()) throw new ValidationError("A visit in the past cannot be reinstated");
  return transition(tx, scope, actorId, visitId, "SCHEDULED", reason.trim(), { cancelReason: null, cancelledById: null, cancelledAt: null, cancellationCharge: null, notDeliveredReason: null, manuallyChanged: true }, lockVersion);
}

const STATUS_WORD: Record<VisitStatus, string> = { SCHEDULED: "scheduled", IN_PROGRESS: "in progress", COMPLETED: "completed", MISSED: "missed", CANCELLED: "cancelled", NOT_DELIVERED: "not delivered" };

/** One visit, one action, inside the caller's transaction. Checks for "already done" before writing anything. */
async function bulkStep(tx: Tx, scope: Scope, actorId: string, visitId: string, action: BulkAction, preview: boolean): Promise<Step> {
  const v = await lockVisit(tx, scope, visitId);
  const edit = (patch: VisitPatch, overrideLock = false) => updateVisitInTx(tx, scope, actorId, visitId, patch, { source: "bulk", overrideLock });
  switch (action.kind) {
    case "assign": {
      const current = await tx.visitAssignment.findFirst({ where: { visitId, ...placeData(action.slot), removedAt: null }, select: { staffId: true } });
      if (current?.staffId === action.staffId) return same(`Already booked as ${placeLabel(action.slot)}`);
      await assignInTx(tx, scope, actorId, { visitId, slot: action.slot, staffId: action.staffId, acceptWarnings: action.acceptWarnings }, { source: "bulk" });
      return { changed: true };
    }
    case "unassign": {
      const current = await tx.visitAssignment.findFirst({ where: { visitId, ...placeData(action.slot), removedAt: null }, select: { id: true } });
      if (!current) return same(`Nobody is booked as ${placeLabel(action.slot)}`);
      await unassignInTx(tx, scope, actorId, { visitId, slot: action.slot, reason: action.reason });
      return { changed: true };
    }
    case "cancel":
      if (v.status === "CANCELLED") return same("Already cancelled");
      if (v.status !== "SCHEDULED" && v.status !== "MISSED") throw new ValidationError(`A ${STATUS_WORD[v.status]} visit cannot be cancelled`);
      await cancelVisitInTx(tx, scope, actorId, visitId, action.reason, undefined, action.charge);
      return { changed: true };
    case "activate":
      if (v.status === "SCHEDULED") return same("Already active (scheduled)");
      if (v.status === "MISSED") throw new ValidationError("A missed visit cannot be activated. If the care was delivered, use Complete Calls.");
      if (v.status === "COMPLETED" || v.status === "IN_PROGRESS") throw new ValidationError(`A ${STATUS_WORD[v.status]} visit cannot be activated`);
      if (v.scheduledEnd < new Date()) throw new ValidationError("A visit in the past cannot be activated. Activate is for future visits; use Complete Calls only if the care was delivered.");
      await reinstateInTx(tx, scope, actorId, visitId, action.reason);
      return { changed: true };
    case "lock":
      if (v.timeLocked === action.locked) return same(action.locked ? "Time already locked" : "Time already unlocked");
      await edit({ timeLocked: action.locked }, true);
      return { changed: true };
    case "alert":
      if (v.alertOnLate === action.on) return same(action.on ? "Late alert already on" : "Late alert already off");
      await edit({ alertOnLate: action.on });
      return { changed: true };
    case "editTime": {
      const start = londonToUtc(londonDate(v.scheduledStart), action.startMinute);
      if (start.getTime() === v.scheduledStart.getTime()) return same(`Already starts at ${fmtTime(start)}`);
      await edit({ scheduledStart: start, scheduledEnd: new Date(start.getTime() + (v.scheduledEnd.getTime() - v.scheduledStart.getTime())) });
      return { changed: true };
    }
    case "editDuration": {
      if (v.scheduledEnd.getTime() - v.scheduledStart.getTime() === action.minutes * 60000) return same(`Already ${action.minutes} minutes`);
      await edit({ scheduledEnd: new Date(v.scheduledStart.getTime() + action.minutes * 60000) });
      return { changed: true };
    }
    case "editService":
      if (v.callTypeId === action.callTypeId) return same("Already this service call");
      await edit({ callTypeId: action.callTypeId });
      return { changed: true };
    case "nudge":
      await edit({ scheduledStart: new Date(v.scheduledStart.getTime() + action.minutes * 60000), scheduledEnd: new Date(v.scheduledEnd.getTime() + action.minutes * 60000) });
      return { changed: true };
    case "doubleUp":
      if (v.carersRequired === action.carers) return same(`Already needs ${action.carers} carer${action.carers === 1 ? "" : "s"}`);
      await edit({ carersRequired: action.carers });
      return { changed: true };
    case "convert": {
      const want = action.to === "double" ? 2 : 1;
      if (v.carersRequired === want) return same(want === 2 ? "Already a double-up" : "Already a single-carer visit");
      if (v.carersRequired > 2) throw new ValidationError(`This visit needs ${v.carersRequired} carers. Use Change Carers Needed instead.`);
      await edit({ carersRequired: want });
      return { changed: true };
    }
    case "publish": {
      if (v.status === "CANCELLED" || v.status === "NOT_DELIVERED") throw new ValidationError(`A ${STATUS_WORD[v.status]} visit is not sent to carers`);
      if (v.publishedAt) return same("Already published to carers");
      if (preview) return { changed: true };
      await tx.visit.update({ where: { id: visitId }, data: { publishedAt: new Date(), lockVersion: { increment: 1 } } });
      await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId, type: "PUBLISHED", actorId, data: { source: "bulk" } } });
      await audit({ organisationId: scope.organisationId, actorId, action: "visit.published", entityType: "Visit", entityId: visitId, data: { source: "bulk" } }, tx);
      return { changed: true };
    }
    case "complete": {
      const per = action.perVisit?.[visitId] ?? {};
      return completeVisitInTx(tx, scope, actorId, visitId, { reason: action.reason, verifiedBy: action.verifiedBy, confirmed: action.confirmed, ...per }, { preview });
    }
  }
}

const fmtTime = (d: Date) => `${String(Math.floor(londonMinute(d) / 60)).padStart(2, "0")}:${String(londonMinute(d) % 60).padStart(2, "0")}`;

/**
 * Applies one action to many visits. Each visit is checked and saved in its own transaction, so a refusal never undoes
 * or half-changes another visit, and the result says exactly which visits changed, which were already as asked, which
 * were refused and why. With `preview` every visit is run through the same rules and rolled back, for the review step.
 */
export async function bulkVisits(ctx: Ctx, visitIds: string[], action: BulkAction, opts: { preview?: boolean } = {}): Promise<BulkResult[]> {
  const scope = await rotaScope(ctx, bulkPermission(action.kind));
  const ids = [...new Set(visitIds.filter(Boolean))];
  if (!ids.length) throw new ValidationError("Select at least one visit");
  if (ids.length > 500) throw new ValidationError("Select at most 500 visits at a time");
  if (action.kind === "nudge" && (!Number.isInteger(action.minutes) || action.minutes === 0 || Math.abs(action.minutes) > 240)) throw new ValidationError("Move times by 1 to 240 minutes");
  if (action.kind === "editTime" && (!Number.isInteger(action.startMinute) || action.startMinute < 0 || action.startMinute > 1439)) throw new ValidationError("Enter a start time");
  if (action.kind === "editDuration" && (!Number.isInteger(action.minutes) || action.minutes < 5 || action.minutes > 1440)) throw new ValidationError("A visit lasts 5 minutes to 24 hours");
  if (action.kind === "doubleUp" && (!Number.isInteger(action.carers) || action.carers < 1 || action.carers > MAX_CARERS)) throw new ValidationError(`Choose 1 to ${MAX_CARERS} carers`);
  if (action.kind === "activate" && action.reason.trim().length < 3) throw new ValidationError("Give a reason for activating");
  if (action.kind === "cancel" && action.reason.trim().length < 3) throw new ValidationError("Give a reason for cancelling");
  if (action.kind === "unassign" && action.reason.trim().length < 3) throw new ValidationError("Give a reason for removing the carer");
  if (action.kind === "complete") checkCompleteInput(action, { preview: opts.preview });
  if (action.kind === "editService" && !(await db.callType.findFirst({ where: { id: action.callTypeId, organisationId: scope.organisationId, active: true } }))) throw new NotFoundError("Service call");
  if (action.kind === "assign" && !(await db.staffMember.findFirst({ where: { id: action.staffId, organisationId: scope.organisationId }, select: { id: true } }))) throw new NotFoundError("Carer");
  // Only visits the caller may see are named; anything else is reported without its reference.
  const refs = new Map((await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: ids } }] }, select: { id: true, reference: true } })).map((v) => [v.id, v.reference]));
  const results: BulkResult[] = [];
  for (const visitId of ids) {
    const reference = refs.get(visitId);
    if (!reference) {
      results.push({ visitId, reference: "—", ok: false, outcome: "refused", message: "Visit not found, or outside your branches" });
      continue;
    }
    try {
      let step: Step;
      try {
        step = await db.$transaction(
          async (tx) => {
            const s = await bulkStep(tx, scope, ctx.userId, visitId, action, !!opts.preview);
            if (opts.preview) throw new DryRun(s);
            return s;
          },
          { isolationLevel: "ReadCommitted", timeout: 15_000 },
        );
      } catch (e) {
        if (e instanceof DryRun) step = e.step;
        else throw e;
      }
      results.push({ visitId, reference, ok: true, outcome: step.changed ? "updated" : "unchanged", message: step.message, warnings: step.warnings?.length ? step.warnings : undefined });
    } catch (e) {
      if (e instanceof AppError) results.push({ visitId, reference, ok: false, outcome: "refused", message: e.message });
      else if (isOverlapViolation(e)) results.push({ visitId, reference, ok: false, outcome: "refused", message: "A carer on this visit is already booked at that time" });
      else {
        logger.error({ err: (e as Error).message, visitId, action: action.kind }, "bulk visit action failed");
        results.push({ visitId, reference, ok: false, outcome: "error", message: "Unexpected error. Nothing was changed on this visit. The error has been logged." });
      }
    }
  }
  if (opts.preview) return results;

  const count = (o: BulkOutcome) => results.filter((r) => r.outcome === o).length;
  const updated = results.filter((r) => r.outcome === "updated");
  // Publishing tells the booked carers in the app (the bell), as publishing a rota build does. No email or text is sent.
  if (action.kind === "publish" && updated.length) {
    const carers = await db.visitAssignment.findMany({ where: { visitId: { in: updated.map((r) => r.visitId) }, removedAt: null }, select: { staff: { select: { userId: true } } } });
    const users = [...new Set(carers.map((c) => c.staff.userId).filter((x): x is string => !!x))];
    const today = londonDate();
    const batch = createHash("sha1").update(updated.map((r) => r.visitId).sort().join(",")).digest("hex").slice(0, 16);
    if (users.length) await db.notification.createMany({ data: users.map((userId) => ({ organisationId: scope.organisationId, userId, type: "rota.published", title: "New visits have been published to you", body: "Open My visits to see and acknowledge them.", reason: "You are booked on visits the office has just published.", actionUrl: "/carer", dedupeKey: `rota-published-bulk:${today}:${userId}:${batch}` })), skipDuplicates: true });
  }
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: `visit.bulk.${action.kind}`, entityType: "Visit", entityId: "bulk", data: { requested: ids.length, updated: count("updated"), unchanged: count("unchanged"), refused: count("refused"), errors: count("error"), visitIds: updated.map((r) => r.visitId) } });
  return results;
}

/** What the review step shows for each selected visit, next to what the action would do to it. */
export interface BulkReviewRow extends BulkResult {
  serviceUser: string;
  date: string;
  time: string;
  status: VisitStatus;
  carers: string;
  lockVersion: number;
  published: boolean;
}

/** Runs the action on every selected visit through the real rules and rolls it all back, so the review is exact. */
export async function previewBulkVisits(ctx: Ctx, visitIds: string[], action: BulkAction): Promise<BulkReviewRow[]> {
  const scope = await rotaScope(ctx, bulkPermission(action.kind));
  const results = await bulkVisits(ctx, visitIds, action, { preview: true });
  const rows = await db.visit.findMany({
    where: { AND: [visitWhere(scope), { id: { in: results.map((r) => r.visitId) } }] },
    select: { id: true, scheduledStart: true, scheduledEnd: true, status: true, carersRequired: true, lockVersion: true, publishedAt: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } },
  });
  const byId = new Map(rows.map((v) => [v.id, v]));
  return results.map((r) => {
    const v = byId.get(r.visitId);
    return {
      ...r,
      serviceUser: v ? `${v.serviceUser.preferredName ?? v.serviceUser.firstName} ${v.serviceUser.lastName}` : "—",
      date: v ? londonDate(v.scheduledStart) : "",
      time: v ? `${fmtTime(v.scheduledStart)}–${fmtTime(v.scheduledEnd)}` : "",
      status: v?.status ?? "SCHEDULED",
      carers: v ? `${v.assignments.length}/${v.carersRequired}` : "",
      lockVersion: v?.lockVersion ?? 0,
      published: !!v?.publishedAt,
    };
  });
}

/** One visit with everything the visit page shows, scoped to the caller. */
export async function getVisit(ctx: Ctx, visitId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const v = await db.visit.findUnique({
    where: { id: visitId },
    include: {
      serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, postcode: true, carerGenderPreference: true, riskLevel: true, areaId: true, branchId: true } },
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
