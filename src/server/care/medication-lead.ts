import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { placeKey, placeLabel } from "@/lib/carer-places";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { fromDbDate, londonTime } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { readinessFor } from "@/server/readiness";
import { lockVisit } from "@/server/rota/assign";
import { rotaScope, visitWhere } from "@/server/rota/scope";
import { raiseAlert } from "@/server/workforce/impact";
import { dueAt } from "./medication";

/**
 * Medication Lead: which carer on a visit is responsible for medication. It works inside the existing visit allocation
 * and the existing eMAR (MAR records), and only while the organisation has medication switched on.
 *
 * - A visit needing medication support with one carer: that carer becomes the lead automatically, but only when their
 *   readiness for the visit's medication tasks is clear. Otherwise responsibility stays unassigned and the office is told.
 * - Two or more carers: an authorised coordinator chooses the lead from the carers booked.
 * - When the lead leaves the visit (removed, replaced, swapped) a database trigger ends their responsibility at once, and
 *   the office is told it needs reassessing. History is never edited.
 * - Being the lead is not evidence that medication was given; that is only ever the MAR record, with the worker who
 *   actually recorded it.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof db;

export type LeadStatus = "ASSIGNED" | "NEEDS_REASSESSMENT" | "UNASSIGNED" | "NOT_NEEDED";
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  ASSIGNED: "Assigned",
  NEEDS_REASSESSMENT: "Needs reassessment",
  UNASSIGNED: "Not assigned",
  NOT_NEEDED: "Not needed",
};

async function enabled(tx: Db, organisationId: string) {
  const s = await tx.rotaSettings.findUnique({ where: { organisationId }, select: { medicationEnabledAt: true } });
  return Boolean(s?.medicationEnabledAt);
}

/** Care tasks that involve medicines, judged by name ("Medication prompt", "Administer medicines" and the like). */
async function medicationTaskIds(tx: Db, organisationId: string) {
  return (await tx.careTask.findMany({ where: { organisationId, name: { contains: "medic", mode: "insensitive" } }, select: { id: true } })).map((t) => t.id);
}

type LeadVisit = { id: string; organisationId: string; serviceUserId: string; date: Date; scheduledStart: Date; medicationRequired: boolean };

/** A visit needs a Medication Lead when it is marked for medication support or an approved medicine is due on it. */
async function needsLead(tx: Db, v: LeadVisit) {
  if (v.medicationRequired) return true;
  const meds = await tx.medication.findMany({ where: { organisationId: v.organisationId, serviceUserId: v.serviceUserId, status: "ACTIVE" } });
  return dueAt(meds, v).length > 0;
}

/**
 * Whether each carer is cleared for medication on this visit: their readiness (training, competency, restrictions,
 * open review flags) for the visit's date, person and medication tasks. Returns the reasons when not.
 */
export async function medicationCompetence(tx: Db, v: LeadVisit, staffIds: string[]) {
  const out = new Map<string, { ok: boolean; reasons: string[] }>();
  if (!staffIds.length) return out;
  const tasks = await medicationTaskIds(tx, v.organisationId);
  const r = await readinessFor(tx, v.organisationId, staffIds, { date: fromDbDate(v.date), careTaskIds: tasks, serviceUserId: v.serviceUserId });
  for (const id of staffIds) {
    const x = r.get(id);
    if (!x) out.set(id, { ok: false, reasons: ["Not on the staff list"] });
    else {
      const ok = !x.blockedForContext && x.status !== "REVIEW_REQUIRED";
      out.set(id, { ok, reasons: ok ? [] : x.reasons.length ? x.reasons : ["Not cleared for medication on this visit"] });
    }
  }
  return out;
}

const liveLeadWhere = (visitId: string) => ({ visitId, endedAt: null });

/**
 * Brings a visit's medication responsibility up to date after its carers changed. Called inside the same transaction
 * as every assignment change. Never reassigns a multi-carer visit's lead by itself: it tells the office instead.
 */
