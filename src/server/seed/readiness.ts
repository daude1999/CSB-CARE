import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { ctxForUser } from "@/server/auth/session";
import { DEFAULT_CARE_ROLES } from "@/server/rota/settings";
import { grantException, recordAssessment, recordTraining, saveRequirement, verifyTraining, type RequirementInput } from "@/server/readiness";

/**
 * The starter readiness matrix for a new organisation: the adult social care training areas in the specification
 * (Appendix C2), scoped to the care role titles. Agencies adjust it in Administration > Staff readiness. Classification,
 * renewal periods and hard stops are starting points for the agency's compliance lead to confirm, not legal advice.
 */
export function defaultRequirements(roleTitles: string[], opts: { medicationTaskId?: string | null; safeguardingPolicyId?: string | null; effectiveFrom: string }): RequirementInput[] {
  const roles = roleTitles.map((jobTitle) => ({ kind: "JOB_TITLE" as const, jobTitle }));
  const src = "Skills for Care — Statutory and mandatory training bundle for adult social care";
  const t = (key: string, name: string, over: Partial<RequirementInput> = {}): RequirementInput => ({ key, name, category: "TRAINING", classification: "MANDATORY_ROLE", sourceAuthority: src, renewalMonths: 12, warningDays: 30, hardStop: true, exceptionAllowed: true, effectiveFrom: opts.effectiveFrom, scopes: roles, ...over });
  const list: RequirementInput[] = [
    t("care-certificate", "Care Certificate (induction standards)", { description: "The 2025 standards for new-to-care workers; knowledge plus workplace evidence assessed by a competent assessor.", renewalMonths: null, requiresPractical: true, sourceAuthority: "Skills for Care — Care Certificate standards (2025)" }),
    t("safeguarding-adults", "Safeguarding adults", { description: "Awareness, escalation routes and local procedures." }),
    t("moving-handling", "Moving and handling", { description: "Theory plus observed practical competence with the equipment used.", requiresPractical: true }),
    t("infection-prevention", "Infection prevention and control"),
    t("basic-life-support", "Basic life support and first aid", { requiresPractical: true }),
    t("fire-safety", "Fire safety"),
    t("health-safety", "Health and safety"),
    t("information-governance", "Information governance and data security"),
    t("mental-capacity", "Mental capacity, consent and restrictive practice", { renewalMonths: 36 }),
    t("ld-autism", "Learning disability and autism awareness (Oliver McGowan)", { renewalMonths: 36, description: "Record the tier, provider and evidence; a generic awareness course is not equivalent unless the applicable guidance says so." }),
    t("lone-working", "Lone working and personal safety", { classification: "AGENCY_POLICY", hardStop: false }),
    t("ecm-app", "Call monitoring app and communications", { classification: "AGENCY_POLICY", hardStop: false, renewalMonths: null, description: "Clocking in and out, what the app records, and that a message is not proof of a visit." }),
  ];
  if (opts.medicationTaskId) {
    list.push({
      key: "medication-competency", name: "Medication support competency", category: "COMPETENCY", classification: "MANDATORY_ROLE",
      sourceAuthority: "CQC — Training and competence in medicines optimisation for adult social care staff", description: "Observed competence before any medication duty; reassessed on concern or policy change.",
      requiresPractical: true, renewalMonths: 12, warningDays: 30, hardStop: true, exceptionAllowed: false, effectiveFrom: opts.effectiveFrom,
      scopes: [{ kind: "CARE_TASK", careTaskId: opts.medicationTaskId }],
    });
  }
  if (opts.safeguardingPolicyId) {
    list.push({ key: "safeguarding-policy", name: "Safeguarding policy read and acknowledged", category: "POLICY", classification: "AGENCY_POLICY", policyId: opts.safeguardingPolicyId, renewalMonths: null, warningDays: 0, hardStop: false, exceptionAllowed: true, effectiveFrom: opts.effectiveFrom, scopes: roles });
  }
  return list;
}

/** Creates the starter matrix for an organisation. Idempotent: skips keys that already exist. */
export async function seedReadinessMatrix(organisationId: string, createdByUserId: string) {
  const ctx = await ctxForUser(createdByUserId, organisationId);
  const settings = await db.rotaSettings.findUnique({ where: { organisationId } });
  const roles = settings?.careRoleTitles?.length ? settings.careRoleTitles : DEFAULT_CARE_ROLES;
  const meds = await db.careTask.findFirst({ where: { organisationId, name: { contains: "Medication", mode: "insensitive" } } });
  const policy = await db.policy.findFirst({ where: { organisationId, ref: "CSB-SAF-001" } });
  const existing = new Set((await db.readinessRequirement.findMany({ where: { organisationId }, select: { key: true } })).map((r) => r.key));
  const created: string[] = [];
  for (const r of defaultRequirements(roles, { medicationTaskId: meds?.id, safeguardingPolicyId: policy?.id, effectiveFrom: addDays(londonDate(), -365) })) {
    if (existing.has(r.key)) continue;
    await saveRequirement(ctx, r);
    created.push(r.key);
  }
  return created;
}

