import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonMinute } from "@/lib/london";
import { placeKey } from "@/lib/carer-places";
import { setMedicationEnabled } from "@/server/care/medication";
import { medicationCompetence } from "@/server/care/medication-lead";
import { recordAssessment } from "@/server/readiness";
import { assignCarer } from "@/server/rota/assign";
import { createVisit } from "@/server/rota/visits";
import { visitCandidates } from "@/server/rota/queries";
import { saveVisitStaffing, StaffingPlaceError } from "@/server/rota/staffing";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Save Changes in the Visit Details panel: several carer changes saved together, all or nothing, through the shared
 * assignment path (eligibility, double-booking, history, audit, Medication Lead). Visits are synthetic, on a day the
 * demo rota does not use.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
type Ctx = Awaited<ReturnType<typeof manager>>;
let orgId = "";
let suId = "";
let callTypeId = "";
const DAY = addDays(londonDate(), 13);
let n = 0;

async function newVisit(ctx: Ctx, carers: number, medicationRequired = false) {
  return createVisit(ctx, { serviceUserId: suId, callTypeId, date: DAY, startMinute: 6 * 60 + 35 * n++, durationMin: 30, carersRequired: carers, medicationRequired });
}
const fresh = (id: string) => db.visit.findUniqueOrThrow({ where: { id } });
const live = async (visitId: string) => Object.fromEntries((await db.visitAssignment.findMany({ where: { visitId, removedAt: null } })).map((a) => [placeKey(a), a.staffId]));

async function pool(ctx: Ctx, visitId: string, state?: "ELIGIBLE") {
  const v = await db.visit.findUniqueOrThrow({ where: { id: visitId }, include: { assignments: true } });
  return (await visitCandidates(ctx, v, "ANY")).filter((c) => (state ? c.state === state : c.state !== "NOT_ELIGIBLE")).map((c) => c.id);
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  suId = su.id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
}, 240_000);

