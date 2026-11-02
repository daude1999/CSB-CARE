import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonMinute } from "@/lib/london";
import { addMedication, approveMedication, rangeOf, setMedicationEnabled, sweepMissedMedication } from "@/server/care/medication";
import { medicationCompetence, medicationLeadView, setMedicationLead } from "@/server/care/medication-lead";
import { addRestriction, recordAssessment } from "@/server/readiness";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { createVisit } from "@/server/rota/visits";
import { visitCandidates } from "@/server/rota/queries";
import { swapCarers } from "@/server/rota/swap";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Medication Lead against the real schema: automatic lead on single-carer visits (only when cleared), coordinator choice
 * on multi-carer visits, responsibility ending with the carer, kept history, and the switch. Visits are synthetic.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carerCtx = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
type Ctx = Awaited<ReturnType<typeof manager>>;
let orgId = "";
let suId = "";
let callTypeId = "";
let medTaskId = "";
const DAY = addDays(londonDate(), 12);
let n = 0;

async function visit(ctx: Ctx, carers: number, medicationRequired = true) {
  return createVisit(ctx, { serviceUserId: suId, callTypeId, date: DAY, startMinute: 6 * 60 + 35 * n++, durationMin: 30, carersRequired: carers, medicationRequired });
}

async function pool(ctx: Ctx, visitId: string) {
  const v = await db.visit.findUniqueOrThrow({ where: { id: visitId }, include: { assignments: true } });
  return (await visitCandidates(ctx, v, "ANY")).filter((c) => c.state !== "NOT_ELIGIBLE").map((c) => c.id);
}

/** Bookable carers who are also cleared for medication on the visit (the demo data has a medication competency rule). */
async function cleared(ctx: Ctx, visitId: string) {
  const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  const ids = (await pool(ctx, visitId)).filter((id) => id !== restrictedId);
  const c = await medicationCompetence(db, v, ids);
  const ok = ids.filter((id) => c.get(id)?.ok);
  if (ok.length < 4) throw new Error(`Only ${ok.length} carers are cleared for medication in the demo data`);
  return ok;
}

const liveLead = (visitId: string) => db.visitMedicationLead.findFirst({ where: { visitId, endedAt: null } });

/** A carer who is restricted from medication tasks (so never cleared to be the lead). */
let restrictedId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  suId = su.id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  medTaskId = (await db.careTask.findFirstOrThrow({ where: { organisationId: orgId, name: { contains: "medic", mode: "insensitive" } } })).id;
  // Synthetic competency assessments so enough carers are cleared for medication (the demo data clears only a few).
  const req = await db.readinessRequirement.findFirst({ where: { organisationId: orgId, key: "medication-competency" } });
  if (req) {
    const ctx = await manager();
    const staff = await db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE", hrMissing: false }, orderBy: { displayName: "asc" }, take: 12 });
    for (const s of staff) {
      await recordAssessment(ctx, s.id, { requirementId: req.id, careTaskId: medTaskId, method: "OBSERVED", observedEvidence: "Synthetic test: observed medication prompt round", outcome: "COMPETENT", assessedAt: addDays(londonDate(), -10), reviewDue: addDays(londonDate(), 300) }).catch(() => undefined);
    }
  }
}, 240_000);

