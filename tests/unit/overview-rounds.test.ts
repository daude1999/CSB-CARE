import { describe, expect, it } from "vitest";
import { coverAlert, greeting, overviewRounds, policySummary, type RoundVisit } from "@/lib/overview-rounds";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekBars } from "@/components/overview-week-bars";

const v = (callType: string, start: number, status = "SCHEDULED", needsCarer = false): RoundVisit => ({ callType, start, end: start + 45, status, needsCarer });
const H = 60;

describe("Overview call rounds", () => {
  const day = [
    v("Morning call", 7 * H, "COMPLETED"), v("Morning call", 8 * H, "COMPLETED"),
    v("Lunch call", 12 * H, "SCHEDULED", true), v("Lunch call", 12 * H + 30),
    v("Tea call", 17 * H), v("Bed call", 20 * H + 30),
  ];

  it("makes one round per call type, in the order of its first visit, with done and total", () => {
    const rounds = overviewRounds(day, 12 * H + 10);
    expect(rounds.map((r) => [r.label, r.done, r.total])).toEqual([["Morning", 2, 2], ["Lunch", 0, 2], ["Tea", 0, 1], ["Bed", 0, 1]]);
  });

  it("marks finished rounds Done, the round under way Now, and the rest later", () => {
    expect(overviewRounds(day, 12 * H + 10).map((r) => r.state)).toEqual(["done", "now", "later", "later"]);
    // Before the first visit nothing is under way.
    expect(overviewRounds(day, 6 * H).map((r) => r.state)).toEqual(["done", "later", "later", "later"]);
    // Once tea starts, an unfinished lunch round is still open but no longer "Now".
    expect(overviewRounds(day, 17 * H + 5).map((r) => r.state)).toEqual(["done", "open", "now", "later"]);
  });

  it("counts a round with only missed or not-delivered visits left as finished", () => {
    const rounds = overviewRounds([v("Morning call", 7 * H, "MISSED"), v("Morning call", 8 * H, "NOT_DELIVERED")], 9 * H);
    expect(rounds[0]).toMatchObject({ state: "done", done: 0, total: 2 });
  });

  it("names the round in the cover alert only when one round is short", () => {
    expect(coverAlert(overviewRounds(day, 9 * H))).toBe("1 lunch visit still needs a carer");
    const two = [...day, v("Tea call", 17 * H + 30, "SCHEDULED", true), v("Tea call", 18 * H, "SCHEDULED", true)];
    expect(coverAlert(overviewRounds(two, 9 * H))).toBe("3 visits still need a carer");
    expect(coverAlert(overviewRounds([v("Morning call", 7 * H)], 9 * H))).toBeNull();
    expect(coverAlert([])).toBeNull();
  });
});

describe("Overview greeting", () => {
  it("follows the London time of day", () => {
    expect(greeting(7 * H)).toBe("Good morning");
    expect(greeting(12 * H)).toBe("Good afternoon");
    expect(greeting(17 * H + 59)).toBe("Good afternoon");
    expect(greeting(18 * H)).toBe("Good evening");
  });
});

describe("Overview Policy tile detail line", () => {
  const p = (count: number, text: string) => ({ count, text: `${count} ${text}` });

  it("lists one or two items in full", () => {
    expect(policySummary([p(2, "sign-offs")])).toBe("2 sign-offs");
    expect(policySummary([p(2, "sign-offs"), p(1, "review overdue")])).toBe("2 sign-offs, 1 review overdue");
  });

  it("shows the two largest and how many more when there are three or more", () => {
    expect(policySummary([p(2, "sign-offs"), p(1, "review overdue"), p(1, "action past due"), p(4, "changes to review")])).toBe(
      "4 changes to review, 2 sign-offs +\u00a02\u00a0more",
    );
  });
});

describe("Overview Reporting tile chart", () => {
  const week = (values: number[]) => values.map((value, i) => ({ date: `2026-11-0${i + 1}`, value }));

  it('says "No visits yet" instead of flat bars when no visits were completed in the last seven days', () => {
    const html = renderToStaticMarkup(WeekBars({ days: week([0, 0, 0, 0, 0, 0, 0]) }));
    expect(html).toContain("No visits yet");
    expect(html).not.toContain("reporting-bars");
  });

  it("draws seven bars when there are visits", () => {
    const html = renderToStaticMarkup(WeekBars({ days: week([3, 0, 5, 2, 4, 1, 2]) }));
    expect(html).toContain('data-testid="reporting-bars"');
    expect(html.match(/ovx-bar/g)).toHaveLength(7);
  });
});