/**
 * Demo evidence for the demonstration organisation, entered through the real services so every record has an
 * enterer and a verifier. Most care staff end up Ready; a few are left in each of the other states on purpose so the
 * queue, the allocation warnings and the clock-in check have something to show. All of it is synthetic.
 */
export async function seedReadinessDemo(organisationId: string, people: { manager: string; coordinator: string }) {
  await seedReadinessMatrix(organisationId, people.manager);
  const manager = await ctxForUser(people.manager, organisationId);
  // Training evidence is HR's (HR_SINGLE_STAFF_RECORD.md): the demo enterer acts with the Group HR account, so every
  // synthetic record still has an enterer and a different verifier.
  const coordinator = { ...(await ctxForUser(people.coordinator, organisationId)), hrUserId: "group" };
  const reqs = await db.readinessRequirement.findMany({ where: { organisationId, status: "ACTIVE" } });
  const byKey = new Map(reqs.map((r) => [r.key, r]));
  const settings = await db.rotaSettings.findUnique({ where: { organisationId } });
  const roles = new Set((settings?.careRoleTitles?.length ? settings.careRoleTitles : DEFAULT_CARE_ROLES).map((r) => r.toLowerCase()));
  const staff = (await db.staffMember.findMany({ where: { organisationId, hrMissing: false, employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" } })).filter((s) => roles.has(s.jobTitle.toLowerCase()));
  const today = londonDate();
  const trainingKeys = [...byKey.values()].filter((r) => r.category === "TRAINING").map((r) => r.key);
  const practical = new Set([...byKey.values()].filter((r) => r.requiresPractical).map((r) => r.key));

  // The people left short on purpose have no sign-in, so the demo carer logins stay Ready and can clock in.
  const pool = staff.filter((s) => !s.userId);
  for (const [i, s] of staff.entries()) {
    const pendingOne = s.id === pool[0]?.id; // evidence submitted, nobody has verified it yet
    const expiredOne = s.id === pool[1]?.id; // safeguarding ran out last month
    const noAssessment = s.id === pool[2]?.id; // course done, practical sign-off outstanding
    const medsCompetent = i % 3 !== 0; // most, not all, may support medication
    for (const key of trainingKeys) {
      const req = byKey.get(key)!;
      const completed = expiredOne && key === "safeguarding-adults" ? addDays(today, -400) : addDays(today, -60 - ((i * 37 + key.length * 11) % 240));
      const rec = await recordTraining(coordinator, s.id, { requirementId: req.id, provider: key === "care-certificate" ? "In-house, assessed" : "DEMO e-learning provider", completedAt: completed, result: "Pass", evidenceNote: "DEMO certificate on file (synthetic)" });
      if (!(pendingOne && key === "infection-prevention")) await verifyTraining(manager, rec.id, "VERIFIED", "DEMO: certificate checked");
      if (practical.has(key) && !(noAssessment && key === "moving-handling")) {
        await recordAssessment(manager, s.id, { requirementId: req.id, method: "OBSERVED", observedEvidence: "DEMO: observed in the workplace carrying out the task safely and as trained (synthetic record).", outcome: "COMPETENT", assessedAt: addDays(completed, 7), reviewDue: addDays(completed, 372) });
      }
    }
    const meds = byKey.get("medication-competency");
    if (meds && medsCompetent) {
      await recordAssessment(manager, s.id, { requirementId: meds.id, method: "OBSERVED", observedEvidence: "DEMO: prompted medication from the MAR sheet correctly on three observed visits (synthetic record).", outcome: i % 5 === 4 ? "COMPETENT_WITH_RESTRICTIONS" : "COMPETENT", restrictions: i % 5 === 4 ? "Prompting only; no controlled drugs" : undefined, assessedAt: addDays(today, -90), reviewDue: addDays(today, 275) });
    }
  }
  // One time-limited exception for the person whose practical sign-off is outstanding: shadowing until the assessment date.
  const mh = byKey.get("moving-handling");
  if (mh && pool[2]) await grantException(manager, pool[2].id, { requirementId: mh.id, reason: "DEMO: observed assessment booked with the moving and handling trainer next week", compensatingControls: "Double-up visits only until assessed; no hoist transfers alone", expiresAt: addDays(today, 14) });
}
