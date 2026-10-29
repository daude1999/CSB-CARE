import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, visitWhere } from "./scope";

/** Open (or recent) rota alerts the caller may see: area-scoped coordinators see alerts for visits in their areas and organisation-wide ones. */
export async function listAlerts(ctx: Ctx, opts: { open?: boolean; take?: number } = {}) {
  const scope = await rotaScope(ctx, "rota.view");
  const alerts = await db.rotaAlert.findMany({ where: { organisationId: scope.organisationId, ...(opts.open !== false ? { resolvedAt: null } : {}) }, orderBy: [{ severity: "desc" }, { raisedAt: "desc" }], take: opts.take ?? 100 });
  if (!scope.areaIds) return alerts;
  const visitIds = alerts.map((a) => a.visitId).filter((x): x is string => !!x);
  const visible = new Set((await db.visit.findMany({ where: { ...visitWhere(scope), id: { in: visitIds } }, select: { id: true } })).map((v) => v.id));
  return alerts.filter((a) => !a.visitId || visible.has(a.visitId));
}

/** A coordinator closes an alert with a note of what was done. The alert and its resolution stay on record. */
export async function resolveAlert(ctx: Ctx, alertId: string, resolution: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (resolution.trim().length < 3) throw new ValidationError("Say what was done");
  return db.$transaction(async (tx) => {
    const a = await tx.rotaAlert.findFirst({ where: { id: alertId, organisationId: scope.organisationId } });
    if (!a) throw new NotFoundError("Alert");
    if (a.visitId && scope.areaIds && !(await tx.visit.findFirst({ where: { ...visitWhere(scope), id: a.visitId }, select: { id: true } }))) throw new NotFoundError("Alert");
    if (a.resolvedAt) throw new ValidationError("This alert is already closed");
    await tx.rotaAlert.update({ where: { id: a.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: resolution.trim() } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.alert.resolved", entityType: "RotaAlert", entityId: a.id, data: { kind: a.kind } }, tx);
  });
}
