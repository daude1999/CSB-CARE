import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../../src/hr/lib/seed";
import { upgradeFixtures } from "../../src/hr/lib/upgrade-fixtures";
import { documentGroup } from "../../src/hr/lib/document-groups";
import {
  branchStats,
  currentChecks,
  statusCounts,
  type HubData,
} from "../../src/hr/lib/presentation";
test("employment references stay distinct from employment contracts", () => {
  assert.equal(documentGroup("References", "Employment reference"), "References");
  assert.equal(documentGroup("Employment", "Employment contract"), "Employment");
});
test("fixture upgrade preserves existing edits, other organisations and is idempotent", () => {
  const s = seed();
  const e = s.employees[0];
  e.name = "Preserved user edit";
  e.dateOfBirth = "1981-01-01";
  const before = structuredClone(s.checks);
  const other = structuredClone(s.employees.filter((e) => e.org !== "csb"));
  upgradeFixtures(s);
  assert.equal(e.name, "Preserved user edit");
  assert.equal(e.dateOfBirth, "1981-01-01");
  assert.deepEqual(s.checks.slice(0, before.length), before);
  assert.deepEqual(
    s.employees.filter((e) => e.org !== "csb"),
    other,
  );
  const upgraded = JSON.stringify(s);
  upgradeFixtures(s);
  assert.equal(JSON.stringify(s), upgraded);
  assert.ok(
    s.checks.some((c) => c.name === "First aid certificate" && c.required),
  );
});
test("dashboard chart and branch totals reconcile to current permitted records", () => {
  const s = upgradeFixtures(seed());
  const data = {
    ...s,
    employees: s.employees.filter((e) => e.org === "csb"),
    checks: s.checks.filter((c) => c.org === "csb"),
    settings: s.settings.csb,
    user: s.users[0],
    today: "2026-09-29",
    allBranches: true,
  } as HubData;
  const checks = currentChecks(data);
  assert.equal(
    Object.values(statusCounts(checks, data.today)).reduce((a, b) => a + b, 0),
    checks.length,
  );
  const b = branchStats(data, "liverpool");
  assert.equal(b.employees.length, 14);
  assert.equal(b.rate, Math.round((b.compliant / b.employees.length) * 100));
});

test("demo address upgrade fills blank seeded records and preserves entered addresses", () => {
  const s = seed();
  s.fixtureVersion = 2;
  s.employees[0].addressLine1 = "User-entered address";
  const originalVersion = s.employees[1].version;
  upgradeFixtures(s);
  assert.equal(s.employees[0].addressLine1, "User-entered address");
  assert.equal(s.employees[0].city, undefined);
  assert.equal(s.employees[1].addressLine2, "Fictional demo address");
  assert.equal(s.employees[1].city, "Liverpool");
  assert.equal(s.employees[1].version, originalVersion + 1);
  assert.equal(s.fixtureVersion, 4);
  const before = JSON.stringify(s);
  upgradeFixtures(s);
  assert.equal(JSON.stringify(s), before);
});
