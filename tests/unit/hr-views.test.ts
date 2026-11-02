import { describe, expect, it } from "vitest";
import { isTraining, nextDue, worst } from "@/hr/components/hr-views";
import type { Check } from "@/hr/lib/domain";

const today = "2026-11-01";
const check = (over: Partial<Check>): Check => ({ id: Math.random().toString(36), org: "o", employee: "e", name: "DBS review", required: true, recurring: true, due: "2027-06-01", verified: true, evidence: "d1", reviewer: "r", checkedAt: "2026-06-01", version: 1, ...over });

describe("HR redesign helpers (figures come from the HR records only)", () => {
  it("shows the least healthy required status, and nothing when no check is required", () => {
    expect(worst([check({}), check({ due: "2026-10-01" })], today)).toBe("Overdue");
    expect(worst([check({}), check({ evidence: null })], today)).toBe("Missing evidence");
    expect(worst([check({}), check({ verified: false })], today)).toBe("Awaiting verification");
    expect(worst([check({ due: "2026-11-20" })], today)).toBe("Due soon");
    expect(worst([check({})], today)).toBe("Up to date");
    expect(worst([check({ required: false, evidence: null })], today)).toBeNull();
    expect(worst([], today)).toBeNull();
  });

  it("takes the earliest review date of required checks only", () => {
    expect(nextDue([check({ due: "2027-01-01" }), check({ due: "2026-12-01" }), check({ due: "2026-01-01", required: false })])).toBe("2026-12-01");
    expect(nextDue([check({ due: null })])).toBeNull();
  });

  it("treats training and certificates as training, but not DBS or right to work", () => {
    expect(isTraining({ name: "Safeguarding training" })).toBe(true);
    expect(isTraining({ name: "First aid certificate", category: "Qualifications" })).toBe(true);
    expect(isTraining({ name: "DBS review" })).toBe(false);
    expect(isTraining({ name: "Right to work" })).toBe(false);
  });
});
