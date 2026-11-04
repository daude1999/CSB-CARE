import { describe, expect, it } from "vitest";
import { suggestReason } from "@/server/rota/missed-auto/suggest";
import { carerLine, deriveAutoStatus } from "@/server/rota/missed-auto/runs";
import { fingerprintOf, type CarerFacts, type CaseFacts, type EvidenceItem } from "@/server/rota/missed-auto/evidence";
import { MISSED_REASONS } from "@/server/rota/missed-calls";

/** The rules behind the automated missed-call summary: pure, so every scenario is checked directly. */

const START = "2026-11-03T09:00:00.000Z";
function carer(over: Partial<CarerFacts> = {}): CarerFacts {
  return { staffId: "s1", name: "Amelia Hart", slot: "PRIMARY", hasLogin: true, confirmation: "REQUESTED", clockInAt: null, clockOutAt: null, clockInAfterDetection: false, stillBooked: true, pendingCorrection: false, approvedCorrection: false, absenceOverlap: false, response: null, responseCount: 0, ...over };
}
function facts(over: Partial<CaseFacts> = {}): CaseFacts {
  return { caseId: "c1", organisationId: "o1", visitId: "v1", serviceUserId: "su1", stage: "NEW", detectedAt: "2026-11-03T09:30:00.000Z", scheduledStart: START, scheduledEnd: "2026-11-03T09:30:00.000Z", visitStatus: "MISSED", carersRequired: 1, medicationRequired: false, highRisk: false, suAbsenceRecorded: false, recoveryBooked: false, replacementRecorded: false, reasonRecorded: false, escalated: false, carers: [carer()], ...over };
}
const said = (answer: string, extra: Partial<NonNullable<CarerFacts["response"]>> = {}) => ({ confirmation: "RESPONDED", responseCount: 1, response: { id: `r-${answer}`, answer, reportedArrival: null, reportedDeparture: null, careDelivered: null, unableReason: null, submittedAt: "2026-11-03T09:40:00.000Z", ...extra } });

describe("missed-call suggestion rules", () => {
  it("Scenario C: no carer booked suggests an unassigned visit, supported by the booking record", () => {
    const s = suggestReason(facts({ carers: [] }));
    expect(s.classification).toBe("POSSIBLE_UNASSIGNED");
    expect(s.suggestedReason).toBe("UNASSIGNED");
    expect(s.support).toBe("SUPPORTED");
    expect(s.urgent).toBe(true);
  });

  it("Scenario A: forgot to clock in suggests NOT_CLOCKED but only as requiring verification, never as delivered", () => {
    const s = suggestReason(facts({ carers: [carer(said("ATTENDED_NO_CLOCK", { reportedArrival: "2026-11-03T09:05:00.000Z", reportedDeparture: "2026-11-03T09:32:00.000Z", careDelivered: "YES" }))] }));
    expect(s.classification).toBe("POSSIBLE_NOT_CLOCKED");
    expect(s.suggestedReason).toBe("NOT_CLOCKED");
    expect(s.support).toBe("WEAK");
    expect(s.missing.join(" ")).toMatch(/Nothing in the system confirms the care was delivered/);
    expect(s.missing.join(" ")).toMatch(/has not asked for a clock correction/);
    expect(s.found.join(" ")).not.toMatch(/delivered/);
  });

  it("Scenario B: arrived late suggests CARER_LATE; a late clock-in recorded by the system is stronger", () => {
    expect(suggestReason(facts({ carers: [carer(said("ARRIVED_LATE", { reportedArrival: "2026-11-03T09:45:00.000Z", careDelivered: "YES" }))] })).suggestedReason).toBe("CARER_LATE");
    const sys = suggestReason(facts({ carers: [carer({ confirmation: "REQUESTED", clockInAt: "2026-11-03T09:44:00.000Z", clockInAfterDetection: true })] }));
    expect(sys.classification).toBe("POSSIBLE_LATE");
    expect(sys.support).toBe("WEAK"); // still waiting for the carer, so not more than "requires verification"
  });

  it("Scenario D: no clock-in and no answer is unresolved, with no reason forced", () => {
    const s = suggestReason(facts({ carers: [carer({ confirmation: "NO_RESPONSE" })] }));
    expect(s.classification).toBe("UNRESOLVED");
    expect(s.suggestedReason).toBeNull();
    expect(s.missing.join(" ")).toMatch(/has not answered by the deadline/);
    expect(suggestReason(facts()).classification).toBe("AWAITING_CARER");
  });

  it("Scenario E: conflicting evidence suggests nothing and asks for a manual investigation", () => {
    const clockVsSaid = suggestReason(facts({ carers: [carer({ ...said("UNABLE_TO_ATTEND", { unableReason: "SICKNESS" }), clockInAt: "2026-11-03T09:50:00.000Z" })] }));
    expect(clockVsSaid.classification).toBe("CONFLICTING");
    expect(clockVsSaid.suggestedReason).toBeNull();
    const twoCarers = suggestReason(facts({ carersRequired: 2, carers: [carer(said("ATTENDED_NO_CLOCK", { reportedArrival: "2026-11-03T09:00:00.000Z", reportedDeparture: "2026-11-03T09:30:00.000Z", careDelivered: "YES" })), carer({ staffId: "s2", name: "Jo Carer", slot: "SECOND", ...said("SU_CANCELLED") })] }));
    expect(twoCarers.classification).toBe("CONFLICTING");
    expect(twoCarers.conflicts[0]).toMatch(/explanations differ/);
  });

  it("maps every carer answer onto an existing reason code, or none", () => {
    const answers: [string, string | null][] = [["UNABLE_TO_ATTEND", "CARER_NO_SHOW"], ["ACCESS_PROBLEM", "ACCESS"], ["SU_CANCELLED", "CLIENT_CANCELLED"], ["PHONE_SYSTEM", "SYSTEM"], ["ROTA_WRONG", "ROTA_ERROR"], ["OTHER", null]];
    for (const [a, code] of answers) {
      const s = suggestReason(facts({ carers: [carer(said(a))] }));
      expect(s.suggestedReason).toBe(code);
      if (code) expect(code in MISSED_REASONS).toBe(true);
    }
    expect(suggestReason(facts({ carers: [carer(said("UNABLE_TO_ATTEND", { unableReason: "TRAVEL" }))] })).suggestedReason).toBe("CARER_TRAVEL");
    expect(suggestReason(facts({ suAbsenceRecorded: true, carers: [carer(said("SU_CANCELLED"))] })).support).toBe("SUPPORTED");
  });

  it("puts urgent contingency first for a high-risk service user, whatever the evidence", () => {
    const s = suggestReason(facts({ highRisk: true }));
    expect(s.urgent).toBe(true);
    expect(s.nextActions[0]).toMatch(/urgent contingency/);
  });

  it("lists a carer without a sign-in as needing a phone call", () => {
    const s = suggestReason(facts({ carers: [carer({ confirmation: "NO_LOGIN", hasLogin: false })] }));
    expect(s.missing[0]).toMatch(/no linked sign-in/);
    expect(s.classification).toBe("UNRESOLVED");
  });
});

