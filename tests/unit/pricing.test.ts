import { describe, expect, it } from "vitest";
import { addDays, isoWeekday, londonMinute } from "@/lib/london";
import { parsePounds, pickBand, price, priceAtCutOff, priceVisit, priceWork, splitWork, type Band } from "@/server/finance/pricing";

const band = (b: Partial<Band> & Pick<Band, "label" | "ratePence">): Band => ({ weekdays: [1, 2, 3, 4, 5], fromMinute: 0, toMinute: 1440, bankHoliday: false, unit: "PER_HOUR", minimumMinutes: null, ...b });
const card: Band[] = [
  band({ label: "Weekday", ratePence: 2400 }),
  band({ label: "Weekday evening", ratePence: 2700, fromMinute: 18 * 60, toMinute: 1440 }),
  band({ label: "Weekend", ratePence: 2800, weekdays: [6, 7] }),
  band({ label: "Bank holiday", ratePence: 3600, weekdays: [], bankHoliday: true }),
];

describe("pricing", () => {
  it("picks the narrowest matching band, and the bank-holiday band on a bank holiday", () => {
    expect(pickBand(card, 2, 9 * 60, false)?.label).toBe("Weekday");
    expect(pickBand(card, 2, 19 * 60, false)?.label).toBe("Weekday evening");
    expect(pickBand(card, 6, 9 * 60, false)?.label).toBe("Weekend");
    expect(pickBand(card, 2, 9 * 60, true)?.label).toBe("Bank holiday");
    expect(pickBand([band({ label: "Weekday", ratePence: 1 })], 7, 600, false)).toBeNull();
  });

  it("prices per hour in whole pence, applies minimums, and prices per visit as a flat amount", () => {
    expect(price(band({ label: "x", ratePence: 2400 }), 30).amountPence).toBe(1200);
    expect(price(band({ label: "x", ratePence: 2500 }), 25).amountPence).toBe(1042); // 1041.67 rounds
    expect(price(band({ label: "x", ratePence: 2400, minimumMinutes: 30 }), 15)).toMatchObject({ amountPence: 1200, minutes: 30 });
    expect(price(band({ label: "x", ratePence: 1500, unit: "PER_VISIT" }), 45).amountPence).toBe(1500);
    expect(priceVisit(card, { weekday: 3, startMinute: 18 * 60 + 30, minutes: 30, bankHoliday: false })).toMatchObject({ bandLabel: "Weekday evening", amountPence: 1350 });
  });

  it("reads money typed by people", () => {
    expect(parsePounds("12.5")).toBe(1250);
    expect(parsePounds("£24.00")).toBe(2400);
    expect(parsePounds("7")).toBe(700);
    expect(parsePounds("-3")).toBeNull();
    expect(parsePounds("1.234")).toBeNull();
  });
});


describe("overnight and cut-off splitting", () => {
  const next = (d: string) => addDays(d, 1);
  // 2026-11-06 is a Friday, so a Friday night runs into the weekend band at midnight.
  it("splits a Friday night at the evening band and at midnight, pricing each stretch at its own band", () => {
    const parts = splitWork(card, "2026-11-06", 22 * 60, 9 * 60, () => false, next, isoWeekday);
    expect(parts.map((p) => [p.date, p.band?.label, p.minutes])).toEqual([["2026-11-06", "Weekday evening", 120], ["2026-11-07", "Weekend", 420]]);
    const p = priceWork(parts)!;
    expect(p.amountPence).toBe(2 * 2700 + 7 * 2800);
    expect(p.minutes).toBe(540);
    expect(p.split).toBe(true);
    expect(p.bandLabel).toBe("Weekday evening + Weekend");
  });

  it("splits a day visit that runs into the evening band", () => {
    const p = priceWork(splitWork(card, "2026-11-03", 17 * 60 + 30, 60, () => false, next, isoWeekday))!;
    expect(p.amountPence).toBe(1200 + 1350);
  });

  it("gives only the bank-holiday minutes the bank-holiday rate", () => {
    const parts = splitWork(card, "2026-12-24", 23 * 60, 120, (d) => d === "2026-12-25", next, isoWeekday);
    expect(parts.map((x) => x.band?.label)).toEqual(["Weekday evening", "Bank holiday"]);
    expect(priceWork(parts)!.amountPence).toBe(2700 + 3600);
  });

  it("keeps a visit inside one band unsplit, prices per-visit bands once, and makes up a minimum at the first band", () => {
    const one = priceWork(splitWork(card, "2026-11-03", 9 * 60, 45, () => false, next, isoWeekday))!;
    expect(one).toMatchObject({ amountPence: 1800, split: false, bandLabel: "Weekday" });
    const flat = [band({ label: "Flat", ratePence: 1500, unit: "PER_VISIT", weekdays: [1, 2, 3, 4, 5, 6, 7] })];
    expect(priceWork(splitWork(flat, "2026-11-06", 23 * 60, 120, () => false, next, isoWeekday))).toMatchObject({ amountPence: 1500 });
    const min = [band({ label: "Min", ratePence: 2400, minimumMinutes: 30, weekdays: [1, 2, 3, 4, 5, 6, 7] })];
    expect(priceWork(splitWork(min, "2026-11-03", 600, 15, () => false, next, isoWeekday))).toMatchObject({ amountPence: 1200, minutes: 30 });
  });

  it("refuses to guess when part of the work has no band", () => {
    const weekdaysOnly = [band({ label: "Weekday", ratePence: 2400 })];
    expect(priceWork(splitWork(weekdaysOnly, "2026-11-06", 23 * 60, 120, () => false, next, isoWeekday))).toBeNull();
  });
});

