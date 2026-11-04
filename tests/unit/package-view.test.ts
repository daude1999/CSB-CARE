import { describe, expect, it } from "vitest";
import { attentionFor, carePackageSummary, coverageState, hoursPerWeek, hoursText, isLongText } from "@/server/care/package-view";

/** The Care Package card's view model: structured fields only, honest empty values, warnings backed by stored data. */
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = "2026-11-04";
const pkg = { reference: "LBTH-1088676", status: "ACTIVE" as const, commissionedMinutesPerWeek: 1488, startDate: d("2026-09-30"), endDate: null, funder: { name: "Example Council" } };
const tpl = (name: string, startMinute: number, effectiveTo: string | null = null) => ({ startMinute, effectiveTo: effectiveTo ? d(effectiveTo) : null, callType: { name } });
const cov = (planned: number, carer = planned, commissioned: number | null = 1488) => ({ planned, plannedCarerMinutes: carer, commissioned, difference: commissioned === null ? null : planned - commissioned, templates: 4 });

describe("care package summary", () => {
  it("formats commissioned minutes as hours a week without rounding away quarter hours", () => {
    expect(hoursText(1488)).toBe("24.8");
    expect(hoursText(1485)).toBe("24.75");
    expect(hoursText(600)).toBe("10");
    expect(hoursPerWeek(1488)).toBe("24.8 hours/week");
    expect(hoursPerWeek(null)).toBeNull();
    expect(hoursPerWeek(0)).toBe("0 hours/week");
  });

  it("uses only structured fields and never carries the requirements text", () => {
    const s = carePackageSummary({ pkg: { ...pkg, requirements: "x".repeat(5000) } as typeof pkg, coverage: cov(1488), templates: [tpl("Tea", 990), tpl("Morning", 540), tpl("Bed", 1200), tpl("Lunch", 720)], openQueries: 0, today })!;
    expect(s).not.toHaveProperty("requirements");
    expect(JSON.stringify(s)).not.toContain("xxxx");
    expect(s.reference).toBe("LBTH-1088676");
    expect(s.scheduledCalls).toEqual(["Morning", "Lunch", "Tea", "Bed"]);
    expect(s.funderName).toBe("Example Council");
    expect(s.attention).toEqual([]);
  });

  it("shows missing values as missing, not as zero or a guess", () => {
    const s = carePackageSummary({ pkg: { ...pkg, reference: "  ", commissionedMinutesPerWeek: null, funder: null }, coverage: cov(600, 600, null), templates: [], openQueries: 0, today })!;
    expect(s.reference).toBeNull();
    expect(s.commissionedMinutesPerWeek).toBeNull();
    expect(s.funderName).toBeNull();
    expect(s.scheduledCalls).toEqual([]);
    expect(s.attention).toEqual(["Commissioned hours are not recorded"]);
    expect(carePackageSummary({ pkg: null, coverage: null, templates: [], openQueries: 0, today })).toBeNull();
  });

  it("leaves out templates that ended before today and repeats a call name once", () => {
    const s = carePackageSummary({ pkg, coverage: cov(1488), templates: [tpl("Morning", 540), tpl("Tea", 990, "2026-11-03"), tpl("Domestic", 600), tpl("Domestic", 840), tpl("Bed", 1200, "2026-11-04")], openQueries: 0, today })!;
    expect(s.scheduledCalls).toEqual(["Morning", "Domestic", "Bed"]);
    expect(s.recurringVisits).toBe(4);
  });

  it("warns only from stored values: hours difference, end date and open package questions", () => {
    expect(attentionFor(pkg, cov(1488 - 120), 0, today)).toEqual(["Planned visits are 2 hours a week under the commissioned hours"]);
    expect(attentionFor(pkg, cov(1488 + 20), 0, today)).toEqual([]); // within the 30-minute tolerance
    expect(attentionFor({ ...pkg, endDate: d("2026-11-10") }, cov(1488), 2, today)).toEqual(["Time-limited: ends in 6 days", "2 package queries to review"]);
    expect(attentionFor({ ...pkg, endDate: d("2026-11-01") }, cov(1488), 0, today)).toEqual(["The package end date has passed but it is still active"]);
    expect(attentionFor({ ...pkg, endDate: d("2027-06-01") }, cov(1488), 0, today)).toEqual([]);
    // Words in the requirements text never raise a warning: the function does not even receive it.
    expect(attentionFor({ ...pkg, requirements: "URGENT: funding not verified, hours differ" } as typeof pkg, cov(1488), 0, today)).toEqual([]);
  });

  it("compares visit time and carer time separately, so double-ups are not confused with visit hours", () => {
    // Four 30-minute double-up visits a day: 14 visit hours, 28 carer hours a week.
    const c = coverageState(cov(840, 1680, 1680));
    expect(c.hasDoubleUps).toBe(true);
    expect(c.visit).toEqual({ state: "UNDER", difference: -840 });
    expect(c.carer).toEqual({ state: "MATCHES", difference: 0 });
    expect(coverageState(cov(600, 600, null)).visit.state).toBe("NOT_RECORDED");
  });

  it("collapses long requirements text without cutting it", () => {
    expect(isLongText("short")).toBe(false);
    expect(isLongText("a".repeat(601))).toBe(true);
    expect(isLongText(Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n"))).toBe(true);
  });
});