describe("Save Changes for a visit's carers", () => {
  it("adds a carer to an empty place and saves it, with history and an audit of before and after", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const [a] = await pool(ctx, v.id);
    const r = await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: a! }], acceptWarnings: true });
    expect(r).toMatchObject({ changes: 1, summary: "1 change saved" });
    expect(await live(v.id)).toEqual({ PRIMARY: a });
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "ASSIGNED" } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: v.id, action: "visit.staffing_saved" } });
    expect(log.data).toMatchObject({ before: { carersRequired: 1, places: {} }, after: { carersRequired: 1, places: { PRIMARY: a } } });
    // The Unassigned board no longer lists the visit.
    const board = await unassignedBoard(ctx, parseUnassigned({ when: "custom", from: DAY, to: DAY }));
    expect(JSON.stringify(board)).not.toContain(v.id);
  });

  it("replaces a carer and keeps the replaced booking in the history", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const [a, b] = await pool(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    const now = await fresh(v.id);
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: now.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: b! }], acceptWarnings: true });
    expect(await live(v.id)).toEqual({ PRIMARY: b });
    const old = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, staffId: a! } });
    expect(old.removedAt).not.toBeNull();
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "REASSIGNED" } })).toBe(1);
  });

  it("removes a carer with the default reason when none is given", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 2);
    const [a, b] = await pool(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    await assignCarer(ctx, { visitId: v.id, slot: "SECOND", staffId: b!, acceptWarnings: true });
    const now = await fresh(v.id);
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: now.lockVersion, carersRequired: 2, places: [{ place: "SECOND", staffId: null }] });
    expect(await live(v.id)).toEqual({ PRIMARY: a });
    expect((await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, staffId: b! } })).removeReason).toBe("Removed by the office");
  });

  it("saves several changes together: a new place, a replacement and a move between places", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 2);
    const [a, b, c, d] = await pool(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    await assignCarer(ctx, { visitId: v.id, slot: "SECOND", staffId: b!, acceptWarnings: true });
    const now = await fresh(v.id);
    // a moves to carer 3, c takes carer 1, d replaces b in carer 2.
    const r = await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: now.lockVersion, carersRequired: 3, places: [{ place: "PRIMARY", staffId: c! }, { place: "SECOND", staffId: d! }, { place: "C3", staffId: a! }], acceptWarnings: true });
    expect(r.changes).toBe(4);
    expect(await live(v.id)).toEqual({ PRIMARY: c, SECOND: d, C3: a });
    expect((await fresh(v.id)).carersRequired).toBe(3);
  });

  it("is all or nothing: one refused carer leaves the visit exactly as it was, and names the place", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 2);
    const ids = await pool(ctx, v.id);
    const [a, b] = ids;
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    // b is booked at the same time on another visit, so b cannot also do this one.
    const clash = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: DAY, startMinute: londonMinute(v.scheduledStart), durationMin: 30, carersRequired: 1 });
    await assignCarer(ctx, { visitId: clash.id, slot: "PRIMARY", staffId: b!, acceptWarnings: true });
    const before = await fresh(v.id);
    const other = ids.find((x) => x !== a && x !== b)!;
    const err = await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: before.lockVersion, carersRequired: 2, places: [{ place: "PRIMARY", staffId: other }, { place: "SECOND", staffId: b! }], acceptWarnings: true }).catch((e) => e);
    expect(err).toBeInstanceOf(StaffingPlaceError);
    expect((err as StaffingPlaceError).place).toBe("SECOND");
    expect((err as Error).message).toMatch(/^Carer 2:/);
    expect(await live(v.id)).toEqual({ PRIMARY: a });
    expect((await fresh(v.id)).lockVersion).toBe(before.lockVersion);
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "visit.staffing_saved" } })).toBe(0);
  });

  it("refuses a carer who is not eligible", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const full = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { assignments: true } });
    const blocked = (await visitCandidates(ctx, full, "ANY")).find((c) => c.state === "NOT_ELIGIBLE");
    expect(blocked, "the demo data has at least one carer who is not eligible").toBeTruthy();
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: blocked!.id }], acceptWarnings: true })).rejects.toThrow(/Carer 1: Cannot allocate/);
    expect(await live(v.id)).toEqual({});
  });

  it("refuses the same carer in two places and a save with nothing changed", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 2);
    const [a] = await pool(ctx, v.id);
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 2, places: [{ place: "PRIMARY", staffId: a! }, { place: "SECOND", staffId: a! }] })).rejects.toThrow(/same carer/);
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 2, places: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("asks for the warnings to be read before booking a carer who needs a check", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const full = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { assignments: true } });
    const review = (await visitCandidates(ctx, full, "ANY")).find((c) => c.state === "REQUIRES_REVIEW");
    expect(review, "a carer who needs a check for this visit").toBeTruthy();
    if (!review) return;
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: review.id }] })).rejects.toThrow(/Needs your confirmation/);
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: review.id }], acceptWarnings: true });
    expect(await live(v.id)).toEqual({ PRIMARY: review.id });
  });

  it("never overwrites a colleague's newer save", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const [a, b] = await pool(ctx, v.id);
    const seen = v.lockVersion;
    // A colleague saves first.
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: seen, carersRequired: 1, places: [{ place: "PRIMARY", staffId: a! }], acceptWarnings: true });
    const err = await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: seen, carersRequired: 1, places: [{ place: "PRIMARY", staffId: b! }], acceptWarnings: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/^Someone else changed this visit/);
    expect(await live(v.id)).toEqual({ PRIMARY: a });
  });

  it("never drops a place that still has a carer, and drops an empty one when asked", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    const [a, b] = await pool(ctx, v.id);
    await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    await assignCarer(ctx, { visitId: v.id, slot: "C3", staffId: b!, acceptWarnings: true });
    let now = await fresh(v.id);
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: now.lockVersion, carersRequired: 2, places: [] })).rejects.toThrow(/before lowering/);
    expect(await live(v.id)).toEqual({ PRIMARY: a, C3: b });
    // Removing carer 3 and the place in one save is a deliberate choice, so it is allowed.
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: now.lockVersion, carersRequired: 2, places: [{ place: "C3", staffId: null }] });
    now = await fresh(v.id);
    expect(now.carersRequired).toBe(2);
    expect(await live(v.id)).toEqual({ PRIMARY: a });
  });

  it("keeps a missed visit missed when its carers change, and refuses a completed one", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    await db.visit.update({ where: { id: v.id }, data: { status: "MISSED" } });
    const missed = await fresh(v.id);
    const [a] = await pool(ctx, v.id);
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: missed.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: a! }], acceptWarnings: true });
    expect((await fresh(v.id)).status).toBe("MISSED");
    // The number of carers is not changed on a missed visit.
    await expect(saveVisitStaffing(ctx, { visitId: v.id, lockVersion: (await fresh(v.id)).lockVersion, carersRequired: 2, places: [] })).rejects.toThrow(/missed visit/);

    const done = await db.visit.findFirst({ where: { organisationId: orgId, status: "COMPLETED" }, include: { assignments: { where: { removedAt: null } } } });
    if (done) {
      const other = (await pool(ctx, v.id)).find((x) => !done.assignments.some((y) => y.staffId === x));
      await expect(saveVisitStaffing(ctx, { visitId: done.id, lockVersion: done.lockVersion, carersRequired: done.carersRequired, places: [{ place: "PRIMARY", staffId: other! }], acceptWarnings: true })).rejects.toThrow(/completed visit/);
    }
  });

  it("is only for people who manage the rota, inside their own organisation", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 1);
    const [a] = await pool(ctx, v.id);
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(saveVisitStaffing(carer, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: a! }] })).rejects.toBeInstanceOf(ForbiddenError);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(saveVisitStaffing(oak, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: a! }] })).rejects.toThrow(/not found/i);
    expect(await live(v.id)).toEqual({});
  });
});

