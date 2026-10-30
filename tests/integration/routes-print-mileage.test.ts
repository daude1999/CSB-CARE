import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { decideMileage, listMileage, submitMyMileage } from "@/server/finance/mileage";
import { printableRota } from "@/server/rota/print";
import { addToRoute, contrastRatio, createLiveRoute, createTemplateRoute, getLiveRoute, getTemplateRoute, listLiveRoutes, moveStop, removeFromRoute, removeRoute } from "@/server/rota/routes";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Run routes, printable rotas and mileage claims against a real database. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ameliaId = "";
const week = () => mondayOf(londonDate());

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
}, 180_000);

describe("run routes", () => {
  it("checks the colours can be read and a carer route has a carer", async () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    await expect(createLiveRoute(await coordinator(), { name: "Pale", kind: "CARER", staffId: ameliaId, weekStart: week(), colour: "#ffffee", textColour: "#ffffff" })).rejects.toThrow(/hard to read/);
    await expect(createLiveRoute(await coordinator(), { name: "Nobody", kind: "CARER", weekStart: week(), colour: "#1a6b8f", textColour: "#ffffff" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("puts a carer's visits on a live route in the order set by hand, and removing the route leaves the visits", async () => {
    const r = await createLiveRoute(await coordinator(), { name: "Amelia AM", kind: "CARER", staffId: ameliaId, weekStart: week(), colour: "#1a6b8f", textColour: "#ffffff" });
    await expect(createLiveRoute(await coordinator(), { name: "Amelia AM", kind: "CARER", staffId: ameliaId, weekStart: week(), colour: "#1a6b8f", textColour: "#ffffff" })).rejects.toBeInstanceOf(ConflictError);
    const { candidates } = await getLiveRoute(await coordinator(), r.id);
    const day = candidates[0]!.date.getTime();
    const sameDay = candidates.filter((v) => v.date.getTime() === day).slice(0, 3);
    expect(sameDay.length).toBeGreaterThan(1);
    expect(await addToRoute(await coordinator(), "LIVE", r.id, sameDay.map((v) => v.id))).toBe(sameDay.length);
    await expect(addToRoute(await coordinator(), "LIVE", r.id, [sameDay[0]!.id])).rejects.toBeInstanceOf(ConflictError);
    await moveStop(await coordinator(), "LIVE", r.id, sameDay[1]!.id, "up");
    const after = (await getLiveRoute(await coordinator(), r.id)).visits.filter((v) => v.date.getTime() === day).map((v) => v.id);
    expect(after[0]).toBe(sameDay[1]!.id);
    await removeFromRoute(await coordinator(), "LIVE", r.id, sameDay[2]!.id);
    expect((await db.visit.findUniqueOrThrow({ where: { id: sameDay[2]!.id } })).runRouteId).toBeNull();
    expect((await listLiveRoutes(await coordinator())).current.some((x) => x.id === r.id)).toBe(true);
    await removeRoute(await coordinator(), "LIVE", r.id);
    expect(await db.visit.count({ where: { id: { in: sameDay.map((v) => v.id) } } })).toBe(sameDay.length);
    expect(await db.runRoute.count({ where: { id: r.id } })).toBe(0);
  });

  it("keeps template routes in round order and carries the order into built visits", async () => {
    const r = await createTemplateRoute(await coordinator(), { name: "Amelia round", kind: "CARER", staffId: ameliaId, colour: "#4b2a7a", textColour: "#ffffff" });
    const { candidates } = await getTemplateRoute(await coordinator(), r.id);
    const two = candidates.slice(0, 2);
    expect(two.length).toBe(2);
    await addToRoute(await coordinator(), "TEMPLATE", r.id, two.map((t) => t.id));
    await moveStop(await coordinator(), "TEMPLATE", r.id, two[1]!.id, "up");
    const order = (await getTemplateRoute(await coordinator(), r.id)).templates.map((t) => t.id);
    expect(order).toEqual([two[1]!.id, two[0]!.id]);
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: two[1]!.id } })).routeOrder).toBe(1);
  });

  it("keeps branch-limited coordinators away from other branches' routes", async () => {
    const r = await createLiveRoute(await manager(), { name: "Amelia PM", kind: "CARER", staffId: ameliaId, weekStart: week(), colour: "#1a6b8f", textColour: "#ffffff" });
    const amelia = await db.staffMember.findUniqueOrThrow({ where: { id: ameliaId } });
    const other = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, ...(amelia.branchId ? { NOT: { id: amelia.branchId } } : {}) } });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [other.id]);
    try {
      if (amelia.branchId) await expect(getLiveRoute(await coordinator(), r.id)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(await manager(), m.id, []);
    }
  });
});

describe("printable rota", () => {
  it("makes a PDF per carer, refuses too long a range, and records the print", async () => {
    const { pdf, filename } = await printableRota(await coordinator(), { kind: "CARER", ids: [ameliaId], from: week(), to: addDays(week(), 6) });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(filename).toMatch(/^rota-team-/);
    await expect(printableRota(await coordinator(), { kind: "CARER", ids: [ameliaId], from: week(), to: addDays(week(), 40) })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "rota.print" } })).toBe(1);
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId } });
    const p2 = await printableRota(await coordinator(), { kind: "SERVICE_USER", ids: [su.id], from: week(), to: addDays(week(), 6), excludeSurname: true });
    expect(p2.pdf.length).toBeGreaterThan(500);
  });

  it("only includes key safe codes for people allowed to see them", async () => {
    // A compliance lead can view and print the rota but not key safe codes.
    const lead = { ...(await manager()), orgRoles: ["COMPLIANCE_LEAD" as const] };
    await expect(printableRota(lead, { kind: "CARER", ids: [ameliaId], from: week(), to: week(), keySafe: true })).rejects.toBeInstanceOf(ForbiddenError);
    await printableRota(lead, { kind: "CARER", ids: [ameliaId], from: week(), to: week() });
    await printableRota(await manager(), { kind: "CARER", ids: [ameliaId], from: week(), to: addDays(week(), 6), keySafe: true });
    const last = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "rota.print" }, orderBy: { createdAt: "desc" } });
    expect((last.data as { keySafes?: number }).keySafes).toBeGreaterThanOrEqual(0);
  });
});

describe("mileage claims", () => {
  it("lets a carer claim, refuses future dates, and someone else decides", async () => {
    const me = await carer();
    await expect(submitMyMileage(me, { date: addDays(londonDate(), 1), miles: 5, reason: "Tomorrow" })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitMyMileage(me, { date: londonDate(), miles: 0, reason: "None" })).rejects.toBeInstanceOf(ValidationError);
    const c = await submitMyMileage(me, { date: londonDate(), miles: 12.34, reason: "Between morning visits" });
    expect(c.miles).toBe(12.3);
    const fin = await ctxFor("finance@care-solution.demo", BROOKFIELD);
    expect((await listMileage(fin, {})).rows.some((r) => r.id === c.id)).toBe(true);
    await expect(decideMileage(fin, c.id, "REJECTED", "")).rejects.toBeInstanceOf(ValidationError);
    await decideMileage(fin, c.id, "APPROVED", "");
    await expect(decideMileage(fin, c.id, "REJECTED", "Changed mind")).rejects.toBeInstanceOf(ConflictError);
    expect((await db.mileageClaim.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("APPROVED");
    expect(await db.notification.count({ where: { dedupeKey: `mileage-decided:${c.id}` } })).toBe(1);
    expect(dbDate(londonDate()).getTime()).toBe(c.date.getTime());
  });
});
