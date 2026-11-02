import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { actionsDue, complianceSummary, overviewFigures } from "@/hr/lib/overview";
import type { Check, Employee, HRTask } from "@/hr/lib/domain";

const today = "2026-11-02";
let n = 0;
const check = (over: Partial<Check>): Check => ({ id: `c${n++}`, org: "o", employee: "e1", name: "DBS review", required: true, recurring: true, due: "2027-06-01", verified: true, evidence: "d1", reviewer: "r", checkedAt: "2026-06-01", version: 1, ...over });
const person = (id: string, over: Partial<Employee> = {}): Employee => ({ id, org: "o", staffId: id, name: `Person ${id}`, branch: "b1", job: "Care Support Worker", status: "Active", start: "2024-01-01", email: "", phone: "", updated: "", version: 1, ...over });
const task = (over: Partial<HRTask>): HRTask => ({ id: `t${n++}`, org: "o", employee: "e1", branch: "b1", type: "Onboarding", assignedTo: "me", due: "2026-10-01", priority: "Normal", status: "Not started", requirement: null, document: null, version: 1, created: "", updated: "", createdBy: "x", ...over } as HRTask);

describe("HR overview counting rules", () => {
  const employees = [person("e1"), person("e2", { status: "Onboarding", start: "2026-11-05" }), person("e3", { status: "Archived" }), person("e4", { start: "2026-12-02" }), person("e5", { start: "2026-12-03" })];
  const checks = [
    check({ name: "Safeguarding training", category: "Training", due: "2026-10-20" }), // training overdue
    check({ name: "First aid certificate", category: "Training", due: "2026-11-20" }), // training due soon
    check({ name: "DBS review", due: "2026-10-01" }), // overdue, not training
    check({ name: "Right to work", verified: false }), // awaiting verification
    check({ name: "Employment contract", category: "Contracts", evidence: null }), // missing
    check({ name: "Optional", required: false, evidence: null }), // not required: ignored
    check({ employee: "e3", evidence: null }), // archived person: ignored
  ];
  const f = overviewFigures({ employees, checks, today, userId: "me", tasks: [task({}), task({ assignedTo: "other" }), task({ status: "Complete" }), task({ due: "2026-12-01" })] });

  it("counts everyone not archived, and only their required checks", () => {
    expect(f.employees).toBe(4);
    expect(f.missing.n).toBe(1);
  });
  it("splits training into overdue and due within 30 days", () => {
    expect(f.training).toMatchObject({ overdue: 1, dueSoon: 1 });
    expect(f.overdue.n).toBe(2);
    expect(f.awaitingReview.n).toBe(1);
  });
  it("starting soon is a start date from today to 30 days ahead", () => {
    expect(f.starters.map((e) => e.id)).toEqual(["e2", "e4"]);
  });
  it("counts only my own open HR tasks that are past due", () => {
    expect(f.myOverdueTasks).toBe(1);
  });
  it("actions due counts each item once, plus leave requests and tasks", () => {
    // training (2) + overdue DBS (1) + awaiting (1) + missing (1) = 5 distinct checks; overdue training counted once.
    expect(actionsDue(f, 3)).toBe(5 + 3 + 1);
  });
});

describe("People compliance summary", () => {
  it("uses the least healthy required check, in plain words", () => {
    expect(complianceSummary([check({}), check({ due: "2026-10-01" })], today).label).toBe("Overdue");
    expect(complianceSummary([check({ evidence: null })], today)).toMatchObject({ label: "Missing evidence", tone: "bad" });
    expect(complianceSummary([check({ verified: false })], today)).toMatchObject({ label: "Review needed", tone: "warn" });
    expect(complianceSummary([check({ due: "2026-11-20" })], today)).toMatchObject({ label: "Due soon", tone: "warn" });
    expect(complianceSummary([check({})], today)).toMatchObject({ label: "Compliant", tone: "good" });
    expect(complianceSummary([check({ required: false })], today).label).toBe("Not assessed");
  });
});

describe("HR styles stay inside HR", () => {
  it("every rule in hr-ui.css starts with .hr-ui (or is a keyframe step)", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/(app)/hr/hr-ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
    expect(selectors.length).toBeGreaterThan(50);
    for (const list of selectors) for (const sel of list.split(/,(?![^(]*\))/)) expect(sel.trim(), sel).toMatch(/^\.hr-ui\b/);
  });
});
