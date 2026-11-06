import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { drain } from "@/server/jobs/queue";
import { handlers } from "@/worker/handlers";
import { createPolicy, getRevision } from "@/server/policies/library";
import { libraryView, parseLibraryQuery } from "@/server/policies/library-view";
import { syncCustomersFromMaster } from "@/server/policies/sync";
import { monthlyUpdates, ukMonth } from "@/server/policies/updates";
import { acknowledge, cancelScheduledPublication, createManualRevision, decide, discardDraft, editDraftSection, publishRevision, returnToDraft, submitForReview } from "@/server/policies/workflow";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Direct publishing and the CSB central library (owner's brief, 5 Nov 2026): authorised people publish without a
 * mandatory approval, CSB central versions reach every eligible organisation automatically, and everything that keeps
 * the record trustworthy (permissions, immutability, local sections, history, reading) still holds.
 */

async function people() {
  return {
    manager: await ctxFor("manager@care-solution.demo", BROOKFIELD),
    author: await ctxFor("author@care-solution.demo", BROOKFIELD),
    carer: await ctxFor("carer1@care-solution.demo", BROOKFIELD),
    oak: await ctxFor("manager@oakridge.demo", OAKRIDGE),
    content: await ctxFor("content@csb.demo"),
  };
}

/** A new organisation draft by the author, changed so it can be published. */
async function orgDraft(ref = "CSB-COM-001") {
  const { author } = await people();
  const policy = await db.policy.findFirstOrThrow({ where: { organisationId: author.organisationId, ref } });
  const rev = await createManualRevision(author, policy.id, "Annual review");
  await editDraftSection(author, rev.id, "purpose", { body: `Updated purpose ${Math.random()}` });
  return { policy, rev };
}

/** Changes one CSB-wording section of a central document and publishes it, with no review. */
async function publishCentralChange(ref: string, newBody: string) {
  const { content } = await people();
  const master = await db.policy.findFirstOrThrow({ where: { organisationId: null, ref }, include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } } } });
  const section = master.currentPublishedVersion!.sections.find((s) => !s.isLocal)!;
  const rev = await createManualRevision(content, master.id, "CSB monthly update");
  await editDraftSection(content, rev.id, section.key, { body: newBody });
  await publishRevision(content, rev.id, { changeSummary: "Clearer wording for staff" });
  await drain("t", handlers, { types: ["master.sync"] });
  return { master, section, rev };
}

