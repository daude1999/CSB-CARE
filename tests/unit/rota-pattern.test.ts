import { describe, expect, it } from "vitest";
import { durationLabel, patternLabel, templateCoverage, weekdaysLabel } from "@/lib/rota-pattern";

describe("Daily Templates labels", () => {
  it("names the cycle weeks from the template's own record", () => {
    expect(patternLabel([1, 2, 3, 4], 4)).toBe("All Weeks");
    expect(patternLabel([2], 4)).toBe("Week 2");
    expect(patternLabel([3, 1], 4)).toBe("Weeks 1 and 3");
    expect(patternLabel([1, 2, 4], 4)).toBe("Weeks 1, 2 and 4");
    expect(patternLabel([1, 2], 2)).toBe("All Weeks");
    expect(patternLabel([1], 1)).toBe("Every week");
    // A week beyond a shortened cycle is never built, so it is not shown.
    expect(patternLabel([1, 3], 2)).toBe("Week 1");
    expect(patternLabel([3, 4], 2)).toBe("Not in the current cycle");
  });

  it("names the weekdays", () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(weekdaysLabel([5, 4, 3, 2, 1])).toBe("Weekdays (Mon–Fri)");
    expect(weekdaysLabel([6, 7])).toBe("Weekends");
    expect(weekdaysLabel([1, 3, 5])).toBe("Mon, Wed and Fri");
    expect(weekdaysLabel([2])).toBe("Tue");
  });

  it("counts carer coverage once per template, double-ups included", () => {
    expect(templateCoverage({ carersRequired: 1, preferredStaff1Id: "a", preferredStaff2Id: null })).toEqual({ filled: 1, required: 1, state: "full" });
    expect(templateCoverage({ carersRequired: 2, preferredStaff1Id: "a", preferredStaff2Id: "b" })).toEqual({ filled: 2, required: 2, state: "full" });
    expect(templateCoverage({ carersRequired: 2, preferredStaff1Id: "a", preferredStaff2Id: null })).toEqual({ filled: 1, required: 2, state: "part" });
    expect(templateCoverage({ carersRequired: 2, preferredStaff1Id: null, preferredStaff2Id: null })).toEqual({ filled: 0, required: 2, state: "none" });
    // A stale second carer on a single-carer template does not count.
    expect(templateCoverage({ carersRequired: 1, preferredStaff1Id: null, preferredStaff2Id: "b" })).toEqual({ filled: 0, required: 1, state: "none" });
  });

  it("formats durations", () => {
    expect(durationLabel(45)).toBe("45m");
    expect(durationLabel(90)).toBe("1h 30m");
    expect(durationLabel(120)).toBe("2h 00m");
  });
});
