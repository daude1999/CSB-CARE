import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { addDocuments, approveVerified, createIntake, decideFact, getIntake, readingMode } from "@/server/care/coordinator/intake";
import { approveAndSave } from "@/server/care/coordinator/apply";
import { activateCare, createIntakeRota, previewIntakeRota, rotaReadiness } from "@/server/care/coordinator/rota";
import { approvePlan, submitPlan } from "@/server/care/care-plans";
import { approveRiskDraft } from "@/server/care/risks";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanCardsPdf } from "../support/coordinator-fixture";

/**
 * P0 acceptance for the no-API Care Coordinator (AI_PROVIDER=none): a fictional council support plan in the
 * "headings and visit cards" layout goes upload → read on our own server → coordinator check → manager approval →
 * saved records → care plan and risk approved by someone else → unpublished draft rota. No AI provider exists at all.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const secondManager = () => ctxFor("reviewer@care-solution.demo", BROOKFIELD);

let intakeId = "";
let suId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(null); // the no-API configuration: no provider at all
  const orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const reviewer = await db.user.findUniqueOrThrow({ where: { email: "reviewer@care-solution.demo" } });
  await db.membership.update({ where: { userId_organisationId: { userId: reviewer.id, organisationId: orgId } }, data: { roles: { push: "CARE_MANAGER" } } });
}, 180_000);

const facts = (dest: string) => db.careIntakeFact.findMany({ where: { intakeId, destination: dest }, orderBy: { position: "asc" } });
type V = { startTime: string; durationMin: number; fundedBy: string; carers: number };

describe("No-API Care Coordinator: card-layout council support plan", () => {
  it("says plainly that no AI is used", () => {
    expect(readingMode(true).ai).toBe(false);
    expect(readingMode(false).label).toMatch(/not sent anywhere/);
  });

  it("reads every page on CSB's own server with page references and nothing invented", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Fictional card-layout plan" });
    intakeId = intake.id;
    await addDocuments(c, intakeId, [{ name: "Support plan (cards).pdf", type: "application/pdf", bytes: await supportPlanCardsPdf() }]);
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId } });
    expect([doc.category, doc.pageCount, doc.readStatus]).toEqual(["COUNCIL_SUPPORT_PLAN", 4, "READ"]);
    expect(doc.readNote).toMatch(/no AI/);

    const visits = await facts("visit");
    expect(visits.map((v) => [(v.value as V).startTime, (v.value as V).durationMin, v.sourcePage, (v.value as V).fundedBy])).toEqual([
      ["09:00", 60, 3, "COUNCIL"], ["12:00", 45, 3, "COUNCIL"], ["11:00", 60, 3, "CARERS_SERVICE"], ["16:30", 30, 4, "COUNCIL"], ["20:00", 60, 4, "COUNCIL"],
    ]);
    // Every quote is the exact text of its page.
    expect(visits.every((v) => v.verification === "VERIFIED")).toBe(true);
    expect((await facts("package.minutesPerWeek"))[0]!.value).toBe(1365);
    expect(await db.careIntakeFact.count({ where: { intakeId, destination: "package.endDate" } })).toBe(0); // not in the document, not invented
    const plan = await db.careIntakeFact.findMany({ where: { intakeId, section: "CARE_PLAN" } });
    expect(new Set(plan.map((p) => p.destination)).size).toBe(9);
    expect(plan.every((p) => p.sourcePage === 2)).toBe(true);
    const refs = await facts("externalReference");
    expect(refs.map((r) => (r.value as { type: string; value: string }))).toEqual([expect.objectContaining({ type: "COUNCIL_CLIENT", value: "1088676" })]);
    const risks = await facts("risk");
    expect(risks).toHaveLength(1);
    expect((risks[0]!.value as { level: string | null }).level).toBeNull();
    const view = await getIntake(await manager(), intakeId);
    expect(view.reconciliation.authorised).toBeNull();
  });

  it("needs a coordinator check and a level set by a person for the risk; no manager approval", async () => {
    const c = await coordinator();
    for (const s of ["PERSONAL", "CARE_PLAN", "PACKAGE", "VISITS", "RISKS"]) await approveVerified(c, intakeId, s);
    const risk = (await facts("risk"))[0]!;
    expect(risk.decision).toBe("PENDING"); // never approved without a level
    await decideFact(c, risk.id, null, { decision: "EDITED", value: { ...(risk.value as object), level: "MEDIUM", levelIsProvisional: true } });
    // Restricted facts (date of birth) are decided by a manager with sensitive-records access.
    for (const f of await db.careIntakeFact.findMany({ where: { intakeId, decision: "PENDING" } })) await decideFact(await secondManager(), f.id, null, { decision: "APPROVED", note: "Checked against the original" });
    const withFacts = new Set((await db.careIntakeFact.findMany({ where: { intakeId, decision: { in: ["APPROVED", "EDITED"] } }, select: { section: true } })).map((f) => f.section));
    expect([...withFacts].sort()).toEqual(["CARE_PLAN", "PACKAGE", "PERSONAL", "RISKS", "VISITS"]);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("DRAFT");
  });

  it("saves four templates, the package and drafts; the family visit is not scheduled; a retry creates nothing", async () => {
    const results = (await approveAndSave(await coordinator(), intakeId)).sections;
    expect(results.every((r) => r.status === "SAVED")).toBe(true);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("COMPLETED");
    suId = (await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).serviceUserId!;
    const templates = await db.visitTemplate.findMany({ where: { serviceUserId: suId }, orderBy: { startMinute: "asc" } });
    expect(templates.map((t) => [t.startMinute, t.durationMin, t.carersRequired, t.weekdays.length])).toEqual([[540, 60, 1, 7], [720, 45, 1, 7], [990, 30, 1, 7], [1200, 60, 1, 7]]);
    const pkg = await db.carePackage.findFirstOrThrow({ where: { serviceUserId: suId } });
    expect([pkg.commissionedMinutesPerWeek, pkg.endDate]).toEqual([1365, null]);
    expect(await db.careIntakeReviewItem.count({ where: { serviceUserId: suId, category: "PACKAGE_HOURS" } })).toBe(0);
    expect(await db.careIntakeReviewItem.count({ where: { serviceUserId: suId, category: "MISSING_INFO" } })).toBe(1); // the family shopping visit
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId }, include: { sections: true } });
    expect([plan.status, plan.sections.length]).toEqual(["DRAFT", 9]);
    expect(plan.sections.every((s) => !/Not documented/.test(s.body))).toBe(true);
    expect((await db.riskAssessment.findMany({ where: { serviceUserId: suId } })).map((r) => r.status)).toEqual(["DRAFT"]);
    expect(await db.visit.count({ where: { serviceUserId: suId } })).toBe(0); // nothing on the rota yet

    const counts = () => Promise.all([db.serviceUser.count({ where: { firstName: "Bea", lastName: "Example" } }), db.visitTemplate.count({ where: { serviceUserId: suId } }), db.carePackage.count({ where: { serviceUserId: suId } }), db.serviceUserDocument.count({ where: { serviceUserId: suId } }), db.serviceUserExternalReference.count({ where: { serviceUserId: suId } })]);
    const before = await counts();
    expect(before).toEqual([1, 4, 1, 1, 1]);
    expect((await approveAndSave(await coordinator(), intakeId)).sections.every((r) => r.status === "ALREADY_SAVED")).toBe(true);
    expect(await counts()).toEqual(before);
  });

  it("prepares an unpublished rota only after a different person approves the plan and the risk", async () => {
    const m = await manager();
    expect((await rotaReadiness(m, intakeId)).ready).toBe(false);
    const plan = await db.carePlan.findFirstOrThrow({ where: { serviceUserId: suId, status: "DRAFT" } });
    await submitPlan(await coordinator(), plan.id);
    await approvePlan(await secondManager(), plan.id);
    const risk = await db.riskAssessment.findFirstOrThrow({ where: { serviceUserId: suId, status: "DRAFT" } });
    await approveRiskDraft(await secondManager(), risk.id, risk.version, { type: risk.type, title: risk.title, hazards: risk.hazards, controls: "Frame within reach.", level: "MEDIUM", reviewDue: addDays(londonDate(), 30) });
    expect((await rotaReadiness(m, intakeId)).ready).toBe(true);
    await activateCare(m, intakeId);
    const week = addDays(mondayOf(londonDate()), 14);
    const preview = await previewIntakeRota(m, intakeId, week, 1);
    expect(preview.totals.create).toBe(28);
    const made = await createIntakeRota(m, intakeId, { weekStart: week, weeks: 1, fingerprint: preview.fingerprint });
    expect([made.visits, made.published]).toEqual([28, 0]);
    const visits = await db.visit.findMany({ where: { serviceUserId: suId } });
    expect(visits.reduce((n, v) => n + (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000, 0)).toBe(1365);
    expect(visits.every((v) => v.publishedAt === null)).toBe(true);
    const again = await previewIntakeRota(m, intakeId, week, 1);
    expect(again.totals.create).toBe(0);
  });
});
