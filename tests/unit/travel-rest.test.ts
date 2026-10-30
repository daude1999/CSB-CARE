import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { londonToUtc } from "@/lib/london";
import { travelAndRest, type Facts } from "@/server/workforce/eligibility";

const MIN = 60_000;
type Booking = Facts["assignments"][number];
const booking = (date: string, startMin: number, len: number, ref: string): Booking => {
  const startsAt = londonToUtc(date, startMin);
  return { id: ref, staffId: "s1", visitId: ref, slot: "PRIMARY", startsAt, endsAt: new Date(startsAt.getTime() + len * MIN), visit: { reference: ref } };
};
const visit = (date: string, startMin: number, len: number) => {
  const start = londonToUtc(date, startMin);
  return { start, end: new Date(start.getTime() + len * MIN), visitId: "new" };
};

describe("travel and rest advice", () => {
  it("points out under 10 minutes between visits on the same day", () => {
    const facts = { assignments: [booking("2026-11-03", 9 * 60, 30, "V-A"), booking("2026-11-03", 10 * 60 + 35, 30, "V-B")] };
    const advice = travelAndRest(facts, "s1", visit("2026-11-03", 9 * 60 + 35, 55));
    expect(advice.map((a) => a.code)).toEqual(["TRAVEL_GAP", "TRAVEL_GAP"]);
    expect(advice[0]?.message).toContain("Only 5 minutes");
    expect(travelAndRest(facts, "s1", visit("2026-11-03", 12 * 60, 30))).toEqual([]);
  });

  it("points out under 11 hours' rest between the last visit of one day and the first of the next", () => {
    const facts = { assignments: [booking("2026-11-02", 22 * 60, 30, "V-BED"), booking("2026-11-04", 6 * 60, 30, "V-EARLY")] };
    expect(travelAndRest(facts, "s1", visit("2026-11-03", 7 * 60, 30)).map((a) => a.code)).toEqual(["DAILY_REST"]);
    expect(travelAndRest(facts, "s1", visit("2026-11-03", 20 * 60, 30)).map((a) => a.code)).toEqual(["DAILY_REST"]);
    expect(travelAndRest(facts, "s1", visit("2026-11-03", 12 * 60, 30))).toEqual([]);
  });

  it("ignores other carers' visits and the visit itself", () => {
    const mine = booking("2026-11-03", 9 * 60, 30, "new");
    const theirs = { ...booking("2026-11-03", 9 * 60 + 30, 30, "V-X"), staffId: "s2" };
    expect(travelAndRest({ assignments: [mine, theirs] }, "s1", visit("2026-11-03", 9 * 60, 30))).toEqual([]);
  });
});
