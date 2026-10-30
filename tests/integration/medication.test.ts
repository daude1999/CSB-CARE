import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, fromDbDate, londonDate, londonMinute } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { addMedication, approveMedication, correctDose, listMedications, marChart, medsForMyVisit, missedMedsCount, rangeOf, recordDose, setMedicationEnabled, stopMedication, sweepMissedMedication, type MedInput } from "@/server/care/medication";
import { clockMine } from "@/server/rota/attendance";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Medication and MAR records against a real database: the switch, second-person approval, dose rules, the missed sweep and scope. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
/** A second person allowed to approve medicines (the demo has one care manager, so the coordinator is given the role here). */
const checker = async () => ({ ...(await coordinator()), orgRoles: ["CARE_MANAGER" as const] });
let orgId = "";
let ameliaId = "";
const MIN = 60_000;

function at(d: Date, minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(d.getTime() + minutes * MIN));
}

/** One of the carer's future published visits that falls in a medication time range, skipping `skip` of them. */
async function ameliaVisit(skip = 0) {
  const vs = await db.visit.findMany({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 2 * 86400_000) }, assignments: { some: { staffId: ameliaId, removedAt: null } } }, orderBy: { scheduledStart: "asc" } });
  const ok = vs.filter((v) => rangeOf(londonMinute(v.scheduledStart)));
  const v = ok[skip];
  if (!v) throw new Error("No suitable visit in the demo data");
  const range = rangeOf(londonMinute(v.scheduledStart));
  if (!range) throw new Error("unreachable");
  return { v, range };
}

function med(range: "MORNING" | "LUNCH" | "TEA" | "BED", over: Partial<MedInput> = {}): MedInput {
  return { name: "Paracetamol", strength: "500mg", dose: "2 tablets", route: "ORAL", support: "PROMPT", timeRanges: [range], startDate: addDays(londonDate(), -30), ...over };
}

async function activeMed(serviceUserId: string, input: MedInput) {
  const m = await addMedication(await manager(), serviceUserId, input);
  await approveMedication(await checker(), m.id);
  return m;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
}, 180_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("medication switch", () => {
  it("stays off until an admin switches it on with a clinical review note", async () => {
    const { v, range } = await ameliaVisit();
    await expect(addMedication(await manager(), v.serviceUserId, med(range))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await missedMedsCount(orgId, [v.id])).toBeNull();
    expect(await medsForMyVisit(orgId, v)).toBeNull();
    await expect(setMedicationEnabled(await coordinator(), true, "Reviewed by the registered nurse today")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setMedicationEnabled(await manager(), true, "ok")).rejects.toBeInstanceOf(ValidationError);
    await setMedicationEnabled(await manager(), true, "Reviewed by J. Smith RN, 30 Oct 2026");
    const s = await db.rotaSettings.findUniqueOrThrow({ where: { organisationId: orgId } });
    expect(s.medicationReviewNote).toBe("Reviewed by J. Smith RN, 30 Oct 2026");
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "medication.enabled" } })).toBe(1);
    expect(await missedMedsCount(orgId, [v.id])).toBe(0);
  });
});

