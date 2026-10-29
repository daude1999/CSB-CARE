import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate, londonDayBounds } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { outstandingAckWhere } from "@/server/policies/assignment";
import { readinessFor } from "@/server/readiness";
import { rotaSettings } from "@/server/rota/settings";

/**
 * The KPI registry: every figure on Reporting & Analytics, with the definition shown next to it, worked out live from
 * the records at the time the page is opened. A figure is shown only to members allowed to see its module, and is
 * worked out for the chosen branch (or every branch the member may see). Figures with no branch dimension say so.
 */

export const KPI_GROUPS = { delivery: "Care delivery", workforce: "Workforce", compliance: "Compliance", finance: "Finance" } as const;
export type KpiGroup = keyof typeof KPI_GROUPS;

export interface KpiScope { organisationId: string; branchIds: string[] | null; from: string; to: string }
export interface KpiValue { value: number | null; unit: "%" | "count" | "hours" | "£"; detail: string; href?: string }
interface KpiDef { key: string; group: KpiGroup; name: string; definition: string; perm: OrgPermission; branchAware: boolean; compute: (s: KpiScope) => Promise<KpiValue> }

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const visitScope = (s: KpiScope): Prisma.VisitWhereInput => (s.branchIds ? { area: { branchId: { in: s.branchIds } } } : {});
const staffScope = (s: KpiScope): Prisma.StaffMemberWhereInput => (s.branchIds ? { branchId: { in: s.branchIds } } : {});
const inRange = (s: KpiScope) => ({ gte: dbDate(s.from), lte: dbDate(s.to) });
const pastInRange = (s: KpiScope) => ({ gte: dbDate(s.from), lte: dbDate(s.to < londonDate() ? s.to : addDays(londonDate(), -1)) });