export async function reconcileMedicationLead(tx: Tx, organisationId: string, visitId: string, actorId: string, opts: { quiet?: boolean; checked?: boolean } = {}): Promise<"SET" | "NEEDS_CHOICE" | "NOT_CLEARED" | null> {
  if (!opts.checked && !(await enabled(tx, organisationId))) return null;
  const v = await tx.visit.findFirst({ where: { id: visitId, organisationId }, select: { id: true, organisationId: true, reference: true, serviceUserId: true, date: true, scheduledStart: true, status: true, medicationRequired: true } });
  if (!v || !["SCHEDULED", "MISSED", "IN_PROGRESS"].includes(v.status)) return null;
  if (!(await needsLead(tx, v))) return null;
  const live = await tx.visitMedicationLead.findFirst({ where: liveLeadWhere(v.id) });
  if (live) return null;
  const carers = await tx.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null, slot: { not: "SHADOW" } }, include: { staff: { select: { displayName: true } } }, orderBy: { position: "asc" } });
  const ended = await tx.visitMedicationLead.count({ where: { visitId: v.id } });
  const when = `${v.reference} at ${londonTime(v.scheduledStart)}`;
  const url = `/rota/visits/${v.id}#medication-lead`;
  if (carers.length === 1) {
    const only = carers[0]!;
    const c = (await medicationCompetence(tx, v, [only.staffId])).get(only.staffId)!;
    if (c.ok) {
      await tx.visitMedicationLead.create({ data: { organisationId, visitId: v.id, staffId: only.staffId, source: "AUTO", assignedById: actorId, reason: "Only carer on the visit, cleared for medication" } });
      await tx.visitEvent.create({ data: { organisationId, visitId: v.id, type: "EDITED", actorId, reason: "Medication Lead set automatically", data: { medicationLead: only.staffId, source: "AUTO" } } });
      await audit({ organisationId, actorId, action: "visit.medication_lead.set", entityType: "Visit", entityId: v.id, data: { staffId: only.staffId, source: "AUTO" } }, tx);
      await resolveLeadAlerts(tx, v.id, actorId, `${only.staff.displayName} is the Medication Lead`);
      return "SET";
    }
    if (opts.quiet) return "NOT_CLEARED";
    await supersedeLeadAlerts(tx, v.id, actorId, `med-lead:${v.id}:${ended}:${only.staffId}`);
    await raiseAlert(tx, { organisationId, kind: "MEDICATION_LEAD_NEEDED", severity: "WARNING", visitId: v.id, staffId: only.staffId, message: `No Medication Lead on ${when}: ${only.staff.displayName} is not cleared for medication (${c.reasons[0]}). Medication responsibility is unassigned.`, dedupeKey: `med-lead:${v.id}:${ended}:${only.staffId}`, actionUrl: url });
    return "NOT_CLEARED";
  }
  if (carers.length >= 2) {
    if (opts.quiet) return "NEEDS_CHOICE";
    await supersedeLeadAlerts(tx, v.id, actorId, `med-lead:${v.id}:${ended}:multi`);
    await raiseAlert(tx, { organisationId, kind: "MEDICATION_LEAD_NEEDED", severity: "WARNING", visitId: v.id, message: ended ? `Medication responsibility needs reassessing on ${when}: the Medication Lead is no longer on the visit. Choose another carer.` : `Choose a Medication Lead for ${when} (${carers.length} carers booked).`, dedupeKey: `med-lead:${v.id}:${ended}:multi`, actionUrl: url });
    return "NEEDS_CHOICE";
  }
  return null;
}

/**
 * After a build or roll forward creates visits in bulk: sets the lead on single-carer medication visits and raises one
 * summary for the office instead of an alert per visit.
 */
