import { checkCategory, checkStatus, dateDays, type Check, type Employee, type HRTask, type ReviewStatus } from "./domain";

/**
 * The HR overview's counting rules, from the HR Hub's own records for the branch scope on screen. Pure, so every
 * rule is unit-tested (tests/hr/overview.test.ts). Interviews and leave requests come from the platform database
 * (src/server/workforce/hr-overview.ts) and are added on screen.
 *
 * - People counted are everyone not archived.
 * - Only required checks of those people count.
 * - "Due soon" and "Overdue" are the HR Hub's own statuses (checkStatus): overdue is past the review date, due soon is
 *   within the next 30 days.
 * - Training is every check whose category is Training (checkCategory).
 * - Starting soon: a start date from today to 30 days ahead.
 * - HR tasks overdue: open tasks assigned to the signed-in HR user, due before today.
 */

export const STARTING_SOON_DAYS = 30;

export type OverviewInput = {
  employees: Employee[];
  checks: Check[];
  tasks?: HRTask[];
  today: string;
  userId: string;
};

export type CheckGroup = { ids: string[]; n: number };

export function overviewFigures(d: OverviewInput) {
  const people = d.employees.filter((e) => e.status !== "Archived");
  const ids = new Set(people.map((e) => e.id));
  const checks = d.checks.filter((c) => c.required && ids.has(c.employee));
  const withStatus = checks.map((c) => ({ c, s: checkStatus(c, d.today) as ReviewStatus }));
  const group = (keep: (x: { c: Check; s: ReviewStatus }) => boolean): CheckGroup => {
    const list = withStatus.filter(keep).map((x) => x.c.id);
    return { ids: list, n: list.length };
  };
  const training = (c: Check) => checkCategory(c) === "Training";
  const trainingOverdue = group((x) => training(x.c) && x.s === "Overdue");
  const trainingDueSoon = group((x) => training(x.c) && x.s === "Due soon");
  const starters = people
    .filter((e) => e.start && dateDays(e.start, d.today) >= 0 && dateDays(e.start, d.today) <= STARTING_SOON_DAYS)
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const myOverdueTasks = (d.tasks ?? []).filter((t) => t.status !== "Complete" && ids.has(t.employee) && t.assignedTo === d.userId && t.due < d.today);
  return {
    employees: people.length,
    training: { overdue: trainingOverdue.n, dueSoon: trainingDueSoon.n, ids: [...trainingOverdue.ids, ...trainingDueSoon.ids] },
    awaitingReview: group((x) => x.s === "Awaiting verification"),
    missing: group((x) => x.s === "Missing evidence"),
    overdue: group((x) => x.s === "Overdue"),
    incomplete: group((x) => x.s === "Incomplete information"),
    starters,
    myOverdueTasks: myOverdueTasks.length,
  };
}

export type OverviewFigures = ReturnType<typeof overviewFigures>;

/**
 * "Actions due": the distinct items listed under Action required. A check counted in two rows (an overdue training
 * record is both "training" and "overdue") counts once; leave requests and the person's overdue HR tasks are added.
 */
export function actionsDue(f: OverviewFigures, leaveRequests: number) {
  const checks = new Set([...f.training.ids, ...f.awaitingReview.ids, ...f.missing.ids, ...f.overdue.ids, ...f.incomplete.ids]);
  return checks.size + leaveRequests + f.myOverdueTasks;
}

/**
 * The People directory's compliance summary for one person: their least healthy required check, in plain words.
 * Employment status (Active, Suspended, …) is shown separately and never mixed in here.
 */
export type ComplianceSummary = { label: string; tone: "good" | "warn" | "bad" | "neutral"; rank: number; detail: string };
export function complianceSummary(checks: Check[], today: string): ComplianceSummary {
  const statuses = checks.filter((c) => c.required).map((c) => checkStatus(c, today));
  const count = (s: ReviewStatus) => statuses.filter((x) => x === s).length;
  if (!statuses.length) return { label: "Not assessed", tone: "neutral", rank: 5, detail: "No checks are required for this role yet" };
  if (count("Overdue")) return { label: "Overdue", tone: "bad", rank: 0, detail: `${count("Overdue")} required check(s) past the review date` };
  if (count("Missing evidence")) return { label: "Missing evidence", tone: "bad", rank: 1, detail: `${count("Missing evidence")} required check(s) with nothing on file` };
  const review = count("Awaiting verification") + count("Incomplete information");
  if (review) return { label: "Review needed", tone: "warn", rank: 2, detail: `${review} check(s) to verify or complete` };
  if (count("Due soon")) return { label: "Due soon", tone: "warn", rank: 3, detail: `${count("Due soon")} check(s) due within 30 days` };
  return { label: "Compliant", tone: "good", rank: 4, detail: "Every required check is up to date" };
}