describe("automation status and fingerprints", () => {
  const base = { evidenceOn: true, stage: "NEW" as const, lastRun: { status: "COMPLETED" }, lastGoodRun: true, awaitingCarer: false, highRisk: false, urgentSuggestion: false, reasonRecorded: false, draftReviewed: false };
  it("keeps its own status apart from the case stage", () => {
    expect(deriveAutoStatus({ ...base, stage: "CLOSED" })).toBe("closed");
    expect(deriveAutoStatus({ ...base, evidenceOn: false, lastGoodRun: false, lastRun: null })).toBe("off");
    expect(deriveAutoStatus({ ...base, lastRun: { status: "FAILED" } })).toBe("failed");
    expect(deriveAutoStatus({ ...base, lastGoodRun: false, lastRun: { status: "RUNNING" } })).toBe("collecting");
    expect(deriveAutoStatus({ ...base, highRisk: true, awaitingCarer: true })).toBe("urgent");
    expect(deriveAutoStatus({ ...base, awaitingCarer: true })).toBe("awaiting");
    expect(deriveAutoStatus(base)).toBe("ready");
    expect(deriveAutoStatus({ ...base, reasonRecorded: true, highRisk: true })).toBe("reviewed");
  });

  it("describes each carer's confirmation in one line", () => {
    expect(carerLine([])).toBe("No carer was booked");
    expect(carerLine(["RESPONDED", "NO_LOGIN"])).toBe("1 answered, 1 without a sign-in");
  });

  it("gives the same fingerprint for the same records in any order, and a new one when a record changes", () => {
    const item = (key: string, value: string): EvidenceItem => ({ key, group: "visit", source: "Visit", sourceId: "v1", label: key, value, eventAt: null, recordedAt: null, availability: "PRESENT", kind: "SYSTEM", staffId: null, verified: true });
    const f = facts();
    expect(fingerprintOf([item("a", "1"), item("b", "2")], f)).toBe(fingerprintOf([item("b", "2"), item("a", "1")], f));
    expect(fingerprintOf([item("a", "1")], f)).not.toBe(fingerprintOf([item("a", "changed")], f));
    expect(fingerprintOf([item("a", "1")], f)).toBe(fingerprintOf([item("a", "1")], { ...f, stage: "INVESTIGATING" }));
  });
});