export async function reconcileMedicationLeads(tx: Tx, organisationId: string, visitIds: string[], actorId: string, label: string, dedupe: string) {
  if (!visitIds.length || !(await enabled(tx, organisationId))) return;
  const withMeds = new Set((await tx.medication.findMany({ where: { organisationId, status: "ACTIVE" }, select: { serviceUserId: true }, distinct: ["serviceUserId"] })).map((m) => m.serviceUserId));
  const candidates = await tx.visit.findMany({ where: { id: { in: visitIds }, OR: [{ medicationRequired: true }, { serviceUserId: { in: [...withMeds] } }] }, select: { id: true } });
  let open = 0;
  for (const c of candidates) {
    const r = await reconcileMedicationLead(tx, organisationId, c.id, actorId, { quiet: true, checked: true });
    if (r === "NEEDS_CHOICE" || r === "NOT_CLEARED") open++;
  }
  if (open) await raiseAlert(tx, { organisationId, kind: "MEDICATION_LEAD_NEEDED", severity: "WARNING", message: `${label}: ${open} medication visit${open === 1 ? " needs" : "s need"} a Medication Lead chosen`, dedupeKey: `med-lead-bulk:${dedupe}`, actionUrl: "/rota/visits" });
}

/** An earlier alert about this visit's lead that no longer describes it (for example "the only carer is not cleared" once a second carer is booked). */
async function supersedeLeadAlerts(tx: Tx, visitId: string, actorId: string, keep: string) {
  await tx.rotaAlert.updateMany({ where: { visitId, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null, dedupeKey: { not: keep } }, data: { resolvedAt: new Date(), resolvedById: actorId, resolution: "Superseded: the carers on the visit changed" } });
}

async function resolveLeadAlerts(tx: Tx, visitId: string, actorId: string, resolution: string) {
  await tx.rotaAlert.updateMany({ where: { visitId, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId, resolution } });
}

const setSchema = z.object({
  staffId: z.string().min(1, "Choose a carer"),
  reason: z.string().trim().max(500).optional(),
  lockVersion: z.number().int().optional(),
});

/**
 * An authorised coordinator chooses (or changes) the Medication Lead from the carers booked on the visit. The chosen
 * carer must be cleared for medication. The previous lead's record is ended, not changed, and who made the change is kept.
 */
