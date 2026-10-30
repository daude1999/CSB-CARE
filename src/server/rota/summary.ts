import "server-only";
import { db } from "@/lib/db";
import { dbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { memberScope, visitWhere } from "./scope";

/** The Rostering figures on the Overview, counted from today's visits. */
export async function rotaHeadline(ctx: Ctx): Promise<{ visitsToday: number; unassignedToday: number; openAlerts: number } | null> {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "rota.view")) return null;
  const scope = { organisationId: ctx.organisationId, ...(await memberScope(ctx.userId, ctx.organisationId)) };
  const visits = await db.visit.findMany({
    where: { ...visitWhere(scope), date: dbDate(londonDate()), status: { notIn: ["CANCELLED"] } },
    select: { carersRequired: true, status: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } },
  });
  // Area-scoped coordinators only count alerts on visits they can see (plus organisation-wide alerts), as the alert list does.
  const openAlertRows = await db.rotaAlert.findMany({ where: { organisationId: ctx.organisationId, resolvedAt: null }, select: { visitId: true } });
  let openAlerts = openAlertRows.length;
  if (scope.areaIds) {
    const visitIds = [...new Set(openAlertRows.map((a) => a.visitId).filter((x): x is string => !!x))];
    const visible = new Set((await db.visit.findMany({ where: { ...visitWhere(scope), id: { in: visitIds } }, select: { id: true } })).map((v) => v.id));
    openAlerts = openAlertRows.filter((a) => !a.visitId || visible.has(a.visitId)).length;
  }
  return {
    visitsToday: visits.length,
    unassignedToday: visits.filter((v) => v.status === "SCHEDULED").reduce((n, v) => n + Math.max(0, v.carersRequired - v.assignments.length), 0),
    openAlerts,
  };
}
