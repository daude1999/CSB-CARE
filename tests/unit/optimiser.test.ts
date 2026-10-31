import { describe, expect, it } from "vitest";
import { optimise, shiftSteps, timeGapProvider, type Booking, type CandidateIn, type OptimiseInput, type SlotIn } from "@/server/rota/optimiser";

const at = (hhmm: string, day = "2026-11-04") => new Date(`${day}T${hhmm}:00Z`);
const cand = (staffId: string, score: number, state: CandidateIn["state"] = "ELIGIBLE"): CandidateIn => ({ staffId, name: staffId.toUpperCase(), state, score, reasons: [], warnings: state === "REQUIRES_REVIEW" ? ["Does not usually work in this area"] : [] });
const slot = (visitId: string, start: string, end: string, candidates: CandidateIn[], extra: Partial<SlotIn> = {}): SlotIn => ({ visitId, slot: "PRIMARY", serviceUserId: `su-${visitId}`, label: visitId, start: at(start), end: at(end), fixedTime: false, lockVersion: 1, candidates, ...extra });
const input = (slots: SlotIn[], over: Partial<OptimiseInput> = {}): OptimiseInput => ({
  slots,
  bookings: new Map<string, Booking[]>(),
  weekMinutes: new Map(),
  maxWeekly: new Map(),
  weekOf: () => "2026-11-02",
  travel: timeGapProvider(10),
  maxShiftMinutes: 15,
  respectWeeklyLimits: true,
  ...over,
});

describe("Generate & Optimise core", () => {
  it("chooses the best allowed carer, preferring a clean pass over warnings", () => {
    const r = optimise(input([slot("v1", "08:00", "08:30", [cand("b", 90, "REQUIRES_REVIEW"), cand("a", 60)])]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.staffId).toBe("a");
  });

  it("only ever proposes carers from the eligibility list; a slot with none stays open with the reason", () => {
    const r = optimise(input([slot("v1", "08:00", "08:30", [])]));
    expect(r.proposals).toHaveLength(0);
    expect(r.unfilled[0]!.reason).toMatch(/eligibility/);
  });

  it("keeps the time gap between one carer's visits and never double-books", () => {
    const r = optimise(input([slot("v1", "08:00", "08:30", [cand("a", 90)]), slot("v2", "08:35", "09:00", [cand("a", 90), cand("b", 40)])], { maxShiftMinutes: 0 }));
    const byVisit = Object.fromEntries(r.proposals.map((p) => [p.visitId, p.staffId]));
    expect(byVisit).toEqual({ v1: "a", v2: "b" });
  });

  it("respects existing bookings on the rota", () => {
    const bookings = new Map<string, Booking[]>([["a", [{ visitId: "x", serviceUserId: "su-x", start: at("07:45"), end: at("08:15"), fixed: true }]]]);
    const r = optimise(input([slot("v1", "08:00", "08:30", [cand("a", 90)])], { bookings, maxShiftMinutes: 0 }));
    expect(r.proposals).toHaveLength(0);
    expect(r.unfilled[0]!.reason).toMatch(/booked too close/);
  });

  it("keeps carers within their weekly hours limit when asked", () => {
    const over = { weekMinutes: new Map([["a|2026-11-02", 600]]), maxWeekly: new Map([["a", 610]]) };
    expect(optimise(input([slot("v1", "08:00", "08:30", [cand("a", 90)])], over)).proposals).toHaveLength(0);
    expect(optimise(input([slot("v1", "08:00", "08:30", [cand("a", 90)])], { ...over, respectWeeklyLimits: false })).proposals).toHaveLength(1);
  });

  it("suggests the smallest time change that lets a carer fit, and never moves a fixed visit", () => {
    const bookings = new Map<string, Booking[]>([["a", [{ visitId: "x", serviceUserId: "su-x", start: at("07:30"), end: at("08:00"), fixed: true }]]]);
    const r = optimise(input([slot("v1", "08:05", "08:35", [cand("a", 90)])], { bookings }));
    expect(r.proposals[0]!.retime?.toStart.toISOString()).toBe(at("08:10").toISOString());
    const locked = optimise(input([slot("v1", "08:05", "08:35", [cand("a", 90)], { fixedTime: true })], { bookings }));
    expect(locked.proposals).toHaveLength(0);
  });

  it("finds a fill by moving another proposal to a different carer", () => {
    // v1 (easier, later) would take A, but v2 can only be done by A; the swap pass gives v1 to B.
    const slots = [slot("v2", "09:00", "09:30", [cand("a", 50)]), slot("v1", "09:00", "09:30", [cand("a", 90), cand("b", 30)])];
    const r = optimise(input(slots, { maxShiftMinutes: 0 }));
    expect(Object.fromEntries(r.proposals.map((p) => [p.visitId, p.staffId]))).toEqual({ v1: "b", v2: "a" });
  });

  it("is deterministic and bounded", () => {
    const slots = Array.from({ length: 40 }, (_, i) => slot(`v${i}`, `${String(8 + (i % 10)).padStart(2, "0")}:00`, `${String(8 + (i % 10)).padStart(2, "0")}:30`, ["a", "b", "c", "d"].map((s, j) => cand(s, 40 + j))));
    const one = optimise(input(slots));
    const two = optimise(input(slots));
    expect(two.proposals.map((p) => `${p.visitId}:${p.staffId}`)).toEqual(one.proposals.map((p) => `${p.visitId}:${p.staffId}`));
    const tiny = optimise(input(slots, { budget: 20 }));
    expect(tiny.budgetSpent).toBe(true);
    expect(tiny.checks).toBeLessThanOrEqual(25);
  });

  it("tries time changes smallest first, earlier before later", () => {
    expect(shiftSteps(15)).toEqual([-5, 5, -10, 10, -15, 15]);
  });
});
