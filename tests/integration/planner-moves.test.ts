import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonMinute, londonToUtc, mondayOf } from "@/lib/london";
import { assignCarer } from "@/server/rota/assign";
import { addToRoute, createLiveRoute, moveToRoute } from "@/server/rota/routes";
import { createVisit, moveVisit, updateVisit } from "@/server/rota/visits";
import { rankCarers } from "@/server/workforce/eligibility";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Advanced Planner operations that change one visit: moving it to another day, onto another carer, between routes. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let callTypeId = "";
let suId = "";
let su2Id = "";
const monday = addDays(mondayOf(londonDate()), 35);

async function allocatable(date: string, minute: number, su: string, exclude: string[] = []) {
  const start = londonToUtc(date, minute);
  const r = await rankCarers(db, orgId, { start, end: new Date(start.getTime() + 30 * 60000), slot: "PRIMARY", serviceUserId: su, careTaskIds: [] });
  return r.filter((x) => x.result.state !== "NOT_ELIGIBLE" && !exclude.includes(x.staff!.id)).map((x) => x.staff!.id);
}

async function booked(date: string, minute: number, staffId: string, su = suId) {
  const ctx = await manager();
  const v = await createVisit(ctx, { serviceUserId: su, callTypeId, date, startMinute: minute, durationMin: 30 });
  await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId, acceptWarnings: true });
  return db.visit.findUniqueOrThrow({ where: { id: v.id } });
}

const carerOn = async (visitId: string) => (await db.visitAssignment.findFirst({ where: { visitId, slot: "PRIMARY", removedAt: null } }))?.staffId ?? null;

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  const sus = await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { reference: "asc" }, take: 2 });
  suId = sus[0]!.id;
  su2Id = sus[1]!.id;
}, 180_000);

describe("moving a visit in the planner", () => {
  it("moves one visit to another day at the same time, keeping its carer, without touching its template", async () => {
    const [a] = await allocatable(monday, 540, suId);
    const v = await booked(monday, 540, a!);
    const to = addDays(monday, 2);
    const moved = await moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", lockVersion: v.lockVersion, toDate: to, staffId: a!, acceptWarnings: true });
    expect(londonDate(moved.scheduledStart)).toBe(to);
    expect(londonMinute(moved.scheduledStart)).toBe(540);
    expect(moved.scheduledEnd.getTime() - moved.scheduledStart.getTime()).toBe(30 * 60000);
    expect(moved.manuallyChanged).toBe(true);
    expect(await carerOn(v.id)).toBe(a);
    // The booking itself moved with the visit, so the carer is free on the old day.
    const booking = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, removedAt: null } });
    expect(booking.startsAt.getTime()).toBe(moved.scheduledStart.getTime());
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "EDITED" } })).toBe(1);
  });

  it("moves a visit to another day and another carer in one step", async () => {
    const [a, b] = await allocatable(addDays(monday, 3), 600, suId);
    const v = await booked(monday, 600, a!);
    await moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", toDate: addDays(monday, 3), staffId: b!, acceptWarnings: true });
    expect(await carerOn(v.id)).toBe(b);
    expect(londonDate((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).scheduledStart)).toBe(addDays(monday, 3));
  });

  it("refuses a move that would double-book the carer and leaves the visit where it was", async () => {
    const [a] = await allocatable(monday, 700, suId);
    await booked(addDays(monday, 4), 700, a!, su2Id);
    const v = await booked(monday, 700, a!);
    await expect(moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", toDate: addDays(monday, 4), staffId: a!, acceptWarnings: true })).rejects.toThrow(/cannot do the new time|already booked/);
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(londonDate(after.scheduledStart)).toBe(monday);
    expect(await carerOn(v.id)).toBe(a);
  });

  it("refuses time-locked visits, moves into the past and stale versions", async () => {
    const [a] = await allocatable(monday, 800, suId);
    const v = await booked(monday, 800, a!);
    await expect(moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", toDate: addDays(londonDate(), -1), staffId: a!, acceptWarnings: true })).rejects.toThrow(/past/);
    await expect(moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", lockVersion: v.lockVersion - 1, toDate: addDays(monday, 1), staffId: a! })).rejects.toThrow(ConflictError);
    const fresh = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    await updateVisit(await manager(), v.id, fresh.lockVersion, { timeLocked: true });
    await expect(moveVisit(await manager(), { visitId: v.id, slot: "PRIMARY", toDate: addDays(monday, 1), staffId: a! })).rejects.toThrow(ValidationError);
  });
});

describe("moving a visit between run routes", () => {
  it("moves a stop straight from one route to another of the same week, and refuses another week's route", async () => {
    const ctx = await manager();
    const [a] = await allocatable(monday, 900, suId);
    const v = await booked(monday, 900, a!);
    const r1 = await createLiveRoute(ctx, { name: "Round A", kind: "AREA", areaId: (await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).areaId!, weekStart: monday, colour: "#1d4f91", textColour: "#ffffff" });
    const r2 = await createLiveRoute(ctx, { name: "Round B", kind: "AREA", areaId: (await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).areaId!, weekStart: monday, colour: "#1c7a43", textColour: "#ffffff" });
    const r3 = await createLiveRoute(ctx, { name: "Round C", kind: "AREA", areaId: (await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).areaId!, weekStart: addDays(monday, 7), colour: "#8a5a00", textColour: "#ffffff" });
    await addToRoute(ctx, "LIVE", r1.id, [v.id]);
    await moveToRoute(ctx, "LIVE", r1.id, r2.id, v.id);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).runRouteId).toBe(r2.id);
    await expect(moveToRoute(ctx, "LIVE", r2.id, r3.id, v.id)).rejects.toThrow(/same week/);
    await expect(moveToRoute(ctx, "LIVE", r1.id, r2.id, v.id)).rejects.toThrow(/not found/i);
    expect(await db.auditLog.count({ where: { action: "rota.route.visit_moved", entityId: r2.id } })).toBe(1);
  });
});
