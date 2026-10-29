import "server-only";
import { db } from "@/lib/db";
import { dbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { areaScope, visitWhere } from "./scope";

/** The Rostering figures on the Overview, counted from today's visits. */
export async function rotaHeadline(ctx: Ctx): Promise<{ visitsToday: number; unassignedToday: number; openAlerts: number } | null> {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "rota.view")) return null;
  const scope = { organisationId: ctx.organisationId, areaIds: await areaScope(ctx.userId, ctx.organisationId) };
  const visits = await db.visit.findMany({
    where: { ...visitWhere(scope), date: dbDate(londonDate()), status: { notIn: ["CANCELLED"] } },
    select: { carersRequired: true, status: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } },
  });
  const openAlerts = await db.rotaAlert.count({ where: { organisationId: ctx.organisationId, resolvedAt: null } });
  return {
    visitsToday: visits.length,
    unassignedToday: visits.filter((v) => v.status === "SCHEDULED").reduce((n, v) => n + Math.max(0, v.carersRequired - v.assignments.length), 0),
    openAlerts,
  };
}
