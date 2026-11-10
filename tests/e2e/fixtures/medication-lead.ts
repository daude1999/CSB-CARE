import "./system-scope";
import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { medicationCompetence, setMedicationLead } from "@/server/care/medication-lead";
import { medicationEnabled, setMedicationEnabled } from "@/server/care/medication";
import { recordAssessment } from "@/server/readiness";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { createVisit } from "@/server/rota/visits";
import { visitCandidates } from "@/server/rota/queries";
import { ctxFor } from "../../helpers";

/**
 * Synthetic data for the Medication Lead screenshots and browser test, on a local database only: switches medication
 * on (with a review note), records synthetic competency assessments, then makes two four-carer medication visits
 * tomorrow: one with Carer 2 as Medication Lead, one whose lead was removed (needs reassessment). Prints their ids.
 */
async function main() {
  const ctx = await ctxFor("manager@care-solution.demo", "csb-demo");
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  if (!(await medicationEnabled(org.id))) await setMedicationEnabled(ctx, true, "Synthetic test data: clinical review recorded for the local demo");
  const task = await db.careTask.findFirstOrThrow({ where: { organisationId: org.id, name: { contains: "medic", mode: "insensitive" } } });
  const req = await db.readinessRequirement.findFirst({ where: { organisationId: org.id, key: "medication-competency" } });
  if (req) {
    for (const s of await db.staffMember.findMany({ where: { organisationId: org.id, employmentStatus: "ACTIVE", hrMissing: false }, orderBy: { displayName: "asc" }, take: 12 })) {
      await recordAssessment(ctx, s.id, { requirementId: req.id, careTaskId: task.id, method: "OBSERVED", observedEvidence: "Synthetic test: observed medication prompt round", outcome: "COMPETENT", assessedAt: addDays(londonDate(), -10), reviewDue: addDays(londonDate(), 300) }).catch(() => undefined);
    }
  }
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "desc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true } });
  const day = addDays(londonDate(), 1);
  const out: string[] = [];
  for (const start of [9 * 60 + 50, 13 * 60 + 50]) {
    const v = await createVisit(ctx, { serviceUserId: su.id, callTypeId: callType.id, date: day, startMinute: start, durationMin: 40, carersRequired: 4, medicationRequired: true, notes: "Synthetic test visit: four carers with medication support" });
    for (const slot of ["PRIMARY", "SECOND", "C3", "C4"] as const) {
      const fresh = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { assignments: true } });
      const list = (await visitCandidates(ctx, fresh, "ANY")).filter((c) => c.state !== "NOT_ELIGIBLE");
      const ok = await medicationCompetence(db, fresh, list.map((c) => c.id));
      const pick = list.find((c) => ok.get(c.id)?.ok) ?? list[0];
      if (pick) await assignCarer(ctx, { visitId: v.id, slot, staffId: pick.id, acceptWarnings: true });
    }
    const second = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, slot: "SECOND", removedAt: null } });
    await setMedicationLead(ctx, v.id, { staffId: second.staffId, reason: "Holds the medication competency for this person" });
    out.push(v.id);
  }
  await unassignCarer(ctx, { visitId: out[1]!, slot: "SECOND", reason: "Carer called in sick" });
  process.stdout.write(JSON.stringify({ lead: out[0], reassess: out[1] }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
