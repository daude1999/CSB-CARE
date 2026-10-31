import { describe, expect, it } from "vitest";
import type { RateBand, RateCard } from "@prisma/client";
import { estimateVisit, totals, type EstimateFacts, type EstimateVisit } from "@/server/finance/estimates";
import { gapSummary, routeGaps } from "@/server/rota/routes";

const band = (ratePence: number): RateBand => ({ id: `b${ratePence}`, rateCardId: "", label: "Day", weekdays: [1, 2, 3, 4, 5, 6, 7], fromMinute: 0, toMinute: 1440, bankHoliday: false, ratePence, unit: "HOURLY", minimumMinutes: null }) as unknown as RateBand;
const card = (id: string, kind: "PAY" | "CHARGE", ratePence: number) => ({ id, organisationId: "o", kind, name: id, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, bands: [band(ratePence)] }) as unknown as RateCard & { bands: RateBand[] };

const facts = (over: Partial<EstimateFacts> = {}): EstimateFacts => ({
  chargeCards: [card("charge", "CHARGE", 2400)],
  payCards: [card("pay", "PAY", 1200), card("senior", "PAY", 1500)],
  payRates: [{ staffId: "s2", rateCardId: "senior", effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
  defaultPayCardId: "pay",
  onCostPercent: 0,
  holidays: new Set(),
  packages: new Map([["su", [{ funderId: "f", startDate: new Date("2026-01-01"), endDate: null, status: "ACTIVE", funder: { id: "f", name: "Council", chargeRateCardId: "charge" } }]]]),
  ...over,
});
const visit = (over: Partial<EstimateVisit> = {}): EstimateVisit => ({ id: "v", date: new Date("2026-11-04"), scheduledStart: new Date("2026-11-04T09:00:00Z"), scheduledEnd: new Date("2026-11-04T10:00:00Z"), status: "SCHEDULED", carersRequired: 1, chargeable: true, payable: true, serviceUserId: "su", assignments: [{ staffId: "s1", slot: "PRIMARY" }], ...over });

describe("rota cost and revenue estimates", () => {
  it("prices charge from the funder's card and pay from the carer's card, with on-costs", () => {
    expect(estimateVisit(visit(), facts())).toMatchObject({ revenuePence: 2400, costPence: 1200, issues: [] });
    expect(estimateVisit(visit({ assignments: [{ staffId: "s2", slot: "PRIMARY" }] }), facts()).costPence).toBe(1500);
    expect(estimateVisit(visit(), facts({ onCostPercent: 20 })).costPence).toBe(1440);
  });

  it("charges both carers on a double-up and prices an open slot at the default rate", () => {
    const e = estimateVisit(visit({ carersRequired: 2 }), facts());
    expect(e.revenuePence).toBe(4800);
    expect(e.costPence).toBe(2400);
    expect(e.openSlotsPriced).toBe(1);
  });

  it("reports missing rates instead of guessing, and keeps unpriced visits out of the margin", () => {
    const noFunder = estimateVisit(visit({ serviceUserId: "other" }), facts());
    expect(noFunder.revenuePence).toBeNull();
    expect(noFunder.issues[0]!.kind).toBe("NO_FUNDER");
    const noPay = estimateVisit(visit(), facts({ defaultPayCardId: null }));
    expect(noPay.costPence).toBeNull();
    const t = totals([estimateVisit(visit(), facts()), noFunder]);
    expect(t.pricedVisits).toBe(1);
    expect(t.marginPence).toBe(1200);
    expect(t.marginPercent).toBe(50);
    expect(t.missingRevenue).toBe(1);
  });

  it("does not charge a missed visit and ignores cancelled ones", () => {
    expect(estimateVisit(visit({ status: "MISSED" }), facts()).revenuePence).toBe(0);
    expect(estimateVisit(visit({ status: "CANCELLED" }), facts())).toMatchObject({ revenuePence: 0, costPence: 0 });
  });
});

describe("run route time-gap check", () => {
  const stop = (id: string, start: string, end: string, status = "SCHEDULED") => ({ id, status, scheduledStart: new Date(`2026-11-04T${start}:00Z`), scheduledEnd: new Date(`2026-11-04T${end}:00Z`) });

  it("finds overlaps, tight gaps, long waits and stops out of time order", () => {
    const gaps = routeGaps([stop("a", "08:00", "08:30"), stop("b", "08:20", "08:50"), stop("c", "08:55", "09:30"), stop("d", "12:00", "12:30"), stop("e", "11:00", "11:30")]);
    expect(gaps.map((g) => g.kinds)).toEqual([["OVERLAP"], ["TIGHT"], ["IDLE"], ["OUT_OF_ORDER"]]);
    expect(gapSummary(gaps)).toEqual({ overlaps: 1, tight: 1, idle: 1, outOfOrder: 1 });
    expect(gaps[1]!.text).toMatch(/travel time is not worked out/);
  });

  it("skips cancelled stops", () => {
    expect(routeGaps([stop("a", "08:00", "08:30"), stop("x", "08:10", "08:40", "CANCELLED"), stop("b", "09:00", "09:30")]).map((g) => g.kinds)).toEqual([[]]);
  });
});