export const KPIS: KpiDef[] = [
  {
    key: "visits-delivered", group: "delivery", name: "Visits delivered", perm: "rota.view", branchAware: true,
    definition: "Completed visits as a share of published visits that were due in the period (up to yesterday), excluding cancelled ones.",
    compute: async (s) => {
      const where = { organisationId: s.organisationId, publishedAt: { not: null }, status: { not: "CANCELLED" as const }, date: pastInRange(s), ...visitScope(s) };
      const [due, done] = await Promise.all([db.visit.count({ where }), db.visit.count({ where: { ...where, status: "COMPLETED" } })]);
      return { value: pct(done, due), unit: "%", detail: `${done} of ${due} visits`, href: "/rota/reports?report=delivery" };
    },
  },
  {
    key: "on-time", group: "delivery", name: "On-time arrivals", perm: "rota.view", branchAware: true,
    definition: "Completed visits where the first clock-in was no later than the organisation's late-call threshold after the planned start.",
    compute: async (s) => {
      const settings = await rotaSettings(db, s.organisationId);
      const visits = await db.visit.findMany({ where: { organisationId: s.organisationId, status: "COMPLETED", actualStart: { not: null }, date: inRange(s), ...visitScope(s) }, select: { scheduledStart: true, actualStart: true } });
      const onTime = visits.filter((v) => v.actualStart!.getTime() - v.scheduledStart.getTime() <= settings.lateAfterMin * 60_000).length;
      return { value: pct(onTime, visits.length), unit: "%", detail: `${onTime} of ${visits.length} completed visits, threshold ${settings.lateAfterMin} minutes` };
    },
  },
  {
    key: "missed", group: "delivery", name: "Missed calls", perm: "rota.view", branchAware: true,
    definition: "Visits in the period marked missed because nobody clocked in by the missed-call threshold.",
    compute: async (s) => {
      const n = await db.visit.count({ where: { organisationId: s.organisationId, status: "MISSED", date: inRange(s), ...visitScope(s) } });
      return { value: n, unit: "count", detail: n ? "See the call alerts report" : "None in the period", href: "/rota/reports?report=alerts" };
    },
  },
  {
    key: "unfilled", group: "delivery", name: "Unfilled visits, next 7 days", perm: "rota.view", branchAware: true,
    definition: "Published, not cancelled visits in the next seven days with no carer assigned. Does not depend on the chosen dates.",
    compute: async (s) => {
      const today = londonDate();
      const n = await db.visit.count({ where: { organisationId: s.organisationId, status: "SCHEDULED", date: { gte: dbDate(today), lte: dbDate(addDays(today, 6)) }, assignments: { none: { removedAt: null } }, ...visitScope(s) } });
      return { value: n, unit: "count", detail: "Visits with nobody booked", href: "/rota/unassigned" };
    },
  },
  {
    key: "exceptions-overdue", group: "delivery", name: "Exceptions past deadline", perm: "rota.monitor", branchAware: true,
    definition: "Open exceptions (late, missed, not delivered, concerns and others) whose deadline has passed, now.",
    compute: async (s) => {
      const open = await db.rotaAlert.findMany({ where: { organisationId: s.organisationId, resolvedAt: null, deadline: { lt: new Date() } }, select: { visitId: true } });
      let n = open.length;
      if (s.branchIds) {
        // Alerts point at visits by id; count those whose visit is in the chosen branches.
        const ids = [...new Set(open.map((a) => a.visitId).filter((x): x is string => !!x))];
        const inScope = new Set((await db.visit.findMany({ where: { id: { in: ids }, area: { branchId: { in: s.branchIds } } }, select: { id: true } })).map((v) => v.id));
        n = open.filter((a) => a.visitId && inScope.has(a.visitId)).length;
      }
      return { value: n, unit: "count", detail: "Open and past their deadline", href: "/rota/exceptions?state=overdue" };
    },
  },
  {
    key: "staff-ready", group: "workforce", name: "Staff ready to work", perm: "readiness.view", branchAware: true,
    definition: "Active staff whose readiness is Ready or Ready with restrictions today, out of all active staff. Readiness uses verified evidence only.",
    compute: async (s) => {
      const staff = await db.staffMember.findMany({ where: { organisationId: s.organisationId, employmentStatus: "ACTIVE", hrMissing: false, ...staffScope(s) }, select: { id: true } });
      const r = await readinessFor(db, s.organisationId, staff.map((x) => x.id));
      const ready = [...r.values()].filter((x) => x.status === "READY" || x.status === "READY_WITH_RESTRICTIONS").length;
      return { value: pct(ready, staff.length), unit: "%", detail: `${ready} of ${staff.length} active staff`, href: "/rota/readiness" };
    },
  },
  {
    key: "evidence-pending", group: "workforce", name: "Evidence awaiting verification", perm: "readiness.view", branchAware: true,
    definition: "Training records entered but not yet checked by a second person, now.",
    compute: async (s) => {
      const n = await db.staffTrainingRecord.count({ where: { organisationId: s.organisationId, verificationStatus: "SUBMITTED", staff: staffScope(s) } });
      return { value: n, unit: "count", detail: "Records waiting for a check", href: "/rota/readiness?status=PENDING_VERIFICATION" };
    },
  },
  {
    key: "ack-rate", group: "compliance", name: "Policy sign-off", perm: "signoff.manage", branchAware: true,
    definition: "Current policy assignments acknowledged, assessed as passed or exempted, out of all current assignments (not withdrawn or superseded).",
    compute: async (s) => {
      const where: Prisma.AcknowledgementWhereInput = { organisationId: s.organisationId, supersededAt: null, state: { not: "WITHDRAWN" }, ...(s.branchIds ? { staffMember: { branchId: { in: s.branchIds } } } : {}) };
      const [all, met] = await Promise.all([db.acknowledgement.count({ where }), db.acknowledgement.count({ where: { ...where, state: { in: ["ACKNOWLEDGED", "ASSESSMENT_PASSED", "EXEMPTED"] } } })]);
      return { value: pct(met, all), unit: "%", detail: `${met} of ${all} assignments`, href: "/staff" };
    },
  },
  {
    key: "ack-overdue", group: "compliance", name: "Overdue sign-offs", perm: "signoff.manage", branchAware: true,
    definition: "Outstanding policy acknowledgements past their due date, now.",
    compute: async (s) => {
      const n = await db.acknowledgement.count({ where: { organisationId: s.organisationId, ...outstandingAckWhere, dueAt: { lt: new Date() }, ...(s.branchIds ? { staffMember: { branchId: { in: s.branchIds } } } : {}) } });
      return { value: n, unit: "count", detail: "Past due", href: "/staff?overdue=1" };
    },
  },
  {
    key: "reviews-overdue", group: "compliance", name: "Policies overdue review", perm: "report.view", branchAware: false,
    definition: "Active policies whose next review date has passed. Policies belong to the whole organisation, so this ignores the branch.",
    compute: async (s) => {
      const n = await db.policy.count({ where: { organisationId: s.organisationId, status: "ACTIVE", nextReviewDate: { lt: new Date() } } });
      return { value: n, unit: "count", detail: "Past their review date", href: "/reports?kind=policies" };
    },
  },
  {
    key: "actions-overdue", group: "compliance", name: "Overdue actions", perm: "report.view", branchAware: false,
    definition: "Open or in-progress compliance actions past their due date. Actions belong to the whole organisation.",
    compute: async (s) => {
      const n = await db.complianceAction.count({ where: { organisationId: s.organisationId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } } });
      return { value: n, unit: "count", detail: "Past their due date", href: "/actions" };
    },
  },
  {
    key: "timesheets-waiting", group: "finance", name: "Timesheets awaiting approval", perm: "finance.view", branchAware: true,
    definition: "Submitted timesheets not yet approved or rejected, now.",
    compute: async (s) => {
      const n = await db.timesheet.count({ where: { organisationId: s.organisationId, status: "SUBMITTED", ...(s.branchIds ? { staffId: { in: (await db.staffMember.findMany({ where: { organisationId: s.organisationId, ...staffScope(s) }, select: { id: true } })).map((x) => x.id) } } : {}) } });
      return { value: n, unit: "count", detail: "Waiting for a finance approver", href: "/rota/finance/timesheets" };
    },
  },
  {
    key: "payable-hours", group: "finance", name: "Approved payable hours", perm: "finance.view", branchAware: true,
    definition: "Payable hours on approved timesheets for weeks starting in the period.",
    compute: async (s) => {
      const staffIds = s.branchIds ? (await db.staffMember.findMany({ where: { organisationId: s.organisationId, ...staffScope(s) }, select: { id: true } })).map((x) => x.id) : null;
      const sum = await db.timesheet.aggregate({ where: { organisationId: s.organisationId, status: "APPROVED", periodStart: inRange(s), ...(staffIds ? { staffId: { in: staffIds } } : {}) }, _sum: { payableMinutes: true } });
      return { value: Math.round(((sum._sum.payableMinutes ?? 0) / 60) * 10) / 10, unit: "hours", detail: "From approved timesheets", href: "/rota/finance/timesheets" };
    },
  },
  {
    key: "invoiced", group: "finance", name: "Approved invoice value", perm: "finance.view", branchAware: false,
    definition: "Total of approved invoice runs for weeks starting in the period. Invoice runs cover the whole organisation. Nothing is sent to funders by the platform.",
    compute: async (s) => {
      const sum = await db.invoiceRun.aggregate({ where: { organisationId: s.organisationId, status: "APPROVED", periodStart: inRange(s) }, _sum: { totalPence: true } });
      return { value: Math.round((sum._sum.totalPence ?? 0) / 100), unit: "£", detail: "Prepared and approved, not issued", href: "/rota/finance/invoices" };
    },
  },
];

