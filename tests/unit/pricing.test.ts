import { describe, expect, it } from "vitest";
import { parsePounds, pickBand, price, priceVisit, type Band } from "@/server/finance/pricing";

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
