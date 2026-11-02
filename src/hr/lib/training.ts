import {
  canEdit,
  checkCategory,
  checkStatus,
  permits,
  priorities,
  type Check,
  type Employee,
  type ReviewStatus,
  type State,
  type TrainingAssignment,
  type User,
} from "./domain";
import { HttpError } from "./http-error";

/**
 * Assign Training and Send Reminder (HR Checks & Training, 2 Nov 2026).
 *
 * An assignment says "this person must complete this course by this date". It is kept apart from the person's
 * checks on purpose: assigning a course never changes a check, its evidence or the rota's readiness rules. Readiness
 * still comes only from verified checks. When the course is one of the person's own training checks, the assignment
 * is completed automatically once that check is verified after it was assigned.
 *
 * A reminder goes to the person's CSB notifications (the bell) only. Nothing is sent by e-mail or text. People
 * without a linked CSB sign-in are reported back so HR can tell them in person.
 */

const TRAINING = /training|certificate|first aid|manual handling|medication|moving|infection|fire|food|mca|dols/i;
export const isTraining = (c: Pick<Check, "name" | "category">) =>
  c.category === "Training" ||
  (checkCategory(c) !== "DBS" && checkCategory(c) !== "Right to work" && TRAINING.test(`${c.name} ${c.category ?? ""}`));

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function fail(message: string, status = 400): never {
  throw new HttpError(status, message);
}

/** Course names HR can pick from: the organisation's training requirements, then training already on people's records. */
export function courseOptions(s: Pick<State, "checks"> & { settings: State["settings"][string] }): string[] {
  const names: string[] = [];
  const add = (n: string) => {
    if (n.trim() && !names.some((x) => same(x, n))) names.push(n.trim());
  };
  for (const r of s.settings.requirements) if (r.enabled && r.category === "Training") add(r.name);
  for (const c of s.checks) if (isTraining(c)) add(c.name);
  return names.sort((a, b) => a.localeCompare(b));
}

export type AssignInput = {
  employees: string[];
  course: string;
  due: string;
  assignedTo: string;
  note: string;
};
export type AssignResult = { assigned: string[]; skipped: { name: string; reason: string }[] };

/** One employee the HR user may act on, or a 404 that looks the same as a missing record. */
function employeeFor(s: State, u: User, id: string): Employee {
  const e = s.employees.find((x) => x.id === id);
  if (!e || !permits(u, e)) fail("Record not available", 404);
  return e;
}

export function assignTraining(s: State, u: User, input: AssignInput, today: string, now = new Date().toISOString()): AssignResult {
  if (!canEdit(u)) fail("Your account is read-only", 403);
  if (input.due < today) fail("The complete-by date cannot be in the past");
  const people = input.employees.map((id) => employeeFor(s, u, id));
  const follower = input.assignedTo ? s.users.find((x) => x.id === input.assignedTo && x.org === u.org && x.active && canEdit(x)) : null;
  if (input.assignedTo && !follower) fail("Follow-up must be an active HR user");
  s.trainingAssignments ??= [];
  s.tasks ??= [];
  const result: AssignResult = { assigned: [], skipped: [] };
  for (const e of people) {
    if (e.status === "Archived") {
      result.skipped.push({ name: e.name, reason: "archived" });
      continue;
    }
    if (follower && !follower.branches.includes(e.branch)) fail(`${follower.name} cannot see ${e.name}'s branch. Choose someone else to follow up.`);
    const open = s.trainingAssignments.find((a) => a.employee === e.id && a.status === "Open" && same(a.course, input.course));
    if (open) {
      result.skipped.push({ name: e.name, reason: `already assigned, due ${open.due}` });
      continue;
    }
    const check = s.checks.find((c) => c.employee === e.id && c.required && same(c.name, input.course)) ?? null;
    const course = check?.name ?? input.course.trim();
    const task = {
      id: crypto.randomUUID(),
      org: u.org,
      employee: e.id,
      branch: e.branch,
      type: `Complete training: ${course}`,
      assignedTo: follower?.id ?? "",
      due: input.due,
      priority: "Normal" as const,
      status: "Waiting on employee" as const,
      requirement: check?.id ?? null,
      document: null,
      version: 1,
      created: now,
      updated: now,
      createdBy: u.id,
    };
    s.tasks.push(task);
    s.trainingAssignments.push({
      id: crypto.randomUUID(),
      org: u.org,
      employee: e.id,
      course,
      check: check?.id ?? null,
      due: input.due,
      note: input.note.trim() || null,
      status: "Open",
      task: task.id,
      assignedBy: u.name,
      assignedAt: now,
      closedBy: null,
      closedAt: null,
      version: 1,
    });
    audit(s, u, e.id, `Training assigned: ${course}, complete by ${input.due}`, now);
    result.assigned.push(e.name);
  }
  return result;
}

/** Mark an assignment complete or cancel it. Completing never verifies a check: evidence is still reviewed on the record. */
export function closeAssignment(s: State, u: User, input: { id: string; version: number; outcome: "Completed" | "Cancelled" }, now = new Date().toISOString()) {
  if (!canEdit(u)) fail("Your account is read-only", 403);
  const a = (s.trainingAssignments ?? []).find((x) => x.id === input.id && x.org === u.org);
  if (!a) fail("Assignment not available", 404);
  const e = employeeFor(s, u, a.employee);
  if (a.status !== "Open") fail("This assignment is already closed", 409);
  if (a.version !== input.version) fail("Assignment changed. Refresh before saving.", 409);
  close(s, a, input.outcome, u.name, now);
  audit(s, u, e.id, `Training ${input.outcome === "Completed" ? "marked complete" : "assignment cancelled"}: ${a.course}`, now);
}

