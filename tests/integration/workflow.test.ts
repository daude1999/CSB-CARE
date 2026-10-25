import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { drain } from "@/server/jobs/queue";
import { handlers } from "@/worker/handlers";
import { login, ctxFromToken } from "@/server/auth/session";
import { DEMO_PASSWORD } from "@/server/seed/demo";
import { getPolicy, listPolicies, getRevision, adoptTemplate } from "@/server/policies/library";
import { createManualRevision, createRollbackRevision, decide, editDraftSection, publishRevision, submitForReview, acknowledge, sendAcknowledgementReminders, confirmImplementation } from "@/server/policies/workflow";
import { searchChunks } from "@/server/search/index-chunks";
import { askAssistant } from "@/server/search/assistant";
import { uploadEvidence, readEvidence } from "@/server/compliance/evidence";
import { createAction, transitionAction } from "@/server/compliance/audits";
import { triageChange, reviewAssessment } from "@/server/changes/workflow";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { setAiProviderForTests } from "@/server/ai";
import { dashboardMetrics } from "@/server/reports/metrics";
import { setEmailProvider } from "@/server/notifications/email";
import { notify } from "@/server/notifications/notify";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

async function approvedRevision(policyRef = "EVX-COM-001") {
  const author = await ctxFor("author@brookfield.demo", BROOKFIELD);
  const approver = await ctxFor("approver@brookfield.demo", BROOKFIELD);
  const policy = await db.policy.findFirstOrThrow({ where: { organisationId: author.organisationId, ref: policyRef } });
  const rev = await createManualRevision(author, policy.id, "Test change");
  await editDraftSection(author, rev.id, "purpose", { body: `Updated purpose ${Math.random()}` });
  await submitForReview(author, rev.id);
  await decide(approver, rev.id, { decision: "APPROVE", comment: "ok" });
  return { rev, policy, author, approver };
}

describe("authentication", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });
  it("creates sessions for valid credentials only and rate-limits failures", async () => {
    const { token } = await login("manager@brookfield.demo", DEMO_PASSWORD);
    const ctx = await ctxFromToken(token);
    expect(ctx?.orgRoles).toContain("ORG_ADMIN");
    expect(await ctxFromToken("forged-token")).toBeNull();
    await expect(login("manager@brookfield.demo", "wrong-password")).rejects.toThrow(/Invalid/);
    for (let i = 0; i < 4; i++) await login("manager@brookfield.demo", "wrong-password").catch(() => {});
    await expect(login("manager@brookfield.demo", DEMO_PASSWORD)).rejects.toThrow(/Too many/);
  });
  it("rejects expired sessions", async () => {
    const { token } = await login("author@brookfield.demo", DEMO_PASSWORD);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await ctxFromToken(token)).toBeNull();
  });
});

describe("tenant isolation", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll();
  });
  it("never exposes another organisation's policies, drafts, search results, evidence or acknowledgements", async () => {
    const brook = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const oakPolicy = await db.policy.findFirstOrThrow({ where: { organisationId: oak.organisationId } });
    await expect(getPolicy(brook, oakPolicy.id)).rejects.toThrow(/not found/);
    const list = await listPolicies(brook, { pageSize: 100 });
    expect(list.items.some((p) => p.organisationId === oak.organisationId)).toBe(false);

    const hits = await searchChunks("Oakridge procedure", { organisationId: brook.organisationId });
    expect(hits.some((h) => h.organisationId === oak.organisationId)).toBe(false);
    expect((await searchChunks("Oakridge procedure", { organisationId: oak.organisationId })).length).toBeGreaterThan(0);

    const answer = await askAssistant(brook, "Oakridge confidential tenancy procedure");
    expect(JSON.stringify(answer)).not.toContain("Oakridge-only");

    const ev = await uploadEvidence(oak, { name: "secret.txt", type: "text/plain", bytes: Buffer.from("Oakridge secret evidence") }, {});
    await expect(readEvidence(brook, ev.id)).rejects.toThrow(/not found/);
    expect((await readEvidence(oak, ev.id)).bytes.toString()).toContain("secret");

    const brookRev = await db.policyRevision.findFirstOrThrow({ where: { organisationId: brook.organisationId } });
    await expect(getRevision(oak, brookRev.id)).rejects.toThrow(/not found/);
    await expect(publishRevision(oak, brookRev.id)).rejects.toThrow(/cannot publish/);

    // Impact assessments on Brookfield policies cannot be reviewed by Oakridge.
    const a = await db.impactAssessment.findFirstOrThrow({ where: { organisationId: brook.organisationId } });
    await expect(reviewAssessment(oak, a.id, { decision: "NO_REVISION", reason: "x" })).rejects.toThrow(/cannot review/);
  });
});

