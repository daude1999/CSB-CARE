import type { MarOutcome, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonMinute, londonTime } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { effectiveClocks } from "@/server/rota/attendance";
import { rotaScope, serviceUserWhere, visitWhere } from "@/server/rota/scope";
import { raiseAlert } from "@/server/workforce/impact";
import { myStaff } from "@/server/workforce/link";

/**
 * Medication and MAR records, modelled on OnePlan's medication set-up: each person's medicines with dose, route,
 * support level and time ranges (morning, lunch, tea, bed, or as needed); a medicine is used only once a second
 * person has approved it; carers record each due dose on the visit; a completed visit with a due dose not recorded
 * raises a "missed medication" exception; and a monthly MAR chart.
 *
 * Clinical safety: the whole feature is off for an organisation until an admin switches it on and records that a
 * clinical review was done. Records are append-only (database triggers); a correction is a new record that
 * supersedes the old one, with a reason. The platform does not check doses, interactions or stock.
 */

export const TIME_RANGES = {
  MORNING: { label: "Morning", from: 6 * 60, to: 11 * 60 },
  LUNCH: { label: "Lunch", from: 11 * 60, to: 14 * 60 },
  TEA: { label: "Tea", from: 14 * 60, to: 18 * 60 },
  BED: { label: "Bed", from: 18 * 60, to: 24 * 60 },
} as const;
export type TimeRange = keyof typeof TIME_RANGES;
export const TIME_RANGE_KEYS = Object.keys(TIME_RANGES) as TimeRange[];

export const SUPPORT_LABEL = { PROMPT: "Prompt", ASSIST: "Assist", ADMINISTER: "Administer" } as const;
export const ROUTE_LABEL = { ORAL: "By mouth", TOPICAL: "On the skin", INHALED: "Inhaled", EYE: "Eye", EAR: "Ear", NASAL: "Nose", TRANSDERMAL: "Patch", OTHER: "Other" } as const;
export const OUTCOME_LABEL: Record<MarOutcome, string> = { GIVEN: "Given", PROMPTED: "Prompted and taken", REFUSED: "Refused", NOT_GIVEN: "Not given", NOT_REQUIRED: "Not needed (as required)" };
/** Codes on the MAR chart, as on a paper MAR. */
export const OUTCOME_CODE: Record<MarOutcome, string> = { GIVEN: "G", PROMPTED: "P", REFUSED: "R", NOT_GIVEN: "N", NOT_REQUIRED: "X" };

// ── Switching the feature on ──────────────────────────────────────────────

export async function medicationEnabled(organisationId: string) {
  const s = await db.rotaSettings.findUnique({ where: { organisationId }, select: { medicationEnabledAt: true } });
  return Boolean(s?.medicationEnabledAt);
}

async function requireEnabled(organisationId: string) {
  if (!(await medicationEnabled(organisationId))) throw new ForbiddenError("Medication records are switched off for your organisation");
}

export async function setMedicationEnabled(ctx: Ctx, on: boolean, reviewNote: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  if (on && reviewNote.trim().length < 10) throw new ValidationError("Record who carried out the clinical review and when");
  await db.$transaction(async (tx) => {
    await tx.rotaSettings.update({ where: { organisationId }, data: on ? { medicationEnabledAt: new Date(), medicationEnabledById: ctx.userId, medicationReviewNote: reviewNote.trim() } : { medicationEnabledAt: null, medicationEnabledById: null } });
    await audit({ organisationId, actorId: ctx.userId, action: on ? "medication.enabled" : "medication.disabled", entityType: "Organisation", entityId: organisationId, data: { reviewNote: reviewNote.trim() || null } }, tx);
  });
}

// ── Medicines ─────────────────────────────────────────────────────────────

const medSchema = z.object({
  name: z.string().trim().min(2, "Give the medicine's name").max(120),
  strength: z.string().trim().max(60).optional(),
  dose: z.string().trim().min(1, "Give the dose, e.g. 1 tablet").max(120),
  route: z.enum(["ORAL", "TOPICAL", "INHALED", "EYE", "EAR", "NASAL", "TRANSDERMAL", "OTHER"]),
  support: z.enum(["PROMPT", "ASSIST", "ADMINISTER"]),
  timeRanges: z.array(z.enum(["MORNING", "LUNCH", "TEA", "BED"])).default([]),
  asRequired: z.boolean().default(false),
  maxDosesPerDay: z.coerce.number().int().min(1).max(24).optional().nullable(),
  controlled: z.boolean().default(false),
  instructions: z.string().trim().max(2000).optional(),
  startDate: z.string().refine(isIsoDate, "Give the start date"),
  endDate: z.string().refine((s) => !s || isIsoDate(s), "End must be a date").optional(),
  prescriber: z.string().trim().max(120).optional(),
});
export type MedInput = z.input<typeof medSchema>;

