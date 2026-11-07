import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { AiUnavailableError, type LlmProvider } from "@/server/ai/provider";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { queueDocumentRead, queueIntakeReads, readProgress, READ_JOB, runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { uploadFromChat } from "@/server/care/coordinator/chat-upload";
import { runJobsNow } from "@/server/jobs/inline";
import { storage } from "@/server/storage";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanPdf } from "../support/coordinator-fixture";

/**
 * Background reading (owner's brief of 6 Nov 2026, 17:21): an upload only stores the original and records a durable
 * job; the job reads, saves the facts and prepares the drafts and proposed rota, with its stage on the document. A
 * failed run is retried from where it stopped; "Read again" reuses the stored original; nothing is created twice.
 * Synthetic documents only; every name and number is invented.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

let plan: Buffer;
let orgId = "";
let intakeId = "";
let docId = "";
const people = () => db.serviceUser.count({ where: { firstName: "Ada", lastName: "Fictional" } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  plan = await supportPlanPdf();
}, 180_000);

describe("upload, queue and read in the background", () => {
  it("stores the original and returns at once, with a saved job and nothing read yet", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Background reading check" });
    intakeId = intake.id;
    const r = await addDocuments(c, intakeId, [{ name: "Support plan.pdf", type: "application/pdf", bytes: plan }], { read: "later" });
    expect(r.toRead).toHaveLength(1);
    expect(r.results).toEqual([]);
    docId = r.toRead[0]!;
    const [q] = await queueIntakeReads(c, r.toRead, { prepare: true });
    const doc = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.readStage).toBe("QUEUED");
    expect(doc.readJobId).toBe(q!.jobId);
    expect(doc.storageKey).toBeTruthy();
    expect(await db.careIntakeFact.count({ where: { intakeId } })).toBe(0);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: q!.jobId } })).status).toBe("QUEUED");
    expect((await readProgress(c, intakeId)).busy).toBe(true);
  });

  it("joins the waiting job when Read again is pressed twice, so there is never a second reading", async () => {
    const again = await queueDocumentRead(await coordinator(), docId);
    expect(again.joined).toBe(true);
    expect(await db.backgroundJob.count({ where: { type: READ_JOB, payload: { path: ["documentId"], equals: docId } } })).toBe(1);
  });

  it("is left alone by the short page ping, which may not run long enough to read", async () => {
    await runJobsNow("test-kick", 5);
    const doc = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: doc.readJobId! } })).status).toBe("QUEUED");
  });

  it("reads, saves the facts and prepares the person's drafts and a proposed rota", async () => {
    const out = await runQueuedReads("test", 1);
    expect(out.map((o) => o.outcome)).toEqual(["succeeded"]);
    const doc = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.readStage).toBe("DONE");
    expect(doc.readStatus).toBe("READ");
    expect(doc.readStageNote).toMatch(/Read and set up\. Personal details populated/);
    // Automatic setup (7 Nov 2026): CSB AI decided the routine facts, never as the person who uploaded.
    expect(await db.careIntakeFact.count({ where: { intakeId, decisionSource: "AUTOMATION", decision: "APPROVED" } })).toBeGreaterThan(5);
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).setupStage).toBe("VERIFIED");
    expect(await db.careIntakeFact.count({ where: { intakeId } })).toBeGreaterThan(10);
    const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: intake.serviceUserId! } });
    expect(su.status).toBe("ASSESSMENT");
    expect(await db.visitTemplate.count({ where: { serviceUserId: su.id } })).toBe(4);
    const visits = await db.visit.findMany({ where: { serviceUserId: su.id } });
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((v) => v.publishedAt === null)).toBe(true);
    expect((await readProgress(await coordinator(), intakeId)).busy).toBe(false);
  });

  it("reads again from the stored original without creating anything twice", async () => {
    const before = { people: await people(), templates: await db.visitTemplate.count(), plans: await db.carePlan.count(), risks: await db.riskAssessment.count(), packages: await db.carePackage.count(), visits: await db.visit.count(), docs: await db.careIntakeDocument.count({ where: { intakeId } }) };
    const q = await queueDocumentRead(await coordinator(), docId);
    expect(q.joined).toBe(false);
    expect((await runQueuedReads("test", 1)).map((o) => o.outcome)).toEqual(["succeeded"]);
    const after = { people: await people(), templates: await db.visitTemplate.count(), plans: await db.carePlan.count(), risks: await db.riskAssessment.count(), packages: await db.carePackage.count(), visits: await db.visit.count(), docs: await db.careIntakeDocument.count({ where: { intakeId } }) };
    expect(after).toEqual({ ...before, visits: after.visits });
    // At most a visit for a time that has come round since; never a duplicate per template and day.
    const vs = await db.visit.findMany({ where: { serviceUser: { firstName: "Ada", lastName: "Fictional" } }, select: { templateId: true, date: true } });
    expect(new Set(vs.map((v) => `${v.templateId}|${v.date.toISOString()}`)).size).toBe(vs.length);
    expect((await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } })).readStage).toBe("DONE");
  });
});

describe("failures, retries and resuming", () => {
  it("waits and tries again when the stored file cannot be opened, then carries on from there", async () => {
    const down = vi.spyOn(storage(), "get").mockRejectedValue(new Error("storage unavailable"));
    const q = await queueDocumentRead(await coordinator(), docId);
    expect((await runQueuedReads("test", 1)).map((o) => o.outcome)).toEqual(["failed"]);
    const waiting = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(waiting.readStage).toBe("RETRYING");
    expect(waiting.readStageNote).toMatch(/attempt 2 of 3/);
    expect(waiting.readStageNote).not.toMatch(/Ada|Fictional/);
    const job = await db.backgroundJob.findUniqueOrThrow({ where: { id: q.jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
    // Storage is back (it was down for a moment); the next run reads it.
    down.mockRestore();
    await db.backgroundJob.update({ where: { id: q.jobId }, data: { runAfter: new Date() } });
    expect((await runQueuedReads("test", 1)).map((o) => o.outcome)).toEqual(["succeeded"]);
    expect((await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } })).readStage).toBe("DONE");
  });

  it("does not read again when a cut-off run had already finished reading, and only prepares", async () => {
    const q = await queueDocumentRead(await coordinator(), docId);
    const job = await db.backgroundJob.findUniqueOrThrow({ where: { id: q.jobId } });
    // As if an earlier run of this job read and saved the document, then was cut off before preparing.
    const readAt = new Date(job.createdAt.getTime() + 1000);
    await db.careIntakeDocument.update({ where: { id: docId }, data: { readAt } });
    const facts = await db.careIntakeFact.findMany({ where: { intakeId }, select: { id: true } });
    expect((await runQueuedReads("test", 1)).map((o) => o.outcome)).toEqual(["succeeded"]);
    const doc = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.readAt!.getTime()).toBe(readAt.getTime());
    expect((await db.careIntakeFact.findMany({ where: { intakeId }, select: { id: true } })).map((f) => f.id).sort()).toEqual(facts.map((f) => f.id).sort());
    expect(doc.readStage).toBe("DONE");
    await db.careIntakeDocument.update({ where: { id: docId }, data: { readAt: new Date(Date.now() - 60_000) } });
  });

  it("stops after the last attempt and says so, keeping the original", async () => {
    const down = vi.spyOn(storage(), "get").mockRejectedValue(new Error("storage unavailable"));
    const q = await queueDocumentRead(await coordinator(), docId);
    for (let i = 0; i < 3; i++) {
      await db.backgroundJob.update({ where: { id: q.jobId }, data: { runAfter: new Date() } });
      await runQueuedReads("test", 1);
    }
    const job = await db.backgroundJob.findUniqueOrThrow({ where: { id: q.jobId } });
    expect(job.status).toBe("DEAD");
    const failed = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(failed.readStage).toBe("FAILED");
    expect(failed.readStageNote).toMatch(/Press Read again/);
    down.mockRestore();
  });

  it("falls back to CSB's reader when the AI times out, and still finishes", async () => {
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const ai: LlmProvider = Object.assign(new SimulatedProvider(), { name: "test-reader", isSimulated: false, extractCareDocument: async () => { throw new AiUnavailableError("The AI service took too long.", "timeout"); } });
    setAiProviderForTests(ai);
    process.env.COORDINATOR_READ_RETRY_BASE_MS = "1";
    try {
      await queueDocumentRead(await coordinator(), docId);
      expect((await runQueuedReads("test", 1)).map((o) => o.outcome)).toEqual(["succeeded"]);
      const doc = await db.careIntakeDocument.findUniqueOrThrow({ where: { id: docId } });
      expect([doc.readStage, doc.readMethod, doc.readFailure]).toEqual(["DONE", "basic-reader", "timeout"]);
      expect(await people()).toBe(1);
    } finally {
      setAiProviderForTests(new SimulatedProvider());
      await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    }
  }, 60_000);
});

describe("access", () => {
  it("keeps reading jobs and their progress inside the organisation and away from carers", async () => {
    await expect(queueDocumentRead(await otherOrg(), docId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readProgress(await otherOrg(), intakeId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(queueDocumentRead(await carer(), docId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the chat paperclip", () => {
  it("stores the document and leaves the reading to the background job", async () => {
    const c = await coordinator();
    const other = Buffer.concat([plan, Buffer.from("\n% second copy for the chat check\n")]);
    const r = await uploadFromChat(c, { target: "new", intakeId: null, serviceUserId: null, title: "Chat background check", files: [{ name: "Chat plan.pdf", type: "application/pdf", bytes: other }], background: true });
    expect(r.reading).toBe(true);
    expect(r.summary).toMatch(/being read now/);
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId: r.intakeId } });
    expect(doc.readStage).toBe("QUEUED");
    expect(await db.careIntakeFact.count({ where: { intakeId: r.intakeId } })).toBe(0);
  });
});