describe("approval workflow controls", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });

  it("requires a reason, a separate approver and rejects illegal transitions at the database level", async () => {
    const author = await ctxFor("author@brookfield.demo", BROOKFIELD);
    const policy = await db.policy.findFirstOrThrow({ where: { organisationId: author.organisationId, ref: "EVX-MED-001" } });
    await expect(createManualRevision(author, policy.id, " ")).rejects.toThrow(/reason/);
    const rev = await createManualRevision(author, policy.id, "Edit");
    await expect(submitForReview(author, rev.id)).rejects.toThrow(/identical/);
    // Direct status jump DRAFT → PUBLISHED is blocked by the database trigger.
    await expect(db.policyVersion.update({ where: { id: rev.draftVersionId }, data: { status: "PUBLISHED" } })).rejects.toThrow(/Illegal policy version transition/);
    const staff = await ctxFor("carer1@brookfield.demo", BROOKFIELD);
    await expect(editDraftSection(staff, rev.id, "purpose", { body: "x" })).rejects.toThrow(/cannot author/);
  });

  it("prevents conflicting publications (optimistic concurrency on the base version)", async () => {
    const a = await approvedRevision();
    const author = a.author;
    const rev2 = await createManualRevision(author, a.policy.id, "Second concurrent change");
    await editDraftSection(author, rev2.id, "scope", { body: "Concurrent scope" });
    await submitForReview(author, rev2.id);
    await decide(a.approver, rev2.id, { decision: "APPROVE", comment: "ok" });
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    await publishRevision(manager, a.rev.id);
    await expect(publishRevision(manager, rev2.id)).rejects.toThrow(/republished after this draft/);
    const published = await db.policyVersion.count({ where: { policyId: a.policy.id, status: "PUBLISHED" } });
    expect(published).toBe(1);
  });

  it("supports scheduled publication through the background worker", async () => {
    const { rev, policy } = await approvedRevision();
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const before = (await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId;
    const when = new Date(Date.now() + 60_000);
    const res = await publishRevision(manager, rev.id, { scheduleFor: when });
    expect(res.scheduled).toBe(true);
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: rev.draftVersionId } })).status).toBe("SCHEDULED");
    await drain("t", handlers, { types: ["publication.publish"] });
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId).toBe(before);
    await db.backgroundJob.updateMany({ where: { type: "publication.publish" }, data: { runAfter: new Date() } });
    await drain("t", handlers, { types: ["publication.publish"] });
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId).toBe(rev.draftVersionId);
  });

  it("rolls back by creating a new approved version, never by rewriting history", async () => {
    const { rev, policy, author, approver } = await approvedRevision();
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const original = (await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId!;
    await publishRevision(manager, rev.id);
    await expect(createRollbackRevision(author, policy.id, original, "")).rejects.toThrow(/reason/);
    const rb = await createRollbackRevision(author, policy.id, original, "Change was made in error");
    await submitForReview(author, rb.id);
    await decide(approver, rb.id, { decision: "APPROVE", comment: "Restore" });
    await publishRevision(manager, rb.id);
    const versions = await db.policyVersion.findMany({ where: { policyId: policy.id, status: { not: "DRAFT" } }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((v) => v.status)).toEqual(["SUPERSEDED", "SUPERSEDED", "PUBLISHED"]);
    expect(versions[2]!.origin).toBe("ROLLBACK");
    expect(versions[2]!.contentHash).toBe(versions[0]!.contentHash);
  });

  it("tracks acknowledgements, overdue reminders without duplicates, and implementation confirmation", async () => {
    const { rev } = await approvedRevision();
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const { publicationId } = await publishRevision(manager, rev.id, { acknowledgementDueDays: 1 });
    await db.acknowledgement.updateMany({ where: { publicationId }, data: { dueAt: new Date(Date.now() - 1000) } });
    const n1 = await sendAcknowledgementReminders();
    const n2 = await sendAcknowledgementReminders();
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
    const carer = await ctxFor("carer2@brookfield.demo", BROOKFIELD);
    const ack = await db.acknowledgement.findFirstOrThrow({ where: { publicationId, userId: carer.userId } });
    await acknowledge(carer, ack.id);
    await expect(confirmImplementation(carer, publicationId, "done")).rejects.toThrow();
    await confirmImplementation(manager, publicationId, "Briefed all staff at handover");
    expect((await db.policyPublication.findUniqueOrThrow({ where: { id: publicationId } })).implementationConfirmedById).toBe(manager.userId);
  });
});

