import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc } from "@/lib/london";
import { openMissedCase } from "@/server/rota/missed-calls";
import { visitReference } from "@/server/rota/visits";

/**
 * Run by the Daily Rota bulk actions browser test against the end-to-end database: makes six synthetic visits three
 * days ago, in the small hours so they never collide with the demo rota. Three scheduled with a carer, one missed (with
 * its missed-call case), one with nobody booked and one cancelled. Prints the date and their references as JSON.
 */
async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
  const sus = await db.serviceUser.findMany({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null } }, orderBy: { lastName: "asc" }, take: 6 });
  const staff = await db.staffMember.findMany({ where: { organisationId: org.id, employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" }, take: 6 });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true }, orderBy: { name: "asc" } });
  const date = addDays(londonDate(), -3);
  const kinds = ["scheduled", "scheduled", "scheduled", "missed", "unstaffed", "cancelled"] as const;
  const out: Record<string, string[]> = { scheduled: [], missed: [], unstaffed: [], cancelled: [] };
  for (const [i, kind] of kinds.entries()) {
    const start = londonToUtc(date, 120 + i * 10);
    const su = sus[i % sus.length]!;
    const v = await db.visit.create({
      data: {
        organisationId: org.id, reference: visitReference(date), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(date),
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * 60_000), publishedAt: new Date(), notes: "Synthetic test visit", createdById: manager.id,
      },
    });
    if (kind !== "unstaffed") await db.visitAssignment.create({ data: { organisationId: org.id, visitId: v.id, slot: "PRIMARY", staffId: staff[i % staff.length]!.id, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: manager.id } });
    if (kind === "missed") {
      await db.$transaction(async (tx) => {
        await tx.visit.update({ where: { id: v.id }, data: { status: "MISSED" } });
        await tx.visitEvent.create({ data: { organisationId: org.id, visitId: v.id, type: "STATUS", fromStatus: "SCHEDULED", toStatus: "MISSED", data: { source: "call.sweep" } } });
        await openMissedCase(tx, v);
      });
    }
    if (kind === "cancelled") await db.visit.update({ where: { id: v.id }, data: { status: "CANCELLED", cancelReason: "Client in hospital", cancelledAt: new Date(), cancelledById: manager.id, cancellationCharge: false } });
    out[kind]!.push(v.reference);
  }
  process.stdout.write(JSON.stringify({ date, ...out }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
