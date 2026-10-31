import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import { sweepCalls } from "@/server/rota/monitor";
import { addCaseComment, addFollowUp, escalateOverdueCases, recordReason, recordReplacement, signOffMissedCase, submitForSignOff } from "@/server/rota/missed-calls";
import { addDays, londonDate } from "@/lib/london";

/**
 * Demo missed calls, through the real services: the sweep marks last week's unclocked visits missed (opening their
 * cases), then the coordinator investigates some and the manager signs a few off. Newer ones are left uninvestigated
 * so every stage shows. Fictional people and events only.
 */
const REASONS = ["CARER_TRAVEL", "CARER_SICKNESS", "ACCESS", "CARER_NO_SHOW", "NOT_CLOCKED", "ROTA_ERROR"] as const;
const COVER = ["FAMILY_COVERED", "NOT_NEEDED", "NONE_POSSIBLE", "FAMILY_COVERED"] as const;

export async function seedMissedCallDemo(organisationId: string, coordinator: Ctx, manager: Ctx) {
  await sweepCalls({ organisationId });
  await escalateOverdueCases();
  const cases = await db.missedCallCase.findMany({ where: { organisationId }, orderBy: { scheduledStart: "asc" } });
  const cutoff = addDays(londonDate(), -2);
  let i = 0;
  for (const c of cases) {
    if (londonDate(c.scheduledStart) > cutoff) continue;
    const n = i++;
    if (n % 4 === 3) continue; // left uninvestigated
    const reason = REASONS[n % REASONS.length]!;
    await recordReason(coordinator, c.id, { reasonCode: reason, findings: "Spoke to the care worker and the client's family by phone the same morning. Details checked against the visit log." });
    await recordReplacement(coordinator, c.id, { replacementType: COVER[n % COVER.length]!, clientInformed: "Family told by phone the same morning", note: "Recorded by the coordinator after the welfare call." });
    if (n % 4 === 1) {
      await addFollowUp(coordinator, c.id, { text: "Welfare call to the client", ownerId: coordinator.userId, due: londonDate() });
      await addCaseComment(manager, c.id, "Please check whether the run route needs more travel time.");
      continue; // still investigating
    }
    await submitForSignOff(coordinator, c.id, { outcome: reason === "NOT_CLOCKED" ? "DELIVERED_NOT_CLOCKED" : reason === "ROTA_ERROR" || reason === "ACCESS" ? "MISSED_OFFICE" : "MISSED_CARER", preventable: reason === "ACCESS" ? "no" : "yes", outcomeNote: "Discussed with the care worker; travel time and the call-the-office rule reminded in supervision." });
    if (n % 4 === 0) await signOffMissedCase(manager, c.id, { decision: "approve", note: "Agreed. Follow up at the next supervision." });
  }
}