describe("notifications", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });
  it("deduplicates and retries failed email deliveries safely", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: "author@brookfield.demo" } });
    let fail = true;
    const sent: string[] = [];
    setEmailProvider({ name: "flaky", send: async (m) => { if (fail) throw new Error("SMTP down"); sent.push(m.subject); return { messageId: "1" }; } });
    const input = { userIds: [u.id], type: "t", title: "Hello", body: "b", reason: "r", dedupeKey: "test-dedupe" };
    expect(await notify(input)).toBe(1);
    expect(await notify(input)).toBe(0);
    const mine = { notification: { dedupeKey: `test-dedupe:${u.id}` } };
    await drain("t", handlers, { types: ["notification.deliver"] });
    expect((await db.notificationDelivery.findFirstOrThrow({ where: mine })).status).toBe("FAILED");
    fail = false;
    await db.backgroundJob.updateMany({ where: { type: "notification.deliver" }, data: { runAfter: new Date() } });
    await drain("t", handlers, { types: ["notification.deliver"] });
    expect((await db.notificationDelivery.findFirstOrThrow({ where: mine })).status).toBe("SENT");
    expect(sent.filter((x) => x === "[CSB] Hello")).toHaveLength(1);
  });
});

describe("AI unavailability and safeguards", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll();
  });
  it("keeps the application working when AI is unavailable", async () => {
    setAiProviderForTests(null);
    const brook = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const r = await askAssistant(brook, "safeguarding referral");
    expect(r.aiUnavailable).toBe(true);
    expect(r.citations.length).toBeGreaterThan(0);
    expect((await dashboardMetrics(brook)).overdueReviews).toBe(1);
  });

  it("does not manufacture a revision when the AI proposes only unsupported edits", async () => {
    setAiProviderForTests({
      name: "fake",
      isSimulated: true,
      analyseChange: async () => { throw new Error("n/a"); },
      assessImpact: async () => { throw new Error("n/a"); },
      answer: async () => ({ answer: "", citations: [{ chunkId: "invented", quote: "Regulation 99 says so" }], evidenceGaps: [] }),
      draftRevision: async () => ({ summary: "s", conflicts: [], uncertainties: [], edits: [{ operation: "modify", sectionKey: "procedure.reporting", heading: null, insertAfterKey: null, newBody: "Refer within 1 hour.", rationale: "r", citations: [{ sectionRef: "reporting-concerns", quote: "Providers must refer within 1 hour." }] }] }),
    });
    const regulatory = await ctxFor("regulatory@csb.demo");
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const change = await db.regulatoryChange.findFirstOrThrow();
    await triageChange(regulatory, change.id, { to: "CONFIRMED_RELEVANT", reason: "relevant" });
    const a = await db.impactAssessment.findFirstOrThrow({ where: { organisationId: manager.organisationId } });
    await reviewAssessment(manager, a.id, { decision: "REVISION_REQUIRED", reason: "yes" });
    const out = await draftRevisionFromAssessment(a.id, manager.userId);
    expect(out.revision).toBeNull();
    expect(out.reason).toMatch(/No supported edit/);
    expect(await db.policyRevision.count({ where: { impactAssessmentId: a.id } })).toBe(0);

    const ans = await askAssistant(manager, "safeguarding");
    expect(ans.citations[0]?.verified).toBe(false);
    expect(ans.evidenceGaps.join(" ")).toMatch(/could not be verified/);
  });

  it("lets reviewers amend AI assessments with a recorded reason", async () => {
    const regulatory = await ctxFor("regulatory@csb.demo");
    const change = await db.regulatoryChange.findFirstOrThrow();
    await expect(triageChange(regulatory, change.id, { to: "CONFIRMED_RELEVANT", reason: "" })).rejects.toThrow(/reason/);
    await triageChange(regulatory, change.id, { to: "UNDER_REVIEW", reason: "Checking", urgency: "URGENT" });
    const c = await db.regulatoryChange.findUniqueOrThrow({ where: { id: change.id }, include: { events: { orderBy: { createdAt: "desc" } } } });
    expect(c.suggestedUrgency).toBe("URGENT");
    expect(c.events[0]?.reason).toMatch(/urgency HIGH → URGENT/);
    await expect(triageChange(regulatory, change.id, { to: "CLOSED", reason: "x" })).rejects.toThrow(/Cannot move/);
  });
});

