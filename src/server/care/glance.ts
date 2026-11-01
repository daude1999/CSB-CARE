import { db } from "@/lib/db";
import { addDays, dbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { medicationEnabled } from "./medication";

/**
 * "Recent care" on a person's overview, next to "Care at a glance" (plan, risks, incidents): the latest visit notes,
 * the carers who visit most, medication status and the latest Care Summary. Every figure is a count of records and
 * links to them. The caller has already checked the person is in scope.
 */
export async function serviceUserGlance(ctx: Ctx, su: { id: string; organisationId: string }) {
  const orgId = su.organisationId;
  const today = londonDate();
  const since = new Date(Date.now() - 28 * 86_400_000);
  const medsOn = hasOrgPermission(ctx, "medication.view") && (await medicationEnabled(orgId));
  const [notes, carers, meds, medExceptions, summary] = await Promise.all([
    db.visitNote.findMany({ where: { organisationId: orgId, visit: { serviceUserId: su.id } }, select: { id: true, visitId: true, text: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.visitAssignment.groupBy({ by: ["staffId"], where: { organisationId: orgId, removedAt: null, slot: { not: "SHADOW" }, startsAt: { gte: since }, visit: { serviceUserId: su.id, status: { not: "CANCELLED" } } }, _count: { _all: true }, orderBy: { _count: { staffId: "desc" } }, take: 4 }),
    medsOn ? db.medication.count({ where: { organisationId: orgId, serviceUserId: su.id, status: "ACTIVE" } }) : Promise.resolve(0),
    medsOn ? db.marRecord.count({ where: { organisationId: orgId, supersededAt: null, outcome: { in: ["REFUSED", "NOT_GIVEN"] }, visit: { serviceUserId: su.id, date: { gte: dbDate(addDays(today, -6)) } } } }) : Promise.resolve(0),
    db.careSummary.findFirst({ where: { organisationId: orgId, serviceUserId: su.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true } }),
  ]);
  const staff = carers.length ? await db.staffMember.findMany({ where: { organisationId: orgId, id: { in: carers.map((c) => c.staffId) } }, select: { id: true, displayName: true } }) : [];
  const nameOf = new Map(staff.map((s) => [s.id, s.displayName]));
  return {
    notes,
    carers: carers.map((c) => ({ id: c.staffId, name: nameOf.get(c.staffId) ?? "Former staff", visits: c._count._all })),
    medication: { on: medsOn, active: meds, exceptions7d: medExceptions },
    summary,
  };
}
