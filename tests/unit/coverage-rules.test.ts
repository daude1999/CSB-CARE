import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { attendanceRate, classify, coveragePeriod, perCarerAttendance, staffingHistory, tally, type AssignmentRow } from "@/server/rota/coverage";
import { allocationReason, parseUnassigned, priorityOf } from "@/server/rota/unassigned";
import { assignmentChecks } from "@/server/rota/unassigned-cover";
import type { EligibilityResult } from "@/server/workforce/eligibility";

const at = (iso: string) => new Date(iso);
const START = at("2026-10-20T09:00:00Z");
const row = (p: Partial<AssignmentRow> & Pick<AssignmentRow, "id" | "staffId" | "assignedAt">): AssignmentRow => ({ slot: "PRIMARY", assignedById: "u1", removedAt: null, removedById: null, removeReason: null, ...p });

describe("coverage classification", () => {
  const now = at("2026-10-21T12:00:00Z");
  it("puts every visit in exactly one reporting category", () => {
    expect(classify({ status: "CANCELLED", scheduledStart: START }, true, now)).toBe("CANCELLED");
    expect(classify({ status: "COMPLETED", scheduledStart: START }, true, now)).toBe("ATTENDED_COMPLETED");
    expect(classify({ status: "IN_PROGRESS", scheduledStart: START }, true, now)).toBe("ATTENDED_OPEN");
    expect(classify({ status: "MISSED", scheduledStart: START }, false, now)).toBe("MISSED");
    expect(classify({ status: "NOT_DELIVERED", scheduledStart: START }, false, now)).toBe("NOT_DELIVERED");
    // A completed status with no clock in force is not evidence of attendance.
    expect(classify({ status: "COMPLETED", scheduledStart: START }, false, now)).toBe("NO_RECORD");
    expect(classify({ status: "SCHEDULED", scheduledStart: START }, false, now)).toBe("NO_RECORD");
    expect(classify({ status: "SCHEDULED", scheduledStart: at("2026-10-21T15:00:00Z") }, false, now)).toBe("NOT_DUE");
  });

  it("reconciles: attended + without + cancelled + not due = total, visits counted once", () => {
    const rows = [
      { outcome: "ATTENDED_COMPLETED", status: "COMPLETED", reassigned: true, late: true },
      { outcome: "ATTENDED_OPEN", status: "IN_PROGRESS", reassigned: false, late: false },
      { outcome: "MISSED", status: "MISSED", reassigned: false, late: false },
      { outcome: "NO_RECORD", status: "COMPLETED", reassigned: false, late: false },
      { outcome: "CANCELLED", status: "CANCELLED", reassigned: false, late: false },
      { outcome: "NOT_DUE", status: "SCHEDULED", reassigned: false, late: false },
    ] as const;
    const t = tally(rows.map((r) => ({ ...r })));
    expect(t.total).toBe(6);
    expect(t.attended + t.uncovered + t.cancelled + t.notDue).toBe(t.total);
    expect(t.completed).toBe(2);
    expect(t.uncovered).toBe(t.missed + t.notDelivered + t.noRecord);
    // Rate excludes cancelled and not-yet-due visits.
    expect(attendanceRate(t)).toBe(50);
  });
});

