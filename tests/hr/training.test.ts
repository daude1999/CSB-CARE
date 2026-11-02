import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../../src/hr/lib/seed";
import { checkStatus, type State } from "../../src/hr/lib/domain";
import {
  assignTraining,
  closeAssignment,
  completeAssignmentForTask,
  completeAssignmentsForCheck,
  courseOptions,
  isTraining,
  outstandingTraining,
  planReminders,
  reminderText,
} from "../../src/hr/lib/training";

const TODAY = "2026-11-02";
const user = (s: State, id: string) => s.users.find((u) => u.id === id)!;
const base = { course: "Medication refresher", due: "2026-12-01", assignedTo: "admin", note: "" };

test("assigning training adds an open assignment, an HR task and history, and never touches checks", () => {
  const s = seed();
  const before = JSON.stringify(s.checks);
  const r = assignTraining(s, user(s, "admin"), { ...base, employees: ["emp-1", "emp-2"] }, TODAY);
  assert.deepEqual(r.assigned.length, 2);
  assert.equal(JSON.stringify(s.checks), before, "checks (and so rota readiness) are unchanged");
  const a = s.trainingAssignments!.filter((x) => x.status === "Open");
  assert.equal(a.length, 2);
  const task = s.tasks!.find((t) => t.id === a[0].task)!;
  assert.equal(task.type, "Complete training: Medication refresher");
  assert.equal(task.status, "Waiting on employee");
  assert.equal(task.assignedTo, "admin");
  assert.ok(s.events.some((e) => e.employee === "emp-1" && e.action.startsWith("Training assigned: Medication refresher")));
});

test("the same open course is not assigned twice, and archived people are skipped", () => {
  const s = seed();
  assignTraining(s, user(s, "admin"), { ...base, employees: ["emp-1"] }, TODAY);
  const r = assignTraining(s, user(s, "admin"), { ...base, course: "medication REFRESHER", employees: ["emp-1", "emp-14"] }, TODAY);
  assert.deepEqual(r.assigned, []);
  assert.deepEqual(r.skipped.map((x) => x.reason), ["already assigned, due 2026-12-01", "archived"]);
});

test("permissions: read-only users, other branches and other organisations are refused", () => {
  const s = seed();
  assert.throws(() => assignTraining(s, user(s, "viewer"), { ...base, employees: ["emp-1"] }, TODAY), /read-only/);
  assert.throws(() => assignTraining(s, user(s, "liverpool-hr"), { ...base, assignedTo: "", employees: ["emp-20"] }, TODAY), /Record not available/);
  assert.throws(() => assignTraining(s, user(s, "admin"), { ...base, employees: ["other-emp"] }, TODAY), /Record not available/);
  assert.throws(() => assignTraining(s, user(s, "admin"), { ...base, assignedTo: "other-admin", employees: ["emp-1"] }, TODAY), /active HR user/);
  assert.throws(() => assignTraining(s, user(s, "admin"), { ...base, assignedTo: "liverpool-hr", employees: ["emp-20"] }, TODAY), /cannot see/);
  assert.throws(() => assignTraining(s, user(s, "admin"), { ...base, due: "2026-11-01", employees: ["emp-1"] }, TODAY), /past/);
  assert.equal(s.trainingAssignments?.length ?? 0, 0, "a refused request records nothing");
});

test("an assignment closes by hand, from its HR task, or when the person's own check is verified", () => {
  const s = seed();
  const admin = user(s, "admin");
  const training = s.checks.find((c) => c.employee === "emp-3" && c.required && isTraining(c))!;
  assignTraining(s, admin, { ...base, course: training.name.toUpperCase(), employees: ["emp-1", "emp-2", "emp-3"] }, TODAY);
  const [a1, a2, a3] = s.trainingAssignments!;
  assert.equal(a3.check, training.id, "linked to the person's own check, using its name");
  assert.equal(a3.course, training.name);

  assert.throws(() => closeAssignment(s, admin, { id: a1.id, version: 99, outcome: "Completed" }), /changed/);
  closeAssignment(s, admin, { id: a1.id, version: a1.version, outcome: "Cancelled" });
  assert.equal(a1.status, "Cancelled");
  assert.equal(s.tasks!.find((t) => t.id === a1.task)!.status, "Complete");
  assert.throws(() => closeAssignment(s, admin, { id: a1.id, version: a1.version, outcome: "Completed" }), /already closed/);

  completeAssignmentForTask(s, admin, a2.task!);
  assert.equal(a2.status, "Completed");

  completeAssignmentsForCheck(s, admin, training);
  assert.equal(a3.status, "Completed");
  assert.equal(s.tasks!.find((t) => t.id === a3.task)!.status, "Complete");
});

