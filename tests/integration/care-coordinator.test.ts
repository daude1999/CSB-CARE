import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { AiUnavailableError, type LlmProvider } from "@/server/ai/provider";
import type { CareDocumentExtraction } from "@/server/ai/schemas";
import { addDocuments, addManualFact, approveVerified, cancelIntake, createIntake, decideFact, getIntake, listIntakes, openIntakeDocument, readIntakeDocument } from "@/server/care/coordinator/intake";
import { applySection, approveAndSave } from "@/server/care/coordinator/apply";
import { confirmAndSetUp } from "@/server/care/coordinator/prepare";
import { referencesFor } from "@/server/care/external-references";
import { activateCare, createIntakeRota, previewIntakeRota, rotaReadiness, staffingProposals } from "@/server/care/coordinator/rota";
import { shiftCheck } from "@/server/care/coordinator/shift";
import { draftFingerprint, putPlanInUse, saveDraft, startDraft } from "@/server/care/care-plans";
import { reviewRisk } from "@/server/care/risks";
import { storage } from "@/server/storage";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { dischargeLetterPdf, supportPlanPdf, topicsPlanPdf } from "../support/coordinator-fixture";
import { packageSources } from "@/server/care/packages";

/**
 * AI Care Coordinator, end to end against a real database, with synthetic documents only:
 * upload → read (page-referenced) → map → coordinator review → Confirm & Set Up Records (one coordinator, no manager
 * approval) → save into the existing profile → care plan / risk drafts approved by someone else → templates → unpublished rota → proposals → shift check.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

let orgId = "";
let intakeId = "";
let planBytes: Buffer;
let letterBytes: Buffer;

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  // A second care manager, so two-person rules can be exercised (the demo has one).
  const reviewer = await db.user.findUniqueOrThrow({ where: { email: "reviewer@care-solution.demo" } });
  await db.membership.update({ where: { userId_organisationId: { userId: reviewer.id, organisationId: orgId } }, data: { roles: { push: "CARE_MANAGER" } } });
  planBytes = await supportPlanPdf();
  letterBytes = await dischargeLetterPdf();
}, 180_000);

const factsOf = async (dest: string) => (await db.careIntakeFact.findMany({ where: { intakeId, destination: dest }, orderBy: { position: "asc" } }));

describe("1. Upload, reading and classification", () => {
  it("stores the originals unchanged, reads every page with page numbers, classifies and restricts the NHS letter", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Synthetic referral, Example Borough" });
    intakeId = intake.id;
    expect(intake.reference).toMatch(/^CI-\d{4}$/);
    const r = await addDocuments(c, intake.id, [
      { name: "Support plan.pdf", type: "application/pdf", bytes: planBytes },
      { name: "Discharge summary.pdf", type: "application/pdf", bytes: letterBytes },
    ]);
    expect(r.documents).toBe(2);
    const docs = await db.careIntakeDocument.findMany({ where: { intakeId }, orderBy: { position: "asc" } });
    expect(docs.map((d) => [d.section, d.category, d.sensitive, d.issuerKind, d.pageCount, d.readStatus])).toEqual([
      ["COUNCIL", "COUNCIL_SUPPORT_PLAN", false, "COUNCIL", 4, "READ"],
      ["OTHER", "DISCHARGE_INFORMATION", true, "NHS", 1, "READ"],
    ]);
    // Original retained byte for byte.
    expect((await storage().get(docs[0]!.storageKey)).equals(planBytes)).toBe(true);
    // A key safe code in a document is never copied.
    expect(JSON.stringify(await db.careIntakeFact.findMany({ where: { intakeId } }))).not.toContain("1234");
    expect((docs[0]!.findings as { kind: string; text: string }[]).some((f) => /key safe/i.test(f.text))).toBe(true);
  });

  it("maps facts to exact profile destinations with source pages, including the timetable continued on page 4", async () => {
    const visits = await factsOf("visit");
    expect(visits.map((v) => [(v.value as { startTime: string }).startTime, (v.value as { durationMin: number }).durationMin, v.sourcePage, (v.value as { fundedBy: string }).fundedBy])).toEqual([
      ["09:00", 60, 3, "COUNCIL"], ["12:00", 45, 3, "COUNCIL"], ["11:00", 60, 3, "CARERS_SERVICE"], ["16:30", 30, 4, "COUNCIL"], ["20:00", 60, 4, "COUNCIL"], ["12:45", 60, 4, "CARERS_SERVICE"],
    ]);
    expect((await factsOf("person.dateOfBirth"))[0]).toMatchObject({ value: "1941-03-02", sourcePage: 1, verification: "VERIFIED" });
    expect((await factsOf("package.minutesPerWeek"))[0]!.value).toBe(1365);
    expect((await factsOf("contact")).length).toBe(3);
    expect((await factsOf("incident.history"))[0]!.temporal).toBe("HISTORICAL");
    const view = await getIntake(await manager(), intakeId);
    expect(view.reconciliation.authorised).toBeNull(); // nothing approved yet
  });

  it("checks an AI reading's quotes against the page: a quote that is not on the page is UNVERIFIED", async () => {
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const ai: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-reader", isSimulated: false,
      async extractCareDocument(): Promise<CareDocumentExtraction> {
        return {
          document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: "2026-09-15", pageCount: 4 },
          person: [
            { field: "firstName", value: "Ada", page: 1, quote: "Full name: Ada Fictional", temporal: "CURRENT" },
            { field: "town", value: "Elsewhere", page: 1, quote: "Lives in Elsewhere town", temporal: "CURRENT" },
          ],
          references: [{ type: "NHS", issuer: "NHS", value: "999 000 0001", page: 1, quote: "NHS number: 999 000 0001", temporal: "CURRENT" }],
          contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [],
          medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [{ text: "Two different evening times", page: 4 }], missing: ["Purchase order"], unreadable: [],
        };
      },
    });
    setAiProviderForTests(ai);
    const tmp = await createIntake(await coordinator(), { title: "AI reading check" });
    await addDocuments(await coordinator(), tmp.id, [{ name: "Plan.pdf", type: "application/pdf", bytes: planBytes }]);
    const facts = await db.careIntakeFact.findMany({ where: { intakeId: tmp.id }, orderBy: { position: "asc" } });
    expect(facts.map((f) => [f.destination, f.verification, f.origin])).toEqual([["person.firstName", "VERIFIED", "AI"], ["person.town", "UNVERIFIED", "AI"], ["externalReference", "VERIFIED", "AI"]]);
    expect(facts[2]!.label).toBe("NHS number (NHS)");
    expect(facts[1]!.conflict).toMatch(/not found on page 1/);
    setAiProviderForTests(new SimulatedProvider());
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    await cancelIntake(await coordinator(), tmp.id, "Test of the AI reading only");
  });

  it("keeps an upload whose AI reading fails, reads it with the basic reader, and reads it again by AI later without re-uploading", async () => {
    process.env.COORDINATOR_READ_RETRY_BASE_MS = "1";
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const failing: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-reader", isSimulated: false,
      async extractCareDocument(): Promise<CareDocumentExtraction> { throw new AiUnavailableError("The AI service rejected the request.", "rejected"); },
    });
    setAiProviderForTests(failing);
    const c = await coordinator();
    const tmp = await createIntake(c, { title: "AI reading failure recovery" });
    const added = await addDocuments(c, tmp.id, [{ name: "Plan.pdf", type: "application/pdf", bytes: planBytes }]);
    expect(added.results[0]).not.toHaveProperty("error");
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId: tmp.id } });
    expect([doc.readStatus, doc.readMethod, doc.readFailure]).toEqual(["PARTLY_READ", "basic-reader", "rejected"]);
    expect(doc.readNote).toMatch(/Uploaded and stored safely\. The AI reading failed because the AI service rejected the request/);
    expect((await storage().get(doc.storageKey)).equals(planBytes)).toBe(true);
    const basicFacts = await db.careIntakeFact.findMany({ where: { intakeId: tmp.id } });
    expect(basicFacts.length).toBeGreaterThan(5);
    expect(basicFacts.every((f) => f.origin === "BASIC")).toBe(true);
    // A document stuck as FAILED by the old reader is recovered the same way.
    await db.careIntakeDocument.update({ where: { id: doc.id }, data: { readStatus: "FAILED", readNote: "The document could not be read by the AI service just now.", readMethod: null, readFailure: null } });

    setAiProviderForTests(Object.assign(new SimulatedProvider(), {
      name: "test-reader", isSimulated: false,
      async extractCareDocument(): Promise<CareDocumentExtraction> {
        return {
          document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: null, pageCount: 4 },
          person: [{ field: "firstName", value: "Ada", page: 1, quote: "Full name: Ada Fictional", temporal: "CURRENT" }],
          references: [], contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [],
          medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [],
        };
      },
    }));
    const again = await readIntakeDocument(c, doc.id);
    expect([again.reader, again.aiFailure]).toEqual(["ai", null]);
    const after = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect([after.readStatus, after.readMethod, after.readFailure, after.section]).toEqual(["READ", "ai", null, "COUNCIL"]);
    const aiFacts = await db.careIntakeFact.findMany({ where: { intakeId: tmp.id } });
    expect(aiFacts.map((f) => [f.destination, f.origin])).toEqual([["person.firstName", "AI"]]);
    const log = await db.auditLog.findMany({ where: { entityId: tmp.id, action: "coordinator.document.read" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => (l.data as { aiFailure: { reason: string } | null }).aiFailure?.reason ?? null)).toEqual(["rejected", null]);
    expect(JSON.stringify(log.map((l) => l.data))).not.toContain("Ada");

    setAiProviderForTests(new SimulatedProvider());
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    await cancelIntake(c, tmp.id, "Test of the AI reading recovery only");
  });
});

describe("2. Coordinator review", () => {
  it("hides restricted facts and documents from a coordinator, and lets a manager open them", async () => {
    const view = await getIntake(await coordinator(), intakeId);
    const med = view.facts.filter((f) => f.section === "MEDICATION");
    expect(med.length).toBeGreaterThan(0);
    expect(med.every((f) => f.hidden && f.value === null && f.quote === null)).toBe(true);
    expect(view.facts.find((f) => f.destination === "person.nhsNumber")!.hidden).toBe(true);
    const letter = view.documents.find((d) => d.sensitive)!;
    await expect(openIntakeDocument(await coordinator(), letter.id)).rejects.toBeInstanceOf(NotFoundError);
    const opened = await openIntakeDocument(await manager(), letter.id);
    expect(opened.bytes.equals(letterBytes)).toBe(true);
    const med0 = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId, section: "MEDICATION" } });
    await expect(decideFact(await coordinator(), med0.id, null, { decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("edits, rejects, asks questions and keeps every decision after reload, with the original reading unchanged", async () => {
    const c = await coordinator();
    const town = (await factsOf("person.town"))[0]!;
    await decideFact(c, town.id, town.lockVersion, { decision: "EDITED", value: "London Borough of Example" });
    await expect(decideFact(c, town.id, town.lockVersion, { decision: "APPROVED" })).rejects.toBeInstanceOf(ConflictError); // stale version
    const after = await db.careIntakeFact.findUniqueOrThrow({ where: { id: town.id } });
    expect([after.value, after.proposed, after.decision]).toEqual(["London Borough of Example", "London", "EDITED"]);
    // The database refuses to rewrite what was read.
    await expect(db.careIntakeFact.update({ where: { id: town.id }, data: { proposed: "Somewhere" } })).rejects.toThrow(/cannot be changed/);
    const pc = (await factsOf("person.preferredName"))[0]!;
    await expect(decideFact(c, pc.id, null, { decision: "REJECTED" })).rejects.toBeInstanceOf(ValidationError); // reason needed
    await decideFact(c, pc.id, null, { decision: "REJECTED", note: "Same as first name" });
    const risk = (await factsOf("risk"))[0]!;
    await expect(decideFact(c, risk.id, null, { decision: "APPROVED" })).rejects.toThrow(/provisional risk level/);
    await decideFact(c, risk.id, null, { decision: "EDITED", value: { ...(risk.value as object), level: "MEDIUM", levelIsProvisional: true, existingControls: "Frame within reach. One carer nearby when standing." } });
    const comm = (await factsOf("person.communicationNeeds"))[0]!;
    const mgr = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
    await decideFact(c, comm.id, null, { decision: "CLARIFY", question: "Which ear is the hearing aid in now?", assignedToId: mgr.id });
    expect(await db.notification.count({ where: { userId: mgr.id, type: "coordinator.question" } })).toBe(1);
    await decideFact(c, comm.id, null, { decision: "APPROVED", note: "Left ear, confirmed by phone with daughter" });
    const n = await approveVerified(c, intakeId, "PERSONAL");
    expect(n).toBeGreaterThan(5);
    for (const s of ["CONTACTS", "CARER_PREFERENCES", "CARE_PLAN", "PACKAGE", "VISITS", "RISKS"]) await approveVerified(c, intakeId, s);
    // Facts with a note (duplicates across documents) stay for a person to decide.
    // Restricted facts (hidden from the coordinator) are left for a manager.
    const left = (await getIntake(c, intakeId)).facts.filter((f) => f.decision === "PENDING" && !f.hidden);
    for (const f of left) await decideFact(c, f.id, null, { decision: "DUPLICATE", note: "Same as the support plan" });
    // A fact added by hand for something the reader cannot see.
    await addManualFact(c, intakeId, { destination: "careplan.communication", value: { support: "Speak slowly, face her, check the hearing aid is in.", canDo: "Understands simple English." }, sourcePage: 1 });
    await addManualFact(c, intakeId, { destination: "externalReference", value: { type: "COUNCIL_CLIENT", issuer: "Example Borough Council", value: "007001" }, sourcePage: 1 });
    // Reload: decisions persisted.
    const view = await getIntake(c, intakeId);
    expect(view.facts.find((f) => f.id === town.id)!.decision).toBe("EDITED");
    expect(view.facts.find((f) => f.id === pc.id)!.decisionNote).toBe("Same as first name");
  });

  it("only someone allowed to confirm intakes can confirm, and not while the page is out of date", async () => {
    await expect(confirmAndSetUp(await carer(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    const lock = (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).lockVersion;
    await expect(confirmAndSetUp(await coordinator(), intakeId, { lockVersion: lock - 1 })).rejects.toThrow(/changed since you opened/);
    expect(await db.careIntakeSection.count({ where: { intakeId, status: "APPROVED" } })).toBe(0);
  });
});

describe("3. Confirm & Set Up Records: one coordinator, no manager approval", () => {
  it("the coordinator confirms once: ordinary records are set up under their name while restricted facts stay listed", async () => {
    const c = await coordinator();
    const coordinatorUser = await db.user.findUniqueOrThrow({ where: { email: "coordinator@care-solution.demo" } });
    const end = (await factsOf("package.endDate"))[0]!;
    await decideFact(c, end.id, null, { decision: "EDITED", value: "2026-12-30" });
    const restrictedLeft = await db.careIntakeFact.count({ where: { intakeId, decision: "PENDING" } });
    expect(restrictedLeft).toBeGreaterThan(0); // medication, history, date of birth: the coordinator cannot see them
    const r = await confirmAndSetUp(c, intakeId, { lockVersion: (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).lockVersion });
    // No manager was asked: every ordinary section is approved by the coordinator and saved.
    expect(r.save.sections.filter((s) => s.status !== "SAVED").map((s) => s.section)).toEqual([]);
    expect(r.save.sections.map((s) => s.section)).toEqual(expect.arrayContaining(["PERSONAL", "CONTACTS", "CARER_PREFERENCES", "PACKAGE", "CARE_PLAN", "RISKS", "VISITS"]));
    const approved = await db.careIntakeSection.findMany({ where: { intakeId, status: "APPROVED" } });
    expect(approved.length).toBeGreaterThanOrEqual(7);
    expect(approved.every((s) => s.decidedById === coordinatorUser.id && s.applyStatus === "DONE")).toBe(true);
    expect(await db.notification.count({ where: { organisationId: orgId, type: "coordinator.submitted" } })).toBe(0);
    // Unresolved restricted facts do not block the ordinary records, but the intake is not Completed.
    expect(r.attention.facts).toBe(restrictedLeft);
    expect(r.save.completed).toBe(false);
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    expect(intake.status).toBe("DRAFT");
    expect(intake.submittedById).toBe(coordinatorUser.id);
    expect(intake.serviceUserId).toBeTruthy();
    // Restricted personal details are not saved by someone who cannot see them.
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: intake.serviceUserId! } })).dateOfBirth).toBeNull();
    // Audit: the coordinator's confirmation, with the time, and each section's approval.
    const audit = await db.auditLog.findMany({ where: { entityType: "CareIntake", entityId: intakeId, action: { in: ["coordinator.intake.confirmed", "coordinator.section.approved", "coordinator.intake.approved"] } } });
    expect(audit.every((a) => a.actorId === coordinatorUser.id)).toBe(true);
    expect(audit.filter((a) => a.action === "coordinator.section.approved").length).toBe(approved.length);
    expect((audit.find((a) => a.action === "coordinator.intake.confirmed")!.data as { at: string }).at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Facts saved can no longer be changed; facts still open in review can.
    const town = (await factsOf("person.town"))[0]!;
    await expect(decideFact(c, town.id, null, { decision: "REJECTED", note: "Changed my mind" })).rejects.toThrow(/already been saved/);
  });

  it("someone allowed to see restricted records decides the restricted facts and the same action finishes the intake", async () => {
    const m = await manager();
    for (const f of await db.careIntakeFact.findMany({ where: { intakeId, decision: "PENDING" } })) await decideFact(m, f.id, null, { decision: f.destination === "person.firstName" || f.destination === "person.lastName" || f.destination === "person.dateOfBirth" ? "DUPLICATE" : "APPROVED", note: "Same as the support plan" });
    const r = await confirmAndSetUp(m, intakeId);
    expect(r.save.sections.filter((s) => s.status === "FAILED")).toEqual([]);
    expect(r.save.sections.filter((s) => s.status === "SAVED").map((s) => s.section)).toEqual(expect.arrayContaining(["MEDICATION", "INCIDENTS", "BODY_MAP"]));
    // Sections already saved by the coordinator are not repeated.
    expect(r.save.sections.find((s) => s.section === "CONTACTS")?.status).toBe("ALREADY_SAVED");
    expect(r.save.completed).toBe(true);
  });
});

describe("4. Saving into the existing profile", () => {
  let suId = "";
  it("creates the person, contacts, preferences, package, drafts and templates, files the originals, and reads them back", async () => {
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    suId = intake.serviceUserId!;
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    expect([su.firstName, su.lastName, su.town, su.status, su.carerGenderPreference, su.nhsNumber]).toEqual(["Ada", "Fictional", "London Borough of Example", "ASSESSMENT", "FEMALE", "9990000001"]);
    expect((await db.careIntakeSection.findMany({ where: { intakeId, status: "APPROVED" } })).every((s) => s.applyStatus === "DONE")).toBe(true);
    // The council client number goes to the encrypted register: unverified, leading zeroes kept, never in plain text.
    const refs = await db.serviceUserExternalReference.findMany({ where: { serviceUserId: suId } });
    expect(refs.map((r) => [r.type, r.verified, r.valueCipher.includes("007001")])).toEqual([["COUNCIL_CLIENT", false, false]]);
    expect((await referencesFor(await manager(), suId)).rows.map((r) => r.value)).toEqual(["007001"]);
    const contacts = await db.serviceUserContact.findMany({ where: { serviceUserId: suId } });
    expect(contacts.map((c) => c.kind).sort()).toEqual(["GP", "NEXT_OF_KIN", "SOCIAL_WORKER"]);
    expect(contacts.every((c) => !c.authorityType)).toBe(true);
    const pkg = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect([pkg.commissionedMinutesPerWeek, pkg.endDate?.toISOString().slice(0, 10)]).toEqual([1365, "2026-12-30"]);
    // The package text holds only the approved staffing instruction. The named funder becomes a question for finance
    // (never a linked funder), and where the package came from is recorded on the facts, not pasted into the text.
    expect(pkg.requirements).toBe("All visits single handed");
    expect(pkg.funderId).toBeNull();
    const funding = await db.careIntakeReviewItem.findMany({ where: { serviceUserId: suId, category: "FUNDING" } });
    expect(funding.map((f) => [f.status, f.restricted, /Example Borough Council/.test(f.description)])).toEqual([["OPEN", false, true]]);
    expect(await db.careIntakeReviewItem.count({ where: { serviceUserId: suId, category: "PACKAGE_HOURS" } })).toBe(0); // 1,365 minutes match
    const src = (await packageSources(await manager(), suId)).byPackage.get(pkg.id);
    expect(src?.intakeReference).toBe(intake.reference);
    expect(src?.documents.map((d) => d.name)).toContain("Support plan");
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
    expect([plan.status, plan.origin]).toEqual(["ACTIVE", "DOCUMENT"]);
    expect(plan.sections).toHaveLength(9);
    expect(plan.sections.find((s) => s.key === "mobility")!.body).toMatch(/frame[\s\S]*Source: Support plan, page 2/);
    expect(plan.sections.find((s) => s.key === "about_me")!.body).toMatch(/Not documented/);
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId } });
    expect(risks.map((r) => [r.status, r.origin])).toEqual([["ACTIVE", "AI_INFERRED"]]);
    const templates = await db.visitTemplate.findMany({ where: { serviceUserId: suId }, include: { tasks: { include: { careTask: true } } }, orderBy: { startMinute: "asc" } });
    expect(templates.map((t) => [t.startMinute, t.durationMin])).toEqual([[540, 60], [720, 45], [990, 30], [1200, 60]]);
    expect(templates[0]!.tasks.map((t) => t.careTask.name)).toEqual(expect.arrayContaining(["Assist with full wash", "Prepare breakfast"]));
    expect(templates[0]!.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-12-30");
    // Informal family rows were not scheduled.
    expect(await db.careIntakeReviewItem.count({ where: { serviceUserId: suId, category: "MISSING_INFO" } })).toBe(2);
    // Clinical content stays inactive.
    expect(await db.medication.count({ where: { serviceUserId: suId, status: "ACTIVE" } })).toBe(0);
    expect(await db.incident.count({ where: { serviceUserId: suId } })).toBe(0);
    expect(await db.bodyMapObservation.count({ where: { serviceUserId: suId } })).toBe(0);
    const recon = await db.careIntakeReviewItem.findMany({ where: { serviceUserId: suId, category: "MEDICATION" } });
    expect(recon.some((r) => /discharge letter/.test(r.description))).toBe(true);
    expect(recon.some((r) => /prompting only/.test(r.description))).toBe(true);
    // Originals filed unchanged, the NHS letter restricted.
    const filed = await db.serviceUserDocument.findMany({ where: { serviceUserId: suId }, include: { versions: true } });
    expect(filed.map((d) => [d.section, d.category, d.sensitive])).toEqual(expect.arrayContaining([["COUNCIL", "COUNCIL_SUPPORT_PLAN", false], ["OTHER", "DISCHARGE_INFORMATION", true]]));
    expect((await storage().get(filed.find((d) => d.section === "COUNCIL")!.versions[0]!.storageKey)).equals(planBytes)).toBe(true);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("COMPLETED");
  });

  it("is idempotent: saving again creates nothing new", async () => {
    const before = await Promise.all([db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.serviceUserDocument.count({ where: { serviceUserId: suId } })]);
    const again1 = await confirmAndSetUp(await manager(), intakeId);
    expect(again1.save.sections.every((x) => x.status === "ALREADY_SAVED")).toBe(true);
    expect(again1.save.completed).toBe(true);
    const again = await applySection(await manager(), intakeId, "VISITS");
    expect(again.status).toBe("DONE");
    expect(await Promise.all([db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.serviceUserDocument.count({ where: { serviceUserId: suId } })])).toEqual(before);
  });

  it("recovers from a failed section: an existing intake with a clashing package fails, then succeeds once cleared", async () => {
    const c = await coordinator();
    const upd = await createIntake(c, { title: "Package update", mode: "EXISTING", serviceUserId: suId });
    await addManualFact(c, upd.id, { destination: "package.startDate", value: addDays(londonDate(), 2) });
    await addManualFact(c, upd.id, { destination: "person.phone", value: "0200 000 0999" });
    const phone = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId: upd.id, destination: "person.phone" } });
    expect(phone.conflict).toMatch(/record already says "0200 000 0101"/);
    // An updated plan: package changes are saved on the coordinator's own confirmation (no manager approval).
    const r = (await approveAndSave(c, upd.id)).sections;
    expect(r.find((x) => x.section === "PACKAGE")).toMatchObject({ status: "FAILED" });
    expect(r.find((x) => x.section === "PACKAGE")!.error).toMatch(/already has an active package/);
    expect(r.find((x) => x.section === "PERSONAL")).toMatchObject({ status: "SAVED" });
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).phone).toBe("0200 000 0999");
    const failed = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId: upd.id, section: "PACKAGE" } } });
    expect([failed.applyStatus, failed.attempts]).toEqual(["FAILED", 1]);
    expect(failed.applyError).toMatch(/already has an active package/);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: upd.id } })).status).not.toBe("COMPLETED");
    await db.carePackage.updateMany({ where: { serviceUserId: suId }, data: { status: "ENDED" } });
    const retry = await applySection(c, upd.id, "PACKAGE");
    expect(retry.status).toBe("DONE");
    expect(await db.carePackage.count({ where: { serviceUserId: suId, status: "ACTIVE" } })).toBe(1);
    // Put the original package back for the rota steps.
    await db.carePackage.updateMany({ where: { serviceUserId: suId, status: "ACTIVE" }, data: { status: "ENDED" } });
    await db.carePackage.updateMany({ where: { serviceUserId: suId, commissionedMinutesPerWeek: 1365 }, data: { status: "ACTIVE" } });
  });
});

describe("5. Care plan, risks and the draft rota", () => {
  it("needs no second approver: the imported care plan and risk assessment are in use, and staff edit them later as new versions", async () => {
    const m = await manager();
    const c = await coordinator();
    const ready = await rotaReadiness(m, intakeId);
    expect(ready.gates.filter((g) => !g.ok).map((g) => g.key)).toEqual([]);
    expect(ready.ready).toBe(true);
    const suId = ready.serviceUser!.id;
    const imported = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId, status: "ACTIVE" }, include: { sections: true } });
    expect([imported.origin, imported.approvedById]).toEqual(["DOCUMENT", null]);
    expect(await db.auditLog.count({ where: { action: "careplan.imported", entityId: suId } })).toBe(1);
    // A coordinator corrects the plan: a new version, put in use by them alone; the imported version is kept.
    const draft = await startDraft(c, suId);
    const fresh = await db.carePlan.findUniqueOrThrow({ where: { id: draft.id }, include: { sections: true } });
    expect(fresh.sections.find((x) => x.key === "mobility")!.body).toMatch(/frame/);
    await saveDraft(c, draft.id, { fingerprint: draftFingerprint(fresh, fresh.sections), summary: fresh.summary ?? "Summary", reviewDue: addDays(londonDate(), 90), sections: { mobility: { body: "Walks with a frame indoors. Corrected by the coordinator after a home visit." } } });
    await putPlanInUse(c, draft.id);
    const versions = await db.carePlan.findMany({ where: { serviceUserId: suId }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.status, v.origin])).toEqual([[imported.version, "SUPERSEDED", "DOCUMENT"], [imported.version + 1, "ACTIVE", "MANUAL"]]);
    expect(versions[1]!.approvedById).toBe(c.userId);
    expect(await db.auditLog.count({ where: { action: "careplan.put-in-use", entityId: suId, actorId: c.userId } })).toBe(1);
    // The superseded imported version cannot be changed.
    await expect(db.carePlan.update({ where: { id: imported.id }, data: { summary: "changed" } })).rejects.toThrow(/immutable/);
    // A risk assessment is reviewed by the coordinator with no second person; the earlier version is kept.
    const risk = await db.riskAssessment.findFirstOrThrow({ where: { serviceUserId: suId, status: "ACTIVE" } });
    await reviewRisk(c, risk.id, risk.version, { type: risk.type, title: risk.title, hazards: risk.hazards, controls: "Frame within reach. One carer nearby when standing.", level: "MEDIUM", reviewDue: addDays(londonDate(), 30) });
    expect(await db.riskAssessmentVersion.count({ where: { riskAssessmentId: risk.id } })).toBe(2);
    // A carer cannot edit either.
    await expect(startDraft(await ctxFor("carer@care-solution.demo", BROOKFIELD), suId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only a manager activates care and creates unpublished visits through Build Rota, never twice", async () => {
    const m = await manager();
    await expect(activateCare(await coordinator(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    await activateCare(m, intakeId);
    const week = addDays(mondayOf(londonDate()), 7);
    const preview = await previewIntakeRota(m, intakeId, week, 2);
    // 4 visits x 7 days x 2 weeks; Confirm & Set Up Records already proposed this week and next (unpublished).
    expect(preview.totals.create + preview.totals.alreadyBuilt).toBe(56);
    expect(preview.totals.alreadyBuilt).toBe(28);
    const made = await createIntakeRota(m, intakeId, { weekStart: week, weeks: 2, fingerprint: preview.fingerprint });
    expect(made.visits).toBe(28);
    expect(made.published).toBe(0);
    const suId = (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).serviceUserId!;
    const visits = await db.visit.findMany({ where: { serviceUserId: suId }, include: { tasks: true } });
    expect(visits.every((v) => v.publishedAt === null)).toBe(true);
    // Wash, dress and breakfast reach the visit; "Prompt medication" waits for the medication record (phase 5).
    expect(visits.find((v) => v.tasks.length >= 3)).toBeTruthy();
    expect(visits.every((v) => v.tasks.every((t) => !/medication/i.test(t.name)))).toBe(true);
    const again = await previewIntakeRota(m, intakeId, week, 2);
    expect(again.totals.create).toBe(0);
    await expect(createIntakeRota(m, intakeId, { weekStart: week, weeks: 2, fingerprint: again.fingerprint })).rejects.toThrow(/nothing new/);
    const proposals = await staffingProposals(m, intakeId, week, 3);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.options.every((o) => o.state !== "NOT_ELIGIBLE"))).toBe(true);
  });
});

describe("6. Shift check, history, isolation and access", () => {
  it("lists open places with suggested carers, unpublished visits and approvals, and changes nothing", async () => {
    const week = addDays(mondayOf(londonDate()), 7);
    const before = await db.visitAssignment.count();
    const s = await shiftCheck(await coordinator(), week);
    expect(s.open.some((o) => o.person === "Ada Fictional")).toBe(true);
    expect(s.urgent.some((u) => /not published/.test(u.text))).toBe(true);
    expect(s.handover.every((h) => h.kind === "FACT" || h.kind === "RECOMMENDATION")).toBe(true);
    expect(await db.visitAssignment.count()).toBe(before);
    await expect(shiftCheck(await carer(), week)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records every step in the intake history with the signed-in person", async () => {
    const actions = (await db.auditLog.findMany({ where: { entityType: "CareIntake", entityId: intakeId } })).map((a) => a.action);
    for (const a of ["coordinator.intake.created", "coordinator.document.uploaded", "coordinator.document.read", "coordinator.fact.decided", "coordinator.intake.confirmed", "coordinator.intake.approved", "coordinator.section.approved", "coordinator.section.applied", "coordinator.documents.filed", "coordinator.care.activated", "coordinator.rota.created"]) expect(actions).toContain(a);
    expect(await db.auditLog.count({ where: { entityType: "CareIntake", entityId: intakeId, actorId: null } })).toBe(0);
  });

  it("keeps intakes inside their organisation and away from carers", async () => {
    await expect(getIntake(await otherOrg(), intakeId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listIntakes(await otherOrg())).length).toBe(0);
    await expect(getIntake(await carer(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId } });
    await expect(openIntakeDocument(await otherOrg(), doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readIntakeDocument(await otherOrg(), doc.id)).rejects.toBeInstanceOf(NotFoundError);
    const f = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId } });
    await expect(decideFact(await otherOrg(), f.id, null, { decision: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmAndSetUp(await otherOrg(), intakeId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops a likely duplicate person unless the coordinator confirms they are someone else", async () => {
    const c = await coordinator();
    const dup = await createIntake(c, { title: "Same person again" });
    await addManualFact(c, dup.id, { destination: "person.firstName", value: "Ada" });
    await addManualFact(c, dup.id, { destination: "person.lastName", value: "Fictional" });
    await expect(confirmAndSetUp(c, dup.id)).rejects.toThrow(/already on record/);
    expect(await db.serviceUser.count({ where: { organisationId: orgId, firstName: "Ada", lastName: "Fictional" } })).toBe(1);
    await confirmAndSetUp(c, dup.id, { notADuplicate: true });
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: dup.id } })).notDuplicateById).toBeTruthy();
  });
});

describe("7. Structured extraction (phase 2): care plan topics, risk mitigation and visit details reach the drafts", () => {
  it("files each topic under its section heading, keeps the mitigation on the risk draft and the instructions on a temporary two-carer template", async () => {
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const at = (page: number, quote: string) => ({ page, quote, temporal: "CURRENT" as const });
    const ai: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-reader", isSimulated: false,
      async extractCareDocument(): Promise<CareDocumentExtraction> {
        return {
          document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: null, pageCount: 2 },
          person: [
            { field: "firstName", value: "Bea", ...at(1, "Full name: Bea Specimen") },
            { field: "lastName", value: "Specimen", ...at(1, "Full name: Bea Specimen") },
          ],
          references: [], contacts: [], carerPreferences: [],
          carePlan: [
            { section: "personal_care", topic: "TOILETING_CONTINENCE", canDo: "Uses the toilet with her frame", support: "Help at night", how: "Leave the commode within reach", preferences: "Prefers a female carer", outcome: null, clarify: null, ...at(2, "Leave the commode within reach") },
            { section: "personal_care", topic: "WASHING_DRESSING", canDo: null, support: "A full strip wash at the sink", how: null, preferences: "Chooses her own clothes", outcome: null, clarify: null, ...at(2, "She likes to choose her own clothes") },
          ],
          risks: [{ type: "FALLS", title: "Falls at night", hazard: "Has fallen twice getting up to the toilet", whoAffected: null, existingControls: null, mitigation: "A sensor light on the landing", assessmentGaps: "No falls assessment date", level: "HIGH", ...at(2, "A sensor light on the landing is recommended") }],
          package: [],
          visits: [{ label: "Morning", weekdays: [1, 2, 3, 4, 5], startTime: "08:00", durationMinutes: 45, carers: 2, tasks: ["Hoist transfer", "Strip wash"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, startDate: null, visitType: "Personal care", instructions: "Two carers for the hoist", temporary: true, ...at(2, "Two carers for the hoist") }],
          medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [],
        };
      },
    });
    setAiProviderForTests(ai);
    try {
      const c = await coordinator();
      const tmp = await createIntake(c, { title: "Topics check" });
      await addDocuments(c, tmp.id, [{ name: "Plan.pdf", type: "application/pdf", bytes: await topicsPlanPdf() }]);
      const facts = await db.careIntakeFact.findMany({ where: { intakeId: tmp.id }, orderBy: { position: "asc" } });
      expect(facts.every((f) => f.verification === "VERIFIED")).toBe(true);
      expect(facts.filter((f) => f.section === "CARE_PLAN").map((f) => f.label)).toEqual(["Toileting and continence", "Washing and dressing"]);
      // A temporary visit with no end date is flagged, so it is not bulk-approved: the coordinator approves it on its own.
      const visit = facts.find((f) => f.destination === "visit")!;
      expect(visit.conflict).toMatch(/no end date/);
      for (const s of ["PERSONAL", "CARE_PLAN", "RISKS", "VISITS"]) await approveVerified(c, tmp.id, s);
      expect((await db.careIntakeFact.findUniqueOrThrow({ where: { id: visit.id } })).decision).toBe("PENDING");
      await decideFact(c, visit.id, null, { decision: "APPROVED" });
      const results = (await confirmAndSetUp(c, tmp.id)).save.sections;
      expect(results.every((r) => r.status === "SAVED")).toBe(true);
      const suId = (await db.careIntake.findUniqueOrThrow({ where: { id: tmp.id } })).serviceUserId!;
      const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
      expect(plan.status).toBe("ACTIVE");
      const body = plan.sections.find((s) => s.key === "personal_care")!.body;
      expect(body).toMatch(/^Toileting and continence\n[\s\S]*How staff should support me: Leave the commode within reach[\s\S]*My preferences: Prefers a female carer/);
      expect(body).toMatch(/Washing and dressing\n[\s\S]*My preferences: Chooses her own clothes/);
      const risk = await db.riskAssessment.findFirstOrThrow({ where: { serviceUserId: suId } });
      expect(risk.status).toBe("ACTIVE");
      expect(JSON.stringify(risk)).toContain("A sensor light on the landing");
      expect(JSON.stringify(risk)).toContain("For a qualified assessor: No falls assessment date");
      const t = await db.visitTemplate.findFirstOrThrow({ where: { serviceUserId: suId } });
      expect([t.carersRequired, t.startMinute, t.durationMin, t.weekdays]).toEqual([2, 480, 45, [1, 2, 3, 4, 5]]);
      expect(t.notes).toContain("Morning (Personal care).");
      expect(t.notes).toContain("Instructions: Two carers for the hoist");
      expect(t.notes).toContain("Temporary visit, end date to confirm.");
    } finally {
      setAiProviderForTests(new SimulatedProvider());
      await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    }
  });
});