describe("direct publishing of organisation documents", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });

  it("publishes a draft directly, with no review or approval, and records who did it", async () => {
    const { manager } = await people();
    const { policy, rev } = await orgDraft();
    const before = policy.currentPublishedVersionId!;
    const res = await publishRevision(manager, rev.id, { changeSummary: "Clarified the purpose" });
    expect(res.scheduled).toBe(false);
    const after = await db.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { currentPublishedVersion: true } });
    expect(after.currentPublishedVersionId).toBe(rev.draftVersionId);
    expect(after.currentPublishedVersion!.status).toBe("PUBLISHED");
    expect(after.currentPublishedVersion!.changeSummary).toBe("Clarified the purpose");
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: before } })).status).toBe("SUPERSEDED");
    expect(await db.approvalDecision.count({ where: { versionId: rev.draftVersionId } })).toBe(0);
    const pub = await db.policyPublication.findUniqueOrThrow({ where: { versionId: rev.draftVersionId } });
    expect(pub.publishedById).toBe(manager.userId);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "policy.published", entityId: rev.draftVersionId } });
    expect(log.actorId).toBe(manager.userId);
    expect(await db.auditLog.count({ where: { action: "revision.publish_requested", entityId: rev.id } })).toBe(1);
    // The library shows the new version as Updated, never as awaiting approval.
    const row = (await libraryView(manager, parseLibraryQuery({ tab: "policies", q: policy.ref }, true))).rows.find((r) => r.id === policy.id);
    expect(row?.status).toBe("updated");
  });

  it("publishes a brand-new organisation policy straight from its first draft", async () => {
    const { author, manager } = await people();
    const { policy, revision } = await createPolicy(author, { ref: "CSB-LOCAL-900", title: "Lone working at night", description: "Local procedure", categoryCode: "HEALTH_SAFETY", serviceTypes: [], sections: [{ key: "procedure", heading: "Procedure", body: "Check in with the on-call coordinator at the start and end of each visit." }] });
    await publishRevision(manager, revision.id);
    const p = await db.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { currentPublishedVersion: true } });
    expect(p.currentPublishedVersion?.status).toBe("PUBLISHED");
    expect(p.nextReviewDate).not.toBeNull();
  });

  it("refuses publication by people without publishing permission and by other organisations", async () => {
    const { author, carer, oak } = await people();
    const { rev } = await orgDraft();
    await expect(publishRevision(author, rev.id)).rejects.toThrow(/cannot publish/);
    await expect(publishRevision(carer, rev.id)).rejects.toThrow(/cannot publish/);
    await expect(publishRevision(oak, rev.id)).rejects.toThrow(/cannot publish/);
    await expect(getRevision(oak, rev.id)).rejects.toThrow(/not found/);
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: rev.draftVersionId } })).status).toBe("DRAFT");
  });

  it("rejects invalid drafts: unchanged text, empty sections, missing summary, archived policy and stale base", async () => {
    const { author, manager } = await people();
    const policy = await db.policy.findFirstOrThrow({ where: { organisationId: author.organisationId, ref: "CSB-MED-001" } });
    const same = await createManualRevision(author, policy.id, "No change");
    await expect(publishRevision(manager, same.id)).rejects.toThrow(/identical/);
    const r1 = await createManualRevision(author, policy.id, "First");
    await editDraftSection(author, r1.id, "purpose", { body: "First change" });
    await db.policyVersion.update({ where: { id: r1.draftVersionId }, data: { reasonForChange: "" } });
    await expect(publishRevision(manager, r1.id)).rejects.toThrow(/Describe what changed/);
    const r2 = await createManualRevision(author, policy.id, "Second");
    await editDraftSection(author, r2.id, "scope", { body: "Second change" });
    await publishRevision(manager, r1.id, { changeSummary: "First change" });
    // r2 was drafted from the version r1 replaced: publishing it would lose r1's change.
    await expect(publishRevision(manager, r2.id, { changeSummary: "Second change" })).rejects.toThrow(/republished after this draft/);
    expect(await db.policyVersion.count({ where: { policyId: policy.id, status: "PUBLISHED" } })).toBe(1);
    // Publishing twice is refused, not repeated.
    await expect(publishRevision(manager, r1.id)).rejects.toThrow(/closed|cannot be published/);
  });

  it("keeps published and superseded versions immutable and stops staff editing anything", async () => {
    const { manager, carer } = await people();
    const { policy, rev } = await orgDraft();
    await publishRevision(manager, rev.id, { changeSummary: "x" });
    const sup = await db.policyVersion.findFirstOrThrow({ where: { policyId: policy.id, status: "SUPERSEDED" } });
    await expect(db.policyVersion.update({ where: { id: rev.draftVersionId }, data: { changeSummary: "rewritten" } })).rejects.toThrow(/immutable/);
    await expect(db.policyVersion.update({ where: { id: sup.id }, data: { contentHash: "x" } })).rejects.toThrow(/immutable/);
    await expect(db.policySection.updateMany({ where: { versionId: rev.draftVersionId }, data: { body: "tampered" } })).rejects.toThrow(/immutable/);
    await expect(db.policyVersion.update({ where: { id: rev.draftVersionId }, data: { status: "DRAFT" } })).rejects.toThrow(/Illegal policy version transition/);
    await expect(createManualRevision(carer, policy.id, "I want to change it")).rejects.toThrow(/cannot author/);
  });

  it("schedules a publication, cancels it, and republishes it at the right time through the worker", async () => {
    const { manager } = await people();
    const { policy, rev } = await orgDraft();
    const before = policy.currentPublishedVersionId;
    const res = await publishRevision(manager, rev.id, { scheduleFor: new Date(Date.now() + 60_000), changeSummary: "Scheduled change" });
    expect(res.scheduled).toBe(true);
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: rev.draftVersionId } })).status).toBe("SCHEDULED");
    await cancelScheduledPublication(manager, rev.id);
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: rev.draftVersionId } })).status).toBe("DRAFT");
    // The old job must not publish a cancelled schedule.
    await db.backgroundJob.updateMany({ where: { type: "publication.publish" }, data: { runAfter: new Date() } });
    await drain("t", handlers, { types: ["publication.publish"] });
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId).toBe(before);

    await publishRevision(manager, rev.id, { scheduleFor: new Date(Date.now() + 60_000) });
    await drain("t", handlers, { types: ["publication.publish"] });
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId).toBe(before);
    await db.backgroundJob.updateMany({ where: { type: "publication.publish", status: "QUEUED" }, data: { runAfter: new Date() } });
    await db.policyPublication.updateMany({ where: { versionId: rev.draftVersionId }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await drain("t", handlers, { types: ["publication.publish"] });
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).currentPublishedVersionId).toBe(rev.draftVersionId);
  });

  it("keeps staff reading and acknowledgement separate from publishing, and still working", async () => {
    const { manager } = await people();
    const { rev } = await orgDraft();
    const { publicationId } = await publishRevision(manager, rev.id, { requireAcknowledgement: true, changeSummary: "Read again please" });
    const carer2 = await ctxFor("carer2@care-solution.demo", BROOKFIELD);
    const ack = await db.acknowledgement.findFirstOrThrow({ where: { publicationId, userId: carer2.userId } });
    expect(ack.acknowledgedAt).toBeNull();
    await acknowledge(carer2, ack.id);
    const done = await db.acknowledgement.findUniqueOrThrow({ where: { id: ack.id } });
    expect(done.acknowledgedAt).not.toBeNull();
    expect((await db.policyPublication.findUniqueOrThrow({ where: { id: publicationId } })).status).toBe("PUBLISHED");
  });

  it("keeps policy-to-form links when a new version is published", async () => {
    const { manager } = await people();
    const { policy, rev } = await orgDraft("CSB-SAF-001");
    const links = await db.policyResourceLink.count({ where: { policyId: policy.id, withdrawnAt: null } });
    await publishRevision(manager, rev.id, { changeSummary: "x" });
    expect(await db.policyResourceLink.count({ where: { policyId: policy.id, withdrawnAt: null } })).toBe(links);
  });

  it("lets drafts sent for review under the old process be published, keeping their review history", async () => {
    const { author, manager } = await people();
    const approver = await ctxFor("approver@care-solution.demo", BROOKFIELD);
    const reviewer = await ctxFor("reviewer@care-solution.demo", BROOKFIELD);
    const a = await orgDraft("CSB-COM-001");
    await submitForReview(author, a.rev.id);
    await decide(reviewer, a.rev.id, { decision: "REQUEST_CHANGES", comment: "Tighten it" }).catch(() => undefined);
    const status = (await db.policyVersion.findUniqueOrThrow({ where: { id: a.rev.draftVersionId } })).status;
    if (status === "CHANGES_REQUESTED") await submitForReview(author, a.rev.id);
    await decide(approver, a.rev.id, { decision: "APPROVE", comment: "Fine" });
    const decisions = await db.approvalDecision.count({ where: { revisionId: a.rev.id } });
    expect(decisions).toBeGreaterThan(0);
    await publishRevision(manager, a.rev.id, { changeSummary: "x" });
    expect(await db.approvalDecision.count({ where: { revisionId: a.rev.id } })).toBe(decisions);

    // Still waiting for review when the process changed: publish it as it is, or return it to draft.
    const b = await orgDraft("CSB-MED-001");
    await submitForReview(author, b.rev.id);
    expect(await db.reviewAssignment.count({ where: { revisionId: b.rev.id, status: "PENDING" } })).toBeGreaterThan(0);
    await returnToDraft(author, b.rev.id);
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: b.rev.draftVersionId } })).status).toBe("DRAFT");
    expect(await db.reviewAssignment.count({ where: { revisionId: b.rev.id, status: "PENDING" } })).toBe(0);
    await submitForReview(author, b.rev.id);
    await publishRevision(manager, b.rev.id, { changeSummary: "Published without waiting" });
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: b.rev.draftVersionId } })).status).toBe("PUBLISHED");
    expect(await db.reviewAssignment.count({ where: { revisionId: b.rev.id } })).toBeGreaterThan(0);

    // A draft that won't be used is discarded, and kept for the record.
    const c = await orgDraft("CSB-IPC-001");
    await discardDraft(author, c.rev.id, "Not needed");
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: c.rev.draftVersionId } })).status).toBe("REJECTED");
    await expect(publishRevision(manager, c.rev.id)).rejects.toThrow(/closed/);
  });
});

