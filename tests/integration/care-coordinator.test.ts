import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import type { CareDocumentExtraction } from "@/server/ai/schemas";
import { addDocuments, addManualFact, approveVerified, cancelIntake, createIntake, decideFact, decideSection, getIntake, listIntakes, openIntakeDocument, readIntakeDocument, submitIntake } from "@/server/care/coordinator/intake";
import { applyApproved, applySection } from "@/server/care/coordinator/apply";
import { referencesFor } from "@/server/care/external-references";
import { activateCare, createIntakeRota, previewIntakeRota, rotaReadiness, staffingProposals } from "@/server/care/coordinator/rota";
import { shiftCheck } from "@/server/care/coordinator/shift";
import { approvePlan, submitPlan } from "@/server/care/care-plans";
import { approveRiskDraft } from "@/server/care/risks";
import { storage } from "@/server/storage";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { dischargeLetterPdf, supportPlanPdf } from "../support/coordinator-fixture";

/**
 * AI Care Coordinator, end to end against a real database, with synthetic documents only:
 * upload → read (page-referenced) → map → coordinator review → manager section approval → save into the existing
 * profile → care plan / risk drafts approved by someone else → templates → unpublished rota → proposals → shift check.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const secondManager = () => ctxFor("reviewer@care-solution.demo", BROOKFIELD);
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
    await expect(submitIntake(c, intakeId)).rejects.toThrow(/still need/);
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

  it("restricted sections are reviewed by a manager; then the intake is sent for approval and managers are told", async () => {
    const m = await manager();
    for (const f of await db.careIntakeFact.findMany({ where: { intakeId, decision: "PENDING" } })) await decideFact(m, f.id, null, { decision: f.destination === "person.firstName" || f.destination === "person.lastName" || f.destination === "person.dateOfBirth" ? "DUPLICATE" : "APPROVED", note: "Same as the support plan" });
    await expect(submitIntake(await carer(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    await submitIntake(await coordinator(), intakeId);
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    expect(intake.status).toBe("SUBMITTED");
    expect(await db.notification.count({ where: { organisationId: orgId, type: "coordinator.submitted" } })).toBeGreaterThanOrEqual(2);
    const town = (await factsOf("person.town"))[0]!;
    await expect(decideFact(await coordinator(), town.id, null, { decision: "APPROVED" })).rejects.toThrow(/with the manager/);
  });
});

describe("3. Manager approval, section by section", () => {
  it("enforces roles and separation of duties, and lets sections progress independently", async () => {
    await expect(decideSection(await coordinator(), intakeId, "PERSONAL", { decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
    // The manager reviewed the restricted facts (medication, history, date of birth), so cannot approve those sections; the second manager can.
    await expect(decideSection(await manager(), intakeId, "MEDICATION", { decision: "APPROVED" })).rejects.toThrow(/another manager/);
    await expect(decideSection(await manager(), intakeId, "PERSONAL", { decision: "APPROVED" })).rejects.toThrow(/another manager/);
    await expect(decideSection(await manager(), intakeId, "PACKAGE", { decision: "RETURNED" })).rejects.toThrow(/reason/);
    for (const s of ["CONTACTS", "CARER_PREFERENCES", "CARE_PLAN", "RISKS", "VISITS"]) await decideSection(await manager(), intakeId, s, { decision: "APPROVED" });
    await decideSection(await manager(), intakeId, "PACKAGE", { decision: "INFO_REQUESTED", reason: "Confirm the package end date with the commissioner" });
    for (const s of ["PERSONAL", "MEDICATION", "INCIDENTS", "BODY_MAP"]) await decideSection(await secondManager(), intakeId, s, { decision: "APPROVED", reason: "Checked against the original letter" });
    const audit = await db.auditLog.findMany({ where: { entityType: "CareIntake", entityId: intakeId, action: "coordinator.section.decided" } });
    expect(audit.length).toBe(10);
    expect(new Set(audit.map((a) => a.actorId)).size).toBe(2);
  });

  it("a returned section goes back to the coordinator and comes back without touching approved sections", async () => {
    const end = (await factsOf("package.endDate"))[0]!;
    await decideFact(await coordinator(), end.id, null, { decision: "EDITED", value: "2026-12-30" });
    await submitIntake(await coordinator(), intakeId);
    const sections = await db.careIntakeSection.findMany({ where: { intakeId } });
    expect(sections.find((s) => s.section === "PACKAGE")!.status).toBe("OPEN");
    expect(sections.find((s) => s.section === "PERSONAL")!.status).toBe("APPROVED");
    await decideSection(await manager(), intakeId, "PACKAGE", { decision: "APPROVED" });
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("APPROVED");
  });
});

describe("4. Saving into the existing profile", () => {
  let suId = "";
  it("creates the person, contacts, preferences, package, drafts and templates, files the originals, and reads them back", async () => {
    // A conflicting package makes that section fail; the others still save and the failure is retryable.
    const results = await applyApproved(await manager(), intakeId);
    expect(results.find((r) => r.section === "PERSONAL")!.status).toBe("DONE");
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    suId = intake.serviceUserId!;
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    expect([su.firstName, su.lastName, su.town, su.status, su.carerGenderPreference, su.nhsNumber]).toEqual(["Ada", "Fictional", "London Borough of Example", "ASSESSMENT", "FEMALE", "9990000001"]);
    expect(results.every((r) => r.status === "DONE")).toBe(true);
    // The council client number goes to the encrypted register: unverified, leading zeroes kept, never in plain text.
    const refs = await db.serviceUserExternalReference.findMany({ where: { serviceUserId: suId } });
    expect(refs.map((r) => [r.type, r.verified, r.valueCipher.includes("007001")])).toEqual([["COUNCIL_CLIENT", false, false]]);
    expect((await referencesFor(await manager(), suId)).rows.map((r) => r.value)).toEqual(["007001"]);
    const contacts = await db.serviceUserContact.findMany({ where: { serviceUserId: suId } });
    expect(contacts.map((c) => c.kind).sort()).toEqual(["GP", "NEXT_OF_KIN", "SOCIAL_WORKER"]);
    expect(contacts.every((c) => !c.authorityType)).toBe(true);
    const pkg = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect([pkg.commissionedMinutesPerWeek, pkg.endDate?.toISOString().slice(0, 10)]).toEqual([1365, "2026-12-30"]);
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
    expect(plan.status).toBe("DRAFT");
    expect(plan.sections).toHaveLength(9);
    expect(plan.sections.find((s) => s.key === "mobility")!.body).toMatch(/frame[\s\S]*Source: Support plan, page 2/);
    expect(plan.sections.find((s) => s.key === "about_me")!.body).toMatch(/Not documented/);
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId } });
    expect(risks.map((r) => r.status)).toEqual(["DRAFT"]);
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
    expect(await applyApproved(await manager(), intakeId)).toEqual([]);
    const again = await applySection(await manager(), intakeId, "VISITS");
    expect(again.status).toBe("DONE");
    expect(await Promise.all([db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.serviceUserDocument.count({ where: { serviceUserId: suId } })])).toEqual(before);
  });

  it("recovers from a failed section: an existing intake with a clashing package fails, then succeeds once cleared", async () => {
    const m = await manager();
    const c = await coordinator();
    const upd = await createIntake(c, { title: "Package update", mode: "EXISTING", serviceUserId: suId });
    await addManualFact(c, upd.id, { destination: "package.startDate", value: addDays(londonDate(), 2) });
    await addManualFact(c, upd.id, { destination: "person.phone", value: "0200 000 0999" });
    const phone = await db.careIntakeFact.findFirstOrThrow({ where: { intakeId: upd.id, destination: "person.phone" } });
    expect(phone.conflict).toMatch(/record already says "0200 000 0101"/);
    await submitIntake(c, upd.id);
    await decideSection(m, upd.id, "PACKAGE", { decision: "APPROVED" });
    await decideSection(m, upd.id, "PERSONAL", { decision: "APPROVED" });
    const r = await applyApproved(c, upd.id);
    expect(r.find((x) => x.section === "PACKAGE")).toMatchObject({ status: "FAILED" });
    expect(r.find((x) => x.section === "PERSONAL")).toMatchObject({ status: "DONE" });
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
  it("blocks the rota until a different person approves the care plan and the risk drafts", async () => {
    const m = await manager();
    const c = await coordinator();
    const ready = await rotaReadiness(m, intakeId);
    expect(ready.ready).toBe(false);
    expect(ready.gates.filter((g) => !g.ok).map((g) => g.key).sort()).toEqual(["careplan", "risks"]);
    await expect(previewIntakeRota(m, intakeId, mondayOf(londonDate()), 1)).rejects.toThrow(/Not ready/);
    const suId = ready.serviceUser!.id;
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId, status: "DRAFT" } });
    // The manager saved the plan (applied the section), so the manager cannot approve it.
    await submitPlan(c, plan.id);
    await expect(approvePlan(m, plan.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approvePlan(await secondManager(), plan.id);
    const risk = await db.riskAssessment.findFirstOrThrow({ where: { serviceUserId: suId, status: "DRAFT" } });
    await expect(approveRiskDraft(m, risk.id, risk.version, { type: risk.type, title: risk.title, hazards: risk.hazards, controls: risk.controls, level: "MEDIUM", reviewDue: addDays(londonDate(), 30) })).rejects.toThrow(/different manager/);
    await approveRiskDraft(await secondManager(), risk.id, risk.version, { type: risk.type, title: risk.title, hazards: risk.hazards, controls: "Frame within reach. One carer nearby when standing.", level: "MEDIUM", reviewDue: addDays(londonDate(), 30) });
    expect((await rotaReadiness(m, intakeId)).ready).toBe(true);
  });

  it("only a manager activates care and creates unpublished visits through Build Rota, never twice", async () => {
    const m = await manager();
    await expect(activateCare(await coordinator(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    await activateCare(m, intakeId);
    const week = addDays(mondayOf(londonDate()), 7);
    const preview = await previewIntakeRota(m, intakeId, week, 2);
    expect(preview.totals.create).toBe(56); // 4 visits x 7 days x 2 weeks
    const made = await createIntakeRota(m, intakeId, { weekStart: week, weeks: 2, fingerprint: preview.fingerprint });
    expect(made.visits).toBe(56);
    expect(made.published).toBe(0);
    const suId = (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).serviceUserId!;
    const visits = await db.visit.findMany({ where: { serviceUserId: suId }, include: { tasks: true } });
    expect(visits.every((v) => v.publishedAt === null)).toBe(true);
    expect(visits.find((v) => v.tasks.length >= 4)).toBeTruthy();
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
    for (const a of ["coordinator.intake.created", "coordinator.document.uploaded", "coordinator.document.read", "coordinator.fact.decided", "coordinator.intake.submitted", "coordinator.section.decided", "coordinator.section.applied", "coordinator.documents.filed", "coordinator.care.activated", "coordinator.rota.created"]) expect(actions).toContain(a);
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
    await expect(decideSection(await otherOrg(), intakeId, "PERSONAL", { decision: "APPROVED" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops a likely duplicate person unless the coordinator confirms they are someone else", async () => {
    const c = await coordinator();
    const dup = await createIntake(c, { title: "Same person again" });
    await addManualFact(c, dup.id, { destination: "person.firstName", value: "Ada" });
    await addManualFact(c, dup.id, { destination: "person.lastName", value: "Fictional" });
    await expect(submitIntake(c, dup.id)).rejects.toThrow(/already on record/);
    await submitIntake(c, dup.id, { notADuplicate: true });
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: dup.id } })).notDuplicateById).toBeTruthy();
  });
});
