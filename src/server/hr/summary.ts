import "server-only";
import type { Ctx } from "@/server/auth/rbac";
import { read } from "@/hr/lib/store";
import { today } from "@/hr/lib/auth";
import { checkStatus, permits } from "@/hr/lib/domain";

/**
 * The two HR figures on the Overview, counted the same way as the HR Hub's own Home page:
 * current (not archived) employees this person may see, and their overdue checks.
 */
export async function hrHeadline(ctx: Ctx): Promise<{ employees: number; overdue: number } | null> {
  if (!ctx.organisationId || !ctx.hrUserId) return null;
  const state = await read(ctx.organisationId).catch(() => null);
  const user = state?.users.find((u) => u.id === ctx.hrUserId && u.active);
  if (!state || !user) return null;
  const people = state.employees.filter((e) => permits(user, e) && e.status !== "Archived");
  const ids = new Set(people.map((e) => e.id));
  const date = today();
  return { employees: people.length, overdue: state.checks.filter((c) => ids.has(c.employee) && checkStatus(c, date) === "Overdue").length };
}

export type HrPersonStatus = "Compliant" | "Checks overdue" | "DBS pending" | "Due soon" | "Attention" | "Not assessed";

/**
 * Three people for the HR card on the Overview: the most recently updated current employees this person may see,
 * each with one status worked out from their checks the same way the HR Hub does.
 */
export async function hrPeoplePreview(ctx: Ctx): Promise<{ id: string; branch: string; name: string; job: string; status: HrPersonStatus }[] | null> {
  if (!ctx.organisationId || !ctx.hrUserId) return null;
  const state = await read(ctx.organisationId).catch(() => null);
  const user = state?.users.find((u) => u.id === ctx.hrUserId && u.active);
  if (!state || !user) return null;
  const date = today();
  return state.employees
    .filter((e) => permits(user, e) && e.status !== "Archived")
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((e) => {
      const checks = state.checks.filter((c) => c.employee === e.id && c.required);
      const statuses = checks.map((c) => ({ category: c.category ?? c.name, status: checkStatus(c, date) }));
      let status: HrPersonStatus = "Compliant";
      if (!checks.length) status = "Not assessed";
      else if (statuses.some((s) => s.status === "Overdue")) status = "Checks overdue";
      else if (statuses.some((s) => /dbs/i.test(s.category) && s.status !== "Up to date")) status = "DBS pending";
      else if (statuses.some((s) => s.status === "Due soon")) status = "Due soon";
      else if (statuses.some((s) => s.status !== "Up to date")) status = "Attention";
      return { id: e.id, branch: e.branch, name: e.name, job: e.job, status };
    });
}