const filterSchema = z.object({
  branch: z.string().max(40).optional().catch(undefined),
  from: z.string().refine(isIsoDate).optional().catch(undefined),
  to: z.string().refine(isIsoDate).optional().catch(undefined),
  group: z.enum(["delivery", "workforce", "compliance", "finance"]).optional().catch(undefined),
});

/** Works out the scope from the member's own branch grants; a branch they may not see is refused, never widened. */
export async function kpiScope(ctx: Ctx, input: Record<string, string | undefined>) {
  if (!ctx.organisationId) throw new ForbiddenError("Choose an organisation");
  const f = filterSchema.parse(input);
  const today = londonDate();
  const to = f.to ?? today;
  const from = f.from ?? addDays(to, -27);
  if (from > to) throw new ValidationError("The start date is after the end date");
  if (londonDayBounds(to).start.getTime() - londonDayBounds(from).start.getTime() > 366 * 86400_000) throw new ValidationError("Choose at most a year");
  const branches = await db.branch.findMany({ where: { organisationId: ctx.organisationId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (f.branch && !branches.some((b) => b.id === f.branch)) throw new ForbiddenError("You cannot see that branch");
  const branchIds = f.branch ? [f.branch] : ctx.branchIds;
  return { scope: { organisationId: ctx.organisationId, branchIds, from, to } satisfies KpiScope, branches, branch: f.branch ?? null, group: f.group ?? null };
}

export async function computeKpis(ctx: Ctx, input: Record<string, string | undefined>) {
  const { scope, branches, branch, group } = await kpiScope(ctx, input);
  const visible = KPIS.filter((k) => hasOrgPermission(ctx, k.perm) && (!group || k.group === group));
  const values = await Promise.all(visible.map((k) => k.compute(scope)));
  return { scope, branches, branch, group, rows: visible.map((k, i) => ({ key: k.key, group: k.group, name: k.name, definition: k.definition, branchAware: k.branchAware, ...values[i]! })) };
}

/** The same figures as a CSV, with their definitions. Needs report.export; the export is audited. */
export async function kpiCsv(ctx: Ctx, input: Record<string, string | undefined>) {
  if (!hasOrgPermission(ctx, "report.export")) throw new ForbiddenError("You cannot export reports");
  const r = await computeKpis(ctx, input);
  await audit({ organisationId: r.scope.organisationId, actorId: ctx.userId, action: "report.kpis.exported", entityType: "Organisation", entityId: r.scope.organisationId, data: { from: r.scope.from, to: r.scope.to, branch: r.branch, rows: r.rows.length } });
  const branchName = r.branch ? r.branches.find((b) => b.id === r.branch)?.name ?? "" : ctx.branchIds ? "My branches" : "All branches";
  return { columns: ["Area", "Measure", "Value", "Unit", "Detail", "Scope", "From", "To", "Definition"], rows: r.rows.map((k) => [KPI_GROUPS[k.group], k.name, k.value ?? "", k.unit, k.detail, k.branchAware ? branchName : "Whole organisation", r.scope.from, r.scope.to, k.definition]) };
}
