import type { ClockKind, ClockMethod, Prisma, RotaSettings, Visit, VisitClock, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate, londonDate, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { readinessFor } from "@/server/readiness";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { raiseAlert } from "@/server/workforce/impact";
import { myStaff } from "@/server/workforce/link";
import { lockVisit } from "./assign";
import { rotaScope, type Scope } from "./scope";
import { rotaSettings } from "./settings";

type Tx = Prisma.TransactionClient;

/**
 * Attendance: clocking in and out of visits. Clock rows are append-only (database trigger); a correction is a new
 * row that supersedes an earlier one, with a reason. Times are the server's clock for carers and a stated time for
 * office entries. No location, NFC or offline evidence is collected, and nothing here claims otherwise.
 */

/** Clock rows still in force: anything another row supersedes is history only. */
export function effectiveClocks<T extends Pick<VisitClock, "id" | "supersedesId">>(clocks: T[]): T[] {
  const superseded = new Set(clocks.map((c) => c.supersedesId).filter((x): x is string => !!x));
  return clocks.filter((c) => !superseded.has(c.id));
}

/** How far before the start a carer may clock in when early clock-in is not blocked, and how long after the end. */
const OPEN_BEFORE_MIN = 180;
const OPEN_AFTER_MIN = 360;

interface ClockInput {
  staffId: string;
  kind: ClockKind;
  at: Date;
  method: ClockMethod;
  actorId: string;
  nonce?: string | null;
  reason?: string | null;
  note?: string | null;
  supersedesId?: string | null;
}

/** The single path every clock entry takes. Checks the order of events for that carer, then moves the visit on. */
async function applyClock(tx: Tx, scope: Scope, visit: Visit, settings: RotaSettings, c: ClockInput) {
  if (["CANCELLED", "NOT_DELIVERED"].includes(visit.status)) throw new ValidationError(`This visit is ${visit.status === "CANCELLED" ? "cancelled" : "marked not delivered"}`);
  const assigned = await tx.visitAssignment.findFirst({ where: { visitId: visit.id, staffId: c.staffId, removedAt: null } });
  if (!assigned) throw new ValidationError("That carer is not booked on this visit");

  const all = await tx.visitClock.findMany({ where: { visitId: visit.id }, orderBy: { at: "asc" } });
  let live = effectiveClocks(all);
  if (c.supersedesId) {
    const old = live.find((x) => x.id === c.supersedesId);
    if (!old) throw new ValidationError("The record being corrected has already been replaced");
    if (old.staffId !== c.staffId || old.kind !== c.kind) throw new ValidationError("A correction must be for the same carer and the same clock type");
    live = live.filter((x) => x.id !== old.id);
  }
  const mine = live.filter((x) => x.staffId === c.staffId);
  const myIn = mine.find((x) => x.kind === "IN");
  const myOut = mine.find((x) => x.kind === "OUT");
  if (c.kind === "IN") {
    if (myIn) throw new ConflictError("Already clocked in to this visit");
    if (myOut && myOut.at <= c.at) throw new ValidationError("Clock-in must be before the clock-out");
  } else {
    if (!myIn) throw new ValidationError("Clock in first");
    if (myOut) throw new ConflictError("Already clocked out of this visit");
    if (c.at <= myIn.at) throw new ValidationError("Clock-out must be after the clock-in");
  }

  let short = false;
  if (c.kind === "OUT" && myIn) {
    const planned = visit.scheduledEnd.getTime() - visit.scheduledStart.getTime();
    short = c.at.getTime() - myIn.at.getTime() < (planned * settings.shortVisitPercent) / 100;
    const needNote = settings.mandatoryClockOutNote || (short && settings.requireNoteOnShortVisit);
    if (needNote && (c.note?.trim().length ?? 0) < 3) throw new ValidationError(short ? "This visit was shorter than planned. Add a note saying why." : "Add a note before clocking out");
  }

  let row: VisitClock;
  try {
    row = await tx.visitClock.create({ data: { organisationId: scope.organisationId, visitId: visit.id, staffId: c.staffId, kind: c.kind, at: c.at, method: c.method, nonce: c.nonce || null, recordedById: c.actorId, reason: c.reason?.trim() || null, supersedesId: c.supersedesId ?? null } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ConflictError("This was already recorded");
    throw e;
  }
  if (c.note?.trim()) await tx.visitNote.create({ data: { organisationId: scope.organisationId, visitId: visit.id, authorUserId: c.actorId, staffId: c.staffId, category: short ? "SHORT_VISIT" : "CLOCK_OUT", text: c.note.trim() } });

  // Work out where the visit now stands from the clocks in force.
  const now = [...live, row];
  const ins = now.filter((x) => x.kind === "IN");
  const outs = now.filter((x) => x.kind === "OUT");
  const everyoneOut = ins.length > 0 && ins.every((i) => outs.some((o) => o.staffId === i.staffId));
  const actualStart = ins.length ? new Date(Math.min(...ins.map((x) => x.at.getTime()))) : null;
  const actualEnd = everyoneOut ? new Date(Math.max(...outs.map((x) => x.at.getTime()))) : null;
  let status: VisitStatus = visit.status;
  if (ins.length && (status === "SCHEDULED" || status === "MISSED")) status = "IN_PROGRESS";
  const steps: VisitStatus[] = [];
  if (status !== visit.status) steps.push(status);
  if (everyoneOut && status === "IN_PROGRESS") steps.push("COMPLETED");
  // The state machine allows each step on its own, so apply them in order.
  for (const s of steps) {
    await tx.visit.update({ where: { id: visit.id }, data: { status: s, statusChangedAt: new Date(), actualStart, ...(s === "COMPLETED" ? { actualEnd } : {}), lockVersion: { increment: 1 } } });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: visit.id, type: "STATUS", fromStatus: s === "COMPLETED" && steps.length > 1 ? steps[0] : visit.status, toStatus: s, actorId: c.actorId, data: { source: `clock.${c.method.toLowerCase()}` } } });
  }
  if (!steps.length) await tx.visit.update({ where: { id: visit.id }, data: { actualStart, actualEnd: visit.status === "COMPLETED" ? (actualEnd ?? undefined) : undefined, lockVersion: { increment: 1 } } });
  await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: visit.id, type: "CLOCK", actorId: c.actorId, reason: c.reason?.trim() || null, data: { kind: c.kind, staffId: c.staffId, method: c.method, at: c.at.toISOString(), corrects: c.supersedesId ?? null } } });

  // An arrival answers the late and missed alerts; leaving answers the overrun alert. The alerts stay on record.
  const answered = c.kind === "IN" ? ["LATE", "MISSED"] : ["OVERRUN"];
  await tx.rotaAlert.updateMany({ where: { organisationId: scope.organisationId, visitId: visit.id, kind: { in: answered }, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: `${c.kind === "IN" ? "Clocked in" : "Clocked out"} at ${londonTime(c.at)}${c.method === "OFFICE" ? " (entered by the office)" : ""}` } });
  if (short) await raiseAlert(tx, { organisationId: scope.organisationId, kind: "SHORT_VISIT", visitId: visit.id, staffId: c.staffId, message: `${visit.reference}: visit shorter than planned`, dedupeKey: `short:${visit.id}:${c.staffId}`, conditionAt: c.at, actionUrl: `/rota/visits/${visit.id}`, notify: false });

  await audit({ organisationId: scope.organisationId, actorId: c.actorId, action: c.supersedesId ? "visit.clock.corrected" : `visit.clock.${c.kind.toLowerCase()}`, entityType: "Visit", entityId: visit.id, data: { clockId: row.id, staffId: c.staffId, method: c.method } }, tx);
  return { clock: row, status: steps.at(-1) ?? visit.status, short };
}

