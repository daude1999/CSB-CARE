import { describe, expect, it } from "vitest";
import { MATCH_WEIGHTS as W, scoreMatch, type MatchFacts } from "@/server/rota/matching";

const facts = (p: Partial<MatchFacts> = {}): MatchFacts => ({
  continuity: new Map(), areas: new Map(), ratings: new Map(), weekMinutes: new Map(), maxWeekly: new Map(), day: new Map(), ...p,
});
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 3, h, m));
const visit = { areaId: "a1", start: at(9), end: at(10) };

describe("scoreMatch", () => {
  it("never scores a carer who is not eligible, whatever their other facts", () => {
    const f = facts({ continuity: new Map([["s", 20]]), areas: new Map([["s", new Set(["a1"])]]), ratings: new Map([["s", 5]]) });
    const m = scoreMatch("NOT_ELIGIBLE", "s", visit, f);
    expect(m.score).toBeNull();
    expect(m.explain).toEqual([]);
    expect(m.continuity).toBe(20);
  });

  it("starts eligible carers above carers with warnings", () => {
    expect(scoreMatch("ELIGIBLE", "s", visit, facts()).score).toBe(W.eligible);
    expect(scoreMatch("REQUIRES_REVIEW", "s", visit, facts()).score).toBe(W.review);
  });

  it("adds continuity up to the cap, area, and rating, and explains each point", () => {
    const f = facts({ continuity: new Map([["s", 4], ["t", 30]]), areas: new Map([["s", new Set(["a1"])]]), ratings: new Map([["s", 5], ["t", 1]]) });
    const s = scoreMatch("ELIGIBLE", "s", visit, f);
    expect(s.score).toBe(W.eligible + 4 * W.continuityPerVisit + W.sameArea + 2 * W.ratingStep);
    expect(s.explain.map((e) => e.text)).toEqual(["passes every check", "supported this person 4 times in the last 8 weeks", "works in this area", "service user's rating 5 of 5"]);
    const t = scoreMatch("ELIGIBLE", "t", visit, f);
    expect(t.score).toBe(W.eligible + W.continuityCap - 2 * W.ratingStep);
  });

  it("rewards staying within weekly hours and penalises going over", () => {
    const within = facts({ maxWeekly: new Map([["s", 600]]), weekMinutes: new Map([["s", 300]]) });
    expect(scoreMatch("ELIGIBLE", "s", visit, within).score).toBe(W.eligible + W.withinHours);
    const over = facts({ maxWeekly: new Map([["s", 600]]), weekMinutes: new Map([["s", 580]]) });
    const m = scoreMatch("ELIGIBLE", "s", visit, over);
    expect(m.score).toBe(W.eligible + W.overHours);
    expect(m.weekHours).toBeCloseTo(9.7);
  });

  it("flags a tight time gap and labels it as a gap, not travel", () => {
    const f = facts({ day: new Map([["s", [{ start: at(8), end: at(8, 50), visitId: "v" }]]]) });
    const m = scoreMatch("ELIGIBLE", "s", visit, f);
    expect(m.score).toBe(W.eligible + W.tightGap);
    expect(m.explain.at(-1)?.text).toMatch(/10 min .*time gap, not a travel time/);
    const roomy = facts({ day: new Map([["s", [{ start: at(7), end: at(8), visitId: "v" }]]]) });
    expect(scoreMatch("ELIGIBLE", "s", visit, roomy).score).toBe(W.eligible);
  });

  it("keeps the score between 0 and 100", () => {
    const f = facts({ maxWeekly: new Map([["s", 60]]), weekMinutes: new Map([["s", 600]]), ratings: new Map([["s", 1]]), day: new Map([["s", [{ start: at(9, 30), end: at(10, 30), visitId: "v" }]]]) });
    expect(scoreMatch("REQUIRES_REVIEW", "s", visit, f).score).toBe(0);
  });
});
