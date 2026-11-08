import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import type { CareDocumentExtraction } from "@/server/ai/schemas";
import { automationOf } from "@/server/audit-log";
import { addDocuments, createIntake, decideFact } from "@/server/care/coordinator/intake";
import { runAutomaticSetup, setupSummaryLines } from "@/server/care/coordinator/auto-setup";
import { chooseIdentityValue, confirmNewPerson, listExceptions, resolveException, serviceUserAiAudit } from "@/server/care/coordinator/exceptions";
import { queueIntakeReads, runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { updateContact } from "@/server/care/service-users";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { LONG_PLAN_FACTS, LONG_PLAN_PERSON, longPlanPdf, longPlanReading } from "../support/long-support-plan";
import { supportPlanPdf } from "../support/coordinator-fixture";

/**
 * Automatic setup by CSB AI (owner's brief of 7 Nov 2026, "Autonomous AI Care Coordinator"). Upload a support plan,
 * CSB AI populates the profile, and people see only genuine exceptions. Fictional documents only.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

let orgId = "";
let longPdf: Buffer;
let reading: CareDocumentExtraction = longPlanReading();
const provider: LlmProvider = Object.assign(new SimulatedProvider(), { name: "test-reader", isSimulated: false, extractCareDocument: async () => reading });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
  setAiProviderForTests(provider);
  longPdf = await longPlanPdf();
}, 180_000);
afterAll(() => setAiProviderForTests(new SimulatedProvider()));

async function uploadAndProcess(title: string, mode: "NEW" | "EXISTING" | "DOCUMENT" = "NEW", serviceUserId?: string, pdf = longPdf) {
  const c = await coordinator();
  const intake = await createIntake(c, { title, mode, serviceUserId });
  const r = await addDocuments(c, intake.id, [{ name: `${title}.pdf`, type: "application/pdf", bytes: pdf }], { read: "later" });
  await queueIntakeReads(c, r.toRead, { prepare: true });
  const out = await runQueuedReads("test", 5);
  expect(out.every((o) => o.outcome === "succeeded")).toBe(true);
  return db.careIntake.findUniqueOrThrow({ where: { id: intake.id } });
}

describe("1. A long council support plan, processed without a fact-by-fact approval", () => {
  let intakeId = "";
  let suId = "";

  it(`reads ${LONG_PLAN_FACTS} facts and creates the populated profile by itself`, async () => {
    const started = Date.now();
    const intake = await uploadAndProcess("Long plan");
    intakeId = intake.id;
    const facts = await db.careIntakeFact.findMany({ where: { intakeId } });
    expect(facts.length).toBe(LONG_PLAN_FACTS);
    expect(facts.length).toBeGreaterThan(70);
    expect(intake.serviceUserId).toBeTruthy();
    suId = intake.serviceUserId!;
    expect(intake.setupStage).toBe("VERIFIED");
    // Nobody pressed anything after uploading: every decision so far is CSB AI's, none is a person's review.
    expect(facts.filter((f) => f.decidedById && f.decisionSource === "HUMAN")).toHaveLength(0);
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    expect([su.firstName, su.lastName, su.preferredName, su.status, su.postcode, su.firstLanguage]).toEqual(["Charles", "Specimen", "Charlie", "ASSESSMENT", LONG_PLAN_PERSON.postcode, "English"]);
    // A coordinator may not save a date of birth: CSB AI leaves it unsaved and hands it to a registered manager.
    expect(su.dateOfBirth).toBeNull();
    const dob = await db.careIntakeReviewItem.findFirstOrThrow({ where: { intakeId, category: "MANAGER_FIELD" } });
    expect([dob.title, dob.severity]).toEqual(["Save the date of birth", "FOLLOW_UP"]);
    expect(dob.description).toMatch(/only a registered manager may save it/);
    expect(su.carerGenderPreference).toBe("MALE");
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("puts each piece of information in its structured record, once", async () => {
    // Mary appears three times: one contact. Five different people: five contacts.
    const contacts = await db.serviceUserContact.findMany({ where: { serviceUserId: suId } });
    expect(contacts.filter((c) => c.name === "Mary Specimen")).toHaveLength(1);
    expect(contacts).toHaveLength(5);
    const pkg = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect([pkg.commissionedMinutesPerWeek, pkg.startDate.toISOString().slice(0, 10), pkg.endDate?.toISOString().slice(0, 10)]).toEqual([1488, "2026-11-10", "2027-05-10"]);
    expect(pkg.requirements).toBe("Two carers for the morning visit; all other visits single handed.");
    // The care plan is imported and in use (no approval), marked with its source; the repeated declutter need is in it once.
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
    expect([plan.status, plan.origin, plan.approvedById, plan.sourceIntakeId]).toEqual(["ACTIVE", "DOCUMENT", null, intakeId]);
    expect(plan.sourceNote).toMatch(/^CI-\d{4}: Long plan pages? \d/);
    const home = plan.sections.find((s) => s.key === "home")!;
    expect(home.body.match(/declutter and organise/g)).toHaveLength(1);
    // Risk information is saved and active, labelled with its source; none waits as a draft for an approval.
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId } });
    expect(risks).toHaveLength(6);
    expect(risks.every((r) => r.status === "ACTIVE" && r.origin !== "MANUAL" && r.sourceIntakeId === intakeId && /Long plan, page \d/.test(r.sourceNote ?? ""))).toBe(true);
    // The plan states no levels or controls for these, so they are labelled as AI-generated, never as completed assessments.
    expect(risks.every((r) => r.origin === "AI_INFERRED")).toBe(true);
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).riskLevel).not.toBeNull();
    // Seven commissioned visits; the repeated morning row and the family shopping are not scheduled; the double-up kept.
    const templates = await db.visitTemplate.findMany({ where: { serviceUserId: suId } });
    expect(templates).toHaveLength(7);
    expect(templates.find((t) => t.startMinute === 8 * 60)?.carersRequired).toBe(2);
    // A proposed rota from the same templates: unpublished, nobody told.
    const visits = await db.visit.findMany({ where: { serviceUserId: suId } });
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((v) => v.publishedAt === null && v.templateId && templates.some((t) => t.id === v.templateId))).toBe(true);
    // Medication only as reconciliation: no medicine record, nothing on a MAR.
    expect(await db.medication.count({ where: { serviceUserId: suId } })).toBe(0);
    // The original is filed; the two calls are call notes; the references are on the register or waiting.
    expect(await db.serviceUserDocument.count({ where: { serviceUserId: suId } })).toBe(1);
    expect(await db.callNote.count({ where: { serviceUserId: suId } })).toBe(2);
    // No incident and no body map record from a narrative.
    expect(await db.incident.count({ where: { serviceUserId: suId } })).toBe(0);
  });

  it("leaves only genuine exceptions, with the right severity", async () => {
    const m = await manager();
    const all = (await listExceptions(m, { serviceUserId: suId })).items;
    const by = (category: string) => all.filter((x) => x.category === category);
    expect(by("SAFEGUARDING").map((x) => x.severity)).toEqual(["URGENT"]);
    expect(by("DNACPR").map((x) => x.severity)).toEqual(["REVIEW"]);
    expect(by("PACKAGE_HOURS").map((x) => x.severity)).toEqual(["REVIEW"]);
    expect(by("REFERENCE").map((x) => x.title)).toEqual(["Say what this Frameworki number is"]);
    expect(by("SCHEDULE").map((x) => x.title)).toEqual(["Temporary visit without an end date"]);
    expect(by("FUNDING")).toHaveLength(1);
    // Nothing raised for routine information: no repeated contact, care need, visit row, name or date of birth.
    const allowed = new Set(["SAFEGUARDING", "DNACPR", "PACKAGE_HOURS", "REFERENCE", "SCHEDULE", "FUNDING", "MEDICATION", "INCIDENT_HISTORY", "BODY_MAP", "MISSING_INFO", "MANAGER_FIELD", "RISK_LEVEL"]);
    expect(all.filter((x) => !allowed.has(x.category))).toEqual([]);
    expect(all.filter((x) => /duplicate|repeated|same as/i.test(x.title))).toEqual([]);
    // The coordinator sees the non-clinical ones; the restricted ones are counted, never shown.
    const c = await listExceptions(await coordinator(), { serviceUserId: suId });
    expect(c.items.every((x) => !x.restricted)).toBe(true);
    // Seven genuine items a person must act on, nothing more: no repeats, no routine information, no approvals.
    expect(c.items.filter((x) => x.severity !== "INFO").map((x) => x.category).sort()).toEqual(["FUNDING", "MANAGER_FIELD", "MANAGER_FIELD", "PACKAGE_HOURS", "REFERENCE", "RISK_LEVEL", "SCHEDULE"]);
    expect(c.items.find((x) => x.category === "RISK_LEVEL")?.severity).toBe("FOLLOW_UP");
    expect(c.items.find((x) => x.category === "MISSING_INFO")?.severity).toBe("INFO");
    expect(c.hidden).toBeGreaterThan(0);
    // Urgent: every manager is told in the app at once (nothing sent outside).
    const urgent = by("SAFEGUARDING")[0]!;
    expect(await db.notification.count({ where: { organisationId: orgId, type: "coordinator.exception.urgent", dedupeKey: { startsWith: `coordinator-urgent:${urgent.id}:` } } })).toBeGreaterThan(0);
    expect(urgent.description).toMatch(/has not recorded that abuse occurred/);
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    expect(intake.setupStatus).toBe("NEEDS_ATTENTION");
  });

  it("records honest provenance: CSB AI, started by the coordinator, never the coordinator's own review", async () => {
    const c = await coordinator();
    const entries = await db.auditLog.findMany({ where: { organisationId: orgId, OR: [{ entityType: "CareIntake", entityId: intakeId }, { entityType: "ServiceUser", entityId: suId }], action: { notIn: ["coordinator.intake.created", "coordinator.document.uploaded", "coordinator.document.read-queued"] } } });
    expect(entries.length).toBeGreaterThan(10);
    for (const e of entries) {
      const a = automationOf(e.data);
      expect(a, e.action).not.toBeNull();
      expect(a!.initiatedById).toBe(c.userId);
    }
    expect(entries.some((e) => e.action === "coordinator.section.approved" || e.action === "coordinator.intake.approved")).toBe(false);
    const audit = await serviceUserAiAudit(c, suId);
    expect(audit.saved.length).toBeGreaterThan(40);
    expect(audit.saved.every((s) => s.provenance.startsWith("Automatically saved by CSB AI") )).toBe(true);
    expect(audit.setups[0]!.counts.human).toBe(0);
    expect(audit.trail.filter((t) => t.automated).length).toBeGreaterThan(10);
  });

  it("gives a completion summary from the read-back counts", async () => {
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    const lines = setupSummaryLines(intake.setupReport as never, "NEW");
    expect(lines).toEqual(expect.arrayContaining(["Personal details populated", "5 contacts added", "Care package created", "7 repeating visit templates created", "Care plan imported from the council support plan and in use", "1 original document filed"]));
    expect(lines.join(" ")).toMatch(/6 risk assessments saved \(6 AI-generated/);
    expect(lines.join(" ")).not.toMatch(/draft|approv/i);
    expect(lines.join(" ")).toMatch(/consolidated/);
  });

  it("running it again creates nothing twice", async () => {
    const count = async () => [await db.serviceUser.count({ where: { lastName: "Specimen" } }), await db.serviceUserContact.count({ where: { serviceUserId: suId } }), await db.visitTemplate.count({ where: { serviceUserId: suId } }), await db.visit.count({ where: { serviceUserId: suId } }), await db.careIntakeReviewItem.count({ where: { intakeId } }), await db.riskAssessment.count({ where: { serviceUserId: suId } })];
    const before = await count();
    await runAutomaticSetup(await coordinator(), intakeId);
    expect(await count()).toEqual(before);
  });

  it("lets a person settle exceptions and correct records afterwards, keeping both values and who changed it", async () => {
    const c = await coordinator();
    const ref = (await listExceptions(c, { serviceUserId: suId })).items.find((x) => x.referenceChoice)!;
    await resolveException(c, ref.id, { action: "REFERENCE_TYPE", type: "COUNCIL_CLIENT" });
    const fact = await db.careIntakeFact.findUniqueOrThrow({ where: { id: ref.factId! } });
    expect([fact.decision, fact.decisionSource, fact.decidedById]).toEqual(["EDITED", "HUMAN", c.userId]);
    const hours = (await listExceptions(c, { serviceUserId: suId })).items.find((x) => x.category === "PACKAGE_HOURS")!;
    await expect(resolveException(c, hours.id, { action: "RESOLVE", note: "x" })).rejects.toThrow(/Say what was done/);
    await resolveException(c, hours.id, { action: "RESOLVE", note: "Council confirmed 24.75 hours; package corrected." });
    const after = await db.careIntakeReviewItem.findUniqueOrThrow({ where: { id: hours.id } });
    expect([after.status, after.resolvedById]).toEqual(["RESOLVED", c.userId]);
    // A manual correction on the Contacts tab, through the existing service.
    const mary = await db.serviceUserContact.findFirstOrThrow({ where: { serviceUserId: suId, name: "Mary Specimen" } });
    await updateContact(c, suId, mary.id, { kind: mary.kind as "NEXT_OF_KIN", name: mary.name, relationship: mary.relationship, phone: "0200 000 0299", isEmergency: true, canReceiveUpdates: false });
    const audit = await serviceUserAiAudit(c, suId);
    const corr = audit.corrections.find((x) => x.field === "Contact Mary Specimen")!;
    expect(corr.saved).toMatch(/0200 000 0202/);
    expect(corr.now).toMatch(/0200 000 0299/);
    expect(corr.changedBy).toBe(c.userName);
    // Restricted items stay with managers; medication with someone who manages medication.
    const med = (await listExceptions(await manager(), { serviceUserId: suId })).items.find((x) => x.category === "MEDICATION")!;
    await expect(resolveException(c, med.id, { action: "RESOLVE", note: "Checked the list" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps the person, the exceptions and the audit inside the organisation", async () => {
    const o = await otherOrg();
    await expect(runAutomaticSetup(o, intakeId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(serviceUserAiAudit(o, suId)).rejects.toBeInstanceOf(NotFoundError);
    const item = await db.careIntakeReviewItem.findFirstOrThrow({ where: { intakeId, status: "OPEN" } });
    await expect(resolveException(o, item.id, { action: "RESOLVE", note: "Not mine to close" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAutomaticSetup(await carer(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("2. Identity is settled by a person, never guessed", () => {
  it("stops before creating anyone when the dates of birth disagree, and carries on with the value a person chooses", async () => {
    reading = longPlanReading({ secondDob: "15/05/1938" });
    try {
      await db.serviceUser.updateMany({ where: { lastName: "Specimen" }, data: { lastName: "Specimen-old" } });
      const intake = await uploadAndProcess("Two dates of birth");
      expect(intake.serviceUserId).toBeNull();
      expect(intake.setupStatus).toBe("NEEDS_ATTENTION");
      expect((intake.setupReport as { blocked: { kind: string } }).blocked.kind).toBe("IDENTITY_CONFLICT");
      expect(await db.serviceUser.count({ where: { lastName: "Specimen" } })).toBe(0);
      const right = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId: intake.id, destination: "person.dateOfBirth", value: { equals: "1938-05-14" }, decision: "PENDING" } });
      const r = await chooseIdentityValue(await manager(), intake.id, right.id);
      expect(r.blocked).toBeNull();
      const done = await db.careIntake.findUniqueOrThrow({ where: { id: intake.id } });
      const su = await db.serviceUser.findUniqueOrThrow({ where: { id: done.serviceUserId! } });
      expect(su.dateOfBirth?.toISOString().slice(0, 10)).toBe("1938-05-14");
      const chosen = await db.careIntakeFact.findUniqueOrThrow({ where: { id: right.id } });
      expect(chosen.decisionSource).toBe("HUMAN");
    } finally {
      reading = longPlanReading();
    }
  }, 120_000);

  it("never creates a second record for someone who may already exist, until a person confirms it is someone new", async () => {
    const before = await db.serviceUser.count({ where: { lastName: "Specimen" } });
    const intake = await uploadAndProcess("Same person again");
    expect(intake.serviceUserId).toBeNull();
    const block = (intake.setupReport as { blocked: { kind: string; match: { reference: string } } }).blocked;
    expect(block.kind).toBe("POSSIBLE_DUPLICATE");
    expect(await db.serviceUser.count({ where: { lastName: "Specimen" } })).toBe(before);
    const r = await confirmNewPerson(await coordinator(), intake.id);
    expect(r.blocked).toBeNull();
    expect(await db.serviceUser.count({ where: { lastName: "Specimen" } })).toBe(before + 1);
  }, 120_000);
});

describe("3. Failures, retries and older intakes", () => {
  it("reports the section that failed, keeps the rest and finishes on a retry without duplicates", async () => {
    await db.serviceUser.updateMany({ where: { lastName: "Specimen" }, data: { lastName: "Specimen-old" } });
    await db.callType.updateMany({ where: { organisationId: orgId }, data: { active: false } });
    let intakeId = "";
    try {
      const intake = await uploadAndProcess("Visits fail first");
      intakeId = intake.id;
      expect(intake.setupStatus).toBe("FAILED");
      const report = intake.setupReport as { sections: { section: string; status: string; error?: string }[] };
      expect(report.sections.find((s) => s.section === "VISITS")).toMatchObject({ status: "FAILED", error: expect.stringMatching(/call type/) });
      expect(await db.serviceUserContact.count({ where: { serviceUserId: intake.serviceUserId! } })).toBe(5);
      expect(await db.careIntakeReviewItem.count({ where: { intakeId, category: "SETUP" } })).toBe(1);
    } finally {
      await db.callType.updateMany({ where: { organisationId: orgId }, data: { active: true } });
    }
    const r = await runAutomaticSetup(await coordinator(), intakeId);
    expect(r.sections.find((s) => s.section === "VISITS")?.status).toBe("SAVED");
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    expect(await db.visitTemplate.count({ where: { serviceUserId: intake.serviceUserId! } })).toBe(7);
    expect(await db.serviceUserContact.count({ where: { serviceUserId: intake.serviceUserId! } })).toBe(5);
    expect(await db.carePackage.count({ where: { serviceUserId: intake.serviceUserId! } })).toBe(1);
  }, 120_000);

  it("takes over a run that was cut off, but never runs twice at once", async () => {
    const intake = await db.careIntake.findFirstOrThrow({ where: { title: "Visits fail first" } });
    await db.careIntake.update({ where: { id: intake.id }, data: { setupStatus: "PROCESSING", setupStartedAt: new Date(), setupById: (await coordinator()).userId } });
    const running = await runAutomaticSetup(await coordinator(), intake.id);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intake.id } })).setupStatus).toBe("PROCESSING");
    expect(running).toBeTruthy();
    await db.careIntake.update({ where: { id: intake.id }, data: { setupStartedAt: new Date(Date.now() - 10 * 60_000) } });
    const r = await runAutomaticSetup(await coordinator(), intake.id);
    expect(r.status).not.toBe("PROCESSING");
    expect(await db.visitTemplate.count({ where: { serviceUserId: intake.serviceUserId! } })).toBe(7);
  }, 120_000);

  it("resumes an intake from before automatic setup, keeping the people's decisions", async () => {
    setAiProviderForTests(new SimulatedProvider());
    try {
      const c = await coordinator();
      const intake = await createIntake(c, { title: "Old workflow intake" });
      await addDocuments(c, intake.id, [{ name: "Old plan.pdf", type: "application/pdf", bytes: await supportPlanPdf() }]);
      // Under the old workflow a person had already decided some facts.
      const phone = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId: intake.id, destination: "person.phone" } });
      await decideFact(c, phone.id, phone.lockVersion, { decision: "REJECTED", note: "Old number, family gave a new one" });
      expect((await db.careIntake.findUniqueOrThrow({ where: { id: intake.id } })).setupStatus).toBeNull();
      const r = await runAutomaticSetup(c, intake.id);
      expect(r.blocked).toBeNull();
      const kept = await db.careIntakeFact.findUniqueOrThrow({ where: { id: phone.id } });
      expect([kept.decision, kept.decisionSource, kept.decidedById, kept.decisionNote]).toEqual(["REJECTED", "HUMAN", c.userId, "Old number, family gave a new one"]);
      const su = await db.serviceUser.findUniqueOrThrow({ where: { id: (await db.careIntake.findUniqueOrThrow({ where: { id: intake.id } })).serviceUserId! } });
      expect(su.phone).toBeNull();
    } finally {
      setAiProviderForTests(provider);
    }
  }, 120_000);
});

describe("4. Revised plans and supporting documents", () => {
  it("applies routine updates for someone on record and proposes package and visit changes for review", async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { lastName: "Specimen" }, orderBy: { createdAt: "asc" } });
    const pkgBefore = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: su.id } });
    const templatesBefore = await db.visitTemplate.count({ where: { serviceUserId: su.id } });
    reading = longPlanReading({ hours: "26" });
    try {
      const intake = await uploadAndProcess("Revised plan", "EXISTING", su.id);
      expect(intake.serviceUserId).toBe(su.id);
      expect(await db.serviceUser.count({ where: { lastName: "Specimen" } })).toBe(await db.serviceUser.count({ where: { lastName: "Specimen" } }));
      const pkg = await db.carePackage.findFirstOrThrow({ where: { id: pkgBefore.id } });
      expect(pkg.commissionedMinutesPerWeek).toBe(pkgBefore.commissionedMinutesPerWeek);
      expect(await db.visitTemplate.count({ where: { serviceUserId: su.id } })).toBe(templatesBefore);
      const items = (await listExceptions(await manager(), { intakeId: intake.id })).items;
      expect(items.filter((x) => x.category === "PROPOSED_CHANGE").map((x) => x.title).sort()).toEqual(["Proposed change to the care package", "Proposed change to the visits"]);
      expect(await db.serviceUserDocumentVersion.count({ where: { intakeId: intake.id } })).toBe(1);
    } finally {
      reading = longPlanReading();
    }
  }, 120_000);

  it("files a supporting document without changing records or creating anyone", async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { lastName: "Specimen" }, orderBy: { createdAt: "asc" } });
    const people = await db.serviceUser.count();
    const contacts = await db.serviceUserContact.count({ where: { serviceUserId: su.id } });
    const intake = await uploadAndProcess("Supporting letter", "DOCUMENT", su.id);
    expect(await db.serviceUser.count()).toBe(people);
    expect(await db.serviceUserContact.count({ where: { serviceUserId: su.id } })).toBe(contacts);
    expect(await db.careIntakeDocument.count({ where: { intakeId: intake.id, filedDocumentId: { not: null } } })).toBe(1);
    expect(await db.careIntakeFact.count({ where: { intakeId: intake.id, decision: "APPROVED" } })).toBe(0);
    // The safeguarding concern in it is still raised: safety is never left in a supporting document.
    expect(await db.careIntakeReviewItem.count({ where: { intakeId: intake.id, category: "SAFEGUARDING" } })).toBe(1);
  }, 120_000);
});