/** A carer clocks themselves in or out now. Their staff identity comes from the linked sign-in, never the form. */
export async function clockMine(ctx: Ctx, visitId: string, kind: ClockKind, input: { nonce?: string; note?: string }) {
  const staff = await myStaff(ctx);
  const scope: Scope = { organisationId: staff.organisationId, areaIds: null, branchIds: null };
  const at = new Date();
  const outcome = await db.$transaction(async (tx) => {
    const v = await lockVisit(tx, scope, visitId);
    // A carer cannot tell another carer's visit from one that does not exist.
    if (!v.publishedAt || !(await tx.visitAssignment.findFirst({ where: { visitId: v.id, staffId: staff.id, removedAt: null } }))) throw new NotFoundError("Visit");
    const settings = await rotaSettings(tx, scope.organisationId);
    const opensAt = v.scheduledStart.getTime() - (settings.blockEarlyClockIn ? settings.earlyBeforeMin : OPEN_BEFORE_MIN) * 60000;
    if (kind === "IN" && at.getTime() < opensAt) throw new ValidationError(`You can clock in from ${londonTime(new Date(opensAt))}`);
    if (kind === "IN" && at.getTime() > v.scheduledEnd.getTime() + OPEN_AFTER_MIN * 60000) throw new ValidationError("This visit is too far in the past to clock in. Ask the office to record it.");
    if (kind === "IN") {
      // Readiness is checked again at the door: a certificate that expired since allocation, a new restriction or an
      // authorisation withdrawn is not ignored. Hard stops refuse the clock-in and alert the office; anything else is flagged.
      const careTaskIds = (await tx.visitTask.findMany({ where: { visitId: v.id }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
      const r = (await readinessFor(tx, scope.organisationId, [staff.id], { date: londonDate(at), careTaskIds, serviceUserId: v.serviceUserId })).get(staff.id);
      if (r && r.blockedForContext) {
        const applies = (c: { taskLevel: boolean; careTaskIds: string[]; serviceUserIds: string[] }) => !c.taskLevel || c.careTaskIds.some((t) => careTaskIds.includes(t)) || c.serviceUserIds.includes(v.serviceUserId);
        const restrictionBites = r.restrictions.some((x) => x.kind === "GENERAL" || (x.kind === "TASK" && !!x.careTaskId && careTaskIds.includes(x.careTaskId)) || (x.kind === "SERVICE_USER" && x.serviceUserId === v.serviceUserId));
        const hard = r.components.some((c) => c.hardStop && applies(c) && ["EXPIRED", "MISSING", "NOT_COMPETENT", "COMPETENCY_DUE", "PENDING_VERIFICATION"].includes(c.state)) || restrictionBites;
        const alert = { organisationId: scope.organisationId, kind: "READINESS" as const, severity: hard ? ("CRITICAL" as const) : ("WARNING" as const), visitId: v.id, staffId: staff.id, message: `${staff.displayName} ${hard ? "was refused clock-in" : "clocked in with a readiness warning"} on ${v.reference}: ${r.reasons.join("; ")}`, dedupeKey: `readiness:${v.id}:${staff.id}:${hard ? "block" : "warn"}`, actionUrl: `/rota/visits/${v.id}` };
        // A refusal is decided here but recorded after this transaction ends, so the office alert is not rolled back with it.
        if (hard) return { refused: `You cannot clock in to this visit: ${r.reasons[0] ?? "a readiness requirement is not met"}. The office has been alerted.`, alert };
        await raiseAlert(tx, alert);
      }
    }
    return { refused: null, result: await applyClock(tx, scope, v, settings, { staffId: staff.id, kind, at, method: "APP", actorId: ctx.userId, nonce: input.nonce, note: input.note }) };
  });
  if (outcome.refused !== null) {
    await db.$transaction((tx) => raiseAlert(tx, outcome.alert));
    throw new ValidationError(outcome.refused);
  }
  return outcome.result;
}

/** The carer could not deliver the visit at the door (no answer, refused). The office is alerted at once. */
export async function notDeliveredMine(ctx: Ctx, visitId: string, reason: string) {
  const staff = await myStaff(ctx);
  const scope: Scope = { organisationId: staff.organisationId, areaIds: null, branchIds: null };
  if (reason.trim().length < 3) throw new ValidationError("Say what happened");
  return db.$transaction(async (tx) => {
    const v = await lockVisit(tx, scope, visitId);
    const settings = await rotaSettings(tx, scope.organisationId);
    if (!settings.doorstepCancel) throw new ForbiddenError("Your organisation records this through the office. Phone the office.");
    if (!v.publishedAt || !(await tx.visitAssignment.findFirst({ where: { visitId: v.id, staffId: staff.id, removedAt: null } }))) throw new NotFoundError("Visit");
    if (v.status !== "SCHEDULED") throw new ValidationError("Only a visit that has not started can be marked not delivered");
    if (Date.now() < v.scheduledStart.getTime() - OPEN_BEFORE_MIN * 60000) throw new ValidationError("This visit has not come round yet");
    await tx.visit.update({ where: { id: v.id }, data: { status: "NOT_DELIVERED", statusChangedAt: new Date(), notDeliveredReason: reason.trim(), lockVersion: { increment: 1 } } });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: v.id, type: "STATUS", fromStatus: v.status, toStatus: "NOT_DELIVERED", actorId: ctx.userId, reason: reason.trim(), data: { source: "carer" } } });
    await tx.rotaAlert.updateMany({ where: { organisationId: scope.organisationId, visitId: v.id, kind: { in: ["LATE"] }, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "Carer reported the visit could not be delivered" } });
    await raiseAlert(tx, { organisationId: scope.organisationId, kind: "NOT_DELIVERED", severity: "CRITICAL", visitId: v.id, staffId: staff.id, message: `${v.reference}: ${staff.displayName} could not deliver the visit (${reason.trim()})`, dedupeKey: `notdelivered:${v.id}`, conditionAt: new Date(), actionUrl: `/rota/visits/${v.id}` });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.not_delivered", entityType: "Visit", entityId: v.id, data: { staffId: staff.id } }, tx);
  });
}

