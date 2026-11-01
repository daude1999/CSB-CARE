import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { londonToUtc } from "@/lib/london";
import { coverChecks, coverState, defaultRecoveryTime, recoveryWindow, type CoverCase } from "@/server/rota/missed-cover";
import { countedOnce, visitKpis } from "@/server/rota/overview";
import type { EligibilityResult } from "@/server/workforce/eligibility";
import { ValidationError } from "@/lib/errors";

/** Find Cover's pure rules: when cover can be booked, how checks are shown, the recovery time, and counting a care need once. */
const NOW = londonToUtc("2026-11-03", 10 * 60);
const MIN = 60_000;
type Rv = CoverCase["covers"][number]["recoveryVisit"];
const rv = (status: Rv["status"], booked: number, required = 1): { recoveryVisit: Rv } => ({
  recoveryVisit: { id: "rv", reference: "V-1", status, date: new Date("2026-11-03"), scheduledStart: new Date(NOW.getTime() + 60 * MIN), scheduledEnd: new Date(NOW.getTime() + 90 * MIN), carersRequired: required, actualStart: null, actualEnd: null, lockVersion: 1, assignments: Array.from({ length: booked }, (_, i) => ({ id: `a${i}`, slot: i ? "SECOND" : "PRIMARY", staffId: `s${i}`, acknowledgedAt: null, staff: { displayName: `S${i}` } })) },
});
const base = { stage: "NEW" as const, replacementType: null, scheduledStart: new Date(NOW.getTime() - 60 * MIN), visit: { status: "MISSED" as const, carersRequired: 1, actualStart: null }, covers: [] as { recoveryVisit: Rv }[] };

describe("coverState", () => {
  it("offers cover for a recent missed call with an open case", () => {
    expect(coverState(base, NOW)).toMatchObject({ kind: "needed", canFind: true, required: 1, booked: 0 });
  });
  it("is booked once every slot on the recovery visit is filled, partial before that", () => {
    expect(coverState({ ...base, covers: [rv("SCHEDULED", 1)] }, NOW)).toMatchObject({ kind: "booked", canFind: false });
    expect(coverState({ ...base, visit: { ...base.visit, carersRequired: 2 }, covers: [rv("SCHEDULED", 1, 2)] }, NOW)).toMatchObject({ kind: "partial", canFind: true, booked: 1, required: 2 });
  });
  it("ignores a cancelled recovery visit, so cover can be found again", () => {
    expect(coverState({ ...base, covers: [rv("CANCELLED", 1)] }, NOW).kind).toBe("needed");
  });
  it("sends a late arrival to the late-arrival record instead of booking duplicate care", () => {
    expect(coverState({ ...base, visit: { ...base.visit, status: "IN_PROGRESS", actualStart: NOW } }, NOW)).toMatchObject({ kind: "late-arrival", canFind: false });
    expect(coverState({ ...base, visit: { ...base.visit, status: "COMPLETED", actualStart: NOW } }, NOW).kind).toBe("late-arrival");
  });
  it("respects an arrangement already recorded by hand, a closed case and the 24-hour window", () => {
    expect(coverState({ ...base, replacementType: "FAMILY_COVERED" }, NOW).kind).toBe("recorded");
    expect(coverState({ ...base, stage: "CLOSED" }, NOW).kind).toBe("closed");
    expect(coverState({ ...base, stage: "AWAITING_SIGNOFF" }, NOW).canFind).toBe(false);
    expect(coverState({ ...base, scheduledStart: new Date(NOW.getTime() - 25 * 3600_000) }, NOW).kind).toBe("too-late");
  });
});

const result = (over: Partial<EligibilityResult> = {}): EligibilityResult => ({ staffId: "s", state: "ELIGIBLE", blocking: [], warnings: [], advice: [], compliance: { dbs: "Up to date", rightToWork: "Up to date", training: "3 of 3 up to date" }, restrictions: [], readiness: { status: "READY", reasons: [] }, ...over });

