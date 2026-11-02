import { read as readHr } from "@/hr/lib/workspace-tx";
import { canEdit, permits } from "@/hr/lib/domain";
import { employeeRoute } from "@/hr/lib/routes";
import { ForbiddenError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";

type StaffRef = { hrEmployeeId: string; hrMissing: boolean };

/**
 * The viewer's HR & Workforce account and the employee, when HR itself would let the viewer see that employee: an
 * active HR account whose branches cover the employee's branch (the HR Hub's own permits() rule). Scheduling someone
 * never grants HR access.
 */
async function hrAccess(ctx: Ctx, staff: StaffRef) {
  // The same test as canUsePortal(ctx, "hr"); not imported, because that module is server-only and this one also
  // runs in seeds, scripts and the worker.
  if (staff.hrMissing || !ctx.organisationId || !ctx.hrUserId) return null;
  const state = await readHr(ctx.organisationId);
  const user = state.users.find((u) => u.id === ctx.hrUserId);
  const employee = state.employees.find((e) => e.id === staff.hrEmployeeId);
  if (!user || !employee || !permits(user, employee)) return null;
  return { user, employee };
}

/** The address of a person's HR record for an "Open HR record" link, or null when the viewer may not open it. The HR Hub checks again. */
export async function hrRecordHref(ctx: Ctx, staff: StaffRef, returnTo: string): Promise<string | null> {
  const a = await hrAccess(ctx, staff);
  return a ? `/hr${employeeRoute(a.employee.id, a.employee.branch, returnTo)}` : null;
}

/**
 * Training and competency evidence belongs to HR & Workforce (owner's decision, 2 Nov 2026): entering, verifying or
 * assessing it needs an HR account that may edit this employee (not a Branch Viewer), on top of the readiness permission.
 */
export async function canRecordHrEvidence(ctx: Ctx, staff: StaffRef): Promise<boolean> {
  const a = await hrAccess(ctx, staff);
  return !!a && canEdit(a.user);
}

export const HR_EVIDENCE_ONLY = "Training and competency evidence is recorded by HR & Workforce. You need an HR account that can edit this person's record.";

export async function requireHrEvidenceEditor(ctx: Ctx, staff: StaffRef) {
  if (!(await canRecordHrEvidence(ctx, staff))) throw new ForbiddenError(HR_EVIDENCE_ONLY);
}
