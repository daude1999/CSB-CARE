import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { isMedicationTask } from "@/server/care/coordinator/visit-tasks";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { confirmAndSetUp } from "@/server/care/coordinator/prepare";
import { correctDraftVisit, draftSummary, prepareDrafts, prepareReportText } from "@/server/care/coordinator/prepare";
import { activateCare, rotaReadiness } from "@/server/care/coordinator/rota";
import { executeTool, type ToolState } from "@/server/care/coordinator/agent-tools";
import { publishBuild } from "@/server/rota/build";
import { bulkVisits } from "@/server/rota/visits";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { scannedPlanPdf, supportPlanPdf } from "../support/coordinator-fixture";
import type { LlmProvider } from "@/server/ai/provider";
import type { CareDocumentExtraction } from "@/server/ai/schemas";

/**
 * AI CSB Coordinator phases 3 to 6: one upload fills the person's real records as drafts and proposes a rota, without
 * activating care, publishing visits or telling carers. Synthetic documents only; every name and number is invented.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const newState = (userQuestion?: string): ToolState => ({ calls: [], wrote: [], links: [], page: { kind: "intake", id: null }, userQuestion });

let orgId = "";
let plan: Buffer;
let intakeId = "";
let suId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  plan = await supportPlanPdf();
}, 180_000);

describe("1. One upload fills the CRM as drafts", () => {
  it("creates the person at Assessment, contacts, package, care plan and risk drafts, templates and an unpublished proposed rota", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Prepared drafts check" });
    intakeId = intake.id;
    await addDocuments(c, intakeId, [{ name: "Support plan.pdf", type: "application/pdf", bytes: plan }]);
    const startedAt = new Date();
    const r = await prepareDrafts(c, intakeId);
    expect(r.blocked).toBeNull();
    expect(r.serviceUserId).toBeTruthy();
    suId = r.serviceUserId!;
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    expect([su.firstName, su.lastName, su.status]).toEqual(["Ada", "Fictional", "ASSESSMENT"]);
    expect(r.sections.filter((s) => s.status === "DRAFTED").map((s) => s.section)).toEqual(expect.arrayContaining(["PERSONAL", "CONTACTS", "PACKAGE", "CARE_PLAN", "RISKS", "VISITS"]));
    expect(await db.serviceUserContact.count({ where: { serviceUserId: suId } })).toBe(3);
    expect(await db.carePackage.count({ where: { serviceUserId: suId } })).toBe(1);
    const carePlan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect(carePlan.status).toBe("DRAFT");
    const risks = await db.riskAssessment.findMany({ where: { serviceUserId: suId } });
    expect(risks.map((x) => x.status)).toEqual(["DRAFT"]);
    expect(risks[0]!.hazards).toMatch(/NO RISK LEVEL IS STATED/);
    // Four commissioned visits a day; the two family rows are never scheduled.
    expect(await db.visitTemplate.count({ where: { serviceUserId: suId } })).toBe(4);
    // Each visit has short carer tasks, and no medication task reaches carers from a document.
    const taskNames = (await db.templateTask.findMany({ where: { template: { serviceUserId: suId } }, select: { careTask: { select: { name: true } } } })).map((x) => x.careTask.name);
    expect(taskNames.length).toBeGreaterThan(0);
    expect(taskNames.every((n) => n.length <= 80 && !isMedicationTask(n))).toBe(true);
    // A proposed rota while the person is still at Assessment: unpublished, and nobody was told.
    expect(r.rota?.visits).toBeGreaterThan(0);
    const visits = await db.visit.findMany({ where: { serviceUserId: suId } });
    expect(visits.length).toBe(r.rota!.visits);
    expect(visits.every((v) => v.publishedAt === null && v.status === "SCHEDULED")).toBe(true);
    // No carer hears about it: nothing about the rota, and nothing to anyone linked to a staff record.
    const told = (await db.notification.findMany({ where: { organisationId: orgId, createdAt: { gte: startedAt } }, select: { type: true, userId: true, title: true, body: true, actionUrl: true } })).filter((n) => /Ada|Fictional/.test(`${n.title} ${n.body}`) || (n.actionUrl ?? "").includes(suId));
    expect(told.filter((n) => n.type.startsWith("rota"))).toEqual([]);
    const carerUsers = new Set((await db.staffMember.findMany({ where: { organisationId: orgId, userId: { not: null } }, select: { userId: true } })).map((x) => x.userId));
    expect(told.filter((n) => carerUsers.has(n.userId))).toEqual([]);
    // Restricted facts (medication) stay for a manager; the report counts them from the database.
    const text = prepareReportText(r);
    expect(text).toMatch(/Draft rota: \d+ proposed visits over 2 weeks/);
    expect(text).toMatch(/Carers are not told/);
    const sections = await db.careIntakeSection.findMany({ where: { intakeId } });
    expect(sections.find((s) => s.section === "MEDICATION")!.status).toBe("OPEN");
    expect(sections.find((s) => s.section === "VISITS")!.status).toBe("DRAFTED");
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("DRAFT");
  }, 120_000);

  it("keeps a second copy of the same PDF only once", async () => {
    const r = await addDocuments(await coordinator(), intakeId, [{ name: "Support plan again.pdf", type: "application/pdf", bytes: plan }]);
    expect([r.documents, r.duplicates]).toEqual([0, ["Support plan again.pdf"]]);
    expect(await db.careIntakeDocument.count({ where: { intakeId } })).toBe(1);
  });

  it("is safe to run again: nothing is created twice", async () => {
    const counts = async () => [await db.serviceUser.count({ where: { firstName: "Ada", lastName: "Fictional" } }), await db.serviceUserContact.count({ where: { serviceUserId: suId } }), await db.carePlan.count({ where: { serviceUserId: suId } }), await db.riskAssessment.count({ where: { serviceUserId: suId } }), await db.visitTemplate.count({ where: { serviceUserId: suId } }), await db.visit.count({ where: { serviceUserId: suId } })];
    const before = await counts();
    const r = await prepareDrafts(await coordinator(), intakeId);
    expect(r.sections.filter((s) => s.status === "DRAFTED")).toHaveLength(0);
    expect(r.rota?.visits).toBe(0);
    expect(await counts()).toEqual(before);
  }, 60_000);

  it("never publishes a proposed visit or activates care without the usual checks", async () => {
    const m = await manager();
    const build = await db.rotaBuild.findFirstOrThrow({ where: { serviceUserId: suId, status: "BUILT" } });
    await expect(publishBuild(m, build.id)).rejects.toThrow(/Activate care first/);
    const v = await db.visit.findFirstOrThrow({ where: { serviceUserId: suId } });
    const bulk = await bulkVisits(m, [v.id], { kind: "publish" });
    expect(JSON.stringify(bulk)).toMatch(/proposal|Activate care/);
    expect(await db.visit.count({ where: { serviceUserId: suId, publishedAt: { not: null } } })).toBe(0);
    const ready = await rotaReadiness(m, intakeId);
    expect(ready.ready).toBe(false);
    expect(ready.gates.find((g) => g.key === "careplan")!.ok).toBe(false);
    await expect(activateCare(m, intakeId)).rejects.toBeInstanceOf(ValidationError);
  });

  it("shows what was prepared, read from the database", async () => {
    const s = await draftSummary(await coordinator(), intakeId);
    expect(s.serviceUser?.status).toBe("ASSESSMENT");
    expect(s.templates?.length).toBe(4);
    expect(s.proposedVisits?.length).toBeGreaterThan(0);
  });
});

describe("2. Corrections, identity and access", () => {
  it("corrects a prepared visit's start time and moves its proposed visits", async () => {
    const t = await db.visitTemplate.findFirstOrThrow({ where: { serviceUserId: suId, startMinute: 990 } });
    const r = await correctDraftVisit(await coordinator(), t.id, { startTime: "17:00" });
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } })).startMinute).toBe(1020);
    const moved = await db.visit.findMany({ where: { templateId: t.id } });
    expect(r.proposedVisitsMoved).toBe(moved.length);
    expect(moved.every((v) => v.publishedAt === null)).toBe(true);
  }, 60_000);

  it("does the same through the chat tools, with real counts", async () => {
    const state = newState();
    const out = await executeTool(await coordinator(), state, "get_prepared_records", { intakeId });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content).templates).toHaveLength(4);
    const refused = await executeTool(await coordinator(), newState("what is missing?"), "prepare_records", { intakeId, notADuplicate: false });
    expect(refused.isError).toBe(true);
    const again = await executeTool(await coordinator(), newState("please prepare the records"), "prepare_records", { intakeId, notADuplicate: false });
    // Nothing is duplicated. (A visit the earlier correction moved from a time already passed today to one still
    // ahead may be proposed now, so the count is not always zero.)
    const proposed = await db.visit.findMany({ where: { serviceUserId: suId }, select: { templateId: true, date: true } });
    expect(new Set(proposed.map((v) => `${v.templateId}|${v.date.toISOString()}`)).size).toBe(proposed.length);
    expect(JSON.parse(again.content).draftRota.visits).toBeLessThanOrEqual(1);
    const t = await db.visitTemplate.findFirstOrThrow({ where: { serviceUserId: suId, startMinute: 540 } });
    const guessed = await executeTool(await coordinator(), newState("fix the morning visit"), "correct_draft_visit", { templateId: t.id, startTime: "09:30", durationMin: null });
    expect(guessed.isError).toBe(true);
    const fixed = await executeTool(await coordinator(), newState("Update the draft: the morning visit starts at 09:30"), "correct_draft_visit", { templateId: t.id, startTime: "09:30", durationMin: null });
    expect(fixed.isError).toBe(false);
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } })).startMinute).toBe(570);
  }, 60_000);

  it("stops before creating a second person who looks like someone on record", async () => {
    const c = await coordinator();
    const dup = await createIntake(c, { title: "Second referral, same person" });
    await addDocuments(c, dup.id, [{ name: "Support plan copy.pdf", type: "application/pdf", bytes: plan }]);
    const r = await prepareDrafts(c, dup.id);
    expect(r.blocked).toMatch(/already on record/);
    expect(r.serviceUserId).toBeNull();
    expect(await db.serviceUser.count({ where: { firstName: "Ada", lastName: "Fictional" } })).toBe(1);
    expect(await db.careIntakeFact.count({ where: { intakeId: dup.id, decision: "APPROVED" } })).toBe(0);
  }, 60_000);

  it("keeps intakes inside their organisation and away from carers", async () => {
    await expect(prepareDrafts(await otherOrg(), intakeId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prepareDrafts(await carer(), intakeId)).rejects.toBeInstanceOf(ForbiddenError);
    const t = await db.visitTemplate.findFirstOrThrow({ where: { serviceUserId: suId } });
    await expect(correctDraftVisit(await otherOrg(), t.id, { startTime: "10:00" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the coordinator confirms the drafted intake once; open restricted facts stay listed and nothing is repeated", async () => {
    const c = await coordinator();
    const before = await Promise.all([db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.carePackage.count({ where: { serviceUserId: suId } })]);
    const r = await confirmAndSetUp(c, intakeId);
    // The drafted sections are now approved under the coordinator's name; nothing was saved twice.
    expect(r.save.approved).toEqual(expect.arrayContaining(["PERSONAL", "VISITS"]));
    expect(r.save.sections.filter((s) => s.status === "FAILED")).toEqual([]);
    expect(await Promise.all([db.serviceUserContact.count({ where: { serviceUserId: suId } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.carePackage.count({ where: { serviceUserId: suId } })])).toEqual(before);
    // Medication and other restricted facts are still open: listed, not saved, and the intake is not Completed.
    expect(r.attention.facts).toBeGreaterThan(0);
    expect(r.save.completed).toBe(false);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("DRAFT");
  });

  it("refuses a time correction once care is active", async () => {
    await db.serviceUser.update({ where: { id: suId }, data: { status: "ACTIVE" } });
    const t = await db.visitTemplate.findFirstOrThrow({ where: { serviceUserId: suId } });
    await expect(correctDraftVisit(await coordinator(), t.id, { startTime: "10:00" })).rejects.toBeInstanceOf(ConflictError);
    await db.serviceUser.update({ where: { id: suId }, data: { status: "ASSESSMENT" } });
  });
});

describe("3. Scanned council plans (no text layer)", () => {
  it("drafts what the AI read from the page images, labelled as not checked word for word", async () => {
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const at = (page: number, quote: string) => ({ page, quote, temporal: "CURRENT" as const });
    const ai: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-reader", isSimulated: false,
      async extractCareDocument(): Promise<CareDocumentExtraction> {
        return {
          document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: null, pageCount: 2 },
          person: [{ field: "firstName", value: "Cara", ...at(1, "First name(s) Cara") }, { field: "lastName", value: "Specimen", ...at(1, "Surname Specimen") }],
          references: [], contacts: [], carerPreferences: [],
          carePlan: [{ section: "mobility", topic: "MOBILITY_TRANSFERS", canDo: null, support: "Walks with a stick", how: null, preferences: null, outcome: null, clarify: null, ...at(2, "Walking stick") }],
          risks: [], package: [],
          visits: [{ label: "Morning", weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "08:30", durationMinutes: 45, carers: 1, tasks: ["Personal care"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(2, "Morning 08:30 45 minutes") }],
          medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [],
        };
      },
    });
    setAiProviderForTests(ai);
    try {
      const c = await coordinator();
      const intake = await createIntake(c, { title: "Scanned plan check" });
      await addDocuments(c, intake.id, [{ name: "Scanned plan.pdf", type: "application/pdf", bytes: await scannedPlanPdf() }]);
      const facts = await db.careIntakeFact.findMany({ where: { intakeId: intake.id } });
      expect(facts.length).toBe(4);
      expect(facts.every((f) => f.verification === "UNVERIFIED" && /is scanned/.test(f.conflict ?? ""))).toBe(true);
      const r = await prepareDrafts(c, intake.id);
      expect(r.blocked).toBeNull();
      const su = await db.serviceUser.findUniqueOrThrow({ where: { id: r.serviceUserId! } });
      expect([su.firstName, su.lastName, su.status]).toEqual(["Cara", "Specimen", "ASSESSMENT"]);
      const decided = await db.careIntakeFact.findMany({ where: { intakeId: intake.id } });
      expect(decided.every((f) => f.decision === "APPROVED" && /scanned page/.test(f.decisionNote ?? "") && f.verification === "UNVERIFIED")).toBe(true);
      expect(await db.visitTemplate.count({ where: { serviceUserId: su.id } })).toBe(1);
      expect(r.rota?.visits).toBeGreaterThan(0);
    } finally {
      setAiProviderForTests(new SimulatedProvider());
      await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    }
  }, 120_000);
});

describe("Option C: a supporting document for someone already on record", () => {
  it("files the document in the person's records and changes nothing else", async () => {
    const c = await coordinator();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    await expect(createIntake(c, { title: "Letter without a person", mode: "DOCUMENT" })).rejects.toThrow(/Choose the person the document is for/);
    const intake = await createIntake(c, { title: "GP letter for an existing person", mode: "DOCUMENT", serviceUserId: su.id });
    expect(intake.serviceUserId).toBe(su.id);
    await addDocuments(c, intake.id, [{ name: "GP letter.pdf", type: "application/pdf", bytes: plan }]);
    const counts = async () => [await db.serviceUserContact.count({ where: { serviceUserId: su.id } }), await db.carePackage.count({ where: { serviceUserId: su.id } }), await db.carePlan.count({ where: { serviceUserId: su.id } }), await db.riskAssessment.count({ where: { serviceUserId: su.id } }), await db.visitTemplate.count({ where: { serviceUserId: su.id } }), await db.visit.count({ where: { serviceUserId: su.id } })];
    const before = await counts();
    const docsBefore = await db.serviceUserDocument.count({ where: { serviceUserId: su.id } });
    const r = await prepareDrafts(c, intake.id);
    expect(r.blocked).toBeNull();
    expect(r.filed).toBe(1);
    expect(r.sections).toEqual([]);
    expect(r.rota).toBeNull();
    expect(prepareReportText(r)).toMatch(/Supporting document: 1 filed/);
    expect(await counts()).toEqual(before);
    expect(await db.serviceUserDocument.count({ where: { serviceUserId: su.id } })).toBe(docsBefore + 1);
    // No fact was accepted automatically: they wait for a person.
    expect(await db.careIntakeFact.count({ where: { intakeId: intake.id, decision: "APPROVED" } })).toBe(0);
    // Running it again files nothing twice.
    expect((await prepareDrafts(c, intake.id)).filed).toBe(0);
    expect(await db.serviceUserDocument.count({ where: { serviceUserId: su.id } })).toBe(docsBefore + 1);
  });
});

describe("Revised plan for someone already on record", () => {
  it("compares every detail with the record, accepts only routine ones, and changes nothing by itself", async () => {
    const { revisionSummary, acceptRoutineChanges } = await import("@/server/care/coordinator/compare");
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Revised plan check", mode: "EXISTING", serviceUserId: suId });
    await addDocuments(c, intake.id, [{ name: "Revised support plan.pdf", type: "application/pdf", bytes: plan }]);
    const templatesBefore = await db.visitTemplate.findMany({ where: { serviceUserId: suId }, orderBy: { id: "asc" } });
    const s = (await revisionSummary(c, intake.id))!;
    expect(s.rows.length).toBeGreaterThan(0);
    // The same plan again: the person's name and the visits nobody moved match the record. Two visits were moved by
    // hand in the tests above, so the plan's original times read as new and the moved visits as no longer in it.
    expect(s.rows.find((r) => r.label.toLowerCase().includes("first name"))?.status).toBe("UNCHANGED");
    expect(s.counts.UNCHANGED).toBeGreaterThan(0);
    expect(s.counts.REMOVED_SUPERSEDED).toBe(2);
    expect(s.rows.filter((r) => r.status === "REMOVED_SUPERSEDED").map((r) => r.label).sort()).toEqual(["Repeating visit at 09:30", "Repeating visit at 17:00"]);
    expect(s.routine).toBeGreaterThan(0);
    const r = await acceptRoutineChanges(c, intake.id);
    expect(r.accepted).toBe(s.routine);
    // Only routine facts were accepted; care, risk and medication facts still wait for a person.
    const accepted = await db.careIntakeFact.findMany({ where: { intakeId: intake.id, decision: "APPROVED" }, select: { section: true } });
    expect(accepted.every((f) => !["CARE_PLAN", "RISKS", "MEDICATION", "INCIDENTS", "BODY_MAP"].includes(f.section))).toBe(true);
    expect(await db.careIntakeFact.count({ where: { intakeId: intake.id, section: { in: ["CARE_PLAN", "RISKS", "MEDICATION"] }, decision: "APPROVED" } })).toBe(0);
    expect(await db.visitTemplate.findMany({ where: { serviceUserId: suId }, orderBy: { id: "asc" } })).toEqual(templatesBefore);
    // Not available for a new person's intake.
    await expect(acceptRoutineChanges(c, intakeId)).rejects.toThrow(/updated plan/);
    expect(await revisionSummary(c, intakeId)).toBeNull();
  });
});
