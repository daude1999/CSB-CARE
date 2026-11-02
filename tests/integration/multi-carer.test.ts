import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { openPlaces, placeKey, preferredOf, staffingOf, type PlaceKey } from "@/lib/carer-places";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { bulkVisits, createVisit, setCarersRequired } from "@/server/rota/visits";
import { bulkTemplates, createTemplate, setTemplateCarer } from "@/server/rota/templates";
import { previewBuild } from "@/server/rota/build";
import { previewRollForward } from "@/server/rota/roll-forward";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { visitCandidates } from "@/server/rota/queries";
import { coverWorkspace } from "@/server/rota/replacement-cover";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Flexible multi-carer visits: any number of carers from 1 to 20, each in its own numbered place, through every path
 * that books or plans carers. Visits are synthetic, on days the demo rota does not use.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
type Ctx = Awaited<ReturnType<typeof manager>>;
let orgId = "";
let suId = "";
let callTypeId = "";
const DAY = addDays(londonDate(), 11);
let slotNo = 0;

async function newVisit(ctx: Ctx, carers: number, day = DAY) {
  const start = 6 * 60 + 35 * slotNo++;
  return createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: start, durationMin: 30, carersRequired: carers });
}

async function live(visitId: string) {
  return db.visitAssignment.findMany({ where: { visitId, removedAt: null }, orderBy: { position: "asc" } });
}

/** Carers the eligibility service allows on this visit (eligible or requiring review), best first. */
async function allowedCarers(ctx: Ctx, visitId: string) {
  const v = await db.visit.findUniqueOrThrow({ where: { id: visitId }, include: { assignments: true } });
  return (await visitCandidates(ctx, v, "ANY")).filter((c) => c.state !== "NOT_ELIGIBLE").map((c) => c.id);
}

async function fill(ctx: Ctx, visitId: string, places: PlaceKey[]) {
  const pool = await allowedCarers(ctx, visitId);
  if (pool.length < places.length) throw new Error(`Only ${pool.length} carers are free for this test visit`);
  for (const [i, slot] of places.entries()) await assignCarer(ctx, { visitId, slot, staffId: pool[i]!, acceptWarnings: true });
  return pool;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  suId = su.id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
}, 240_000);

describe("Carers needed", () => {
  it("accepts 1 to 20 carers on a new visit (presets and a custom number) and refuses anything else", async () => {
    const ctx = await manager();
    for (const n of [1, 3, 6, 9, 20]) expect((await newVisit(ctx, n)).carersRequired).toBe(n);
    await expect(newVisit(ctx, 21)).rejects.toThrow(/at most 20 carers/);
    await expect(newVisit(ctx, 0)).rejects.toThrow(/at least one carer/);
    await expect(newVisit(ctx, 2.5)).rejects.toThrow(/whole number/);
  });

  it("is guarded by the database too", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(db.visit.update({ where: { id: v.id }, data: { carersRequired: 21 } })).rejects.toThrow();
    await expect(db.visit.update({ where: { id: v.id }, data: { carersRequired: 0 } })).rejects.toThrow();
  });
});

