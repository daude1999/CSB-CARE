import { describe, expect, it } from "vitest";
import { addDays, cycleWeekOf, hhmm, isoWeekday, londonClock, londonDate, londonMinute, londonToUtc, mondayOf, parseHhmm } from "@/lib/london";

describe("Europe/London wall-clock times", () => {
  it("converts winter (GMT) and summer (BST) times to the right instant", () => {
    expect(londonToUtc("2026-01-15", 9 * 60).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(londonToUtc("2026-07-15", 9 * 60).toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });
  it("keeps visits on the days the clocks change at the intended local time", () => {
    // Clocks go forward at 01:00 GMT on 29 March 2026 and back at 01:00 GMT on 25 October 2026.
    expect(londonToUtc("2026-03-29", 7 * 60).toISOString()).toBe("2026-03-29T06:00:00.000Z");
    expect(londonToUtc("2026-10-25", 7 * 60).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    const start = londonToUtc("2026-03-29", 0);
    const end = londonToUtc("2026-03-30", 0);
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(23);
  });
  it("round-trips dates and minutes", () => {
    const d = londonToUtc("2026-10-29", 17 * 60 + 30);
    expect(londonDate(d)).toBe("2026-10-29");
    expect(londonMinute(d)).toBe(17 * 60 + 30);
    // An overnight visit ending after midnight belongs to the next London date.
    expect(londonDate(new Date(londonToUtc("2026-10-29", 23 * 60).getTime() + 90 * 60000))).toBe("2026-10-30");
  });
  it("works out weekdays, Mondays and cycle weeks", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(cycleWeekOf("2026-10-19", "2026-10-19", 4)).toBe(1);
    expect(cycleWeekOf("2026-11-09", "2026-10-19", 4)).toBe(4);
    expect(cycleWeekOf("2026-11-16", "2026-10-19", 4)).toBe(1);
    expect(cycleWeekOf("2026-10-12", "2026-10-19", 4)).toBe(4);
  });
  it("parses and formats times of day", () => {
    expect(parseHhmm("07:05")).toBe(425);
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("7.30")).toBeNull();
    expect(hhmm(425)).toBe("07:05");
  });
});

describe("Overview header clock", () => {
  it("shows the London date and 24-hour time on both sides of a clock change", () => {
    // Winter (GMT): London matches UTC.
    expect(londonClock(new Date("2026-11-01T20:15:00Z"))).toEqual({ date: "Sun, 1 Nov 2026", time: "20:15" });
    // Summer (BST): London is an hour ahead, so 23:30 UTC is already the next day.
    expect(londonClock(new Date("2026-07-15T23:30:00Z"))).toEqual({ date: "Thu, 16 Jul 2026", time: "00:30" });
    // The night the clocks went back (25 Oct 2026, 02:00 BST becomes 01:00 GMT).
    expect(londonClock(new Date("2026-10-25T00:30:00Z")).time).toBe("01:30");
    expect(londonClock(new Date("2026-10-25T01:30:00Z")).time).toBe("01:30");
    expect(londonClock(new Date("2026-10-25T02:30:00Z")).time).toBe("02:30");
  });
});
