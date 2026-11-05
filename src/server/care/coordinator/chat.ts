import "server-only";
import { db } from "@/lib/db";
import { addDays, dbDate, fromDbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, visitWhere } from "@/server/rota/scope";

/**
 * Supporting reads for the AI CSB Coordinator chat (src/app/csb-coordinator-chat-actions.ts). Nothing here writes.
 */

/**
 * A short, non-clinical summary of one service user for the chat, only when the person may see them: status, care
 * plan versions and review date, risk assessment titles and review dates, the care package's commissioned hours, and
 * the next seven days' visits with how many still need a carer. No medication, health conditions, contacts, key safe
 * or address details are included. Returns null when the person is not visible to this employee.
 */
export async function serviceUserChatContext(ctx: Ctx, serviceUserId: string): Promise<Record<string, unknown> | null> {
  if (!hasOrgPermission(ctx, "serviceUser.view")) return null;
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({
    where: { ...serviceUserWhere(scope), id: serviceUserId },
    select: {
      id: true, reference: true, firstName: true, preferredName: true, lastName: true, status: true,
      carePlans: { where: { status: { in: ["DRAFT", "IN_REVIEW", "ACTIVE"] } }, select: { version: true, status: true, reviewDue: true } },
      packages: { where: { status: "ACTIVE" }, select: { commissionedMinutesPerWeek: true, startDate: true, endDate: true } },
    },
  });
  if (!su) return null;
  const today = londonDate();
  const [risks, visits] = await Promise.all([
    db.riskAssessment.findMany({ where: { organisationId: scope.organisationId, serviceUserId: su.id, status: "ACTIVE" }, select: { title: true, level: true, reviewDue: true }, orderBy: { reviewDue: "asc" }, take: 20 }),
    hasOrgPermission(ctx, "rota.view")
      ? db.visit.findMany({
          where: { ...visitWhere(scope), serviceUserId: su.id, date: { gte: dbDate(today), lte: dbDate(addDays(today, 6)) }, status: { not: "CANCELLED" } },
          select: { carersRequired: true, status: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } },
        })
      : null,
  ]);
  return {
    serviceUser: { name: `${su.preferredName ?? su.firstName} ${su.lastName}`, reference: su.reference, status: su.status },
    carePlans: su.carePlans.map((p) => ({ version: p.version, status: p.status, reviewDue: p.reviewDue ? fromDbDate(p.reviewDue) : null })),
    activePackages: su.packages.map((p) => ({ hoursPerWeek: p.commissionedMinutesPerWeek ? Math.round(p.commissionedMinutesPerWeek / 6) / 10 : null, start: fromDbDate(p.startDate), end: p.endDate ? fromDbDate(p.endDate) : null })),
    riskAssessments: risks.map((r) => ({ title: r.title, level: r.level, reviewDue: fromDbDate(r.reviewDue), overdue: fromDbDate(r.reviewDue) < today })),
    nextSevenDaysVisits: visits ? { total: visits.length, needingACarer: visits.filter((v) => !["COMPLETED", "NOT_DELIVERED"].includes(v.status) && v.assignments.length < v.carersRequired).length } : "not visible to this employee",
    today,
  };
}