async function suInScope(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "medication.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, organisationId: true } });
  if (!su) throw new NotFoundError("Service user");
  await requireEnabled(su.organisationId);
  return { su, scope };
}

/** Records a medicine as a draft. It is not used on visits until someone else approves it. */
export async function addMedication(ctx: Ctx, serviceUserId: string, input: MedInput, opts: { replacesId?: string; reason?: string } = {}) {
  requireOrgPermission(ctx, "medication.manage");
  const p = medSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the medicine");
  const d = p.data;
  if (!d.asRequired && !d.timeRanges.length) throw new ValidationError("Choose when it is due, or mark it as required");
  if (d.endDate && d.endDate < d.startDate) throw new ValidationError("The end date is before the start");
  const { su } = await suInScope(ctx, serviceUserId);
  return db.$transaction(async (tx) => {
    if (opts.replacesId) {
      const old = await tx.medication.findFirst({ where: { id: opts.replacesId, serviceUserId: su.id, status: { in: ["DRAFT", "ACTIVE"] } } });
      if (!old) throw new NotFoundError("Medicine");
    }
    const m = await tx.medication.create({ data: { organisationId: su.organisationId, serviceUserId: su.id, name: d.name, strength: d.strength || null, dose: d.dose, route: d.route, support: d.support, timeRanges: d.asRequired ? [] : d.timeRanges, asRequired: d.asRequired, maxDosesPerDay: d.asRequired ? (d.maxDosesPerDay ?? null) : null, controlled: d.controlled, instructions: d.instructions || null, prescriber: d.prescriber || null, startDate: dbDate(d.startDate), endDate: d.endDate ? dbDate(d.endDate) : null, createdById: ctx.userId, replacesId: opts.replacesId ?? null, changeReason: opts.reason?.trim() || null } });
    await audit({ organisationId: su.organisationId, actorId: ctx.userId, action: "medication.added", entityType: "ServiceUser", entityId: su.id, data: { medicationId: m.id, name: m.name, replaces: opts.replacesId ?? null } }, tx);
    return m;
  });
}

/** A second person approves a draft. If it replaces an active medicine, that one stops the same day. */
export async function approveMedication(ctx: Ctx, medicationId: string) {
  const organisationId = requireOrgPermission(ctx, "medication.manage");
  const m = await db.medication.findFirst({ where: { id: medicationId, organisationId } });
  if (!m) throw new NotFoundError("Medicine");
  await suInScope(ctx, m.serviceUserId);
  if (m.status !== "DRAFT") throw new ConflictError("Only a draft can be approved");
  if (m.createdById === ctx.userId) throw new ForbiddenError("You entered this medicine, so someone else must check and approve it");
  await db.$transaction(async (tx) => {
    const done = await tx.medication.updateMany({ where: { id: m.id, status: "DRAFT" }, data: { status: "ACTIVE", approvedById: ctx.userId, approvedAt: new Date() } });
    if (!done.count) throw new ConflictError("This medicine has just been decided by someone else");
    if (m.replacesId) await tx.medication.updateMany({ where: { id: m.replacesId, status: "ACTIVE" }, data: { status: "STOPPED", stoppedById: ctx.userId, stoppedAt: new Date(), stopReason: `Replaced: ${m.changeReason ?? "changed"}` } });
    await audit({ organisationId, actorId: ctx.userId, action: "medication.approved", entityType: "ServiceUser", entityId: m.serviceUserId, data: { medicationId: m.id } }, tx);
  });
}

export async function stopMedication(ctx: Ctx, medicationId: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "medication.manage");
  if (reason.trim().length < 3) throw new ValidationError("Say why it is stopped");
  const m = await db.medication.findFirst({ where: { id: medicationId, organisationId } });
  if (!m) throw new NotFoundError("Medicine");
  await suInScope(ctx, m.serviceUserId);
  if (m.status === "STOPPED") throw new ConflictError("Already stopped");
  await db.$transaction(async (tx) => {
    await tx.medication.update({ where: { id: m.id }, data: { status: "STOPPED", stoppedById: ctx.userId, stoppedAt: new Date(), stopReason: reason.trim() } });
    await audit({ organisationId, actorId: ctx.userId, action: "medication.stopped", entityType: "ServiceUser", entityId: m.serviceUserId, data: { medicationId: m.id, reason: reason.trim() } }, tx);
  });
}