describe("customer-specific maintenance", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll();
  });
  it("turns a master template update into a customer draft that preserves customisations", async () => {
    const regulatory = await ctxFor("regulatory@csb.demo");
    const content = await ctxFor("content@csb.demo");
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const change = await db.regulatoryChange.findFirstOrThrow();
    await triageChange(regulatory, change.id, { to: "CONFIRMED_RELEVANT", reason: "relevant" });
    const masterAssessment = await db.impactAssessment.findFirstOrThrow({ where: { organisationId: null } });
    await expect(reviewAssessment(manager, masterAssessment.id, { decision: "REVISION_REQUIRED", reason: "x" })).rejects.toThrow(/cannot review/);
    await reviewAssessment(regulatory, masterAssessment.id, { decision: "REVISION_REQUIRED", reason: "Update template" });
    const { revision } = await draftRevisionFromAssessment(masterAssessment.id, null);
    await submitForReview(content, revision!.id);
    await decide(regulatory, revision!.id, { decision: "APPROVE", comment: "Approved master update" });
    await publishRevision(regulatory, revision!.id);
    await drain("t", handlers);

    const customer = await db.policy.findFirstOrThrow({ where: { organisationId: manager.organisationId, ref: "EVX-SAF-001" } });
    const sync = await db.policyRevision.findFirstOrThrow({ where: { policyId: customer.id, kind: "MASTER_SYNC" }, include: { draftVersion: { include: { sections: true } } } });
    const report = sync.validation as { safeApplied: { masterKey: string }[]; preservedLocal: string[] };
    expect(report.safeApplied.map((s) => s.masterKey)).toEqual(["procedure.reporting"]);
    expect(report.preservedLocal.length).toBe(1);
    expect(sync.draftVersion.sections.find((s) => s.key === "procedure.reporting")?.body).toContain("24 hours");
    expect(sync.draftVersion.sections.find((s) => s.isLocal)?.body).toContain("Morgan Manager");
    expect(sync.draftVersion.status).toBe("DRAFT");
    expect((await db.policy.findUniqueOrThrow({ where: { id: customer.id } })).currentPublishedVersionId).toBe(customer.currentPublishedVersionId);
    expect(await db.notification.count({ where: { type: "revision.master_update", organisationId: manager.organisationId } })).toBeGreaterThan(0);
    // No staff notifications until the customer publishes.
    const carer = await ctxFor("carer1@brookfield.demo", BROOKFIELD);
    expect(await db.notification.count({ where: { userId: carer.userId, type: "policy.published" } })).toBe(0);

    // A customer can adopt a template only once.
    const author = await ctxFor("author@brookfield.demo", BROOKFIELD);
    await expect(adoptTemplate(author, customer.templateId!)).rejects.toThrow(/already uses/);
  });
});