export async function setMedicationLead(ctx: Ctx, visitId: string, input: z.input<typeof setSchema>) {
  if (!hasOrgPermission(ctx, "medication.view")) throw new ForbiddenError("You cannot change medication responsibility");
  const scope = await rotaScope(ctx, "rota.edit");
  const p = setSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the Medication Lead");
  const d = p.data;
  if (!(await enabled(db, scope.organisationId))) throw new ForbiddenError("Medication records are switched off for your organisation");
  return db.$transaction(async (tx) => {
    const v = await lockVisit(tx, scope, visitId);
    if (d.lockVersion !== undefined && d.lockVersion !== v.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
    if (!["SCHEDULED", "MISSED", "IN_PROGRESS"].includes(v.status)) throw new ValidationError("Medication responsibility can only be changed on a visit that is still to happen or in progress");
    const booked = await tx.visitAssignment.findFirst({ where: { visitId: v.id, staffId: d.staffId, removedAt: null, slot: { not: "SHADOW" } }, include: { staff: { select: { displayName: true } } } });
    if (!booked) throw new ValidationError("The Medication Lead must be one of the carers booked on this visit");
    const c = (await medicationCompetence(tx, v, [d.staffId])).get(d.staffId)!;
    if (!c.ok) throw new ValidationError(`${booked.staff.displayName} is not cleared for medication on this visit: ${c.reasons.join("; ")}`);
    const current = await tx.visitMedicationLead.findFirst({ where: liveLeadWhere(v.id) });
    if (current?.staffId === d.staffId) return current;
    if (current && (d.reason?.length ?? 0) < 3) throw new ValidationError("Give a reason for changing the Medication Lead");
    const now = new Date();
    if (current) await tx.visitMedicationLead.update({ where: { id: current.id }, data: { endedAt: now, endedById: ctx.userId, endReason: `Changed by ${ctx.userName}: ${d.reason}` } });
    const lead = await tx.visitMedicationLead.create({ data: { organisationId: scope.organisationId, visitId: v.id, staffId: d.staffId, source: "COORDINATOR", assignedById: ctx.userId, assignedAt: now, reason: d.reason || null } });
    await tx.visit.update({ where: { id: v.id }, data: { lockVersion: { increment: 1 } } });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: v.id, type: "EDITED", actorId: ctx.userId, reason: d.reason || "Medication Lead chosen", data: { medicationLead: d.staffId, previous: current?.staffId ?? null, place: placeKey(booked) } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.medication_lead.set", entityType: "Visit", entityId: v.id, data: { staffId: d.staffId, previousStaffId: current?.staffId ?? null, source: "COORDINATOR", reason: d.reason || null } }, tx);
    await resolveLeadAlerts(tx, v.id, ctx.userId, `${booked.staff.displayName} chosen as Medication Lead`);
    return lead;
  });
}

/** The visit page's Medication Lead panel: status, the lead, who could be chosen (and why not), and the history. */
export async function medicationLeadView(ctx: Ctx, visitId: string) {
  if (!hasOrgPermission(ctx, "medication.view")) return null;
  const scope = await rotaScope(ctx, "rota.view");
  if (!(await enabled(db, scope.organisationId))) return null;
  const v = await db.visit.findFirst({ where: { ...visitWhere(scope), id: visitId }, select: { id: true, organisationId: true, serviceUserId: true, date: true, scheduledStart: true, medicationRequired: true, status: true, lockVersion: true } });
  if (!v) return null;
  const [needed, history, carers] = await Promise.all([
    needsLead(db, v),
    db.visitMedicationLead.findMany({ where: { visitId: v.id }, orderBy: { assignedAt: "desc" }, include: { staff: { select: { displayName: true } } } }),
    db.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null, slot: { not: "SHADOW" } }, include: { staff: { select: { displayName: true } } }, orderBy: { position: "asc" } }),
  ]);
  const competence = await medicationCompetence(db, v, carers.map((a) => a.staffId));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(history.flatMap((h) => [h.assignedById, h.endedById ?? ""]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const live = history.find((h) => !h.endedAt) ?? null;
  const status: LeadStatus = live ? "ASSIGNED" : !needed ? "NOT_NEEDED" : history.length ? "NEEDS_REASSESSMENT" : "UNASSIGNED";
  return {
    status,
    needed,
    lockVersion: v.lockVersion,
    canChange: hasOrgPermission(ctx, "rota.edit") && ["SCHEDULED", "MISSED", "IN_PROGRESS"].includes(v.status),
    lead: live ? { staffId: live.staffId, name: live.staff.displayName, place: placeLabel(placeKey(carers.find((a) => a.staffId === live.staffId) ?? { slot: "PRIMARY" })), source: live.source, since: live.assignedAt, by: users.get(live.assignedById) ?? (live.source === "AUTO" ? "Automatic" : "A member") } : null,
    options: carers.map((a) => ({ staffId: a.staffId, name: a.staff.displayName, place: placeLabel(placeKey(a)), ok: competence.get(a.staffId)?.ok ?? false, reasons: competence.get(a.staffId)?.reasons ?? [] })),
    history: history.filter((h) => h.endedAt).map((h) => ({ id: h.id, name: h.staff.displayName, source: h.source, from: h.assignedAt, to: h.endedAt!, setBy: users.get(h.assignedById) ?? "Automatic", endedBy: h.endedById ? users.get(h.endedById) ?? "A member" : "System", endReason: h.endReason ?? "" })),
  };
}

/** For the carer's own visit: who the Medication Lead is (null when medication is off or no lead is needed). */
export async function leadForCarer(organisationId: string, visitId: string) {
  if (!(await enabled(db, organisationId))) return null;
  const live = await db.visitMedicationLead.findFirst({ where: { visitId, organisationId, endedAt: null }, include: { staff: { select: { displayName: true } } } });
  return live ? { staffId: live.staffId, name: live.staff.displayName } : null;
}

/** The live lead of each visit, for the missed-medication sweep. */
export async function liveLeads(tx: Db, visitIds: string[]) {
  if (!visitIds.length) return new Map<string, string>();
  const rows = await tx.visitMedicationLead.findMany({ where: { visitId: { in: visitIds }, endedAt: null }, select: { visitId: true, staffId: true } });
  return new Map(rows.map((r) => [r.visitId, r.staffId]));
}