describe("Medication Lead after Save Changes", () => {
  it("follows the existing rules: an only carer who is cleared becomes the lead, and replacing them ends it", async () => {
    const ctx = await manager();
    await setMedicationEnabled(ctx, true, "Reviewed by J. Smith RN for the visit panel test");
    const req = await db.readinessRequirement.findFirst({ where: { organisationId: orgId, key: "medication-competency" } });
    const medTask = await db.careTask.findFirst({ where: { organisationId: orgId, name: { contains: "medic", mode: "insensitive" } } });
    if (req && medTask) {
      const staff = await db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE", hrMissing: false }, orderBy: { displayName: "asc" }, take: 12 });
      for (const s of staff) await recordAssessment(ctx, s.id, { requirementId: req.id, careTaskId: medTask.id, method: "OBSERVED", observedEvidence: "Synthetic test: observed medication prompt round", outcome: "COMPETENT", assessedAt: addDays(londonDate(), -10), reviewDue: addDays(londonDate(), 300) }).catch(() => undefined);
    }
    const v = await newVisit(ctx, 2, true);
    const ids = await pool(ctx, v.id);
    const comp = await medicationCompetence(db, await fresh(v.id), ids);
    const ok = ids.filter((id) => comp.get(id)?.ok);
    expect(ok.length, "cleared carers in the demo data").toBeGreaterThanOrEqual(2);
    // Lower to one carer and book a cleared carer in one save: they become the lead automatically.
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: v.lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: ok[0]! }], acceptWarnings: true });
    expect((await db.visitMedicationLead.findFirst({ where: { visitId: v.id, endedAt: null } }))?.staffId).toBe(ok[0]);
    await saveVisitStaffing(ctx, { visitId: v.id, lockVersion: (await fresh(v.id)).lockVersion, carersRequired: 1, places: [{ place: "PRIMARY", staffId: ok[1]! }], acceptWarnings: true });
    const leads = await db.visitMedicationLead.findMany({ where: { visitId: v.id }, orderBy: { assignedAt: "asc" } });
    expect(leads[0]!.endedAt).not.toBeNull();
    const liveLead = leads.find((l) => !l.endedAt);
    // Either the new only carer took over automatically, or nobody holds it: it never stays with someone who left.
    expect(liveLead?.staffId ?? null).not.toBe(ok[0]);
  });
});