describe("Numbered carer places", () => {
  it("assigns a different carer to each place of a three-carer visit, in order, and reports it fully staffed", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    await fill(ctx, v.id, ["PRIMARY", "SECOND"]);
    let rows = await live(v.id);
    expect(staffingOf(3, rows.length)).toBe("PARTIAL");
    expect(openPlaces(3, rows)).toEqual(["C3"]);
    await fill(ctx, v.id, ["C3"]);
    rows = await live(v.id);
    expect(rows.map((a) => [a.slot, a.position])).toEqual([["PRIMARY", 1], ["SECOND", 2], ["ADDITIONAL", 3]]);
    expect(new Set(rows.map((a) => a.staffId)).size).toBe(3);
    expect(staffingOf(3, rows.length)).toBe("FULL");
  });

  it("refuses a place above the number needed, a place already taken, and the same carer twice", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    const pool = await fill(ctx, v.id, ["PRIMARY"]);
    await expect(assignCarer(ctx, { visitId: v.id, slot: "C4", staffId: pool[1]!, acceptWarnings: true })).rejects.toThrow(/needs 3 carers/);
    // The same person in a second place is refused by the eligibility service (and by the database underneath).
    await expect(assignCarer(ctx, { visitId: v.id, slot: "C3", staffId: pool[0]!, acceptWarnings: true })).rejects.toThrow();
    expect((await live(v.id)).length).toBe(1);
  });

  it("removes and replaces one place while the others stay booked, keeping the history", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 4);
    const pool = await fill(ctx, v.id, ["PRIMARY", "SECOND", "C3", "C4"]);
    await unassignCarer(ctx, { visitId: v.id, slot: "C3", reason: "Carer unwell" });
    let rows = await live(v.id);
    expect(rows.map(placeKey)).toEqual(["PRIMARY", "SECOND", "C4"]);
    const removed = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, position: 3 } });
    expect(removed.removedAt).not.toBeNull();
    expect(removed.staffId).toBe(pool[2]);
    // Replace: a new carer takes place 3.
    const fresh = (await allowedCarers(ctx, v.id)).find((id) => !pool.slice(0, 4).includes(id))!;
    await assignCarer(ctx, { visitId: v.id, slot: "C3", staffId: fresh, acceptWarnings: true });
    rows = await live(v.id);
    expect(rows.map((a) => [placeKey(a), a.staffId])).toEqual([["PRIMARY", pool[0]], ["SECOND", pool[1]], ["C3", fresh], ["C4", pool[3]]]);
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: { in: ["ASSIGNED", "UNASSIGNED"] } } })).toBeGreaterThanOrEqual(6);
  });

  it("never removes a carer silently: lowering the number is refused while a higher place is filled", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    await fill(ctx, v.id, ["PRIMARY", "SECOND", "C3"]);
    const lock = (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).lockVersion;
    await expect(setCarersRequired(ctx, v.id, 2, lock)).rejects.toThrow(ValidationError);
    expect((await live(v.id)).length).toBe(3);
    await unassignCarer(ctx, { visitId: v.id, slot: "C3", reason: "Only two needed now" });
    await setCarersRequired(ctx, v.id, 2, (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).lockVersion);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).carersRequired).toBe(2);
    // Raising adds an empty place; nobody moves.
    await setCarersRequired(ctx, v.id, 6, (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).lockVersion);
    expect(openPlaces(6, await live(v.id))).toEqual(["C3", "C4", "C5", "C6"]);
  });

  it("refuses a stale change to the number of carers", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 2);
    await expect(setCarersRequired(ctx, v.id, 3, v.lockVersion + 5)).rejects.toThrow(ConflictError);
  });

  it("stores places 3+ as numbered extra places and the database rejects a mismatched number", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    const [a] = await allowedCarers(ctx, v.id);
    await expect(db.visitAssignment.create({ data: { organisationId: orgId, visitId: v.id, staffId: a!, slot: "ADDITIONAL", position: 2, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: ctx.userId } })).rejects.toThrow();
  });
});

describe("Unassigned, bulk and cover", () => {
  it("lists a part-staffed visit with the exact places still open", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 5);
    await fill(ctx, v.id, ["PRIMARY", "SECOND"]);
    const board = await unassignedBoard(ctx, parseUnassigned({ when: "custom", from: DAY, to: DAY, staffing: "partial" }));
    const item = board.items.find((i) => i.visit.id === v.id)!;
    expect(item.openSlots).toEqual(["C3", "C4", "C5"]);
    expect(item.reason).toMatch(/3 of 5 carers still needed/);
  });

  it("changes the number of carers in bulk and refuses visits that would lose a carer", async () => {
    const ctx = await manager();
    const a = await newVisit(ctx, 1);
    const b = await newVisit(ctx, 3);
    await fill(ctx, b.id, ["PRIMARY", "SECOND", "C3"]);
    const res = await bulkVisits(ctx, [a.id, b.id], { kind: "doubleUp", carers: 2 });
    expect(res.find((r) => r.visitId === a.id)!.ok).toBe(true);
    expect(res.find((r) => r.visitId === b.id)!.ok).toBe(false);
    expect((await db.visit.findUniqueOrThrow({ where: { id: a.id } })).carersRequired).toBe(2);
    expect((await live(b.id)).length).toBe(3);
    expect((await bulkVisits(ctx, [a.id], { kind: "doubleUp", carers: 7 }))[0]!.ok).toBe(true);
    await expect(bulkVisits(ctx, [a.id], { kind: "doubleUp", carers: 25 })).rejects.toThrow();
  });

  it("assigns a carer to place 3 in bulk", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    const [first] = await allowedCarers(ctx, v.id);
    const [r] = await bulkVisits(ctx, [v.id], { kind: "assign", staffId: first!, slot: "C3", acceptWarnings: true });
    expect(r!.ok).toBe(true);
    expect((await live(v.id)).map(placeKey)).toEqual(["C3"]);
  });

  it("offers Find Replacement Cover for place 3", async () => {
    const ctx = await manager();
    const v = await newVisit(ctx, 3);
    await fill(ctx, v.id, ["PRIMARY", "SECOND"]);
    const w = await coverWorkspace(ctx, { mode: "fill", id: v.id, slot: "C3" }, {});
    if (w.kind !== "visit") throw new Error("Expected visit cover");
    expect(w.slot).toBe("C3");
  });
});