test("outstanding training: open assignments plus overdue, due soon and missing training, never 'to verify'", () => {
  const s = seed();
  assignTraining(s, user(s, "admin"), { ...base, employees: ["emp-1"] }, TODAY);
  const items = outstandingTraining(s, "emp-1", TODAY);
  assert.ok(items.some((i) => i.course === "Medication refresher" && i.status === "Assigned"));
  for (const i of items) assert.notEqual(i.status, "Awaiting verification");
  const own = s.checks.filter((c) => c.employee === "emp-1" && c.required && isTraining(c));
  for (const c of own) {
    const st = checkStatus(c, TODAY);
    const listed = items.some((i) => i.course === c.name);
    assert.equal(listed, ["Overdue", "Due soon", "Missing evidence"].includes(st), `${c.name} ${st}`);
  }
  assert.ok(outstandingTraining(s, "emp-1", "2026-12-02").some((i) => i.course === "Medication refresher" && i.status === "Overdue"), "a late assignment shows as overdue");
});

test("reminders: only people with a linked sign-in and training to do, once a day, recorded in history", () => {
  const s = seed();
  const admin = user(s, "admin");
  assignTraining(s, admin, { ...base, employees: ["emp-1", "emp-2"] }, TODAY);
  const signIns = new Map([["emp-1", "user-1"]]);
  const first = planReminders(s, admin, ["emp-1", "emp-2"], signIns, TODAY);
  assert.deepEqual(first.result.sent, [s.employees[0].name]);
  assert.deepEqual(first.result.skipped, [{ name: s.employees[1].name, reason: "no CSB sign-in linked" }]);
  assert.equal(first.plans[0].userId, "user-1");
  assert.ok(s.events.some((e) => e.employee === "emp-1" && e.action.startsWith("Training reminder sent to CSB notifications")));
  const again = planReminders(s, admin, ["emp-1"], signIns, TODAY);
  assert.deepEqual(again.plans, []);
  assert.equal(again.result.skipped[0].reason, "already reminded today");
  assert.equal(planReminders(s, admin, ["emp-1"], signIns, "2026-11-03").plans.length, 1, "a new day allows a new reminder");
  assert.throws(() => planReminders(s, user(s, "viewer"), ["emp-1"], signIns, TODAY), /read-only/);
  assert.throws(() => planReminders(s, user(s, "liverpool-hr"), ["emp-20"], signIns, TODAY), /Record not available/);
});

test("reminder wording names each course and never invents dates", () => {
  const t = reminderText(
    [
      { course: "Fire safety", status: "Overdue", due: "2026-10-03" },
      { course: "First aid", status: "Missing evidence", due: null },
      { course: "Medication refresher", status: "Assigned", due: "2026-12-01" },
    ],
  );
  assert.equal(t.title, "Training overdue");
  assert.equal(t.body, "Please complete: Fire safety (overdue since 3 Oct); First aid (no certificate on file); Medication refresher (by 1 Dec). When you have your certificate, give it to the office so HR can record it.");
  assert.equal(reminderText([{ course: "First aid", status: "Due soon", due: "2026-11-20" }]).title, "Training reminder");
});

test("course options come from training requirements and records, without duplicates", () => {
  const s = seed();
  const opts = courseOptions({ checks: s.checks, settings: s.settings.csb });
  assert.equal(new Set(opts.map((o) => o.toLowerCase())).size, opts.length);
  assert.ok(!opts.includes("DBS review") && !opts.includes("Right to work"));
});