describe("medicines", () => {
  it("needs a second person to approve, and the database refuses self-approval and edits after approval", async () => {
    const { v, range } = await ameliaVisit();
    const me = await manager();
    await expect(addMedication(me, v.serviceUserId, med(range, { timeRanges: [] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(addMedication(await coordinator(), v.serviceUserId, med(range))).rejects.toBeInstanceOf(ForbiddenError);
    const m = await addMedication(me, v.serviceUserId, med(range, { name: "Amlodipine", dose: "1 tablet" }));
    expect(m.status).toBe("DRAFT");
    // A draft is not due on visits.
    expect((await medsForMyVisit(orgId, v))?.some((x) => x.med.id === m.id)).toBe(false);
    await expect(approveMedication(me, m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.medication.update({ where: { id: m.id }, data: { status: "ACTIVE", approvedById: me.userId, approvedAt: new Date() } })).rejects.toThrow(/Someone other/);
    await approveMedication(await checker(), m.id);
    await expect(approveMedication(await checker(), m.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(db.medication.update({ where: { id: m.id }, data: { dose: "4 tablets" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.medication.delete({ where: { id: m.id } })).rejects.toThrow(/cannot be deleted/);
    expect((await medsForMyVisit(orgId, v))?.some((x) => x.med.id === m.id)).toBe(true);

    // A change is a new medicine that replaces the old one when approved; the old one stops and is kept.
    const change = await addMedication(me, v.serviceUserId, med(range, { name: "Amlodipine", dose: "2 tablets" }), { replacesId: m.id, reason: "GP increased the dose" });
    await approveMedication(await checker(), change.id);
    const old = await db.medication.findUniqueOrThrow({ where: { id: m.id } });
    expect(old.status).toBe("STOPPED");
    expect(old.stopReason).toContain("GP increased the dose");
    await expect(stopMedication(me, change.id, "x")).rejects.toBeInstanceOf(ValidationError);
    await stopMedication(me, change.id, "Course finished");
    await expect(stopMedication(me, change.id, "Again")).rejects.toBeInstanceOf(ConflictError);
    const list = await listMedications(me, v.serviceUserId);
    expect(list.filter((x) => x.name === "Amlodipine").map((x) => x.status).sort()).toEqual(["STOPPED", "STOPPED"]);
  });
});

describe("recording doses", () => {
  it("needs a clock-in and a reason for a refusal, records a scheduled dose once, and keeps records permanent", async () => {
    const { v, range } = await ameliaVisit(1);
    const m = await activeMed(v.serviceUserId, med(range, { name: "Metformin", dose: "500mg" }));
    const extra = await activeMed(v.serviceUserId, med(range, { name: "Senna", dose: "1 tablet" }));
    const me = await carer();
    at(v.scheduledStart, 1);
    await expect(recordDose(me, v.id, { medicationId: m.id, outcome: "PROMPTED" })).rejects.toThrow(/Clock in/);
    await clockMine(me, v.id, "IN", { nonce: `med-${v.id}` });
    await expect(recordDose(me, v.id, { medicationId: m.id, outcome: "REFUSED" })).rejects.toBeInstanceOf(ValidationError);
    const r = await recordDose(me, v.id, { medicationId: m.id, outcome: "PROMPTED" });
    await expect(recordDose(me, v.id, { medicationId: m.id, outcome: "PROMPTED" })).rejects.toBeInstanceOf(ConflictError);
    await expect(db.marRecord.update({ where: { id: r.id }, data: { outcome: "GIVEN" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.marRecord.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/);

    // A refusal raises an exception for the office.
    await recordDose(me, v.id, { medicationId: extra.id, outcome: "REFUSED", reason: "Said they had already taken it" });
    expect(await db.rotaAlert.count({ where: { organisationId: orgId, kind: "MEDICATION_NOT_TAKEN", visitId: v.id } })).toBe(1);
    vi.useRealTimers();

    // The office corrects a record: the new one supersedes the old, which stays on file.
    await expect(correctDose(await coordinator(), r.id, { outcome: "GIVEN", reason: "Carer pressed the wrong button" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctDose(await manager(), r.id, { outcome: "GIVEN", reason: "no" })).rejects.toBeInstanceOf(ValidationError);
    const fixed = await correctDose(await manager(), r.id, { outcome: "GIVEN", reason: "Carer pressed the wrong button" });
    expect(fixed.supersedesId).toBe(r.id);
    expect((await db.marRecord.findUniqueOrThrow({ where: { id: r.id } })).supersededAt).not.toBeNull();
    await expect(correctDose(await manager(), r.id, { outcome: "REFUSED", reason: "Second correction" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.marRecord.count({ where: { visitId: v.id, medicationId: m.id } })).toBe(2);
  });

  it("needs a witness for a controlled drug and stops 'as required' doses at the daily limit", async () => {
    const { v, range } = await ameliaVisit(2);
    const cd = await activeMed(v.serviceUserId, med(range, { name: "Morphine sulfate oral solution", dose: "5ml", support: "ADMINISTER", controlled: true }));
    const prn = await activeMed(v.serviceUserId, med(range, { name: "Ibuprofen", dose: "1 tablet", timeRanges: [], asRequired: true, maxDosesPerDay: 1 }));
    const me = await carer();
    at(v.scheduledStart, 1);
    await clockMine(me, v.id, "IN", { nonce: `med-${v.id}` });
    await expect(recordDose(me, v.id, { medicationId: cd.id, outcome: "GIVEN" })).rejects.toThrow(/witness/);
    await recordDose(me, v.id, { medicationId: cd.id, outcome: "GIVEN", witnessName: "Pat Daughter" });
    await recordDose(me, v.id, { medicationId: prn.id, outcome: "GIVEN" });
    await expect(recordDose(me, v.id, { medicationId: prn.id, outcome: "GIVEN" })).rejects.toThrow(/most doses a day/);
    // A medicine not due on this visit cannot be recorded on it.
    const other = await activeMed(v.serviceUserId, med(range === "BED" ? "MORNING" : "BED", { name: "Simvastatin", dose: "20mg" }));
    await expect(recordDose(me, v.id, { medicationId: other.id, outcome: "GIVEN" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a carer recording on someone else's visit", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, assignments: { none: { staffId: ameliaId } } } });
    const m = await db.medication.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    await expect(recordDose(await carer(), v.id, { medicationId: m.id, outcome: "GIVEN" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("missed medication and the MAR chart", () => {
  it("raises one critical exception for a completed visit with a due dose not recorded, and shows it on the chart", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "COMPLETED", date: { gte: new Date(`${addDays(londonDate(), -2)}T00:00:00Z`) } }, orderBy: { scheduledStart: "desc" } });
    const range = rangeOf(londonMinute(v.scheduledStart));
    if (!range) throw new Error("The demo's latest completed visit is outside the medication times");
    const m = await activeMed(v.serviceUserId, med(range, { name: "Levothyroxine", dose: "50mcg" }));
    // Approved after the visit: it could not have been given, so it is not missed.
    expect(await sweepMissedMedication()).toBe(0);
    // Approved before the visit (the approval time is not part of the locked content).
    await db.medication.update({ where: { id: m.id }, data: { approvedAt: new Date(v.scheduledStart.getTime() - 86400_000) } });
    expect(await sweepMissedMedication()).toBeGreaterThanOrEqual(1);
    const alert = await db.rotaAlert.findFirstOrThrow({ where: { organisationId: orgId, kind: "MISSED_MEDICATION", visitId: v.id } });
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.deadline).not.toBeNull();
    expect(await sweepMissedMedication()).toBe(0);
    expect(await missedMedsCount(orgId, [v.id])).toBe(1);

    const day = fromDbDate(v.date);
    const chart = await marChart(await manager(), v.serviceUserId, day.slice(0, 7));
    const row = chart.grid.find((g) => g.med.id === m.id);
    expect(row?.cells.find((c) => c.day === day)?.missed).toBeGreaterThanOrEqual(1);
    await expect(marChart(await manager(), v.serviceUserId, "October")).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps branch-limited members to their branches' people", async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, area: { branch: { name: "Portsmouth" } } } });
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const mem = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), mem.id, [liverpool.id]);
    try {
      await expect(listMedications(await coordinator(), su.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(marChart(await coordinator(), su.id, londonDate().slice(0, 7))).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(await manager(), mem.id, []);
    }
  });

  it("switching off hides the figures again but keeps the records", async () => {
    const before = await db.marRecord.count({ where: { organisationId: orgId } });
    await setMedicationEnabled(await manager(), false, "");
    expect(await missedMedsCount(orgId, ["x"])).toBeNull();
    expect(await db.marRecord.count({ where: { organisationId: orgId } })).toBe(before);
  });
});