describe("staffing history", () => {
  it("keeps the original carer and finds a late replacement", () => {
    const h = staffingHistory([
      row({ id: "a", staffId: "ahmed", assignedAt: at("2026-10-18T10:00:00Z"), removedAt: at("2026-10-20T08:40:00Z"), removeReason: "Sickness absence recorded" }),
      row({ id: "b", staffId: "fatima", assignedAt: at("2026-10-20T08:40:00Z"), assignedById: "coord" }),
    ], START, 30);
    expect(h.original).toEqual(["ahmed"]);
    expect(h.current).toEqual(["fatima"]);
    expect(h.reassigned).toBe(true);
    expect(h.replacements[0]).toMatchObject({ fromStaffId: "ahmed", toStaffId: "fatima", byId: "coord", reason: "Sickness absence recorded", minutesBefore: 20, late: true });
    expect(staffingHistory([row({ id: "a", staffId: "ahmed", assignedAt: at("2026-10-18T10:00:00Z"), removedAt: at("2026-10-20T08:40:00Z") }), row({ id: "b", staffId: "fatima", assignedAt: at("2026-10-20T08:40:00Z") })], START, 15).late).toBe(false);
  });

  it("follows a chain of replacements and counts changes, ignoring shadows", () => {
    const h = staffingHistory([
      row({ id: "1", staffId: "a", assignedAt: at("2026-10-10T10:00:00Z"), removedAt: at("2026-10-12T10:00:00Z") }),
      row({ id: "2", staffId: "b", assignedAt: at("2026-10-12T10:00:00Z"), removedAt: at("2026-10-15T10:00:00Z") }),
      row({ id: "3", staffId: "c", assignedAt: at("2026-10-15T10:00:00Z") }),
      row({ id: "4", staffId: "s", slot: "SHADOW", assignedAt: at("2026-10-11T10:00:00Z") }),
    ], START, 30);
    expect(h.original).toEqual(["a"]);
    expect(h.current).toEqual(["c"]);
    expect(h.replacements.map((r) => r.toStaffId)).toEqual(["b", "c"]);
    expect(h.changes).toBe(2);
    expect(h.late).toBe(false);
  });

  it("treats a double-up's places separately and a removal without replacement as a change", () => {
    const h = staffingHistory([
      row({ id: "1", staffId: "a", assignedAt: at("2026-10-10T10:00:00Z") }),
      row({ id: "2", staffId: "b", slot: "SECOND", assignedAt: at("2026-10-10T10:00:00Z"), removedAt: at("2026-10-19T10:00:00Z") }),
    ], START, 30);
    expect(h.original).toEqual(["a", "b"]);
    expect(h.current).toEqual(["a"]);
    expect(h.reassigned).toBe(false);
    expect(h.changes).toBe(1);
  });
});

describe("per-carer attendance", () => {
  it("never pairs one carer's clock-in with another's clock-out, and uses corrections in force", () => {
    const c = (id: string, staffId: string, kind: "IN" | "OUT", iso: string, supersedesId: string | null = null) => ({ id, staffId, kind, at: at(iso), supersedesId });
    const m = perCarerAttendance([
      c("1", "a", "IN", "2026-10-20T09:00:00Z"),
      c("2", "b", "IN", "2026-10-20T09:05:00Z"),
      c("3", "a", "OUT", "2026-10-20T09:20:00Z"),
      c("4", "a", "OUT", "2026-10-20T09:30:00Z", "3"),
      c("5", "b", "OUT", "2026-10-20T09:40:00Z"),
    ]);
    expect(m.get("a")).toMatchObject({ in: at("2026-10-20T09:00:00Z"), out: at("2026-10-20T09:30:00Z"), corrected: true });
    expect(m.get("b")).toMatchObject({ in: at("2026-10-20T09:05:00Z"), out: at("2026-10-20T09:40:00Z"), corrected: false });
  });
});

describe("reporting period", () => {
  it("defaults to the last seven complete London days, ending yesterday", () => {
    expect(coveragePeriod("7", undefined, undefined, "2026-11-01")).toEqual({ from: "2026-10-25", to: "2026-10-31", partial: false });
    expect(coveragePeriod("90", undefined, undefined, "2026-11-01").from).toBe("2026-08-03");
  });
  it("labels a range that includes today as partial and never runs past today", () => {
    expect(coveragePeriod("custom", "2026-10-28", "2026-11-05", "2026-11-01")).toEqual({ from: "2026-10-28", to: "2026-11-01", partial: true });
  });
  it("refuses a custom period over 92 days", () => {
    expect(() => coveragePeriod("custom", "2026-01-01", "2026-10-01", "2026-11-01")).toThrow(/92 days/);
  });
  it("crosses the October clock change by calendar day", () => {
    // 25 Oct 2026 is the last Sunday of October (BST ends); the period is still seven calendar days.
    expect(coveragePeriod("7", undefined, undefined, "2026-10-26")).toEqual({ from: "2026-10-19", to: "2026-10-25", partial: false });
  });
});

