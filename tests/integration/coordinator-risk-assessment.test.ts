import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { readingToFacts } from "@/lib/care-coordinator-rules";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { queueIntakeReads, runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { reviewRisk } from "@/server/care/risks";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { longPlanPdf, longPlanReading } from "../support/long-support-plan";
import { riskAssessmentPdf, riskAssessmentReading } from "../support/risk-assessment-fixture";

/**
 * A council risk assessment uploaded with (or after) the support plan must load its risks into the person's Risk
 * Assessments tab. Before this fix none of them did: short hazard cells ("Falls") were dropped while reading, and a risk
 * that the plan also mentioned was consolidated into the plan's narrative version, losing the stated level and controls.
 * Fictional documents only.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const provider: LlmProvider = Object.assign(new SimulatedProvider(), {
  name: "test-reader",
  isSimulated: false,
  extractCareDocument: async (i: { filename: string }) => (/risk/i.test(i.filename) ? riskAssessmentReading() : longPlanReading()),
});

async function fresh() {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
  setAiProviderForTests(provider);
}
afterAll(() => setAiProviderForTests(new SimulatedProvider()));

async function upload(title: string, files: { name: string; bytes: Buffer }[], mode: "NEW" | "DOCUMENT" = "NEW", serviceUserId?: string) {
  const c = await coordinator();
  const intake = await createIntake(c, { title, mode, serviceUserId });
  const r = await addDocuments(c, intake.id, files.map((f) => ({ ...f, type: "application/pdf" })), { read: "later" });
  await queueIntakeReads(c, r.toRead, { prepare: true });
  const out = await runQueuedReads("test", 5);
  expect(out.every((o) => o.outcome === "succeeded")).toBe(true);
  return db.careIntake.findUniqueOrThrow({ where: { id: intake.id } });
}
const risksOf = (serviceUserId: string) => db.riskAssessment.findMany({ where: { serviceUserId }, orderBy: { title: "asc" } });

describe("reading a risk assessment form", () => {
  it("keeps rows whose hazard is a single word instead of dropping them", () => {
    const facts = readingToFacts(riskAssessmentReading()).filter((f) => f.section === "RISKS");
    expect(facts.map((f) => f.label)).toEqual(["Falls", "Stairs", "Fire", "Transfers with a stand aid"]);
    const falls = facts[0]!.value as { hazard: string; level: string; levelIsProvisional: boolean };
    expect([falls.hazard, falls.level, falls.levelIsProvisional]).toEqual(["Hazard named in the document: Falls", "HIGH", false]);
  });
});

describe("support plan and risk assessment uploaded together", () => {
  let suId = "";
  beforeAll(fresh, 180_000);

  it("sets the person up and loads every risk from the risk assessment", async () => {
    const intake = await upload("Plan and risk assessment", [
      { name: "Support plan.pdf", bytes: await longPlanPdf() },
      { name: "Risk assessment.pdf", bytes: await riskAssessmentPdf() },
    ]);
    expect(intake.setupStatus).not.toBe("FAILED");
    suId = intake.serviceUserId!;
    const risks = await risksOf(suId);
    // 4 from the risk assessment (2 of them also in the plan) + 4 only in the plan.
    expect(risks.map((r) => r.title)).toEqual(["Clutter and trip hazards", "Falls", "Fire", "Fragile skin on heels", "Mixing up tablets", "Self-neglect: eating and drinking", "Stairs", "Transfers with a stand aid"]);
    expect(risks.every((r) => r.status === "ACTIVE" && r.sourceIntakeId === intake.id)).toBe(true);
  }, 120_000);

  it("saves the risk assessment's level and controls, not the plan's narrative, for a risk in both", async () => {
    const falls = (await risksOf(suId)).find((r) => r.title === "Falls")!;
    expect([falls.level, falls.origin]).toEqual(["HIGH", "DOCUMENT"]);
    expect(falls.controls).toBe("Walking frame within reach at all times; carer stays beside Charles when he stands.");
    expect(falls.sourceNote).toMatch(/Risk assessment, page 1/);
    // The plan's words about the same risk are kept with it, with their source.
    expect(falls.hazards).toMatch(/Also in Support plan, page 3: Unsteady when tired/);
    const transfers = (await risksOf(suId)).find((r) => r.title === "Transfers with a stand aid")!;
    expect([transfers.level, transfers.origin, transfers.controls]).toEqual(["MEDIUM", "DOCUMENT", "Two trained carers for every transfer; stand aid serviced every six months."]);
    expect(await db.riskAssessment.count({ where: { serviceUserId: suId, title: "Falls" } })).toBe(1);
  });

  it("keeps short controls as written and labels plan-only risks as AI-generated", async () => {
    const risks = await risksOf(suId);
    const stairs = risks.find((r) => r.title === "Stairs")!;
    expect([stairs.level, stairs.origin, stairs.controls]).toEqual(["MEDIUM", "DOCUMENT", "Controls in the document: Rail"]);
    expect(risks.find((r) => r.title === "Fire")!.level).toBe("HIGH");
    expect(risks.find((r) => r.title === "Clutter and trip hazards")!.origin).toBe("AI_INFERRED");
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: suId } })).riskLevel).toBe("HIGH");
  });
});

describe("risk assessment added later as a supporting document", () => {
  let suId = "";
  beforeAll(fresh, 180_000);

  it("updates what CSB AI wrote from the plan, adds new risks and changes nothing else", async () => {
    const first = await upload("Plan only", [{ name: "Support plan.pdf", bytes: await longPlanPdf() }]);
    suId = first.serviceUserId!;
    const before = await risksOf(suId);
    expect(before).toHaveLength(6);
    // A manager reviews the transfers assessment: a person's review is never overwritten by a document.
    const transfers = before.find((r) => r.title === "Transfers with a stand aid")!;
    await reviewRisk(await manager(), transfers.id, transfers.version, { type: "MOVING_HANDLING", title: transfers.title, hazards: transfers.hazards, controls: "Two carers; reviewed by the manager on the first visit.", level: "LOW", reviewDue: "2027-01-15" });
    const contacts = await db.serviceUserContact.count({ where: { serviceUserId: suId } });

    const doc = await upload("Council risk assessment", [{ name: "Risk assessment.pdf", bytes: await riskAssessmentPdf() }], "DOCUMENT", suId);
    expect(doc.setupStatus).not.toBe("FAILED");
    const after = await risksOf(suId);
    expect(after.map((r) => r.title)).toEqual(["Clutter and trip hazards", "Falls", "Fire", "Fragile skin on heels", "Mixing up tablets", "Self-neglect: eating and drinking", "Stairs", "Transfers with a stand aid"]);
    const falls = after.find((r) => r.title === "Falls")!;
    expect([falls.level, falls.origin, falls.version, falls.sourceIntakeId]).toEqual(["HIGH", "DOCUMENT", 2, doc.id]);
    // The plan's version stays readable as version 1.
    const v1 = await db.riskAssessmentVersion.findFirstOrThrow({ where: { riskAssessmentId: falls.id, version: 1 } });
    expect([v1.level, v1.controls]).toEqual(["MEDIUM", "Walking frame"]);
    const t = after.find((r) => r.title === "Transfers with a stand aid")!;
    expect([t.level, t.controls]).toEqual(["LOW", "Two carers; reviewed by the manager on the first visit."]);
    expect(after.find((r) => r.title === "Fire")!.origin).toBe("DOCUMENT");
    // A supporting document changes no other record.
    expect(await db.serviceUserContact.count({ where: { serviceUserId: suId } })).toBe(contacts);
    expect(await db.auditLog.count({ where: { entityType: "RiskAssessment", entityId: falls.id, action: "risk.imported" } })).toBe(2);
  }, 180_000);
});