describe("Templates, build and roll forward", () => {
  it("keeps a preferred carer per place on a four-carer template and builds four places", async () => {
    const ctx = await manager();
    const staff = await db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE", hrMissing: false }, take: 4, orderBy: { displayName: "asc" } });
    const today = londonDate();
    const t = await createTemplate(ctx, {
      serviceUserId: suId, callTypeId, cycleWeeks: [1, 2, 3, 4], weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 4 * 60 + 15, durationMin: 30,
      carersRequired: 4, preferredStaff1Id: staff[0]!.id, preferredStaff2Id: staff[1]!.id, extraPreferredStaffIds: [staff[2]!.id, ""], effectiveFrom: today,
    });
    expect(preferredOf(t)).toEqual([staff[0]!.id, staff[1]!.id, staff[2]!.id, null]);
    // The same person in two places is refused.
    await expect(createTemplate(ctx, { serviceUserId: suId, callTypeId, cycleWeeks: [1], weekdays: [1], startMinute: 300, durationMin: 30, carersRequired: 3, preferredStaff1Id: staff[0]!.id, extraPreferredStaffIds: [staff[0]!.id], effectiveFrom: today })).rejects.toThrow(/different person/);
    // Set place 4 directly.
    await setTemplateCarer(ctx, t.id, t.version, "C4", staff[3]!.id);
    expect(preferredOf(await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } }))[3]).toBe(staff[3]!.id);

    const week = mondayOf(addDays(today, 7 * 30));
    const plan = await previewBuild(ctx, { weekStart: week, cycleWeek: 1 });
    const mine = plan.visits.filter((p) => p.templateId === t.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const p of mine) {
      expect(p.carersRequired).toBe(4);
      expect(p.slots.filter((s) => s.slot !== "SHADOW").map((s) => s.slot)).toEqual(["PRIMARY", "SECOND", "C3", "C4"]);
    }

    // Lowering the template trims the extra preferences beyond the new number.
    await bulkTemplates(ctx, [t.id], { kind: "doubleUp", carers: 3 });
    const t3 = await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(t3.carersRequired).toBe(3);
    expect(preferredOf(t3)).toEqual([staff[0]!.id, staff[1]!.id, staff[2]!.id]);
  });

  it("rolls a three-carer visit forward with all three places", async () => {
    const ctx = await manager();
    const source = mondayOf(addDays(londonDate(), 14));
    const v = await newVisit(ctx, 3, addDays(source, 2));
    await fill(ctx, v.id, ["PRIMARY", "SECOND", "C3"]);
    const plan = await previewRollForward(ctx, { sourceWeek: source, targetWeek: addDays(source, 7), weeks: 1 });
    const rolled = plan.visits.find((r) => r.sourceVisitId === v.id)!;
    expect(rolled.carersRequired).toBe(3);
    expect(rolled.slots.filter((s) => s.slot !== "SHADOW").map((s) => s.slot)).toEqual(["PRIMARY", "SECOND", "C3"]);
    expect(rolled.slots.every((s) => s.fromStaffId)).toBe(true);
  });
});

describe("Existing records", () => {
  it("reads every older carer booking as place 1 or 2 with the right number", async () => {
    const odd = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "VisitAssignment" WHERE (slot = 'PRIMARY' AND position <> 1) OR (slot = 'SECOND' AND position <> 2) OR (slot = 'SHADOW' AND position <> 0)`;
    expect(Number(odd[0]!.n)).toBe(0);
  });

});
