import { db } from "@/lib/db";
import { drain } from "@/server/jobs/queue";
import { handlers } from "@/worker/handlers";
import { ctxForUser } from "@/server/auth/session";
import { myStaff } from "@/server/workforce/link";
import { setMissedAutomation } from "@/server/rota/missed-auto/settings";
import { queueInvestigation } from "@/server/rota/missed-auto/queue";
import { makeMissedCall } from "../../support/missed-fixture";

/**
 * Run by the missed call automation browser test against the end-to-end database. `on` switches the automation on for
 * the demo organisation, makes a synthetic missed call booked to the demo carer, collects its evidence and prints the
 * ids as JSON. `off` switches it off again so the other browser tests see the default.
 */
async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const ctx = async (email: string) => ctxForUser((await db.user.findUniqueOrThrow({ where: { email } })).id, org.id);
  const manager = await ctx("manager@care-solution.demo");
  if (process.argv[2] === "off") {
    await setMissedAutomation(manager, { evidence: false, confirm: false, summary: false, confirmMinutes: 60, reminders: 1, reminderMinutes: 30 });
    process.stdout.write("{}");
    return;
  }
  await setMissedAutomation(manager, { evidence: true, confirm: true, summary: true, confirmMinutes: 60, reminders: 1, reminderMinutes: 30 });
  const carer = await myStaff(await ctx("carer@care-solution.demo"));
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { firstName: "asc" } });
  const made = await makeMissedCall(org.id, { serviceUserId: su.id, minutesAgo: 30, staffIds: [carer.id] });
  // The fixture books the carer after the sweep opens the case, so add the snapshot row the sweep would have made.
  const a = await db.visitAssignment.findFirstOrThrow({ where: { visitId: made.visitId, staffId: carer.id } });
  await db.missedCallCarerConfirmation.upsert({
    where: { caseId_staffId: { caseId: made.caseId, staffId: carer.id } },
    create: { organisationId: org.id, caseId: made.caseId, staffId: carer.id, assignmentId: a.id, slot: a.slot, position: a.position, userIdAtDetection: carer.userId },
    update: {},
  });
  await queueInvestigation(made.caseId, "MANUAL");
  await drain("e2e", handlers, { types: ["missed.investigate"], max: 20 });
  const v = await db.visit.findUniqueOrThrow({ where: { id: made.visitId } });
  const conf = await db.missedCallCarerConfirmation.findUniqueOrThrow({ where: { caseId_staffId: { caseId: made.caseId, staffId: carer.id } } });
  process.stdout.write(JSON.stringify({ caseId: made.caseId, reference: v.reference, confirmationId: conf.id, start: made.start.toISOString() }));
}

main().then(() => db.$disconnect(), (e) => {
  console.error(e);
  process.exit(1);
});