export async function listMedications(ctx: Ctx, serviceUserId: string) {
  await suInScope(ctx, serviceUserId);
  return db.medication.findMany({ where: { serviceUserId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
}

// ── What is due on a visit ────────────────────────────────────────────────

type MedRow = Prisma.MedicationGetPayload<object>;

/** The time range a visit's start falls in. */
export function rangeOf(startMinute: number): TimeRange | null {
  return TIME_RANGE_KEYS.find((k) => TIME_RANGES[k].from <= startMinute && startMinute < TIME_RANGES[k].to) ?? null;
}

/** Approved medicines due at a visit: those for the visit's time range, plus any "as required" ones. */
export function dueAt(meds: MedRow[], visit: { date: Date; scheduledStart: Date }) {
  const range = rangeOf(londonMinute(visit.scheduledStart));
  const day = fromDbDate(visit.date);
  return meds.filter((m) => m.status === "ACTIVE" && fromDbDate(m.startDate) <= day && (!m.endDate || fromDbDate(m.endDate) >= day) && (m.asRequired || (range !== null && m.timeRanges.includes(range))));
}

/** Medicines due on a carer's visit with what has been recorded, for the carer page. Empty when switched off. */
export async function medsForMyVisit(organisationId: string, visit: { id: string; serviceUserId: string; date: Date; scheduledStart: Date }) {
  if (!(await medicationEnabled(organisationId))) return null;
  const meds = await db.medication.findMany({ where: { organisationId, serviceUserId: visit.serviceUserId, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const due = dueAt(meds, visit);
  const records = await db.marRecord.findMany({ where: { visitId: visit.id, supersededAt: null }, orderBy: { at: "asc" } });
  return due.map((m) => ({ med: m, records: records.filter((r) => r.medicationId === m.id) }));
}

const recordSchema = z.object({
  medicationId: z.string().min(1),
  outcome: z.enum(["GIVEN", "PROMPTED", "REFUSED", "NOT_GIVEN", "NOT_REQUIRED"]),
  reason: z.string().trim().max(500).optional(),
  witnessName: z.string().trim().max(120).optional(),
});

/**
 * The carer records one dose on their own visit after clocking in. Refused or not given needs a reason; a controlled
 * drug needs the name of a second person who witnessed it. A scheduled dose is recorded once per visit; an "as
 * required" dose may be recorded more than once, up to its daily limit.
 */
export async function recordDose(ctx: Ctx, visitId: string, input: z.input<typeof recordSchema>) {
  const p = recordSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the record");
  const d = p.data;
  if ((d.outcome === "REFUSED" || d.outcome === "NOT_GIVEN") && (d.reason?.length ?? 0) < 3) throw new ValidationError("Say why the dose was not taken");
  const staff = await myStaff(ctx);
  await requireEnabled(staff.organisationId);
  return db.$transaction(async (tx) => {
    const v = await tx.visit.findFirst({ where: { id: visitId, organisationId: staff.organisationId, publishedAt: { not: null }, assignments: { some: { staffId: staff.id, removedAt: null } } }, include: { clocks: { where: { staffId: staff.id } } } });
    if (!v) throw new NotFoundError("Visit");
    if (!effectiveClocks(v.clocks).some((c) => c.kind === "IN")) throw new ValidationError("Clock in before recording medication");
    if (["CANCELLED", "NOT_DELIVERED"].includes(v.status)) throw new ConflictError("This visit was not delivered");
    const m = await tx.medication.findFirst({ where: { id: d.medicationId, serviceUserId: v.serviceUserId, status: "ACTIVE" } });
    if (!m || !dueAt([m], v).length) throw new NotFoundError("Medicine due on this visit");
    if (m.controlled && (d.outcome === "GIVEN" || d.outcome === "PROMPTED") && (d.witnessName?.length ?? 0) < 2) throw new ValidationError("A controlled drug needs the name of the person who witnessed it");
    const existing = await tx.marRecord.findMany({ where: { visitId: v.id, medicationId: m.id, supersededAt: null } });
    if (!m.asRequired && existing.length) throw new ConflictError("This dose is already recorded. Ask the office to correct it if it is wrong.");
    if (m.asRequired && m.maxDosesPerDay && (d.outcome === "GIVEN" || d.outcome === "PROMPTED")) {
      const today = await tx.marRecord.count({ where: { medicationId: m.id, supersededAt: null, outcome: { in: ["GIVEN", "PROMPTED"] }, visit: { date: v.date } } });
      if (today >= m.maxDosesPerDay) throw new ConflictError(`The most doses a day for this medicine (${m.maxDosesPerDay}) have been recorded. Contact the office.`);
    }
    const r = await tx.marRecord.create({ data: { organisationId: v.organisationId, visitId: v.id, medicationId: m.id, staffId: staff.id, outcome: d.outcome, reason: d.reason || null, witnessName: d.witnessName || null, recordedById: ctx.userId } });
    if (d.outcome === "REFUSED" || d.outcome === "NOT_GIVEN") {
      await raiseAlert(tx, { organisationId: v.organisationId, kind: "MEDICATION_NOT_TAKEN", severity: "WARNING", visitId: v.id, staffId: staff.id, message: `${m.name} ${d.outcome === "REFUSED" ? "refused" : "not given"} on ${v.reference}: ${d.reason}`, dedupeKey: `mar-not-taken:${r.id}`, actionUrl: `/rota/visits/${v.id}#medication` });
    }
    await audit({ organisationId: v.organisationId, actorId: ctx.userId, action: "medication.recorded", entityType: "Visit", entityId: v.id, data: { medicationId: m.id, outcome: d.outcome } }, tx);
    return r;
  });
}

/** The office corrects a MAR record: a new record supersedes the old, with a reason. The old one stays on file. */
export async function correctDose(ctx: Ctx, recordId: string, input: { outcome: MarOutcome; reason: string }) {
  const organisationId = requireOrgPermission(ctx, "medication.manage");
  await requireEnabled(organisationId);
  if (input.reason.trim().length < 5) throw new ValidationError("Explain the correction");
  const scope = await rotaScope(ctx, "medication.view");
  const old = await db.marRecord.findFirst({ where: { id: recordId, organisationId, supersededAt: null } });
  if (!old || !(await db.visit.findFirst({ where: { ...visitWhere(scope), id: old.visitId }, select: { id: true } }))) throw new NotFoundError("MAR record");
  return db.$transaction(async (tx) => {
    const r = await tx.marRecord.create({ data: { organisationId, visitId: old.visitId, medicationId: old.medicationId, staffId: old.staffId, outcome: input.outcome, reason: input.reason.trim(), witnessName: old.witnessName, recordedById: ctx.userId, at: old.at, supersedesId: old.id } });
    const done = await tx.marRecord.updateMany({ where: { id: old.id, supersededAt: null }, data: { supersededAt: new Date() } });
    if (!done.count) throw new ConflictError("This record has already been corrected");
    await audit({ organisationId, actorId: ctx.userId, action: "medication.corrected", entityType: "Visit", entityId: old.visitId, data: { from: old.id, to: r.id, outcome: input.outcome, reason: input.reason.trim() } }, tx);
    return r;
  });
}

/**
 * Run with the call sweep: a completed visit from the last two days with a scheduled dose and no record raises one
 * "missed medication" exception. Only organisations with medication switched on are checked.
 */
export async function sweepMissedMedication(now = new Date()) {
  const orgs = (await db.rotaSettings.findMany({ where: { medicationEnabledAt: { not: null } }, select: { organisationId: true } })).map((o) => o.organisationId);
  let raised = 0;
  for (const organisationId of orgs) {
    const visits = await db.visit.findMany({ where: { organisationId, status: "COMPLETED", date: { gte: dbDate(addDays(londonDate(now), -2)) } }, select: { id: true, reference: true, serviceUserId: true, date: true, scheduledStart: true, assignments: { where: { removedAt: null }, select: { staffId: true }, take: 1 } } });
    if (!visits.length) continue;
    const meds = await db.medication.findMany({ where: { organisationId, status: "ACTIVE", asRequired: false, serviceUserId: { in: [...new Set(visits.map((v) => v.serviceUserId))] } } });
    const recs = await db.marRecord.findMany({ where: { visitId: { in: visits.map((v) => v.id) }, supersededAt: null }, select: { visitId: true, medicationId: true } });
    const done = new Set(recs.map((r) => `${r.visitId}:${r.medicationId}`));
    for (const v of visits) {
      // Only medicines approved before the visit started could have been given on it.
      const missing = dueAt(meds.filter((m) => m.serviceUserId === v.serviceUserId && m.approvedAt && m.approvedAt <= v.scheduledStart), v).filter((m) => !done.has(`${v.id}:${m.id}`));
      if (!missing.length) continue;
      const r = await raiseAlert(db, { organisationId, kind: "MISSED_MEDICATION", severity: "CRITICAL", visitId: v.id, staffId: v.assignments[0]?.staffId ?? null, message: `Missed medication on ${v.reference} at ${londonTime(v.scheduledStart)}: ${missing.map((m) => m.name).join(", ")} not recorded`, dedupeKey: `missed-meds:${v.id}`, actionUrl: `/rota/visits/${v.id}#medication` });
      if (r.created) raised++;
    }
  }
  return raised;
}

/** The office view of a visit's medication: what was due and every record, corrections included. */
export async function visitMedication(ctx: Ctx, visitId: string) {
  if (!hasOrgPermission(ctx, "medication.view")) return null;
  const scope = await rotaScope(ctx, "medication.view");
  if (!(await medicationEnabled(scope.organisationId))) return null;
  const v = await db.visit.findFirst({ where: { ...visitWhere(scope), id: visitId }, select: { id: true, serviceUserId: true, date: true, scheduledStart: true } });
  if (!v) return null;
  const meds = await db.medication.findMany({ where: { serviceUserId: v.serviceUserId, status: { in: ["ACTIVE", "STOPPED"] } } });
  const records = await db.marRecord.findMany({ where: { visitId: v.id }, orderBy: { at: "asc" } });
  return { due: dueAt(meds, v), records, meds: new Map(meds.map((m) => [m.id, m])) };
}

/**
 * A month's MAR chart for one person: for each medicine and day, the codes recorded (G, P, R, N, X) in time order,
 * and "—" where a scheduled dose was due on a delivered visit and nothing was recorded.
 */
export async function marChart(ctx: Ctx, serviceUserId: string, month: string) {
  const { su } = await suInScope(ctx, serviceUserId);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError("Choose a month");
  const first = `${month}-01`;
  const days: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
  const last = days[days.length - 1] ?? first;
  const [meds, visits] = await Promise.all([
    db.medication.findMany({ where: { serviceUserId: su.id, status: { in: ["ACTIVE", "STOPPED"] }, startDate: { lte: dbDate(last) }, OR: [{ endDate: null }, { endDate: { gte: dbDate(first) } }] }, orderBy: { name: "asc" } }),
    db.visit.findMany({ where: { serviceUserId: su.id, date: { gte: dbDate(first), lte: dbDate(last) }, status: { in: ["COMPLETED", "IN_PROGRESS"] } }, select: { id: true, date: true, scheduledStart: true } }),
  ]);
  const records = await db.marRecord.findMany({ where: { visitId: { in: visits.map((v) => v.id) }, supersededAt: null }, orderBy: { at: "asc" } });
  const grid = meds.map((m) => ({
    med: m,
    cells: days.map((day) => {
      const vs = visits.filter((v) => fromDbDate(v.date) === day);
      const recs = records.filter((r) => r.medicationId === m.id && vs.some((v) => v.id === r.visitId));
      // A stopped medicine was due only on visits before it was stopped.
      const missed = vs.filter((v) => (!m.stoppedAt || v.scheduledStart < m.stoppedAt) && m.approvedAt && m.approvedAt <= v.scheduledStart && dueAt([{ ...m, status: "ACTIVE" }], v).length && !m.asRequired && !recs.some((r) => r.visitId === v.id)).length;
      return { day, codes: recs.map((r) => OUTCOME_CODE[r.outcome]), missed };
    }),
  }));
  return { days, grid };
}

/** For the Monitor and dashboard: how many of these visits have had a missed-medication exception. Null when off. */
export async function missedMedsCount(organisationId: string, visitIds: string[]) {
  if (!(await medicationEnabled(organisationId))) return null;
  if (!visitIds.length) return 0;
  const rows = await db.rotaAlert.findMany({ where: { organisationId, kind: "MISSED_MEDICATION", visitId: { in: visitIds } }, select: { visitId: true }, distinct: ["visitId"] });
  return rows.length;
}
