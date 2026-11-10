import "./system-scope";
import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { assignCarer } from "@/server/rota/assign";
import { createVisit } from "@/server/rota/visits";
import { visitCandidates } from "@/server/rota/queries";
import { ctxFor } from "../../helpers";

/**
 * Synthetic data for the multi-carer browser test and screenshots: a four-carer visit tomorrow morning with three carers
 * booked through the normal assignment path (so the fourth place is open). Prints its id and reference as JSON.
 */
async function main() {
  const ctx = await ctxFor("manager@care-solution.demo", "csb-demo");
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true } });
  const day = addDays(londonDate(), 1);
  const v = await createVisit(ctx, { serviceUserId: su.id, callTypeId: callType.id, date: day, startMinute: 10 * 60 + 40, durationMin: 45, carersRequired: 4, notes: "Synthetic test visit: four-carer hoist transfer" });
  for (const slot of ["PRIMARY", "SECOND", "C3"] as const) {
    const fresh = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { assignments: true } });
    const pick = (await visitCandidates(ctx, fresh, "ANY")).find((c) => c.state !== "NOT_ELIGIBLE");
    if (!pick) break;
    await assignCarer(ctx, { visitId: v.id, slot, staffId: pick.id, acceptWarnings: true });
  }
  process.stdout.write(JSON.stringify({ visitId: v.id, reference: v.reference, date: day }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