describe("Medication Lead", () => {
  it("does nothing while medication is switched off", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 1);
    const [a] = await pool(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    expect(await liveLead(v.id)).toBeNull();
    expect(await medicationLeadView(ctx, v.id)).toBeNull();
    await expect(setMedicationLead(ctx, v.id, { staffId: a! })).rejects.toBeInstanceOf(ForbiddenError);
    await setMedicationEnabled(ctx, true, "Reviewed by J. Smith RN for the Medication Lead test");
  });

  it("makes the only carer the lead automatically when they are cleared for medication", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 1);
    const [a] = await cleared(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    const lead = await liveLead(v.id);
    expect(lead).toMatchObject({ staffId: a, source: "AUTO" });
    const view = (await medicationLeadView(ctx, v.id))!;
    expect(view.status).toBe("ASSIGNED");
    expect(view.lead?.place).toBe("Carer 1");
  });

  it("leaves responsibility unassigned and tells the office when the only carer is not cleared", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 1);
    const ids = await pool(ctx, v.id);
    restrictedId = ids[ids.length - 1]!;
    await addRestriction(ctx, restrictedId, { kind: "TASK", careTaskId: medTaskId, reason: "Medication competency not yet assessed", startsAt: addDays(londonDate(), -1) });
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: restrictedId, acceptWarnings: true });
    expect(await liveLead(v.id)).toBeNull();
    const alert = await db.rotaAlert.findFirst({ where: { visitId: v.id, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null } });
    expect(alert?.message).toMatch(/not cleared for medication/);
    await expect(setMedicationLead(ctx, v.id, { staffId: restrictedId })).rejects.toThrow(/not cleared for medication/);
    expect((await medicationLeadView(ctx, v.id))!.status).toBe("UNASSIGNED");
  });

  it("lets a coordinator choose the lead on a four-carer visit, only from the carers booked", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 4);
    const ids = await cleared(ctx, v.id);
    const other = (await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, id: { notIn: ids.slice(0, 4) } } })).id;
    for (const [i, slot] of (["PRIMARY", "SECOND", "C3", "C4"] as const).entries()) await assignCarer(ctx, { visitId: v.id, slot, staffId: ids[i]!, acceptWarnings: true });
    // Carer 1 was the only carer for a moment and became lead automatically; the coordinator then chooses deliberately.
    await unassignCarer(ctx, { visitId: v.id, slot: "PRIMARY", reason: "Rebooking to test the choice" });
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: ids[0]!, acceptWarnings: true });
    expect(await liveLead(v.id)).toBeNull();
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null } })).toBe(1);
    await expect(setMedicationLead(ctx, v.id, { staffId: other })).rejects.toThrow(/booked on this visit/);
    await setMedicationLead(ctx, v.id, { staffId: ids[1]! });
    expect(await liveLead(v.id)).toMatchObject({ staffId: ids[1], source: "COORDINATOR", assignedById: ctx.userId });
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null } })).toBe(0);
    expect((await medicationLeadView(ctx, v.id))!.lead?.place).toBe("Carer 2");
    // Changing the lead needs a reason and keeps the previous record.
    await expect(setMedicationLead(ctx, v.id, { staffId: ids[2]! })).rejects.toThrow(/reason/);
    await setMedicationLead(ctx, v.id, { staffId: ids[2]!, reason: "Senior carer covering the morning round" });
    const all = await db.visitMedicationLead.findMany({ where: { visitId: v.id }, orderBy: { assignedAt: "asc" } });
    // The automatic lead (Carer 1, ended when removed), then the two coordinator choices.
    expect(all.map((h) => [h.staffId, h.source, h.endedAt === null])).toEqual([[ids[0], "AUTO", false], [ids[1], "COORDINATOR", false], [ids[2], "COORDINATOR", true]]);
    expect(all[1]!.endReason).toMatch(/Senior carer covering/);
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "visit.medication_lead.set" } })).toBe(3);
  });

  it("ends responsibility when the lead is removed and asks for reassessment, never moving it silently", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 3);
    const ids = await cleared(ctx, v.id);
    for (const [i, slot] of (["PRIMARY", "SECOND", "C3"] as const).entries()) await assignCarer(ctx, { visitId: v.id, slot, staffId: ids[i]!, acceptWarnings: true });
    await setMedicationLead(ctx, v.id, { staffId: ids[1]!, reason: "Carer 2 holds the medication competency for this person" });
    await unassignCarer(ctx, { visitId: v.id, slot: "SECOND", reason: "Carer off sick" });
    expect(await liveLead(v.id)).toBeNull();
    const ended = await db.visitMedicationLead.findFirstOrThrow({ where: { visitId: v.id, staffId: ids[1]! } });
    expect(ended.endReason).toMatch(/no longer on the visit: Carer off sick/);
    expect(ended.endedById).toBe(ctx.userId);
    const view = (await medicationLeadView(ctx, v.id))!;
    expect(view.status).toBe("NEEDS_REASSESSMENT");
    expect(view.history).toHaveLength(2);
    const alert = await db.rotaAlert.findFirst({ where: { visitId: v.id, kind: "MEDICATION_LEAD_NEEDED", resolvedAt: null } });
    expect(alert?.message).toMatch(/needs reassessing/);
    await setMedicationLead(ctx, v.id, { staffId: ids[2]! });
    expect((await medicationLeadView(ctx, v.id))!.status).toBe("ASSIGNED");
  });

  it("ends responsibility when the lead is replaced in their place", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 2);
    const ids = await cleared(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: ids[0]!, acceptWarnings: true });
    expect((await liveLead(v.id))?.staffId).toBe(ids[0]);
    await assignCarer(ctx, { visitId: v.id, slot: "SECOND", staffId: ids[1]!, acceptWarnings: true });
    // The automatic lead stays while they are still booked.
    expect((await liveLead(v.id))?.staffId).toBe(ids[0]);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: ids[2]!, acceptWarnings: true });
    expect(await liveLead(v.id)).toBeNull();
  });

  it("follows a swap: the lead who swaps away stops being responsible", async () => {
    const ctx = await manager();
    const a = await visit(ctx, 1);
    const b = await visit(ctx, 1, false);
    const ids = await cleared(ctx, a.id);
    await assignCarer(ctx, { visitId: a.id, slot: "PRIMARY", staffId: ids[0]!, acceptWarnings: true });
    await assignCarer(ctx, { visitId: b.id, slot: "PRIMARY", staffId: ids[1]!, acceptWarnings: true });
    expect((await liveLead(a.id))?.staffId).toBe(ids[0]);
    await swapCarers(ctx, { first: { visitId: a.id, slot: "PRIMARY" }, second: { visitId: b.id, slot: "PRIMARY" }, reason: "Swap for continuity", acceptWarnings: true });
    // The incoming single carer is checked and becomes lead automatically.
    expect((await liveLead(a.id))?.staffId).toBe(ids[1]);
    expect(await db.visitMedicationLead.count({ where: { visitId: a.id } })).toBe(2);
  });

  it("refuses a carer or a lead record that is not on the visit, and never edits history (database rules)", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 1);
    const ids = await cleared(ctx, v.id);
    await expect(db.visitMedicationLead.create({ data: { organisationId: orgId, visitId: v.id, staffId: ids[0]!, source: "COORDINATOR", assignedById: ctx.userId } })).rejects.toThrow();
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: ids[0]!, acceptWarnings: true });
    const lead = (await liveLead(v.id))!;
    await expect(db.visitMedicationLead.update({ where: { id: lead.id }, data: { staffId: ids[1]! } })).rejects.toThrow();
    await expect(db.visitMedicationLead.delete({ where: { id: lead.id } })).rejects.toThrow();
  });

  it("is changed only by people who manage the rota", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, medicationLeads: { some: {} } } });
    const lead = (await liveLead(v.id)) ?? (await db.visitMedicationLead.findFirstOrThrow({ where: { visitId: v.id } }));
    await expect(setMedicationLead(await carerCtx(), v.id, { staffId: lead.staffId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates the input", async () => {
    const ctx = await manager();
    const v = await visit(ctx, 2);
    await expect(setMedicationLead(ctx, v.id, { staffId: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("records a missed dose against the Medication Lead only, never the other carers on the visit", async () => {
    const ctx = await manager();
    const checker = { ...(await ctxFor("coordinator@care-solution.demo", BROOKFIELD)), orgRoles: ["CARE_MANAGER" as const] };
    const recent = await db.visit.findMany({ where: { organisationId: orgId, status: "COMPLETED", date: { gte: dbDate(addDays(londonDate(), -2)) } }, include: { assignments: { where: { removedAt: null, slot: { not: "SHADOW" } } } }, orderBy: { scheduledStart: "desc" } });
    const v = recent.find((x) => x.assignments.length >= 2 && rangeOf(londonMinute(x.scheduledStart)));
    if (!v) throw new Error("The demo data has no recent completed double-up in a medication time");
    const lead = v.assignments[1]!;
    await db.visitMedicationLead.create({ data: { organisationId: orgId, visitId: v.id, staffId: lead.staffId, source: "COORDINATOR", assignedById: ctx.userId, assignedAt: v.scheduledStart } });
    const m = await addMedication(ctx, v.serviceUserId, { name: "Amlodipine", strength: "5mg", dose: "1 tablet", route: "ORAL", support: "PROMPT", timeRanges: [rangeOf(londonMinute(v.scheduledStart))!], startDate: addDays(londonDate(), -30) });
    await approveMedication(checker, m.id);
    await db.medication.update({ where: { id: m.id }, data: { approvedAt: new Date(v.scheduledStart.getTime() - 86400_000) } });
    await sweepMissedMedication();
    const alert = await db.rotaAlert.findFirstOrThrow({ where: { organisationId: orgId, kind: "MISSED_MEDICATION", visitId: v.id } });
    expect(alert.staffId).toBe(lead.staffId);
    expect(alert.message).toMatch(/Medication Lead/);
  });
});