function close(s: State, a: TrainingAssignment, outcome: "Completed" | "Cancelled", by: string, now: string) {
  Object.assign(a, { status: outcome, closedBy: by, closedAt: now, version: a.version + 1 });
  const t = (s.tasks ?? []).find((x) => x.id === a.task && x.status !== "Complete");
  if (t) Object.assign(t, { status: "Complete", updated: now, version: t.version + 1 });
}

/** After a check is verified: complete any open assignment for it that was made before the verification. */
export function completeAssignmentsForCheck(s: State, u: User, check: Check, now = new Date().toISOString()) {
  for (const a of (s.trainingAssignments ?? []).filter((x) => x.status === "Open" && x.employee === check.employee && (x.check === check.id || (!x.check && same(x.course, check.name))))) {
    close(s, a, "Completed", u.name, now);
    audit(s, u, a.employee, `Training assignment completed by verified record: ${a.course}`, now);
  }
}

/** When the follow-up HR task is marked complete in My Tasks, the assignment it belongs to is complete too. */
export function completeAssignmentForTask(s: State, u: User, taskId: string, now = new Date().toISOString()) {
  const a = (s.trainingAssignments ?? []).find((x) => x.task === taskId && x.status === "Open");
  if (!a) return;
  Object.assign(a, { status: "Completed", closedBy: u.name, closedAt: now, version: a.version + 1 });
  audit(s, u, a.employee, `Training marked complete from HR task: ${a.course}`, now);
}

/* ------------------------------------------------------------------ reminders */

export type ReminderItem = { course: string; status: ReviewStatus | "Assigned"; due: string | null };

const NEEDS_EMPLOYEE: ReviewStatus[] = ["Overdue", "Due soon", "Missing evidence"];

/**
 * What a person still has to do: open assignments, and required training checks that are overdue, due soon or have
 * no evidence. Checks awaiting verification are HR's job, not the employee's, so they are left out.
 */
export function outstandingTraining(s: Pick<State, "checks"> & { trainingAssignments?: TrainingAssignment[] }, employee: string, today: string): ReminderItem[] {
  const items: ReminderItem[] = [];
  const open = (s.trainingAssignments ?? []).filter((a) => a.employee === employee && a.status === "Open");
  for (const a of open) items.push({ course: a.course, status: a.due < today ? "Overdue" : "Assigned", due: a.due });
  for (const c of s.checks.filter((c) => c.employee === employee && c.required && isTraining(c))) {
    const st = checkStatus(c, today);
    if (!NEEDS_EMPLOYEE.includes(st) || items.some((i) => same(i.course, c.name))) continue;
    items.push({ course: c.name, status: st, due: c.due });
  }
  const rank = (i: ReminderItem) => (i.status === "Assigned" ? priorities["Due soon"] : priorities[i.status]);
  return items.sort((a, b) => rank(a) - rank(b) || (a.due ?? "9").localeCompare(b.due ?? "9"));
}

const short = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(d + "T12:00:00Z"));

/** The words the employee sees. Built on the server from the records, never from the browser. */
export function reminderText(items: ReminderItem[]) {
  const line = (i: ReminderItem) =>
    i.status === "Overdue"
      ? `${i.course} (overdue${i.due ? ` since ${short(i.due)}` : ""})`
      : i.status === "Missing evidence"
        ? `${i.course} (no certificate on file)`
        : i.due
          ? `${i.course} (by ${short(i.due)})`
          : i.course;
  const overdue = items.some((i) => i.status === "Overdue");
  return {
    title: overdue ? "Training overdue" : "Training reminder",
    body: `Please complete: ${items.map(line).join("; ")}. When you have your certificate, give it to the office so HR can record it.`,
  };
}

export type ReminderPlan = { employee: string; name: string; items: ReminderItem[]; userId: string };
export type ReminderResult = { sent: string[]; skipped: { name: string; reason: string }[] };

/**
 * Works out who gets a reminder and records it in the HR history. `signIns` maps HR employee id to the linked CSB
 * sign-in (from the workforce link); a person without one is skipped and reported. At most one reminder per person
 * per day, so pressing the button twice never sends twice.
 */
export function planReminders(s: State, u: User, employees: string[], signIns: ReadonlyMap<string, string>, today: string, now = new Date().toISOString()) {
  if (!canEdit(u)) fail("Your account is read-only", 403);
  const people = employees.map((id) => employeeFor(s, u, id));
  s.trainingReminders ??= [];
  const plans: ReminderPlan[] = [];
  const result: ReminderResult = { sent: [], skipped: [] };
  for (const e of people) {
    const items = outstandingTraining(s, e.id, today);
    const userId = signIns.get(e.id);
    if (e.status === "Archived") result.skipped.push({ name: e.name, reason: "archived" });
    else if (!items.length) result.skipped.push({ name: e.name, reason: "no outstanding training" });
    else if (!userId) result.skipped.push({ name: e.name, reason: "no CSB sign-in linked" });
    else if (s.trainingReminders.some((r) => r.employee === e.id && r.day === today)) result.skipped.push({ name: e.name, reason: "already reminded today" });
    else {
      plans.push({ employee: e.id, name: e.name, items, userId });
      s.trainingReminders.push({ id: crypto.randomUUID(), org: u.org, employee: e.id, day: today, at: now, by: u.name, courses: items.map((i) => i.course) });
      audit(s, u, e.id, `Training reminder sent to CSB notifications: ${items.map((i) => i.course).join(", ")}`, now);
      result.sent.push(e.name);
    }
  }
  return { plans, result };
}

function audit(s: State, u: User, employee: string, action: string, at: string) {
  s.events.push({ id: crypto.randomUUID(), org: u.org, employee, actor: u.name, action, at });
}