const officeSchema = z.object({
  staffId: z.string().min(1, "Choose the carer"),
  kind: z.enum(["IN", "OUT"], { message: "Choose clock in or clock out" }),
  date: z.string().refine(isIsoDate, "Choose the date"),
  time: z.string().refine((t) => parseHhmm(t) !== null, "Times must be like 09:00"),
  reason: z.string().trim().min(3, "Give a reason for entering this by hand"),
  /** Shown on the visit as a clock-out note; required when the recorded visit is short or the organisation demands one. */
  note: z.string().trim().max(2000).optional(),
  supersedesId: z.string().optional(),
});

/** The office records or corrects a clock time for a carer (phone call, failed phone, wrong time). Always with a reason. */
export async function officeClock(ctx: Ctx, visitId: string, input: z.input<typeof officeSchema> | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "rota.clockCorrect");
  const p = officeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the form");
  const at = londonToUtc(p.data.date, parseHhmm(p.data.time) ?? 0);
  if (at.getTime() > Date.now() + 60000) throw new ValidationError("A clock time cannot be in the future");
  return db.$transaction(async (tx) => {
    const v = await lockVisit(tx, scope, visitId);
    if (Math.abs(at.getTime() - v.scheduledStart.getTime()) > 24 * 3600000) throw new ValidationError("That time is more than a day away from the visit");
    const settings = await rotaSettings(tx, scope.organisationId);
    return applyClock(tx, scope, v, settings, { staffId: p.data.staffId, kind: p.data.kind, at, method: "OFFICE", actorId: ctx.userId, reason: p.data.reason, note: p.data.note || undefined, supersedesId: p.data.supersedesId || null });
  });
}