describe("unassigned priority and reasons", () => {
  const now = at("2026-11-01T08:00:00Z");
  it("applies the stated priority rule", () => {
    expect(priorityOf({ status: "SCHEDULED", scheduledStart: at("2026-11-01T09:30:00Z"), riskLevel: null }, now).priority).toBe("URGENT");
    expect(priorityOf({ status: "MISSED", scheduledStart: at("2026-11-01T07:30:00Z"), riskLevel: null }, now).priority).toBe("URGENT");
    expect(priorityOf({ status: "SCHEDULED", scheduledStart: at("2026-11-01T20:00:00Z"), riskLevel: "HIGH" }, now).priority).toBe("URGENT");
    expect(priorityOf({ status: "SCHEDULED", scheduledStart: at("2026-11-01T20:00:00Z"), riskLevel: "LOW" }, now).priority).toBe("HIGH");
    expect(priorityOf({ status: "SCHEDULED", scheduledStart: at("2026-11-04T20:00:00Z"), riskLevel: "HIGH" }, now).priority).toBe("HIGH");
    expect(priorityOf({ status: "SCHEDULED", scheduledStart: at("2026-11-04T20:00:00Z"), riskLevel: null }, now).priority).toBe("NORMAL");
  });
  it("explains why a place is empty from the visit's records", () => {
    expect(allocationReason({ carersRequired: 1, rotaBuildId: null, templateId: null }, [], [{ slot: "PRIMARY", removeReason: "Sickness", removedAt: now, staffName: "Ahmed Ali" }])).toBe("Ahmed Ali removed: Sickness");
    expect(allocationReason({ carersRequired: 2, rotaBuildId: "b", templateId: "t" }, [{ slot: "PRIMARY" }], [])).toBe("Second carer needed (double-up)");
    expect(allocationReason({ carersRequired: 1, rotaBuildId: "b", templateId: "t" }, [], [])).toBe("No carer when the rota was built");
    expect(allocationReason({ carersRequired: 1, rotaBuildId: null, templateId: null }, [], [])).toBe("New visit, not yet allocated");
  });
  it("reads Today, Tomorrow, This Week, custom and the older from/days links", () => {
    expect(parseUnassigned({}, "2026-11-01")).toMatchObject({ when: "today", from: "2026-11-01", to: "2026-11-01" });
    expect(parseUnassigned({ when: "tomorrow" }, "2026-11-01")).toMatchObject({ from: "2026-11-02", to: "2026-11-02" });
    expect(parseUnassigned({ when: "week" }, "2026-11-01")).toMatchObject({ from: "2026-11-01", to: "2026-11-07" });
    expect(parseUnassigned({ from: "2026-11-03", days: "7" }, "2026-11-01")).toMatchObject({ when: "custom", from: "2026-11-03", to: "2026-11-09" });
    expect(parseUnassigned({ when: "custom", from: "2026-11-01", to: "2027-01-30" }, "2026-11-01").to).toBe("2026-11-28");
  });
});

describe("assignment checks", () => {
  const base: EligibilityResult = { staffId: "s", state: "ELIGIBLE", blocking: [], warnings: [], advice: [], compliance: { dbs: "Up to date", rightToWork: "Up to date", training: "3 of 3 up to date" }, restrictions: [], readiness: null };
  it("shows a check as passed only from the service's own result", () => {
    const checks = assignmentChecks(base);
    expect(checks.find((c) => c.label === "DBS")).toMatchObject({ state: "ok", text: "Recorded in HR: up to date" });
    expect(checks.every((c) => c.state === "ok")).toBe(true);
  });
  it("turns blocking reasons into failures and warnings into warnings; unknown codes are never dropped", () => {
    const checks = assignmentChecks({ ...base, state: "NOT_ELIGIBLE", blocking: [{ code: "OVERLAP", message: "Already booked 09:00–09:30 (V-1)" }, { code: "NEW_RULE", message: "Something new" }], warnings: [{ code: "MAX_HOURS", message: "Would exceed their 40 hour weekly limit" }], advice: [{ code: "TRAVEL", message: "Only 5 minutes after the previous visit" }] });
    expect(checks.find((c) => c.label === "Existing bookings")).toMatchObject({ state: "fail" });
    expect(checks.find((c) => c.label === "Weekly hours")).toMatchObject({ state: "warn" });
    expect(checks.find((c) => c.text === "Something new")).toMatchObject({ state: "fail" });
    expect(checks.find((c) => c.label === "Time between bookings")?.text).toContain("not a journey time");
  });
});
