import { db } from "@/lib/db";
import { addDays, dbDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { myStaff } from "@/server/workforce/link";
import { rotaSettings } from "./settings";

/**
 * The carer's own view: published visits they are booked on, within the days the organisation allows. A carer only
 * ever sees their own visits; the staff identity comes from the explicit sign-in link, never from the request.
 */
export async function myVisits(ctx: Ctx) {
  const staff = await myStaff(ctx);
  const settings = await rotaSettings(db, staff.organisationId);
  const today = londonDate();
  const visits = await db.visit.findMany({
    where: {
      organisationId: staff.organisationId,
      publishedAt: { not: null },
      date: { gte: dbDate(addDays(today, -settings.carerDaysBack)), lte: dbDate(addDays(today, settings.carerDaysForward)) },
      assignments: { some: { staffId: staff.id, removedAt: null } },
    },
    include: {
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true, addressLine1: true, town: true, postcode: true, accessNotes: true } },
      callType: { select: { name: true } },
      tasks: { orderBy: { position: "asc" }, select: { id: true, name: true, outcomes: { where: { staffId: staff.id }, select: { outcome: true, note: true, at: true } } } },
      visitNotes: { orderBy: { createdAt: "desc" }, select: { id: true, category: true, text: true, createdAt: true, staffId: true } },
      assignments: { where: { removedAt: null }, select: { id: true, slot: true, staffId: true, acknowledgedAt: true, staff: { select: { displayName: true } } } },
      clocks: { where: { staffId: staff.id }, select: { id: true, kind: true, at: true, supersedesId: true }, orderBy: { at: "asc" } },
    },
    orderBy: { scheduledStart: "asc" },
  });
  // The latest handover note for each person in the last week, so the next carer reads it before going in.
  const handovers = await db.visitNote.findMany({
    where: { organisationId: staff.organisationId, category: "HANDOVER", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, visit: { serviceUserId: { in: [...new Set(visits.map((v) => v.serviceUserId))] } } },
    select: { text: true, createdAt: true, visitId: true, visit: { select: { serviceUserId: true } } },
    orderBy: { createdAt: "desc" },
  });
  const lastHandover = new Map<string, { text: string; createdAt: Date; visitId: string }>();
  for (const h of handovers) if (!lastHandover.has(h.visit.serviceUserId)) lastHandover.set(h.visit.serviceUserId, h);
  return { staff, settings, visits, lastHandover };
}

/** The carer confirms they have seen their published visits. Only their own, not-yet-seen allocations change. */
export async function acknowledgeMyVisits(ctx: Ctx) {
  const { staff, visits } = await myVisits(ctx);
  const ids = visits.flatMap((v) => v.assignments.filter((a) => a.staffId === staff.id && !a.acknowledgedAt).map((a) => a.id));
  if (!ids.length) return 0;
  return db.$transaction(async (tx) => {
    const { count } = await tx.visitAssignment.updateMany({ where: { id: { in: ids }, staffId: staff.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
    await audit({ organisationId: staff.organisationId, actorId: ctx.userId, action: "visit.acknowledged", entityType: "StaffMember", entityId: staff.id, data: { count } }, tx);
    return count;
  });
}
