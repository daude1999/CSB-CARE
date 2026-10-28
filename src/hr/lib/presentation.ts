import {
  checkStatus,
  employeeStatus,
  priorities,
  type State,
  type OrganisationSettings,
  type User,
  type Employee,
  type Check,
  type Doc,
} from "./domain";
export type HubData = Omit<State, "settings"> & {
  settings: OrganisationSettings;
  user: User;
  today: string;
  allBranches: boolean;
};
export const displayDate = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s))
    : "Not recorded";
export function checksFor(data: HubData, id: string) {
  return data.checks.filter((c) => c.employee === id);
}
export function currentPeople(data: HubData) {
  return data.employees.filter((e) => e.status !== "Archived");
}
export function currentChecks(data: HubData) {
  const ids = new Set(currentPeople(data).map((e) => e.id));
  return data.checks.filter((c) => ids.has(c.employee));
}
export function statusCounts(checks: Check[], today: string) {
  const counts = Object.fromEntries(
    Object.keys(priorities).map((s) => [s, 0]),
  ) as Record<string, number>;
  for (const c of checks) counts[checkStatus(c, today)]++;
  return counts;
}
export function health(checks: Check[], today: string) {
  const base = employeeStatus(checks, today);
  if (base !== "Attention required") return base;
  const counts = statusCounts(checks, today);
  if (
    counts["Overdue"] ||
    counts["Incomplete information"] ||
    counts["Awaiting verification"]
  )
    return "Attention required";
  if (counts["Missing evidence"]) return "Missing evidence";
  if (counts["Due soon"]) return "Due soon";
  return base;
}
export function branchStats(data: HubData, branch: string) {
  const employees = currentPeople(data).filter((e) => e.branch === branch);
  const ids = new Set(employees.map((e) => e.id));
  const checks = data.checks.filter((c) => ids.has(c.employee));
  const counts = statusCounts(checks, data.today);
  const compliant = employees.filter(
    (e) =>
      employeeStatus(
        checks.filter((c) => c.employee === e.id),
        data.today,
      ) === "Checks up to date",
  ).length;
  return {
    employees,
    counts,
    compliant,
    rate: employees.length
      ? Math.round((compliant / employees.length) * 100)
      : 0,
    newStarters: employees.filter((e) => e.status === "Onboarding").length,
    missing: employees.filter((e) =>
      checks.some(
        (c) =>
          c.employee === e.id &&
          checkStatus(c, data.today) === "Missing evidence",
      ),
    ).length,
  };
}
export function documentState(d: Doc, data: HubData) {
  if (d.state === "Quarantined") return "Quarantined";
  const linked = data.checks.filter((c) => c.evidence === d.id);
  if (!linked.length)
    return data.documents.some((x) => x.previous === d.id)
      ? "Previous version"
      : "Awaiting verification";
  return linked
    .map((c) => checkStatus(c, data.today))
    .sort((a, b) => priorities[a] - priorities[b])[0];
}
export function documentDue(d: Doc, data: HubData) {
  return (
    d.reviewDate ||
    d.expiryDate ||
    data.checks
      .filter((c) => c.evidence === d.id && c.due)
      .map((c) => c.due!)
      .sort()[0] ||
    null
  );
}
export function employeeTitle(e: Employee) {
  return `${e.name} · ${e.staffId}`;
}
