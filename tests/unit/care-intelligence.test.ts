import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDERS, canClose, manualMoves, readyBlockers, remindersFor, retainUntil, suggestedNextAction, type CandidateFacts } from "@/server/recruitment/model";
import { keepCited, parsePeriod } from "@/server/care/care-summary";
import { visitStateLabel } from "@/server/rota/monitor-alerts";
import { SimulatedProvider } from "@/server/ai/simulated";
import { CareSummarySchema } from "@/server/ai/schemas";

const base: CandidateFacts = { stage: "APPLIED", applicationComplete: true, rightToWork: "NOT_CHECKED", outstandingDocuments: [], offerResponse: null, createdOn: "2026-10-20", stageChangedOn: "2026-10-20", nextAction: null, screenings: [], interviews: [], hrEmployeeId: null };
const now = new Date("2026-11-01T10:00:00Z");

describe("recruitment rules", () => {
  it("only allows moves that do not skip the interview, offer or onboarding steps", () => {
    expect(manualMoves("APPLIED")).toEqual(["SCREENING", "INTERVIEW"]);
    expect(manualMoves("OFFER")).toEqual([]);
    expect(manualMoves("ONBOARDING")).toEqual([]);
    expect(canClose("OFFER")).toBe(true);
    expect(canClose("ONBOARDING")).toBe(false);
  });

  it("keeps closed candidates for the retention period", () => {
    expect(retainUntil("2026-11-01", 6)).toBe("2027-05-01");
  });

  it("suggests one next step from the records, and a recruiter's own note wins", () => {
    expect(suggestedNextAction({ ...base, applicationComplete: false }, now)).toMatch(/missing application/);
    expect(suggestedNextAction({ ...base, stage: "SCREENING" }, now)).toMatch(/screening questions/);
    expect(suggestedNextAction({ ...base, nextAction: "Call back Tuesday" }, now)).toBe("Call back Tuesday");
  });

  it("raises reminders only when they are due, and none when reminders are off", () => {
    const c = { ...base, id: "c1", applicationComplete: false, trainingMissing: 0, onboardingDocsMissing: 0 };
    expect(remindersFor(c, DEFAULT_REMINDERS, "2026-11-01", now).map((r) => r.kind)).toEqual(["INCOMPLETE"]);
    expect(remindersFor({ ...c, createdOn: "2026-10-31" }, DEFAULT_REMINDERS, "2026-11-01", now)).toEqual([]);
    expect(remindersFor(c, { ...DEFAULT_REMINDERS, remindersOn: false }, "2026-11-01", now)).toEqual([]);
    const interview = { ...c, applicationComplete: true, stage: "INTERVIEW" as const, interviews: [{ startsAt: new Date("2026-11-02T09:00:00Z"), status: "AWAITING_CONFIRMATION" as const, outcome: null }] };
    expect(remindersFor(interview, DEFAULT_REMINDERS, "2026-11-01", now).map((r) => r.kind)).toEqual(["INTERVIEW_CONFIRM"]);
  });

  it("will not record Ready for Work until HR has made the employee Active with right to work verified", () => {
    expect(readyBlockers({ employeeStatus: "Onboarding", outstandingDocuments: ["DBS application"], rightToWork: "IN_PROGRESS" })).toHaveLength(3);
    expect(readyBlockers({ employeeStatus: null, outstandingDocuments: [], rightToWork: "VERIFIED" })).toEqual(["The HR employee record is missing"]);
    expect(readyBlockers({ employeeStatus: "Active", outstandingDocuments: [], rightToWork: "VERIFIED" })).toEqual([]);
  });
});

describe("Care Summary rules", () => {
  it("reads the period and caps a custom one", () => {
    expect(parsePeriod({}, "2026-11-01")).toEqual({ period: "14", from: "2026-10-19", to: "2026-11-01" });
    expect(parsePeriod({ period: "7" }, "2026-11-01")).toEqual({ period: "7", from: "2026-10-26", to: "2026-11-01" });
    expect(parsePeriod({ period: "custom", from: "2026-01-01", to: "2026-11-01" }, "2026-11-01").from).toBe("2026-08-02");
    expect(parsePeriod({ period: "custom", from: "2026-11-05", to: "2026-11-01" }, "2026-11-01").period).toBe("14");
  });

  it("drops points that cite nothing real and keeps only known record ids", () => {
    const { output, dropped } = keepCited(
      { summary: [{ text: "Ate well", sources: ["n1", "X9"] }, { text: "Invented", sources: ["Z1"] }], changes: [{ text: "No source", sources: [] }], concerns: [], nextActions: [], gaps: [" ", "Thin evidence"] },
      new Set(["N1"]),
    );
    expect(output.summary).toEqual([{ text: "Ate well", sources: ["N1"] }]);
    expect(output.changes).toEqual([]);
    expect(output.gaps).toEqual(["Thin evidence"]);
    expect(dropped).toBe(2);
  });

  it("the simulated provider labels every point, cites only the records it was given and passes the schema", async () => {
    const records = [
      { sid: "N1", kind: "Visit note", date: "2026-10-30", text: "Ate little at lunch" },
      { sid: "N2", kind: "Visit note", date: "2026-10-31", text: "Refused breakfast, appetite poor" },
      { sid: "I1", kind: "Incident", date: "2026-10-31", text: "INC-1 Fall, low severity, open: found on floor" },
    ];
    const out = await new SimulatedProvider().summariseCare({ from: "2026-10-19", to: "2026-11-01", records, facts: [] });
    expect(CareSummarySchema.safeParse(out).success).toBe(true);
    const points = [...out.summary, ...out.changes, ...out.concerns, ...out.nextActions];
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.text.startsWith("[SIMULATED")).toBe(true);
      for (const s of p.sources) expect(["N1", "N2", "I1"]).toContain(s);
    }
    expect(out.changes.some((c) => /eating/.test(c.text))).toBe(true);
    expect(out.concerns[0]?.sources).toContain("I1");
  });
});

describe("visit status words", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 1, h, m));
  it("keeps no attendance, recorded missed, not delivered, cancelled, late, in progress and completed apart", () => {
    const v = { scheduledStart: at(9), actualStart: null };
    expect(visitStateLabel({ ...v, status: "SCHEDULED" }, at(9, 30)).label).toBe("No attendance recorded");
    expect(visitStateLabel({ ...v, status: "SCHEDULED" }, at(8)).label).toBe("Scheduled");
    expect(visitStateLabel({ ...v, status: "MISSED" }, at(10)).label).toBe("Recorded missed");
    expect(visitStateLabel({ ...v, status: "NOT_DELIVERED" }, at(10)).label).toBe("Not delivered");
    expect(visitStateLabel({ ...v, status: "CANCELLED" }, at(10)).label).toBe("Cancelled");
    expect(visitStateLabel({ status: "IN_PROGRESS", scheduledStart: at(9), actualStart: at(9, 40) }, at(10)).label).toBe("In progress, started late");
    expect(visitStateLabel({ status: "IN_PROGRESS", scheduledStart: at(9), actualStart: at(9, 5) }, at(10)).label).toBe("In progress");
    expect(visitStateLabel({ status: "COMPLETED", scheduledStart: at(9), actualStart: at(9, 2) }, at(10)).label).toBe("Completed");
    expect(visitStateLabel({ status: "COMPLETED", scheduledStart: at(9), actualStart: at(9, 30) }, at(10)).label).toBe("Completed late");
  });
});
