import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { updateFinanceSettings } from "@/server/finance/rates";
import { rotaInsights } from "@/server/rota/insights";
import { listVisits } from "@/server/rota/queries";
import { createLiveRoute, addToRoute, getLiveRoute, orderRouteDayByTime, routeGaps } from "@/server/rota/routes";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** Rota Insights figures agree with the visit lists they link to; money is for finance roles; route order by time. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const week = addDays(mondayOf(londonDate()), 7);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("Rota Insights", () => {
  it("reconciles with the visit list for the same week", async () => {
    const r = await rotaInsights(await manager(), { week });
    const { rows } = await listVisits(await manager(), { date: week, to: addDays(week, 6), includeCancelled: true }, 6000);
    const live = rows.filter((v) => v.status !== "CANCELLED");
    expect(r.visits.scheduled).toBe(live.length);
    expect(r.visits.cancelled).toBe(rows.length - live.length);
    expect(r.visits.openSlots).toBe(live.reduce((n, v) => n + v.flags.unassignedSlots, 0));
    expect(r.visits.allocated + r.visits.unallocated + r.visits.partDoubleUps + r.visits.notDelivered).toBe(r.visits.scheduled);
    expect(r.hours.scheduledCarer).toBeGreaterThanOrEqual(r.hours.scheduledCare);
  });

  it("shows money only to finance roles, and the on-cost assumption changes only the estimate", async () => {
    expect((await rotaInsights(await coordinator(), { week })).finance).toBeNull();
    const runs = await db.payRun.count({ where: { organisationId: orgId } });
    const before = (await rotaInsights(await manager(), { week })).finance!;
    expect(before.onCostPercent).toBe(0);
    const fs = await db.financeSettings.findUniqueOrThrow({ where: { organisationId: orgId } });
    await updateFinanceSettings(await manager(), { defaultPayRateCardId: fs.defaultPayRateCardId ?? "", payBasis: fs.payBasis, mileage: "0.45", invoicePrefix: fs.invoicePrefix, estimateOnCostPercent: "25" });
    const after = (await rotaInsights(await manager(), { week })).finance!;
    expect(after.onCostPercent).toBe(25);
    if (before.total.pricedVisits) expect(after.total.pricedCostPence).toBeGreaterThan(before.total.pricedCostPence);
    expect(after.total.pricedRevenuePence).toBe(before.total.pricedRevenuePence);
    await expect(updateFinanceSettings(await manager(), { payBasis: "ACTUAL", mileage: "0.45", invoicePrefix: "INV", estimateOnCostPercent: "120" })).rejects.toThrow();
    // Estimates never create pay records.
    expect(await db.payRun.count({ where: { organisationId: orgId } })).toBe(runs);
  });

  it("puts a route day in time order, within the organisation only", async () => {
    const area = await db.area.findFirstOrThrow({ where: { organisationId: orgId } });
    const route = await createLiveRoute(await manager(), { name: "Gap check", kind: "AREA", areaId: area.id, weekStart: week, colour: "#1d3f73", textColour: "#ffffff" });
    const day = addDays(week, 2);
    const vs = await db.visit.findMany({ where: { organisationId: orgId, areaId: area.id, date: dbDate(day), status: "SCHEDULED" }, orderBy: { scheduledStart: "desc" }, take: 3 });
    expect(vs.length).toBeGreaterThanOrEqual(2);
    await addToRoute(await manager(), "LIVE", route.id, vs.map((v) => v.id));
    // Reverse the order by hand so the route is out of time order.
    for (const [i, v] of vs.entries()) await db.visit.update({ where: { id: v.id }, data: { routeOrder: i + 1 } });
    const stops = (await getLiveRoute(await manager(), route.id)).visits.filter((v) => v.date.getTime() === dbDate(day).getTime());
    if (stops[0]!.scheduledStart.getTime() !== stops[1]!.scheduledStart.getTime()) expect(routeGaps(stops).some((g) => g.kinds.includes("OUT_OF_ORDER"))).toBe(true);
    await expect(orderRouteDayByTime(await ctxFor("manager@oakridge.demo", OAKRIDGE), route.id, day)).rejects.toThrow(/not found/i);
    await orderRouteDayByTime(await manager(), route.id, day);
    const after = (await getLiveRoute(await manager(), route.id)).visits.filter((v) => v.date.getTime() === dbDate(day).getTime());
    expect(routeGaps(after).some((g) => g.kinds.includes("OUT_OF_ORDER"))).toBe(false);
  });
});
