import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { readingToFacts } from "@/lib/care-coordinator-rules";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { runAutomaticSetup, setupSummaryLines } from "@/server/care/coordinator/auto-setup";
import { listExceptions, serviceUserAiAudit } from "@/server/care/coordinator/exceptions";
import { queueIntakeReads, runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { draftFingerprint, putPlanInUse, saveDraft, startDraft } from "@/server/care/care-plans";
import { reviewRisk } from "@/server/care/risks";
import { updateContact } from "@/server/care/service-users";
import { storage } from "@/server/storage";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { SCANNED_PLAN_PERSON, scannedPlanReading } from "../support/scanned-support-plan";

/**
 * Owner's brief of 7 Nov 2026, "Remove redundant approval workflows": a scanned council support plan with over 100
 * facts is uploaded and CSB AI enters it into the CRM like a member of staff would. Nobody approves a fact, a section,
 * the care plan or a risk assessment. Fictional document only (tests/support/scanned-support-plan.pdf: page images, no
 * text layer).
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);

const reading = scannedPlanReading();
const provider: LlmProvider = Object.assign(new SimulatedProvider(), { name: "test-reader", isSimulated: false, extractCareDocument: async () => reading });
const pdf = readFileSync(join(process.cwd(), "tests/support/scanned-support-plan.pdf"));

let orgId = "";
let intakeId = "";
let suId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
  setAiProviderForTests(provider);
}, 180_000);
afterAll(() => setAiProviderForTests(new SimulatedProvider()));

describe("A scanned council support plan with over 100 facts, entered with no approval workflow", () => {
  it("reads the scan and sets the person up by itself: no fact, section, care plan or risk waits for an approval", async () => {
    expect(readingToFacts(reading).length).toBeGreaterThan(100);
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Scanned council plan", mode: "NEW" });
    intakeId = intake.id;
    const r = await addDocuments(c, intake.id, [{ name: "Care and Support Plan (scan).pdf", type: "application/pdf", bytes: pdf }], { read: "later" });
    await queueIntakeReads(c, r.toRead, { prepare: true });
    const out = await runQueuedReads("test", 5);
    expect(out.every((o) => o.outcome === "succeeded")).toBe(true);

    const facts = await db.careIntakeFact.findMany({ where: { intakeId } });
    expect(facts.length).toBeGreaterThan(100);
    // The pages are images: no quote could be checked against text, and none of that became a check for a person.
    expect(facts.filter((f) => f.origin === "AI").every((f) => f.verification === "UNVERIFIED")).toBe(true);
    expect(await db.careIntakeReviewItem.count({ where: { intakeId, category: "SOURCE_CHECK" } })).toBe(0);
    // Every decision was CSB AI's; nobody approved anything.
    expect(facts.filter((f) => f.decisionSource === "HUMAN" && f.decision !== "PENDING")).toEqual([]);
    // Waiting facts are only the genuine exceptions (identity details for a manager, the unclear number, the funder).
    const waiting = facts.filter((f) => f.decision === "PENDING" || f.decision === "CLARIFY");
    expect(waiting.length).toBeLessThanOrEqual(3);

    const done = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    suId = done.serviceUserId!;
    expect(suId).toBeTruthy();
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId }, select: { id: true } });
    expect(await db.auditLog.count({ where: { organisationId: orgId, entityId: { in: [intakeId, suId, ...risks.map((r) => r.id)] }, action: { in: ["coordinator.section.approved", "coordinator.intake.approved", "coordinator.fact.bulk-approved", "careplan.approved", "careplan.submitted", "risk.draft.approved"] } } })).toBe(0);
    expect(done.setupStatus).not.toBe("FAILED");
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    expect([su.firstName, su.lastName, su.preferredName, su.postcode, su.status]).toEqual([SCANNED_PLAN_PERSON.firstName, SCANNED_PLAN_PERSON.lastName, "Winnie", SCANNED_PLAN_PERSON.postcode, "ASSESSMENT"]);
  }, 120_000);

  it("populates every record once: contacts, references, package, care plan, risks, templates, rota, call notes, documents", async () => {
    // Contacts: ten different people; Nora appears twice and is kept once.
    const contacts = await db.serviceUserContact.findMany({ where: { serviceUserId: suId } });
    expect(contacts).toHaveLength(10);
    expect(contacts.filter((x) => x.name === "Nora Sample")).toHaveLength(1);
    // References: the two clear ones are on the register; the Frameworki number's type is asked once.
    expect(await db.serviceUserExternalReference.count({ where: { serviceUserId: suId } })).toBe(2);
    // The package is structured: dates, minutes a week, staffing.
    const pkg = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect([pkg.startDate.toISOString().slice(0, 10), pkg.endDate?.toISOString().slice(0, 10), pkg.commissionedMinutesPerWeek]).toEqual(["2026-11-17", "2027-05-17", 1320]);
    // The care plan is imported and in use, with its source, and nobody named as its approver.
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
    expect([plan.status, plan.origin, plan.approvedById, plan.sourceIntakeId]).toEqual(["ACTIVE", "DOCUMENT", null, intakeId]);
    expect(plan.sourceNote).toMatch(/Care and Support Plan \(scan\) pages 3, 4/);
    expect(plan.sections.every((s) => !/Not documented/.test(s.body))).toBe(true);
    expect(plan.sections.find((s) => s.key === "home")!.body.match(/keep the kitchen and bathroom clean/g)).toHaveLength(1);
    expect(plan.sections.find((s) => s.key === "mobility")!.body).toMatch(/perching stool[\s\S]*Source: Care and Support Plan \(scan\), page 3/);
    // Risks: all eight saved and active. The two the council assessed are its assessments; the rest are labelled AI-generated.
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId }, orderBy: { title: "asc" } });
    expect(risks).toHaveLength(8);
    expect(risks.every((r) => r.status === "ACTIVE")).toBe(true);
    expect(risks.filter((r) => r.origin === "DOCUMENT").map((r) => [r.title, r.level])).toEqual([["Falls at night", "HIGH"], ["Transfers with a perching stool", "MEDIUM"]]);
    expect(risks.filter((r) => r.origin === "AI_INFERRED")).toHaveLength(6);
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).riskLevel).toBe("HIGH");
    // Seven commissioned visits; the repeated morning row once; the family shopping is not scheduled.
    const templates = await db.visitTemplate.findMany({ where: { serviceUserId: suId } });
    expect(templates).toHaveLength(7);
    // A draft rota was prepared (its visits start with the package on 17 November), unpublished; carers are not told.
    const report = (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).setupReport as { rota: { error?: string; weekStart: string } | null };
    expect(report.rota).not.toBeNull();
    expect(report.rota!.error).toBeUndefined();
    expect(templates.every((t) => t.effectiveFrom.toISOString().slice(0, 10) >= "2026-11-17")).toBe(true);
    const visits = await db.visit.findMany({ where: { serviceUserId: suId } });
    expect(visits.every((v) => v.publishedAt === null)).toBe(true);
    expect(await db.notification.count({ where: { organisationId: orgId, type: { startsWith: "visit" } } })).toBe(0);
    // Call notes, and the original scan kept byte for byte.
    expect(await db.callNote.count({ where: { serviceUserId: suId } })).toBe(4);
    const filed = await db.serviceUserDocumentVersion.findFirstOrThrow({ where: { document: { serviceUserId: suId } } });
    const kept = await storage().get(filed.storageKey);
    expect(createHash("sha256").update(kept).digest("hex")).toBe(createHash("sha256").update(pdf).digest("hex"));
    // Medication stays a reconciliation list: no medicine record, nothing on a MAR, no DNACPR status recorded.
    expect(await db.medication.count({ where: { serviceUserId: suId } })).toBe(0);
    expect(await db.incident.count({ where: { serviceUserId: suId } })).toBe(0);
  });

  it("leaves only genuine exceptions, and keeps the safety controls", async () => {
    const all = (await listExceptions(await manager(), { serviceUserId: suId })).items;
    const cats = all.filter((x) => x.severity !== "INFO").map((x) => x.category).sort();
    expect(cats).toEqual(expect.arrayContaining(["DNACPR", "FUNDING", "MANAGER_FIELD", "MEDICATION", "REFERENCE", "RISK_LEVEL"]));
    expect(cats).not.toContain("SOURCE_CHECK");
    expect(cats).not.toContain("PACKAGE_HOURS"); // 22 hours match the timetable
    expect(all.find((x) => x.category === "DNACPR")!.severity).toBe("REVIEW");
    // Restricted items (medication, DNACPR, history) are hidden from the coordinator and from carers.
    const c = await listExceptions(await coordinator(), { serviceUserId: suId });
    expect(c.items.every((x) => !x.restricted)).toBe(true);
    expect(c.hidden).toBeGreaterThan(0);
    await expect(listExceptions(await carer(), { serviceUserId: suId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listExceptions(await ctxFor("manager@oakridge.demo", OAKRIDGE), { serviceUserId: suId })).rejects.toBeInstanceOf(NotFoundError);
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    const lines = setupSummaryLines(intake.setupReport as never, "NEW");
    expect(lines).toEqual(expect.arrayContaining(["Care plan imported from the council support plan and in use", "10 contacts added", "7 repeating visit templates created"]));
    expect(lines.join(" ")).toMatch(/8 risk assessments saved \(6 AI-generated/);
  });

  it("lets staff correct records afterwards, with the change in the audit history and earlier versions kept", async () => {
    const c = await coordinator();
    // A contact: the saved value and the corrected value are both shown, with who changed it.
    const nora = await db.serviceUserContact.findFirstOrThrow({ where: { serviceUserId: suId, name: "Nora Sample" } });
    await updateContact(c, suId, nora.id, { kind: nora.kind as "NEXT_OF_KIN", name: nora.name, relationship: nora.relationship, phone: "0200 000 0399", isEmergency: true, canReceiveUpdates: false });
    const audit = await serviceUserAiAudit(c, suId);
    const corr = audit.corrections.find((x) => x.field === "Contact Nora Sample")!;
    expect([corr.saved.includes("0200 000 0303"), corr.now.includes("0200 000 0399"), corr.changedBy]).toEqual([true, true, c.userName]);
    // The care plan: a new version put in use by the coordinator alone; the imported version is kept, unchanged.
    const draft = await startDraft(c, suId);
    const fresh = await db.carePlan.findUniqueOrThrow({ where: { id: draft.id }, include: { sections: true } });
    await saveDraft(c, draft.id, { fingerprint: draftFingerprint(fresh, fresh.sections), summary: fresh.summary ?? "", reviewDue: addDays(londonDate(), 120), sections: { nutrition: { body: "Soft diet until the dentist says otherwise. Fish on Fridays." } } });
    await putPlanInUse(c, draft.id);
    expect((await db.carePlan.findMany({ where: { serviceUserId: suId }, orderBy: { version: "asc" } })).map((p) => [p.status, p.origin])).toEqual([["SUPERSEDED", "DOCUMENT"], ["ACTIVE", "MANUAL"]]);
    expect(await db.auditLog.count({ where: { action: "careplan.put-in-use", entityId: suId, actorId: c.userId } })).toBe(1);
    // A risk: the level set by the coordinator; the AI-generated first version is kept.
    const skin = await db.riskAssessment.findFirstOrThrow({ where: { serviceUserId: suId, title: "Fragile skin on the shins" } });
    await reviewRisk(c, skin.id, skin.version, { type: skin.type, title: skin.title, hazards: skin.hazards, controls: "Moisturise shins at the morning visit; report any break in the skin.", level: "LOW", reviewDue: addDays(londonDate(), 60) });
    const versions = await db.riskAssessmentVersion.findMany({ where: { riskAssessmentId: skin.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.level, v.changedById])).toEqual([["MEDIUM", c.userId], ["LOW", c.userId]]);
    expect(versions[0]!.reason).toMatch(/AI-generated/);
  });

  it("can be run again after a failure or by mistake without saving anything twice", async () => {
    const count = async () => Promise.all([db.serviceUser.count({ where: { lastName: "Sample", firstName: "Winifred" } }), db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.visit.count({ where: { serviceUserId: suId } }), db.riskAssessment.count({ where: { serviceUserId: suId } }), db.carePlan.count({ where: { serviceUserId: suId } }), db.callNote.count({ where: { serviceUserId: suId } }), db.serviceUserDocument.count({ where: { serviceUserId: suId } }), db.careIntakeReviewItem.count({ where: { intakeId } })]);
    const before = await count();
    await runAutomaticSetup(await coordinator(), intakeId);
    expect(await count()).toEqual(before);
  });
});