describe("pay period cut-off and clock changes", () => {
  const next = (d: string) => addDays(d, 1);
  it("pays a Sunday night up to midnight and leaves the rest for next week's run", () => {
    // 2026-11-08 is a Sunday: weekend until midnight, then Monday's weekday band.
    const cut = priceAtCutOff(splitWork(card, "2026-11-08", 23 * 60, 120, () => false, next, isoWeekday), "2026-11-08")!;
    expect(cut.head).toMatchObject({ minutes: 60, amountPence: 2800 });
    expect(cut.tail).toMatchObject({ minutes: 60, amountPence: 2400 });
  });

  it("does not split work that ends inside the period, or a per-visit band", () => {
    expect(priceAtCutOff(splitWork(card, "2026-11-07", 23 * 60, 120, () => false, next, isoWeekday), "2026-11-08")!.tail).toBeNull();
    const flat = [band({ label: "Flat", ratePence: 1500, unit: "PER_VISIT", weekdays: [1, 2, 3, 4, 5, 6, 7] })];
    expect(priceAtCutOff(splitWork(flat, "2026-11-08", 23 * 60, 120, () => false, next, isoWeekday), "2026-11-08")).toMatchObject({ head: { amountPence: 1500 }, tail: null });
  });

  it("pays a minimum with the head, counted on the whole visit", () => {
    const min = [band({ label: "Min", ratePence: 2400, minimumMinutes: 60, weekdays: [1, 2, 3, 4, 5, 6, 7] })];
    const cut = priceAtCutOff(splitWork(min, "2026-11-08", 23 * 60 + 40, 30, () => false, next, isoWeekday), "2026-11-08")!;
    expect(cut.tail).toMatchObject({ minutes: 10, amountPence: 400 });
    expect(cut.head.minutes + (cut.tail?.minutes ?? 0)).toBe(60);
    expect(cut.head.amountPence + (cut.tail?.amountPence ?? 0)).toBe(2400);
  });

  it("keeps every minute across the October 2026 clock change", () => {
    // 25 Oct 2026: clocks go back at 02:00, so the night of the 24th has an extra hour. Ten worked hours stay ten.
    expect(londonMinute(new Date("2026-10-25T00:30:00Z"))).toBe(90); // 01:30 BST
    expect(londonMinute(new Date("2026-10-25T01:30:00Z"))).toBe(90); // 01:30 GMT, the repeated hour
    const parts = splitWork(card, "2026-10-24", 22 * 60, 600, () => false, next, isoWeekday);
    expect(parts.reduce((n, p) => n + p.minutes, 0)).toBe(600);
    expect(priceWork(parts)!.amountPence).toBe(10 * 2800);
    // And on 28 Mar 2027, when an hour is lost, eight worked hours are still paid as eight.
    expect(priceWork(splitWork(card, "2027-03-27", 23 * 60, 480, () => false, next, isoWeekday))!.minutes).toBe(480);
  });
});
