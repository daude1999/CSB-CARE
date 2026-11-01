import { db } from "@/lib/db";
import { makeMissedCall } from "../../support/missed-fixture";

/**
 * Run by the Find Cover browser test against the end-to-end database: makes two synthetic missed calls from the last
 * hour (one single-carer, one double-up) for the demo organisation and prints their ids as JSON.
 */
async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const sus = await db.serviceUser.findMany({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "desc" }, take: 2 });
  const carer = await db.staffMember.findFirst({ where: { organisationId: org.id, employmentStatus: "ACTIVE", hrMissing: false, OR: [{ branchId: sus[0]!.branchId }, { branchId: null }] }, orderBy: { displayName: "asc" } });
  const single = await makeMissedCall(org.id, { serviceUserId: sus[0]!.id, minutesAgo: 50, staffIds: carer ? [carer.id] : [] });
  const double = await makeMissedCall(org.id, { serviceUserId: sus[1]!.id, minutesAgo: 70, carersRequired: 2 });
  const ref = async (visitId: string) => (await db.visit.findUniqueOrThrow({ where: { id: visitId } })).reference;
  process.stdout.write(JSON.stringify({ single: { ...single, reference: await ref(single.visitId) }, double: { ...double, reference: await ref(double.visitId) } }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
