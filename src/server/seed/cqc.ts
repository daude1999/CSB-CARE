import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { ctxForUser } from "../auth/session";
import { reportIncident } from "../care/incidents";
import { transitionAction } from "../compliance/audits";
import { createAssessment, createImprovementAction, recordResult } from "../cqc/assessments";
import { discoverEvidence, linksFor, reviewEvidence } from "../cqc/evidence";
import { activeFramework } from "../cqc/framework";
import { addFinding, addRcaAction, addTimelineEntry, createRca, ESCALATIONS, linkRcaToCqc, managerReview, recordEscalation, saveConclusions, saveFactors, saveWhatHappened, submitForReview } from "../cqc/rca";

/**
 * Synthetic CQC Inspection & Evidence demo data for the Care Solution Bureau demo organisation: one branch assessment
 * with a mix of results, verified and waiting evidence, improvement actions, and three investigations at different
 * stages. Everything is fictional and goes through the real services (so permissions, references, notifications and
 * the audit log behave as in use). Run once on a demo database: `npx tsx prisma/seed-cqc.ts`. It does nothing if the
 * organisation already has a CQC assessment.
 */
export async function seedCqcDemo() {
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const org = await db.membership.findFirstOrThrow({ where: { user: { email: "manager@care-solution.demo" } }, select: { organisationId: true } });
  const organisationId = org.organisationId;
  if (await db.cqcAssessment.count({ where: { organisationId } })) return { skipped: true };
  const [mgr, apr, rvw, crd] = await Promise.all(["manager@care-solution.demo", "approver@care-solution.demo", "reviewer@care-solution.demo", "coordinator@care-solution.demo"].map(user));
  const manager = await ctxForUser(mgr!.id, organisationId);
  const approver = await ctxForUser(apr!.id, organisationId);
  const reviewer = await ctxForUser(rvw!.id, organisationId);
  const coordinator = await ctxForUser(crd!.id, organisationId);
  const today = londonDate();
  const liverpool = (await db.branch.findFirstOrThrow({ where: { organisationId, name: { contains: "Liverpool" } } })).id;
  const people = await db.serviceUser.findMany({ where: { organisationId, branchId: liverpool, status: "ACTIVE" }, select: { id: true }, take: 3, orderBy: { reference: "asc" } });
  const fw = await activeFramework();
  const criteria = await db.cqcCriterion.findMany({ where: { frameworkId: fw.id }, orderBy: { position: "asc" } });
  const id = (code: string) => criteria.find((c) => c.code === code)!.id;

  // ── assessment: Safe, Effective, Caring and Responsive fully assessed; Well-led part-way (shows low confidence).
  const a = await createAssessment(manager, { title: "Liverpool branch quarterly readiness review", branchId: liverpool, periodFrom: addDays(today, -90), periodTo: today, nextDueAt: addDays(today, 90) });
  const partial = new Set(["S04", "S09", "E05", "R04", "R09", "C06"]);
  const notMet = new Set(["S07", "E08"]);
  const skip = new Set(["W06", "W07", "W08", "W09", "W10", "W11", "W12", "W13", "W14"]);
  for (const c of criteria) {
    if (skip.has(c.code)) continue;
    if (c.code === "R11") {
      await recordResult(manager, a.id, c.id, { result: "NOT_APPLICABLE", rationale: "Checked the current caseload with the branch manager.", naReason: "No one in the Liverpool branch receives end of life care at present." });
      continue;
    }
    const result = notMet.has(c.code) ? "NOT_MET" : partial.has(c.code) ? "PARTIALLY_MET" : "MET";
    const rationale = result === "MET" ? "Sampled records for the period and spoke with the care team; practice matches the procedure." : result === "PARTIALLY_MET" ? "Most records sampled were in order, but some gaps were found that need follow-up." : "Records sampled did not show this happening consistently. Improvement action raised.";
    await recordResult(manager, a.id, c.id, { result, rationale, findings: result === "MET" ? undefined : "See the improvement action for this area." });
  }

  // ── evidence: suggestions from existing records; the approver verifies some of them.
  await discoverEvidence(manager, { frameworkId: fw.id, branchId: liverpool });
  const suggestions = await linksFor(manager, organisationId, { branchId: liverpool, status: "SUGGESTED" });
  let verified = 0;
  for (const [i, l] of suggestions.entries()) {
    if (i % 3 === 2) continue; // leave some waiting for review
    try {
      await reviewEvidence(approver, l.id, { to: i % 7 === 6 ? "REJECTED" : "VERIFIED", note: i % 7 === 6 ? "Does not relate to this branch's practice." : undefined });
      verified++;
    } catch {
      // A suggestion whose source cannot be verified yet (for example a policy past its review date) stays waiting.
    }
  }

  // ── improvement actions on the areas that were not met or partly met.
  await createImprovementAction(manager, a.id, id("S07"), { title: "Re-audit medicines administration records for all Liverpool service users", ownerId: coordinator.userId, dueDate: new Date(`${addDays(today, 21)}T12:00:00Z`), priority: "HIGH", evidenceRequired: "Completed MAR audit with actions" });
  await createImprovementAction(manager, a.id, id("E08"), { title: "Agree hospital discharge information checklist with the local trust", ownerId: reviewer.userId, dueDate: new Date(`${addDays(today, 35)}T12:00:00Z`), priority: "MEDIUM", evidenceRequired: "Signed checklist and first two uses" });
  const overdue = await createImprovementAction(manager, a.id, id("S04"), { title: "Update moving and handling risk assessments overdue for review", ownerId: coordinator.userId, dueDate: new Date(`${addDays(today, 7)}T12:00:00Z`), priority: "HIGH", evidenceRequired: "Reviewed risk assessments" });
  await db.complianceAction.update({ where: { id: overdue.id }, data: { dueDate: new Date(`${addDays(today, -3)}T12:00:00Z`) } });

  // ── investigations
  const missed = await reportIncident(manager, { serviceUserId: people[0]?.id, date: addDays(today, -12), time: "07:45", category: "Missed or late call", severity: "MODERATE", description: "Morning visit not attended. The person was found by family at 09:30 and had missed breakfast and prompted medication." });
  const fall = await reportIncident(manager, { serviceUserId: people[1]?.id ?? people[0]?.id, date: addDays(today, -5), time: "18:20", category: "Fall", severity: "HIGH", description: "Person found on the bedroom floor by the evening carer. Ambulance called; bruising to the left hip, no fracture." });
  const meds = await reportIncident(manager, { serviceUserId: people[2]?.id ?? people[0]?.id, date: addDays(today, -2), time: "12:10", category: "Medication error", severity: "MODERATE", description: "Lunchtime medicine given from the morning blister slot. GP advice taken; no harm observed." });

  const r1 = await createRca(manager, { title: "Missed early morning visit after carer sickness", category: "Missed or late visit", severity: "HIGH", eventDate: addDays(today, -12), eventTime: "07:45", dueDate: addDays(today, 2), ownerId: reviewer.userId, managerId: approver.userId, sources: [{ type: "INCIDENT", id: missed.id }], externalRef: "LA-QA-2291" });
  await saveWhatHappened(reviewer, r1.id, { summary: "The 07:30 visit was not covered after the booked carer phoned in sick at 06:50. The message went to the office line, which is not monitored before 08:00.", peopleInvolved: "Booked carer, on-call coordinator, family member", immediateImpact: "Missed breakfast and prompted medication; family distress.", harm: "LOW", immediateActions: "Replacement carer sent at 09:10, GP pharmacist consulted about the missed dose, family called." });
  await addTimelineEntry(reviewer, r1.id, { date: addDays(today, -12), time: "06:50", text: "Carer phoned the office line to report sickness", kind: "FACT" });
  await addTimelineEntry(reviewer, r1.id, { date: addDays(today, -12), time: "07:05", text: "On-call coordinator says the escalation phone did not ring", kind: "WITNESS" });
  await addTimelineEntry(reviewer, r1.id, { date: addDays(today, -12), time: "07:30", text: "Visit due; no carer attended", kind: "FACT" });
  await addTimelineEntry(reviewer, r1.id, { date: addDays(today, -12), time: "08:15", text: "Call-diversion may not have been set the night before", kind: "ASSUMPTION" });
  await addTimelineEntry(reviewer, r1.id, { date: addDays(today, -12), time: "09:10", text: "Replacement carer arrived", kind: "FACT" });
  await saveFactors(reviewer, r1.id, { factors: { SCHEDULING: { relevant: true, notes: "No cover carer was rostered before 08:00." }, COMMUNICATION: { relevant: true, notes: "Sickness call went to an unmonitored line." }, SYSTEMS: { relevant: true, notes: "Call diversion depends on a manual step each evening." } }, fiveWhys: ["The visit was missed", "No one knew the carer was off", "The call went to the office line", "The diversion to on-call was not set", "Setting it is a manual step with no check"], causeEffectNotes: "Two independent gaps (no early cover, manual call diversion) combined." });
  const f1 = await addFinding(reviewer, r1.id, { kind: "SYSTEMIC", factorArea: "SCHEDULING", text: "There is no contingency cover for visits before 08:00.", evidence: "Rota for the week shows no cover carer before 08:00 on any day." });
  await addFinding(reviewer, r1.id, { kind: "CONTRIBUTING", factorArea: "SYSTEMS", text: "Office call diversion relies on a manual evening step with no check.", evidence: "Phone provider log shows diversion off that night; procedure has no checklist." });
  await saveConclusions(reviewer, r1.id, { immediateCause: "Carer sickness without a cover arrangement.", underlyingCauses: "No early-morning contingency rota; manual call diversion.", uncertainties: "Whether the diversion failed or was never set.", conclusions: "The main cause is the absence of early-morning cover, made worse by the unmonitored phone line." });
  await addRcaAction(reviewer, r1.id, { title: "Set up an early-morning cover rota for the Liverpool branch", ownerId: coordinator.userId, dueDate: new Date(`${addDays(today, 14)}T12:00:00Z`), actionType: "PREVENTATIVE", priority: "HIGH", evidenceRequired: "Published cover rota", findingId: f1.id });
  const a2 = await addRcaAction(reviewer, r1.id, { title: "Automate office-line diversion to the on-call phone", ownerId: manager.userId, dueDate: new Date(`${addDays(today, 10)}T12:00:00Z`), actionType: "CORRECTIVE", priority: "MEDIUM", evidenceRequired: "Provider confirmation and a tested diversion" });
  for (const kind of Object.keys(ESCALATIONS)) await recordEscalation(reviewer, r1.id, { kind, decision: kind === "DUTY_OF_CANDOUR" ? "DONE" : "NOT_REQUIRED", rationale: kind === "DUTY_OF_CANDOUR" ? "Apology and explanation given to the family by phone and in writing." : "Considered with the registered manager; criteria not met.", externalRef: kind === "DUTY_OF_CANDOUR" ? "DoC letter 2026-14" : undefined, notifiedOn: kind === "DUTY_OF_CANDOUR" ? addDays(today, -10) : undefined });
  await submitForReview(reviewer, r1.id);
  const findings = await db.rcaFinding.findMany({ where: { rcaId: r1.id }, select: { id: true } });
  await managerReview(approver, r1.id, { decision: "APPROVE", note: "Both findings are supported by the rota and the phone log. Action plan agreed.", confirmFindingIds: findings.map((f) => f.id) });
  await transitionAction(manager, a2.id, "IN_PROGRESS", { note: "Provider ticket raised" }).catch(() => undefined);
  await linkRcaToCqc(manager, r1.id, [id("S01"), id("W15")], "Learning from a missed visit");

  const r2 = await createRca(manager, { title: "Fall in the bedroom during the evening", category: "Fall", severity: "HIGH", eventDate: addDays(today, -5), eventTime: "18:20", dueDate: addDays(today, 9), ownerId: coordinator.userId, managerId: manager.userId, sources: [{ type: "INCIDENT", id: fall.id }] });
  await saveWhatHappened(coordinator, r2.id, { summary: "The person was found on the bedroom floor by the evening carer. They had tried to reach the wardrobe without their walking frame.", harm: "LOW", immediateActions: "Ambulance called; family told; falls risk assessment flagged for review." });
  await addTimelineEntry(coordinator, r2.id, { date: addDays(today, -5), time: "18:20", text: "Evening carer found the person on the floor", kind: "FACT" });

  await createRca(manager, { title: "Lunchtime medicine given from the wrong blister slot", category: "Medication error", severity: "MODERATE", eventDate: addDays(today, -2), eventTime: "12:10", dueDate: addDays(today, 26), ownerId: reviewer.userId, managerId: approver.userId, sources: [{ type: "INCIDENT", id: meds.id }] });
  // One investigation shown as overdue: its due date is moved into the past.
  await db.rcaInvestigation.update({ where: { id: r1.id }, data: { dueDate: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
  return { skipped: false, assessment: a.reference, verified, investigations: 3 };
}
