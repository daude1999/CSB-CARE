import { db } from "@/lib/db";
import { dbDate, londonDate } from "@/lib/london";
import { sweepCalls } from "@/server/rota/monitor";
import { visitReference } from "@/server/rota/visits";

/**
 * Synthetic data for Find Cover tests: a one-off visit that started `minutesAgo` minutes ago, marked missed by the real
 * call sweep (which opens its case), then given the carers who "should have" attended. The carers are attached after
 * the sweep so the fixture never collides with their real bookings (a missed visit's bookings do not hold their time).
 */
export async function makeMissedCall(organisationId: string, opts: { minutesAgo?: number; minutes?: number; carersRequired?: 1 | 2; staffIds?: string[]; serviceUserId?: string } = {}) {
  const su = opts.serviceUserId
    ? await db.serviceUser.findFirstOrThrow({ where: { id: opts.serviceUserId, organisationId } })
    : await db.serviceUser.findFirstOrThrow({ where: { organisationId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId, active: true }, orderBy: { name: "asc" } });
  const careTask = await db.careTask.findFirst({ where: { organisationId, active: true }, orderBy: { name: "asc" } });
  const start = new Date(Math.floor((Date.now() - (opts.minutesAgo ?? 60) * 60_000) / 60_000) * 60_000);
  const v = await db.visit.create({
    data: {
      organisationId, reference: visitReference(londonDate(start)), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(londonDate(start)),
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + (opts.minutes ?? 30) * 60_000), carersRequired: opts.carersRequired ?? 1, publishedAt: new Date(), notes: "Synthetic test visit",
      ...(careTask ? { tasks: { create: [{ careTaskId: careTask.id, name: careTask.name, position: 0 }] } } : {}),
    },
  });
  await sweepCalls({ organisationId, now: new Date() });
  const slots = ["PRIMARY", "SECOND"] as const;
  for (const [i, staffId] of (opts.staffIds ?? []).entries()) {
    await db.visitAssignment.create({ data: { organisationId, visitId: v.id, slot: slots[i]!, staffId, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: "system" } });
  }
  const c = await db.missedCallCase.update({ where: { visitId: v.id }, data: { staffId: opts.staffIds?.[0] ?? null } });
  return { visitId: v.id, caseId: c.id, serviceUserId: su.id, start };
}
