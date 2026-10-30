import { describe, expect, it } from "vitest";
import { evaluateReadiness, type ReadinessFacts, type StaffFacts } from "@/server/readiness/evaluate";

/** Pure rules for the five readiness statuses, against the specification's acceptance lines (Appendix F10). */

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const today = "2026-10-29";

function staff(over: Partial<StaffFacts> = {}): StaffFacts {
  return {
    id: "s1",
    jobTitle: "Care Worker",
    branchId: "b1",
    userId: "u1",
    compliance: [
      { category: "DBS", name: "Enhanced DBS", required: true, recurring: true, dueDate: D("2029-06-01"), verified: true, hasEvidence: true, hrCheckId: "c1" },
      { category: "Right to work", name: "Right to work", required: true, recurring: false, dueDate: null, verified: true, hasEvidence: true, hrCheckId: "c2" },
    ],
    ...over,
  };
}

function req(over: Partial<ReadinessFacts["requirements"][number]> & { scopes?: ReadinessFacts["requirements"][number]["scopes"] } = {}): ReadinessFacts["requirements"][number] {
  return {
    id: "r1", organisationId: "o", key: "safeguarding", name: "Safeguarding adults", description: null, category: "TRAINING", classification: "MANDATORY_ROLE",
    sourceAuthority: null, sourceRef: null, sourceVersion: null, requiresPractical: false, renewalMonths: 12, warningDays: 30, hardStop: true, exceptionAllowed: true,
    policyId: null, status: "ACTIVE", version: 1, supersedesId: null, effectiveFrom: D("2026-01-01"), effectiveTo: null, createdById: "m", createdAt: D("2026-01-01"),
    scopes: [{ id: "sc1", requirementId: "r1", kind: "JOB_TITLE", jobTitle: "Care Worker", branchId: null, careTaskId: null, serviceUserId: null }],
    ...over,
  };
}

function record(over: Partial<ReadinessFacts["records"][number]> = {}): ReadinessFacts["records"][number] {
  return {
    id: "t1", organisationId: "o", staffId: "s1", requirementId: "r1", provider: "Skills for Care", completedAt: D("2026-06-01"), expiresAt: null, result: "Pass", evidenceId: null, evidenceNote: null,
    assessmentType: null, assessor: null, enteredById: "m", verificationStatus: "VERIFIED", verifiedById: "v", verifiedAt: D("2026-06-02"), verificationNote: null, exemptionRationale: null, supersedesId: null, createdAt: D("2026-06-01"),
    ...over,
  };
}

function facts(over: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return { requirements: [req()], records: [], assessments: [], restrictions: [], exceptions: [], flags: [], acknowledgements: [], publishedPolicies: [], userNames: { m: "Manager", v: "Verifier", a: "Assessor" }, ...over };
}