describe("coverChecks", () => {
  it("shows green only for checks the service passed", () => {
    const checks = coverChecks(result());
    expect(checks.every((c) => c.state === "ok")).toBe(true);
    expect(checks.find((c) => c.label === "Right to work")!.text).toBe("Verified in HR");
  });
  it("never shows an unverified check as passed", () => {
    const checks = coverChecks(result({ compliance: { dbs: "Not recorded", rightToWork: "Not recorded", training: "None required" }, readiness: null }));
    for (const label of ["Right to work", "DBS check", "Mandatory training", "Care competencies and readiness"]) expect(checks.find((c) => c.label === label)!.state).toBe("info");
  });
  it("puts each failure and warning against its check, with the service's own words", () => {
    const checks = coverChecks(result({ state: "NOT_ELIGIBLE", blocking: [{ code: "OVERLAP", message: "Already booked 09:00–09:30 (V-9)" }, { code: "RESTRICTION", message: "Restricted: test" }], warnings: [{ code: "GENDER", message: "Prefers a female carer" }], advice: [{ code: "TRAVEL_GAP", message: "Only 5 minutes after their visit" }] }));
    expect(checks.find((c) => c.label === "Rota clashes")).toMatchObject({ state: "fail", text: "Already booked 09:00–09:30 (V-9)" });
    expect(checks.find((c) => c.label === "Care competencies and readiness")!.state).toBe("fail");
    expect(checks.find((c) => c.label === "Service user's preferences")).toMatchObject({ state: "warn", text: "Prefers a female carer" });
    expect(checks.find((c) => c.label === "Time between visits")!.text).toMatch(/not a travel time/);
  });
  it("keeps codes it does not know about instead of dropping them", () => {
    expect(coverChecks(result({ warnings: [{ code: "NEW_RULE", message: "Something new" }] })).find((c) => c.label === "Other checks")!.text).toBe("Something new");
  });
});

describe("recovery time", () => {
  const missed = { scheduledStart: new Date(NOW.getTime() - 60 * MIN), scheduledEnd: new Date(NOW.getTime() - 30 * MIN) };
  it("keeps the missed visit's length", () => {
    const w = recoveryWindow(missed, "2026-11-03", "11:00", NOW);
    expect(w.end.getTime() - w.start.getTime()).toBe(30 * MIN);
  });
  it("refuses the past, before the missed visit, beyond 48 hours and bad input", () => {
    expect(() => recoveryWindow(missed, "2026-11-03", "08:00", NOW)).toThrow(ValidationError);
    expect(() => recoveryWindow(missed, "2026-11-06", "10:00", NOW)).toThrow(ValidationError);
    expect(() => recoveryWindow(missed, "nope", "10:00", NOW)).toThrow(ValidationError);
    expect(() => recoveryWindow(missed, "2026-11-03", "25:00", NOW)).toThrow(ValidationError);
  });
  it("defaults to the next quarter hour at least 15 minutes ahead", () => {
    expect(defaultRecoveryTime(londonToUtc("2026-11-03", 10 * 60 + 7))).toEqual({ date: "2026-11-03", time: "10:30" });
    expect(defaultRecoveryTime(londonToUtc("2026-11-03", 23 * 60 + 50))).toEqual({ date: "2026-11-04", time: "00:00" });
  });
});

describe("counting a care need once", () => {
  const v = (id: string, status: string, recoveryOfId: string | null = null) => ({ id, status, recoveryOfId, flags: { unassignedSlots: 0, late: false } });
  it("leaves out a recovery visit only when its missed visit is in the same list", () => {
    expect(countedOnce([v("a", "MISSED"), v("b", "COMPLETED", "a")]).map((x) => x.id)).toEqual(["a"]);
    expect(countedOnce([v("b", "COMPLETED", "a")]).map((x) => x.id)).toEqual(["b"]);
  });
  it("keeps the missed visit reported as missed", () => {
    const k = visitKpis([v("a", "MISSED"), v("b", "COMPLETED", "a"), v("c", "COMPLETED")]);
    expect(k).toMatchObject({ total: 2, missed: 1, completed: 1 });
  });
});