describe("CSB central library", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });

  it("shows a newly published central document to every eligible organisation at once, without copies or approval", async () => {
    const { content, manager, oak } = await people();
    const all = await createPolicy(content, { ref: "CSB-GDN-900", title: "Hot weather guidance", description: "For every service", categoryCode: "HEALTH_SAFETY", serviceTypes: [], sections: [{ key: "guidance", heading: "Guidance", body: "Offer drinks at every visit when the temperature is above 25°C." }], master: true });
    const dom = await createPolicy(content, { ref: "CSB-GDN-901", title: "Home visit key holding", description: "Domiciliary only", categoryCode: "HEALTH_SAFETY", serviceTypes: ["DOMICILIARY"], sections: [{ key: "guidance", heading: "Guidance", body: "Return keys to the key safe after every visit." }], master: true });
    // Not visible to anyone until CSB publishes it.
    const findIn = async (ctx: typeof manager, id: string) => (await libraryView(ctx, parseLibraryQuery({ tab: "policies", q: "CSB-GDN-90" }, true))).rows.find((r) => r.id === id);
    expect(await findIn(manager, all.policy.id)).toBeUndefined();
    await expect(publishRevision(manager, all.revision.id)).rejects.toThrow(/cannot publish/);
    await publishRevision(content, all.revision.id);
    await publishRevision(content, dom.revision.id);
    const mine = await findIn(manager, all.policy.id);
    expect(mine?.central).toBe(true);
    expect(mine?.status).toBe("current");
    expect(await findIn(oak, all.policy.id)).toBeDefined();
    // Eligibility follows the organisation's services: Oakridge runs supported living only.
    expect(await findIn(manager, dom.policy.id)).toBeDefined();
    expect(await findIn(oak, dom.policy.id)).toBeUndefined();
    // No organisation copy and no organisation approval was needed.
    expect(await db.policy.count({ where: { templateId: all.policy.id } })).toBe(0);
    expect(await db.approvalDecision.count({ where: { version: { policyId: all.policy.id } } })).toBe(0);
  });

  it("distributes a central update into organisation copies automatically, keeping local sections, with no duplicates", async () => {
    const { manager } = await people();
    const ref = "CSB-FRM-001";
    const copy = await db.policy.findFirstOrThrow({ where: { organisationId: manager.organisationId, ref }, include: { currentPublishedVersion: { include: { sections: true } } } });
    const localBefore = copy.currentPublishedVersion!.sections.filter((s) => s.isLocal).map((s) => s.body);
    const { section } = await publishCentralChange(ref, "Write down exactly what you saw and heard, and when.");
    const after = await db.policy.findUniqueOrThrow({ where: { id: copy.id }, include: { currentPublishedVersion: { include: { sections: true } } } });
    expect(after.currentPublishedVersionId).not.toBe(copy.currentPublishedVersionId);
    expect(after.currentPublishedVersion!.origin).toBe("MASTER_SYNC");
    expect(after.currentPublishedVersion!.changeSummary).toBe("Clearer wording for staff");
    expect(after.currentPublishedVersion!.sections.find((s) => s.key === section.key)?.body).toBe("Write down exactly what you saw and heard, and when.");
    expect(after.currentPublishedVersion!.sections.filter((s) => s.isLocal).map((s) => s.body)).toEqual(localBefore);
    const sync = await db.policyRevision.findFirstOrThrow({ where: { policyId: copy.id, kind: "MASTER_SYNC" } });
    expect(sync.closedAt).not.toBeNull();
    expect(await db.approvalDecision.count({ where: { revisionId: sync.id } })).toBe(0);

    // Running the job again (a retry) changes nothing.
    const versions = await db.policyVersion.count({ where: { policyId: copy.id } });
    const masterVersion = (await db.policy.findFirstOrThrow({ where: { organisationId: null, ref } })).currentPublishedVersionId!;
    await syncCustomersFromMaster(masterVersion);
    expect(await db.policyVersion.count({ where: { policyId: copy.id } })).toBe(versions);
    expect(await db.policy.count({ where: { organisationId: manager.organisationId, ref } })).toBe(1);

    // The update is on this month's register, labelled as a CSB central update.
    const updates = await monthlyUpdates(manager, { month: ukMonth(new Date()) });
    expect(updates.rows.find((r) => r.policyId === copy.id)?.source).toBe("CSB central update");
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    expect((await monthlyUpdates(oak, { month: ukMonth(new Date()) })).rows.some((r) => r.policyId === copy.id)).toBe(false);
  });

  it("never overwrites wording an organisation customised, flags it, and still applies the rest", async () => {
    const { manager, author } = await people();
    const ref = "CSB-FRM-001";
    const copy = await db.policy.findFirstOrThrow({ where: { organisationId: manager.organisationId, ref }, include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } } } });
    const shared = copy.currentPublishedVersion!.sections.filter((s) => !s.isLocal && s.masterKey);
    const mineKey = shared[0]!.key;
    // The organisation customises one CSB section and publishes it directly.
    const own = await createManualRevision(author, copy.id, "Our wording");
    await editDraftSection(author, own.id, mineKey, { body: "Our own wording for this section." });
    await publishRevision(manager, own.id, { changeSummary: "Local wording" });
    // CSB then changes the same section.
    await publishCentralChange(ref, "CSB's new wording.");
    const after = await db.policy.findUniqueOrThrow({ where: { id: copy.id }, include: { currentPublishedVersion: { include: { sections: true } } } });
    expect(after.currentPublishedVersion!.sections.find((s) => s.key === mineKey)?.body).toBe("Our own wording for this section.");
    expect(await db.notification.count({ where: { organisationId: manager.organisationId, type: "policy.central_update_attention" } })).toBeGreaterThan(0);
  });

  it("carries a draft in progress forward onto the new central version so the work is not lost", async () => {
    const { manager, author } = await people();
    const ref = "CSB-FRM-001";
    const copy = await db.policy.findFirstOrThrow({ where: { organisationId: manager.organisationId, ref }, include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } } } });
    const local = copy.currentPublishedVersion!.sections.find((s) => s.isLocal)!;
    const draft = await createManualRevision(author, copy.id, "Update our contacts");
    await editDraftSection(author, draft.id, local.key, { body: "New local contact: 01632 960099 (fictional)." });
    const { section } = await publishCentralChange(ref, "CSB wording changed while you were drafting.");
    const rebased = await db.policyRevision.findUniqueOrThrow({ where: { id: draft.id }, include: { draftVersion: { include: { sections: true } } } });
    const current = (await db.policy.findUniqueOrThrow({ where: { id: copy.id } })).currentPublishedVersionId;
    expect(rebased.baseVersionId).toBe(current);
    expect(rebased.draftVersion.sections.find((s) => s.key === section.key)?.body).toBe("CSB wording changed while you were drafting.");
    expect(rebased.draftVersion.sections.find((s) => s.key === local.key)?.body).toBe("New local contact: 01632 960099 (fictional).");
    await publishRevision(manager, draft.id, { changeSummary: "New contact" });
    expect((await db.policy.findUniqueOrThrow({ where: { id: copy.id } })).currentPublishedVersionId).toBe(rebased.draftVersionId);
  });
});
