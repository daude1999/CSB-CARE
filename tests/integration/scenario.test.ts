/**
 * End-to-end scenario (service level, no live websites):
 * A source document changes → the system detects and records the new version →
 * identifies a potentially affected policy → produces a cited impact assessment →
 * a reviewer confirms a revision is necessary → AI prepares a draft with a visible
 * diff → an authorised reviewer requests a change, then approves → the approved
 * version is published → affected staff are notified → acknowledgements are
 * tracked → the previous version remains available.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { checkSource } from "@/server/sources/engine";
import { drain } from "@/server/jobs/queue";
import { fixtureFetch, fixtureHttp, SIMULATED_PATH, simulatedGuidance } from "@/server/testing/fixtures";
import { handlers } from "@/worker/handlers";
import { triageChange, reviewAssessment } from "@/server/changes/workflow";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { acknowledge, decide, editDraftSection, publishRevision, submitForReview } from "@/server/policies/workflow";
import { versionDiff } from "@/server/policies/versions";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import type { LogEmailProvider } from "@/server/notifications/email";

const URL = `https://www.gov.uk/api/content${SIMULATED_PATH}`;

describe("automated policy update workflow (end to end)", () => {
  let email: LogEmailProvider;
  let masters: Record<string, string>;
  beforeAll(async () => {
    ({ email } = await resetDb());
    masters = await seedAll({ simulatedChange: false });
  });

  it("runs the whole workflow with human approval gates", async () => {
    // ── 1. Source registered and baseline captured
    const source = await db.regulatorySource.create({
      data: { key: "scenario-src", name: "SIMULATED scenario source", canonicalUrl: `https://www.gov.uk${SIMULATED_PATH}`, category: "GOVERNMENT_GUIDANCE", monitoringMethod: "GOVUK_CONTENT_API", coverage: "AUTOMATED", config: { basePaths: [SIMULATED_PATH] }, serviceTypes: ["RESIDENTIAL", "DOMICILIARY"], isSimulated: true },
    });
    await checkSource(source.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: simulatedGuidance(1) } })) });
    const doc = await db.sourceDocument.findFirstOrThrow({ where: { sourceId: source.id } });
    const req = await db.regulatoryRequirement.create({
      data: { ref: "REQ-SCN-1", title: "Referral timescale", sourceId: source.id, sourceDocumentId: doc.id, sourceSectionRef: "reporting-concerns", exactReference: "Reporting concerns", sourceUrl: doc.url, excerpt: "Providers must notify the local authority safeguarding team within 48 hours of becoming aware of a concern.", legalStatus: "ADVISORY_GUIDANCE", isSimulated: true },
    });
    await db.requirementPolicyLink.create({ data: { requirementId: req.id, policyId: masters["CSB-SAF-001"]!, sectionKey: "procedure.reporting", rationale: "Reporting procedure states the timescale" } });

    // ── 2. The source document changes; the change is detected and the new version recorded
    const run = await checkSource(source.id, { trigger: "SCHEDULED", http: fixtureHttp(fixtureFetch({ [URL]: { body: simulatedGuidance(2) } })) });
    expect(run.changeIds).toHaveLength(1);
    const versions = await db.sourceVersion.findMany({ where: { documentId: doc.id }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(versions[0]!.normalisedText).toContain("48 hours");
    expect(versions[1]!.normalisedText).toContain("24 hours");
    const changeId = run.changeIds[0]!;

    // ── 3. Background analysis identifies affected policies and proposes cited assessments
    await drain("test", handlers);
    const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId }, include: { candidates: { include: { policy: true } }, citations: true } });
    expect(change.isSimulated).toBe(true);
    expect(change.aiIsSimulated).toBe(true);
    const brookfield = await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } });
    const customerPolicy = await db.policy.findFirstOrThrow({ where: { organisationId: brookfield.id, ref: "CSB-SAF-001" } });
    const flag = change.candidates.find((c) => c.policyId === customerPolicy.id);
    expect(flag?.reason).toBe("REQUIREMENT_LINK");
    expect(flag?.evidence).toMatch(/REQ-SCN-1/);
    expect(change.citations.every((c) => c.verified)).toBe(true);

    const assessment = await db.impactAssessment.findUniqueOrThrow({ where: { changeId_policyId: { changeId, policyId: customerPolicy.id } }, include: { citations: true } });
    expect(assessment.status).toBe("PROPOSED");
    expect(assessment.outcome).toBe("REVISION_RECOMMENDED");
    expect(assessment.affectedSectionKeys).toContain("procedure.reporting");
    expect(assessment.citations.length).toBeGreaterThan(0);
    expect(assessment.citations.every((c) => c.verified && c.sourceVersionId === versions[1]!.id)).toBe(true);

    // Staff/compliance leads were told policies may be affected; nothing was changed.
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    expect(await db.notification.count({ where: { userId: manager.userId, type: "policies.potentially_affected" } })).toBe(1);
    expect((await db.policy.findUniqueOrThrow({ where: { id: customerPolicy.id } })).currentPublishedVersionId).toBe(customerPolicy.currentPublishedVersionId);

    // ── 4. Stages cannot be skipped: revision decision requires the change to be confirmed relevant
    await expect(reviewAssessment(manager, assessment.id, { decision: "REVISION_REQUIRED", reason: "x" })).rejects.toThrow(/confirmed relevant/);
    const regulatory = await ctxFor("regulatory@csb.demo");
    await expect(triageChange(manager, changeId, { to: "CONFIRMED_RELEVANT", reason: "x" })).rejects.toThrow(/permission/);
    await triageChange(regulatory, changeId, { to: "CONFIRMED_RELEVANT", reason: "Reporting timescale shortened; affects safeguarding procedures" });

    // ── 5. Reviewer confirms that a revision is necessary
    await reviewAssessment(manager, assessment.id, { decision: "REVISION_REQUIRED", reason: "Our procedure states 48 hours" });
    expect((await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } })).status).toBe("POLICY_REVISION_REQUIRED");

    // ── 6. AI prepares a draft with a visible, minimal, cited diff
    const drafted = await draftRevisionFromAssessment(assessment.id, manager.userId);
    expect(drafted.created).toBe(true);
    const revision = drafted.revision!;
    expect(revision.isSimulated).toBe(true);
    const diff = await versionDiff(revision.baseVersionId, revision.draftVersionId);
    const changed = diff.filter((d) => d.status !== "unchanged");
    expect(changed.map((d) => d.key)).toEqual(["procedure.reporting"]);
    expect(changed[0]!.parts.some((p) => p.removed && p.value.includes("48"))).toBe(true);
    expect(changed[0]!.parts.some((p) => p.added && p.value.includes("24"))).toBe(true);
    expect(diff.find((d) => d.key === "local.contacts")?.status).toBe("unchanged");
    const validation = revision.validation as { unchangedSectionsVerified: boolean; applied: { citations: { verified: boolean }[] }[] };
    expect(validation.unchangedSectionsVerified).toBe(true);
    expect(validation.applied[0]!.citations.every((c) => c.verified)).toBe(true);
    // Nothing is published yet.
    expect((await db.policy.findUniqueOrThrow({ where: { id: customerPolicy.id } })).currentPublishedVersionId).toBe(customerPolicy.currentPublishedVersionId);

    // ── 7. Human review: publishing before approval is impossible; author cannot approve
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const approver = await ctxFor("approver@care-solution.demo", BROOKFIELD);
    await expect(publishRevision(manager, revision.id)).rejects.toThrow(/approved/);
    await submitForReview(author, revision.id);
    await expect(decide(author, revision.id, { decision: "APPROVE", comment: "self" })).rejects.toThrow(/own revision|not a reviewer/);
    expect(await db.notification.count({ where: { userId: approver.userId, type: "revision.awaiting_review" } })).toBe(1);

    await decide(approver, revision.id, { decision: "REQUEST_CHANGES", comment: "Please also mention the referral reference." });
    await editDraftSection(author, revision.id, "procedure.reporting", {
      body: "The manager, or the most senior person on duty, must refer the concern to the local authority safeguarding team within 24 hours of becoming aware of it, or immediately if the person is in danger. Where a crime may have been committed, contact the police. Record the referral reference and the outcome of each contact.",
    });
    await submitForReview(author, revision.id);
    expect(await decide(approver, revision.id, { decision: "APPROVE", comment: "Approved; matches the updated guidance." })).toBe("APPROVED");

    // ── 8. Publish
    const previousVersionId = customerPolicy.currentPublishedVersionId!;
    await publishRevision(manager, revision.id, { acknowledgementDueDays: 7 });
    const after = await db.policy.findUniqueOrThrow({ where: { id: customerPolicy.id }, include: { currentPublishedVersion: { include: { sections: true } } } });
    expect(after.currentPublishedVersionId).toBe(revision.draftVersionId);
    expect(after.currentPublishedVersion?.status).toBe("PUBLISHED");
    expect(after.currentPublishedVersion?.sections.find((s) => s.key === "procedure.reporting")?.body).toContain("24 hours");

    // ── 9. Previous version remains available and immutable
    const prev = await db.policyVersion.findUniqueOrThrow({ where: { id: previousVersionId }, include: { sections: true } });
    expect(prev.status).toBe("SUPERSEDED");
    expect(prev.sections.find((s) => s.key === "procedure.reporting")?.body).toContain("48 hours");
    await expect(db.policySection.update({ where: { id: prev.sections[0]!.id }, data: { body: "tampered" } })).rejects.toThrow(/immutable/);

    // ── 10. Staff notified; acknowledgements tracked; emails delivered by the worker
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const note = await db.notification.findFirstOrThrow({ where: { userId: carer.userId, type: "policy.published" } });
    expect(note.title).toContain("[SIMULATED]");
    const pub = await db.policyPublication.findUniqueOrThrow({ where: { versionId: revision.draftVersionId }, include: { acknowledgements: true } });
    const members = await db.membership.count({ where: { organisationId: brookfield.id } });
    expect(pub.acknowledgements).toHaveLength(members);
    const mine = pub.acknowledgements.find((a) => a.userId === carer.userId)!;
    await acknowledge(carer, mine.id);
    expect(await db.acknowledgement.count({ where: { publicationId: pub.id, acknowledgedAt: null } })).toBe(members - 1);
    await expect(acknowledge(author, mine.id)).rejects.toThrow(/not found/);

    await drain("test", handlers);
    expect(email.outbox.some((m) => m.subject.includes("Updated policy") && m.text.includes("Why you are receiving this"))).toBe(true);
    expect(await db.notificationDelivery.count({ where: { status: "SENT" } })).toBeGreaterThan(0);

    // ── 11. Complete audit trail
    const actions = (await db.auditLog.findMany({ where: { OR: [{ entityId: revision.id }, { entityId: revision.draftVersionId }, { entityId: changeId }, { entityId: assessment.id }] }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["change.triage", "impact.review", "revision.ai_draft_created", "revision.submitted", "revision.request_changes", "revision.approve", "policy.published"]));
    const decisions = await db.approvalDecision.findMany({ where: { revisionId: revision.id } });
    expect(decisions.map((d) => [d.decision, d.deciderId])).toEqual([
      ["REQUEST_CHANGES", approver.userId],
      ["APPROVE", approver.userId],
    ]);
  });
});
