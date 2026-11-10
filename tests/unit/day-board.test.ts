import { describe, expect, it } from "vitest";
import { callRounds, daySegments, FOLD_PX, hhmm, hourMarks, initials, lanes, openMinutes, roundLabel, scaleFor, shortDuration } from "@/lib/day-board";

/** Time maths behind the Daily Rota Board (approved redesign, 10 Nov 2026). */
describe("day board", () => {
  const morning = { start: 7 * 60, end: 9 * 60 + 15 };
  const lunch = { start: 12 * 60, end: 14 * 60 + 15 };
  const bed = { start: 20 * 60 + 30, end: 21 * 60 + 15 };

  it("folds a stretch of more than 90 minutes with no visits, and nothing shorter", () => {
    const s = daySegments([morning, lunch, bed]);
    expect(s).toEqual([
      { from: 420, to: 570, folded: false },
      { from: 570, to: 720, folded: true },
      { from: 720, to: 870, folded: false },
      { from: 870, to: 1230, folded: true },
      { from: 1230, to: 1320, folded: false },
    ]);
    // Exactly 90 minutes apart is not folded.
    expect(daySegments([{ start: 420, end: 480 }, { start: 570, end: 600 }]).some((x) => x.folded)).toBe(false);
    expect(daySegments([{ start: 420, end: 480 }, { start: 571, end: 600 }]).some((x) => x.folded)).toBe(true);
  });

  it("uses 07:00 to 22:00 for a day with no visits and merges overlapping visits", () => {
    expect(daySegments([])).toEqual([{ from: 420, to: 1320, folded: false }]);
    expect(daySegments([{ start: 420, end: 500 }, { start: 450, end: 520 }])).toEqual([{ from: 420, to: 540, folded: false }]);
  });

  it("maps minutes to pixels with each fold exactly 22px wide and time never running backwards", () => {
    const s = daySegments([morning, lunch, bed]);
    const { x, width, pxPerMin } = scaleFor(s, 1000);
    expect(FOLD_PX).toBe(22);
    expect(x(420)).toBe(0);
    expect(x(720) - x(570)).toBeCloseTo(22);
    expect(x(1320)).toBeCloseTo(width);
    expect(width).toBeCloseTo(openMinutes(s) * pxPerMin + 2 * 22);
    let last = -1;
    for (let m = 400; m <= 1340; m += 5) {
      expect(x(m)).toBeGreaterThanOrEqual(last);
      last = x(m);
    }
    // A narrow track keeps blocks readable instead of squeezing: the board scrolls inside its card.
    expect(scaleFor(s, 200).width).toBeGreaterThan(200);
  });

  it("labels whole hours only where the day is open", () => {
    expect(hourMarks(daySegments([morning, lunch]))).toEqual([420, 480, 540, 720, 780, 840]);
  });

  it("builds call rounds from the organisation's call types, in order of first visit", () => {
    expect(callRounds([{ callType: "Lunch call", start: 720, end: 765 }, { callType: "Morning call", start: 450, end: 495 }, { callType: "Morning call", start: 420, end: 465 }, { callType: "Lunch call", start: 810, end: 855 }])).toEqual([
      { name: "Morning call", start: 420, end: 495 },
      { name: "Lunch call", start: 720, end: 855 },
    ]);
    expect(roundLabel("Morning call")).toBe("Morning");
    expect(roundLabel("Bed calls")).toBe("Bed");
    expect(roundLabel("Waking night")).toBe("Waking night");
  });

  it("stacks overlapping visits into lanes so none is hidden", () => {
    const { placed, count } = lanes([{ startMin: 420, endMin: 465, id: "a" }, { startMin: 430, endMin: 475, id: "b" }, { startMin: 465, endMin: 510, id: "c" }]);
    expect(count).toBe(2);
    expect(Object.fromEntries(placed.map((p) => [p.item.id, p.lane]))).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("formats times, durations and initials", () => {
    expect(hhmm(425)).toBe("07:05");
    expect([shortDuration(45), shortDuration(60), shortDuration(75)]).toEqual(["45m", "1h", "1h 15m"]);
    expect([initials("Margaret Ellison"), initials("Cher"), initials("  ")]).toEqual(["ME", "C", "?"]);
  });
});
