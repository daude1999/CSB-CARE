import { randomUUID } from "node:crypto";
import { checkStatus, dateDays, permits, type State } from "./domain";
export function runReminders(s: State, today: string, org?: string) {
  let created = 0;
  for (const notice of s.notices.filter((n) => !org || n.org === org)) {
    const check = s.checks.find((c) => c.id === notice.check);
    const employee = s.employees.find((e) => e.id === notice.employee);
    const user = s.users.find((u) => u.id === notice.recipient);
    if (
      !check ||
      !employee ||
      !user ||
      !permits(user, employee) ||
      employee.status === "Archived" ||
      check.version !== notice.version ||
      check.due !== notice.due ||
      !["Overdue", "Due soon"].includes(checkStatus(check, today))
    )
      notice.state = "Cancelled";
  }
  for (const c of s.checks.filter((c) => !org || c.org === org)) {
    const e = s.employees.find((e) => e.id === c.employee);
    if (
      !e ||
      e.status === "Archived" ||
      !c.due ||
      !["Overdue", "Due soon"].includes(checkStatus(c, today))
    )
      continue;
    const days = dateDays(c.due, today);
    const threshold =
      days < 0
        ? "overdue-" + today
        : s.settings[e.org].thresholds
            .filter((t) => days <= t)
            .sort((a, b) => a - b)[0];
    if (threshold === undefined) continue;
    for (const u of s.users.filter(
      (u) => permits(u, e) && u.role !== "Branch Viewer",
    )) {
      const key = [c.id, c.version, c.due, threshold, u.id, "in-app"].join(":");
      if (s.notices.some((n) => n.key === key)) continue;
      for (const old of s.notices.filter(
        (n) =>
          n.check === c.id && n.recipient === u.id && n.state !== "Cancelled",
      ))
        old.state = "Cancelled";
      s.notices.push({
        id: randomUUID(),
        org: e.org,
        employee: e.id,
        check: c.id,
        recipient: u.id,
        key,
        message: `${e.name}: ${c.name} ${days < 0 ? "is overdue" : "is due " + c.due}`,
        read: false,
        state: "Pending",
        attempts: 0,
        due: c.due,
        version: c.version,
        at: new Date().toISOString(),
      });
      created++;
    }
  }
  for (const n of s.notices.filter(
    (n) => n.state === "Pending" && (!org || n.org === org),
  )) {
    const e = s.employees.find((e) => e.id === n.employee)!;
    const u = s.users.find((u) => u.id === n.recipient)!;
    n.attempts++;
    n.state = permits(u, e) ? "Delivered" : "Cancelled";
  }
  return created;
}
