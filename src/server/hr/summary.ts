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