describe("audits and actions", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll();
  });
  it("enforces action lifecycle with separate verification", async () => {
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    const reviewer = await ctxFor("reviewer@brookfield.demo", BROOKFIELD);
    const oakMember = await db.user.findUniqueOrThrow({ where: { email: "manager@oakridge.demo" } });
    await expect(createAction(manager, { title: "x", ownerId: oakMember.id, dueDate: new Date() })).rejects.toThrow(/member/);
    const action = await createAction(manager, { title: "Fix", ownerId: reviewer.userId, dueDate: new Date() });
    await expect(transitionAction(reviewer, action.id, "COMPLETED", {})).rejects.toThrow(/Describe/);
    await transitionAction(reviewer, action.id, "COMPLETED", { note: "Done" });
    await expect(transitionAction(reviewer, action.id, "VERIFIED")).rejects.toThrow(/compliance lead/);
    await transitionAction(manager, action.id, "VERIFIED", { note: "Checked records" });
    await transitionAction(manager, action.id, "CLOSED");
    const history = await db.actionEvent.findMany({ where: { actionId: action.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.to)).toEqual(["OPEN", "COMPLETED", "VERIFIED", "CLOSED"]);
  });
  it("flags audit templates linked to affected requirements without changing them", async () => {
    // The seeded simulated change affects REQ-SIM-001; link a question to it and re-run analysis.
    const req = await db.regulatoryRequirement.findUniqueOrThrow({ where: { ref: "REQ-SIM-001" } });
    const q = await db.auditQuestion.findFirstOrThrow();
    await db.auditQuestionRequirement.create({ data: { questionId: q.id, requirementId: req.id } });
    const change = await db.regulatoryChange.findFirstOrThrow();
    const { analyseChange } = await import("@/server/changes/workflow");
    const before = await db.auditQuestion.findMany({ where: { templateId: q.templateId } });
    await analyseChange(change.id);
    const tpl = await db.auditTemplate.findUniqueOrThrow({ where: { id: q.templateId }, include: { questions: true } });
    expect(tpl.needsReview).toBe(true);
    expect(tpl.questions.map((x) => x.text)).toEqual(before.map((x) => x.text));
  });
  it("rejects disallowed or mislabelled evidence uploads", async () => {
    const manager = await ctxFor("manager@brookfield.demo", BROOKFIELD);
    await expect(uploadEvidence(manager, { name: "x.exe", type: "application/x-msdownload", bytes: Buffer.from("MZ...") }, {})).rejects.toThrow(/not allowed/);
    await expect(uploadEvidence(manager, { name: "fake.pdf", type: "application/pdf", bytes: Buffer.from("<html>not a pdf</html>") }, {})).rejects.toThrow(/not allowed/);
    await expect(uploadEvidence(manager, { name: "big.txt", type: "text/plain", bytes: Buffer.alloc(11 * 1024 * 1024, 65) }, {})).rejects.toThrow(/10 MB/);
    const ok = await uploadEvidence(manager, { name: "../../etc/passwd.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") }, {});
    expect(ok.filename).not.toContain("/");
  });
});
