import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { unassignCarer } from "@/server/rota/assign";
import { applyPlan, decideChanges, discardPlan, generatePlan, getPlan, publishPlanVisits } from "@/server/rota/optimise";
import { updateVisit } from "@/server/rota/visits";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Generate & Optimise: a plan proposes carers (and small time changes) for open slots without touching the rota; only
 * accepted changes are applied, each through the normal assignment path, and a visit changed since the plan is left
 * alone.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const day = addDays(mondayOf(londonDate()), 9); // Wednesday next week
const liveAssignments = () => db.visitAssignment.count({ where: { organisationId: orgId, removedAt: null } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  // Open some slots: take the carer off a few of that day's visits.
  const taken = await db.visitAssignment.findMany({ where: { organisationId: orgId, removedAt: null, slot: "PRIMARY", visit: { date: dbDate(day), status: "SCHEDULED", carersRequired: 1 } }, include: { visit: true }, orderBy: { startsAt: "asc" }, take: 6 });
  for (const a of taken) await unassignCarer(await manager(), { visitId: a.visitId, slot: "PRIMARY", reason: "Opened for the optimiser test" });
}, 180_000);

describe("Generate & Optimise", () => {
  let planId = "";

  it("validates its settings and needs rota.build", async () => {
    await expect(generatePlan(await manager(), { from: day, days: 9, gapMinutes: 10, maxShiftMinutes: 15 })).rejects.toThrow();
    await expect(generatePlan(await manager(), { from: day, days: 1, gapMinutes: 10, maxShiftMinutes: 7 })).rejects.toThrow(/steps of 5/);
    await expect(generatePlan(await ctxFor("finance@care-solution.demo", BROOKFIELD), { from: day, days: 1, gapMinutes: 10, maxShiftMinutes: 15 })).rejects.toThrow();
  });

  it("proposes only eligible carers, never double-books, and changes nothing on the rota", async () => {
    const before = await liveAssignments();
    const plan = await generatePlan(await manager(), { from: day, days: 1, gapMinutes: 10, maxShiftMinutes: 15, respectWeeklyLimits: true });
    planId = plan.id;
    expect(await liveAssignments()).toBe(before);
    const { summary, changes } = await getPlan(await manager(), plan.id);
    expect(summary.openSlots).toBeGreaterThanOrEqual(6);
    expect(summary.proposed + summary.unfilled.length).toBeGreaterThanOrEqual(summary.openSlots);
    expect(summary.travelLabel).toMatch(/No distances or driving times/);
    const assigns = changes.filter((c) => c.kind === "ASSIGN");
    expect(assigns.length).toBeGreaterThan(0);
    for (const c of assigns) {
      const v = await db.visit.findUniqueOrThrow({ where: { id: c.visitId } });
      const retime = changes.find((x) => x.visitId === c.visitId && x.kind === "RETIME");
      const r = await eligibilityFor(db, orgId, { staffId: c.staffId!, start: retime?.toStart ?? v.scheduledStart, end: retime?.toEnd ?? v.scheduledEnd, slot: c.slot!, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId });
      expect(r.state).not.toBe("NOT_ELIGIBLE");
    }
    // No carer is proposed for two overlapping visits.
    const times = await Promise.all(assigns.map(async (c) => ({ staffId: c.staffId!, ...(await db.visit.findUniqueOrThrow({ where: { id: c.visitId }, select: { scheduledStart: true, scheduledEnd: true } })) })));
    for (const a of times) for (const b of times) if (a !== b && a.staffId === b.staffId) expect(a.scheduledEnd <= b.scheduledStart || b.scheduledEnd <= a.scheduledStart).toBe(true);
  });

  it("is invisible to another organisation", async () => {
    await expect(getPlan(await ctxFor("manager@oakridge.demo", OAKRIDGE), planId)).rejects.toThrow(/not found/i);
  });

  it("applies only accepted changes through the normal path, and refuses a visit changed since", async () => {
    const { changes } = await getPlan(await manager(), planId);
    const assigns = changes.filter((c) => c.kind === "ASSIGN" && !changes.some((x) => x.visitId === c.visitId && x.kind === "RETIME"));
    expect(assigns.length).toBeGreaterThanOrEqual(2);
    const [keep, stale, ...rest] = assigns;
    await decideChanges(await manager(), planId, [keep!.id, stale!.id], "ACCEPTED");
    if (rest[0]) await decideChanges(await manager(), planId, [rest[0].id], "REJECTED");
    // Someone edits the second visit after the plan was made.
    const sv = await db.visit.findUniqueOrThrow({ where: { id: stale!.visitId } });
    await updateVisit(await manager(), sv.id, sv.lockVersion, { notes: "Edited after the plan" });

    const r = await applyPlan(await manager(), planId);
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(1);
    const booked = await db.visitAssignment.findFirst({ where: { visitId: keep!.visitId, slot: keep!.slot!, removedAt: null } });
    expect(booked?.staffId).toBe(keep!.staffId);
    expect(await db.visitEvent.count({ where: { visitId: keep!.visitId, type: "ASSIGNED", data: { path: ["source"], equals: "optimiser" } } })).toBe(1);
    expect(await db.visitAssignment.count({ where: { visitId: stale!.visitId, removedAt: null } })).toBe(0);
    const after = await getPlan(await manager(), planId);
    expect(after.changes.find((c) => c.id === stale!.id)!.decision).toBe("FAILED");
    expect(after.changes.find((c) => c.id === stale!.id)!.outcome).toMatch(/changed since/);
    if (rest[0]) expect(await db.visitAssignment.count({ where: { visitId: rest[0].visitId, removedAt: null } })).toBe(0);
    await expect(applyPlan(await manager(), planId)).rejects.toThrow(/already been applied/);
    await expect(decideChanges(await manager(), planId, [keep!.id], "REJECTED")).rejects.toThrow(/already been applied/);
    expect((await publishPlanVisits(await manager(), planId)).failed).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "RotaPlan", entityId: planId } })).toBe(2);
  });

  it("can be discarded without changing the rota", async () => {
    const before = await liveAssignments();
    const plan = await generatePlan(await manager(), { from: day, days: 1, gapMinutes: 10, maxShiftMinutes: 0 });
    await discardPlan(await manager(), plan.id);
    expect(await liveAssignments()).toBe(before);
    await expect(applyPlan(await manager(), plan.id)).rejects.toThrow(/discarded/);
  });
});
