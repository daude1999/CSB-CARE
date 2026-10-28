import test from "node:test";
import assert from "node:assert/strict";
import {
  checkStatus,
  dateDays,
  employeeStatus,
  csvCell,
  permits,
  type Check,
} from "../../src/hr/lib/domain";
import { seed } from "../../src/hr/lib/seed";
import { runReminders } from "../../src/hr/lib/reminders";
import {
  DisabledEmailProvider,
  UnconfiguredOneDriveReader,
} from "../../src/hr/lib/providers";
const check: Check = {
  id: "test",
  org: "csb",
  employee: "emp-1",
  name: "DBS review",
  required: true,
  recurring: true,
  due: "2026-09-29",
  verified: true,
  evidence: "doc-0",
  reviewer: "Alex",
  checkedAt: "2026-09-01T10:00:00Z",
  version: 1,
};
test("review calendar boundaries: yesterday, today, 30 and 31 days", () => {
  for (const [due, expected] of [
    ["2026-09-28", "Overdue"],
    ["2026-09-29", "Due soon"],
    ["2026-10-29", "Due soon"],
    ["2026-10-30", "Up to date"],
  ])
    assert.equal(checkStatus({ ...check, due }, "2026-09-29"), expected);
});
test("evidence, verification and missing dates cannot become green", () => {
  assert.equal(
    checkStatus({ ...check, evidence: null, due: "2027-01-01" }, "2026-09-29"),
    "Missing evidence",
  );
  assert.equal(
    checkStatus({ ...check, verified: false, due: "2027-01-01" }, "2026-09-29"),
    "Awaiting verification",
  );
  assert.equal(
    checkStatus({ ...check, due: null }, "2026-09-29"),
    "Incomplete information",
  );
  assert.equal(
    checkStatus({ ...check, due: null, recurring: false }, "2026-09-29"),
    "Up to date",
  );
  assert.equal(
    checkStatus({ ...check, required: false }, "2026-09-29"),
    "Not applicable",
  );
  assert.equal(employeeStatus([], "2026-09-29"), "Not assessed");
});
test("date-only arithmetic across UK daylight saving transitions", () => {
  assert.equal(dateDays("2026-03-30", "2026-03-28"), 2);
  assert.equal(dateDays("2026-10-26", "2026-10-24"), 2);
  assert.equal(dateDays("2027-01-01", "2026-12-31"), 1);
});
test("organisation and branch scope deny by default, including transfer", () => {
  const s = seed();
  const u = s.users.find((u) => u.id === "liverpool-hr")!;
  assert.ok(permits(u, s.employees[0]));
  assert.ok(!permits(u, s.employees[15]));
  assert.ok(!permits(u, s.employees.at(-1)!));
  s.employees[0].branch = "portsmouth";
  assert.ok(!permits(u, s.employees[0]));
  assert.ok(!permits({ ...u, active: false }, s.employees[1]));
});
test("reminders deduplicate, catch up at one threshold and cancel obsolete deliveries", () => {
  const s = seed();
  const first = runReminders(s, "2026-09-29");
  assert.ok(first > 0);
  assert.equal(runReminders(s, "2026-09-29"), 0);
  assert.equal(new Set(s.notices.map((n) => n.key)).size, s.notices.length);
  for (const n of s.notices) {
    const e = s.employees.find((e) => e.id === n.employee)!;
    const u = s.users.find((u) => u.id === n.recipient)!;
    assert.ok(permits(u, e));
    assert.notEqual(u.role, "Branch Viewer");
    assert.notEqual(e.status, "Archived");
  }
  const notice = s.notices[0];
  const c = s.checks.find((c) => c.id === notice.check)!;
  c.due = "2027-01-01";
  c.version++;
  runReminders(s, "2026-09-29");
  assert.equal(notice.state, "Cancelled");
});
test("reminders revoke access and read status does not change compliance", () => {
  const s = seed();
  runReminders(s, "2026-09-29");
  const n = s.notices.find((n) => n.recipient === "liverpool-hr")!;
  const c = s.checks.find((c) => c.id === n.check)!;
  const before = checkStatus(c, "2026-09-29");
  n.read = true;
  assert.equal(checkStatus(c, "2026-09-29"), before);
  s.users.find((u) => u.id === "liverpool-hr")!.active = false;
  runReminders(s, "2026-09-29");
  assert.ok(
    s.notices
      .filter((n) => n.recipient === "liverpool-hr")
      .every((n) => n.state === "Cancelled"),
  );
});
test("CSV export neutralises formulas, including leading whitespace", () => {
  for (const value of ["=SUM(1,2)", "+cmd", "-10", "@formula", "  =1", "\t=1"])
    assert.ok(csvCell(value).startsWith("\"'"));
  assert.equal(csvCell('Alice "Demo"'), '"Alice ""Demo"""');
});
test("45 CSB employees, second organisation, coherent fixtures and real seed events", () => {
  const s = seed();
  assert.equal(s.employees.filter((e) => e.org === "csb").length, 45);
  assert.equal(s.branches.filter((b) => b.org === "csb").length, 3);
  for (const c of s.checks)
    if (c.evidence)
      assert.ok(
        s.documents.some(
          (d) => d.id === c.evidence && d.employee === c.employee,
        ),
      );
  for (const e of s.employees)
    assert.ok(s.events.some((a) => a.employee === e.id));
  assert.ok(
    s.employees.some(
      (e) =>
        employeeStatus(
          s.checks.filter((c) => c.employee === e.id),
          "2026-09-29",
        ) === "Checks up to date",
    ),
  );
});
test("external adapters cannot silently send email or read OneDrive", async () => {
  assert.equal((await new DisabledEmailProvider().send()).accepted, false);
  await assert.rejects(
    () => new UnconfiguredOneDriveReader().listApprovedSource(),
    /not connected/,
  );
});