describe("staff readiness rules", () => {
  it("is not ready when a mandatory requirement has no verified record, and names the gap", () => {
    const r = evaluateReadiness(facts(), staff(), { date: today });
    expect(r.status).toBe("NOT_READY");
    expect(r.reasons).toEqual(["Safeguarding adults: no verified record"]);
  });

  it("never treats unverified evidence as complete: a submitted record gives pending verification", () => {
    const r = evaluateReadiness(facts({ records: [record({ verificationStatus: "SUBMITTED", verifiedById: null, verifiedAt: null })] }), staff(), { date: today });
    expect(r.status).toBe("PENDING_VERIFICATION");
    expect(r.components.find((c) => c.key === "safeguarding")?.evidence[0]?.summary).toContain("awaiting verification");
  });

  it("is ready when every applicable requirement is verified and in date, citing the verifier", () => {
    const r = evaluateReadiness(facts({ records: [record()] }), staff(), { date: today });
    expect(r.status).toBe("READY");
    const c = r.components.find((c) => c.key === "safeguarding")!;
    expect(c.state).toBe("MET");
    expect(c.dueDate).toBe("2027-06-01");
    expect(c.evidence[0]?.verifiedBy).toBe("Verifier");
  });

  it("changes when a certificate expires, and warns before it does", () => {
    expect(evaluateReadiness(facts({ records: [record()] }), staff(), { date: "2027-05-15" }).components.find((c) => c.key === "safeguarding")?.state).toBe("DUE_SOON");
    const expired = evaluateReadiness(facts({ records: [record()] }), staff(), { date: "2027-06-02" });
    expect(expired.status).toBe("NOT_READY");
    expect(expired.reasons[0]).toContain("expired 2027-06-01");
  });

  it("distinguishes course completion from practical competence", () => {
    const f = facts({ requirements: [req({ requiresPractical: true })], records: [record()] });
    const noAssessment = evaluateReadiness(f, staff(), { date: today });
    expect(noAssessment.status).toBe("NOT_READY");
    expect(noAssessment.reasons[0]).toContain("practical competency not yet signed off");
    const notYet = evaluateReadiness({ ...f, assessments: [{ id: "a1", organisationId: "o", staffId: "s1", requirementId: "r1", careTaskId: null, method: "OBSERVED", observedEvidence: "x", assessorId: "a", assessorRole: null, outcome: "NOT_YET_COMPETENT", restrictions: null, remedialAction: "shadow", assessedAt: D("2026-07-01"), reviewDue: null, createdAt: D("2026-07-01") }] }, staff(), { date: today });
    expect(notYet.status).toBe("NOT_READY");
    const competent = evaluateReadiness({ ...f, assessments: [{ id: "a2", organisationId: "o", staffId: "s1", requirementId: "r1", careTaskId: null, method: "OBSERVED", observedEvidence: "x", assessorId: "a", assessorRole: null, outcome: "COMPETENT", restrictions: null, remedialAction: null, assessedAt: D("2026-07-01"), reviewDue: D("2027-07-01"), createdAt: D("2026-07-01") }] }, staff(), { date: today });
    expect(competent.status).toBe("READY");
    expect(competent.components.find((c) => c.key === "safeguarding")?.evidence.some((e) => e.kind === "ASSESSMENT" && e.verifiedBy === "Assessor")).toBe(true);
  });

  it("does not treat training as policy acknowledgement, and re-opens when a newer version is published", () => {
    const policyReq = req({ id: "r2", key: "sg-policy", name: "Safeguarding policy", category: "POLICY", policyId: "p1", scopes: [{ id: "sc2", requirementId: "r2", kind: "ALL", jobTitle: null, branchId: null, careTaskId: null, serviceUserId: null }] });
    const base = facts({ requirements: [policyReq], records: [record({ requirementId: "r2" })], publishedPolicies: [{ id: "p1", publicationId: "pub2" }] });
    expect(evaluateReadiness(base, staff(), { date: today }).reasons[0]).toContain("has not been acknowledged");
    const older = { ...base, acknowledgements: [{ staffId: "s1", policyId: "p1", acknowledged: true, publicationId: "pub1", acknowledgementId: "k1" }] };
    expect(evaluateReadiness(older, staff(), { date: today }).status).toBe("NOT_READY");
    const current = { ...base, acknowledgements: [{ staffId: "s1", policyId: "p1", acknowledged: true, publicationId: "pub2", acknowledgementId: "k2" }] };
    expect(evaluateReadiness(current, staff(), { date: today }).status).toBe("READY");
    expect(evaluateReadiness(base, staff({ userId: null }), { date: today }).reasons[0]).toContain("no sign-in linked");
  });

  it("applies requirements by role and branch, and task-level ones only to the visit that involves them", () => {
    const med = req({ id: "r3", key: "medication", name: "Medication competency", category: "COMPETENCY", scopes: [{ id: "sc3", requirementId: "r3", kind: "CARE_TASK", jobTitle: null, branchId: null, careTaskId: "task-meds", serviceUserId: null }] });
    const f = facts({ requirements: [req(), med], records: [record()] });
    const general = evaluateReadiness(f, staff(), { date: today });
    expect(general.status).toBe("READY_WITH_RESTRICTIONS");
    expect(general.blockedForContext).toBe(false);
    const medsVisit = evaluateReadiness(f, staff(), { date: today, careTaskIds: ["task-meds"] });
    expect(medsVisit.blockedForContext).toBe(true);
    expect(medsVisit.reasons.some((x) => x.startsWith("For this visit: Medication competency"))).toBe(true);
    // A senior's role is out of scope for a Care Worker requirement, so nothing is required of them.
    expect(evaluateReadiness(facts(), staff({ jobTitle: "Registered Manager" }), { date: today }).status).toBe("READY");
    const branchReq = req({ id: "r4", key: "lone", name: "Lone working", scopes: [{ id: "sc4", requirementId: "r4", kind: "BRANCH", jobTitle: null, branchId: "b2", careTaskId: null, serviceUserId: null }] });
    expect(evaluateReadiness(facts({ requirements: [branchReq] }), staff({ branchId: "b1" }), { date: today }).status).toBe("READY");
    expect(evaluateReadiness(facts({ requirements: [branchReq] }), staff({ branchId: "b2" }), { date: today }).status).toBe("NOT_READY");
  });

  it("blocks a worker for a restricted task or person while leaving them ready elsewhere", () => {
    const f = facts({ records: [record()], restrictions: [{ id: "x1", organisationId: "o", staffId: "s1", kind: "SERVICE_USER", careTaskId: null, serviceUserId: "su9", reason: "Complaint under investigation", startsAt: D("2026-10-01"), endsAt: null, createdById: "m", createdAt: D("2026-10-01"), liftedById: null, liftedAt: null, liftedReason: null }] });
    const other = evaluateReadiness(f, staff(), { date: today, serviceUserId: "su1" });
    expect(other.status).toBe("READY_WITH_RESTRICTIONS");
    expect(other.blockedForContext).toBe(false);
    expect(evaluateReadiness(f, staff(), { date: today, serviceUserId: "su9" }).blockedForContext).toBe(true);
  });

  it("records an approved exception as the evidence, until it expires", () => {
    const f = facts({ exceptions: [{ id: "e1", organisationId: "o", staffId: "s1", requirementId: "r1", reason: "Course booked 3 Nov", compensatingControls: "Shadowing only", approvedById: "m", expiresAt: D("2026-11-10"), createdAt: D("2026-10-20"), revokedById: null, revokedAt: null, revokedReason: null }] });
    const r = evaluateReadiness(f, staff(), { date: today });
    expect(r.status).toBe("READY");
    expect(r.components.find((c) => c.key === "safeguarding")?.state).toBe("EXCEPTION");
    expect(r.components.find((c) => c.key === "safeguarding")?.evidence[0]?.summary).toContain("Exception approved by Manager");
    expect(evaluateReadiness(f, staff(), { date: "2026-11-11" }).status).toBe("NOT_READY");
  });

  it("needs a review when something changed, and ranks not-ready above it", () => {
    const flag = { id: "f1", organisationId: "o", staffId: "s1", reason: "Changed role in HR", raisedById: null, raisedAt: D("2026-10-28"), clearedById: null, clearedAt: null, outcome: null };
    expect(evaluateReadiness(facts({ records: [record()], flags: [flag] }), staff(), { date: today }).status).toBe("REVIEW_REQUIRED");
    expect(evaluateReadiness(facts({ flags: [flag] }), staff(), { date: today }).status).toBe("NOT_READY");
  });

  it("treats HR checks as part of readiness: missing evidence or an overdue DBS review is not ready", () => {
    const noDbs = staff({ compliance: [{ category: "Right to work", name: "RTW", required: true, recurring: false, dueDate: null, verified: true, hasEvidence: true, hrCheckId: "c2" }] });
    expect(evaluateReadiness(facts({ records: [record()] }), noDbs, { date: today }).reasons).toContain("DBS: no check recorded in HR & Workforce");
    const overdue = staff({ compliance: [{ category: "DBS", name: "Enhanced DBS", required: true, recurring: true, dueDate: D("2026-01-01"), verified: true, hasEvidence: true, hrCheckId: "c1" }, { category: "Right to work", name: "RTW", required: true, recurring: false, dueDate: null, verified: true, hasEvidence: true, hrCheckId: "c2" }] });
    expect(evaluateReadiness(facts({ records: [record()] }), overdue, { date: today }).status).toBe("NOT_READY");
    const unverified = staff({ compliance: [{ category: "DBS", name: "Enhanced DBS", required: true, recurring: true, dueDate: D("2027-01-01"), verified: false, hasEvidence: true, hrCheckId: "c1" }, { category: "Right to work", name: "RTW", required: true, recurring: false, dueDate: null, verified: true, hasEvidence: true, hrCheckId: "c2" }] });
    expect(evaluateReadiness(facts({ records: [record()] }), unverified, { date: today }).status).toBe("PENDING_VERIFICATION");
  });

  it("keeps evidence recorded against an earlier version of the same requirement", () => {
    const v1 = req({ id: "r1", status: "RETIRED", effectiveTo: D("2026-09-01") });
    const v2 = req({ id: "r1b", version: 2, supersedesId: "r1", effectiveFrom: D("2026-09-01"), scopes: [{ id: "sc9", requirementId: "r1b", kind: "JOB_TITLE", jobTitle: "Care Worker", branchId: null, careTaskId: null, serviceUserId: null }] });
    const r = evaluateReadiness(facts({ requirements: [v1, v2], records: [record({ requirementId: "r1" })] }), staff(), { date: today });
    expect(r.status).toBe("READY");
    expect(r.components.filter((c) => c.key === "safeguarding")).toHaveLength(1);
  });
});
