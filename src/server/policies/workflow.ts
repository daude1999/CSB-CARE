import type { Policy, PolicyRevision, PolicyVersion } from "@prisma/client";
import { acknowledgeRow, assignPublication, materialPublication } from "./assignment";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { canOnPolicy, requireOnPolicy, type Ctx } from "../auth/rbac";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { notify, usersWithOrgRoles } from "../notifications/notify";
import { indexPolicyVersion } from "../search/index-chunks";
import { createDraftVersion, sectionsHash, toSectionInputs, type SectionInput } from "./versions";
import { ensureBranchAssignmentRules, generatedPublicationCheck, REVIEW_MARKER, type GovernanceKey } from "../policy-geo/generator";

type RevisionFull = PolicyRevision & { policy: Policy; draftVersion: PolicyVersion };

async function loadRevision(revisionId: string): Promise<RevisionFull> {
  const r = await db.policyRevision.findUnique({ where: { id: revisionId }, include: { policy: true, draftVersion: true } });
  if (!r) throw new NotFoundError("Revision");
  return r;
}

/** Customer: approvers in the org. Master: platform regulatory reviewers. */
async function eligibleApprovers(policy: Policy): Promise<string[]> {
  if (policy.kind === "MASTER") {
    const users = await db.user.findMany({ where: { platformRoles: { has: "REGULATORY_REVIEWER" }, deactivatedAt: null }, select: { id: true } });
    return users.map((u) => u.id);
  }
  return usersWithOrgRoles(policy.organisationId!, ["POLICY_APPROVER"]);
}

/**
 * Review is optional since direct publishing (owner's brief, 5 Nov 2026). A draft someone chooses to send for review
 * (or one sent under the old process) is marked approved by one approval from someone other than its author.
 */
const OPTIONAL_REVIEW_APPROVALS = 1;

export async function createManualRevision(ctx: Ctx, policyId: string, reason: string) {
  const policy = await db.policy.findUnique({ where: { id: policyId }, include: { currentPublishedVersion: { include: { sections: true } } } });
  if (!policy) throw new NotFoundError("Policy");
  requireOnPolicy(ctx, policy, "author");
  if (!reason.trim()) throw new ValidationError("A reason for the revision is required");
  const base = policy.currentPublishedVersion;
  return db.$transaction(async (tx) => {
    const draft = await createDraftVersion(tx, {
      policyId,
      organisationId: policy.organisationId,
      sections: base ? toSectionInputs(base.sections) : [],
      origin: "MANUAL",
      createdById: ctx.userId,
      previousVersionId: base?.id,
      basedOnMasterVersionId: base?.basedOnMasterVersionId,
      reasonForChange: reason,
    });
    const rev = await tx.policyRevision.create({
      data: { policyId, organisationId: policy.organisationId, kind: "MANUAL", baseVersionId: base?.id ?? null, draftVersionId: draft.id, title: `Manual revision of ${policy.ref}`, explanation: reason, createdById: ctx.userId, authorId: ctx.userId, substantive: true },
    });
    await audit({ organisationId: policy.organisationId, actorId: ctx.userId, action: "revision.created", entityType: "PolicyRevision", entityId: rev.id, data: { kind: "MANUAL", reason } }, tx);
    return rev;
  });
}

/** Rollback never rewrites history: it drafts a new version from an earlier one, which is then published as a new version. */
export async function createRollbackRevision(ctx: Ctx, policyId: string, targetVersionId: string, reason: string) {
  const policy = await db.policy.findUnique({ where: { id: policyId } });
  if (!policy) throw new NotFoundError("Policy");
  requireOnPolicy(ctx, policy, "author");
  if (!reason.trim()) throw new ValidationError("A rollback reason is required");
  const target = await db.policyVersion.findUnique({ where: { id: targetVersionId }, include: { sections: true } });
  if (!target || target.policyId !== policyId) throw new NotFoundError("Version");
  if (!["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(target.status)) throw new ConflictError("Only previously published versions can be restored");
  if (target.id === policy.currentPublishedVersionId) throw new ConflictError("That version is already the current published version");
  return db.$transaction(async (tx) => {
    const draft = await createDraftVersion(tx, {
      policyId,
      organisationId: policy.organisationId,
      sections: toSectionInputs(target.sections),
      origin: "ROLLBACK",
      createdById: ctx.userId,
      previousVersionId: policy.currentPublishedVersionId,
      basedOnMasterVersionId: target.basedOnMasterVersionId,
      reasonForChange: `Rollback to ${target.label}: ${reason}`,
      changeSummary: `Restores the content of ${target.label}`,
    });
    const rev = await tx.policyRevision.create({
      data: { policyId, organisationId: policy.organisationId, kind: "ROLLBACK", baseVersionId: policy.currentPublishedVersionId, draftVersionId: draft.id, title: `Rollback ${policy.ref} to ${target.label}`, explanation: reason, createdById: ctx.userId, authorId: ctx.userId },
    });
    await audit({ organisationId: policy.organisationId, actorId: ctx.userId, action: "revision.rollback_created", entityType: "PolicyRevision", entityId: rev.id, data: { targetVersionId, reason } }, tx);
    return rev;
  });
}

export async function editDraftSection(ctx: Ctx, revisionId: string, key: string, input: { heading?: string; body: string }) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "author");
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(r.draftVersion.status)) throw new ConflictError(`Cannot edit a ${r.draftVersion.status} version`);
  if (!input.body.trim()) throw new ValidationError("Section text cannot be empty");
  await db.$transaction(async (tx) => {
    const section = await tx.policySection.findUnique({ where: { versionId_key: { versionId: r.draftVersionId, key } } });
    if (!section) throw new NotFoundError("Section");
    await tx.policySection.update({ where: { id: section.id }, data: { body: input.body, heading: input.heading ?? section.heading } });
    const all = await tx.policySection.findMany({ where: { versionId: r.draftVersionId } });
    await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { contentHash: sectionsHash(toSectionInputs(all)) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.section_edited", entityType: "PolicyRevision", entityId: r.id, data: { key } }, tx);
  });
  if (!r.authorId) await db.policyRevision.update({ where: { id: r.id }, data: { authorId: ctx.userId } });
}

export async function addComment(ctx: Ctx, revisionId: string, body: string, sectionKey?: string) {
  const r = await loadRevision(revisionId);
  if (!canOnPolicy(ctx, r.policy, "review") && !canOnPolicy(ctx, r.policy, "author")) throw new ForbiddenError();
  if (!body.trim()) throw new ValidationError("Comment cannot be empty");
  return db.revisionComment.create({ data: { revisionId, authorId: ctx.userId, body, sectionKey } });
}

export async function submitForReview(ctx: Ctx, revisionId: string, input: { approverIds?: string[]; reviewerIds?: string[]; note?: string } = {}) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "author");
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(r.draftVersion.status)) throw new ConflictError(`Revision is ${r.draftVersion.status}`);
  if (r.baseVersionId) {
    const base = await db.policyVersion.findUniqueOrThrow({ where: { id: r.baseVersionId } });
    if (base.contentHash === r.draftVersion.contentHash) throw new ValidationError("The draft is identical to the approved version; there is nothing to review");
  }
  if (await db.policyGenerationRun.findUnique({ where: { revisionId: r.id }, select: { id: true } })) {
    const marked = await db.policySection.findMany({ where: { versionId: r.draftVersionId, body: { contains: REVIEW_MARKER } }, select: { heading: true } });
    if (marked.length) throw new ValidationError(`Complete the sections marked "${REVIEW_MARKER}" before submitting: ${marked.map((m) => m.heading).join(", ")}.`);
  }
  const authorId = r.authorId ?? ctx.userId;
  const eligible = (await eligibleApprovers(r.policy)).filter((id) => id !== authorId);
  const approvers = (input.approverIds?.length ? input.approverIds : r.policy.approverId ? [r.policy.approverId] : eligible).filter((id) => eligible.includes(id));
  if (!approvers.length) throw new ConflictError("No eligible approver other than the author is available; approvals require separation of duties");
  const reviewers = (input.reviewerIds ?? (r.policy.reviewerId ? [r.policy.reviewerId] : [])).filter((id) => id !== authorId);

  await db.$transaction(async (tx) => {
    await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: "UNDER_REVIEW" } });
    await tx.policyRevision.update({ where: { id: r.id }, data: { authorId, submittedAt: new Date() } });
    for (const id of approvers) await tx.reviewAssignment.upsert({ where: { revisionId_assigneeId_role: { revisionId: r.id, assigneeId: id, role: "APPROVER" } }, create: { revisionId: r.id, assigneeId: id, role: "APPROVER", dueAt: r.dueAt }, update: { status: "PENDING", dueAt: r.dueAt } });
    for (const id of reviewers) await tx.reviewAssignment.upsert({ where: { revisionId_assigneeId_role: { revisionId: r.id, assigneeId: id, role: "REVIEWER" } }, create: { revisionId: r.id, assigneeId: id, role: "REVIEWER", dueAt: r.dueAt }, update: { status: "PENDING", dueAt: r.dueAt } });
    if (input.note) await tx.revisionComment.create({ data: { revisionId: r.id, authorId: ctx.userId, body: input.note } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.submitted", entityType: "PolicyRevision", entityId: r.id, data: { approvers, reviewers } }, tx);
  });
  const round = await db.auditLog.count({ where: { entityId: r.id, action: "revision.submitted" } });
  await notify({
    organisationId: r.organisationId,
    userIds: [...approvers, ...reviewers],
    type: "revision.awaiting_review",
    title: `${r.isSimulated ? "[SIMULATED] " : ""}Draft awaiting your review: ${r.policy.ref} ${r.policy.title}`,
    body: `${r.title}. ${r.urgency === "URGENT" || r.urgency === "HIGH" ? `Urgency: ${r.urgency}. ` : ""}You have been asked for a second opinion. Review is optional: an authorised publisher can still publish the draft.`,
    reason: "You are assigned as a reviewer or approver for this policy revision.",
    links: [{ label: "Review draft", url: `/revisions/${r.id}` }],
    actionUrl: `/revisions/${r.id}`,
    dueAt: r.dueAt,
    dedupeKey: `revision-review:${r.id}:${round}`,
  });
}

export async function decide(ctx: Ctx, revisionId: string, input: { decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT"; comment: string }) {
  const r = await loadRevision(revisionId);
  if (r.draftVersion.status !== "UNDER_REVIEW") throw new ConflictError(`Revision is ${r.draftVersion.status}, not under review`);
  if (r.authorId === ctx.userId || r.createdById === ctx.userId) throw new ForbiddenError("Authors cannot review or approve their own revision");
  if (!input.comment?.trim()) throw new ValidationError("A comment is required with every decision");
  const isApprover = canOnPolicy(ctx, r.policy, "approve");
  const isReviewer = canOnPolicy(ctx, r.policy, "review");
  if (!isApprover && !isReviewer) throw new ForbiddenError("You are not a reviewer or approver for this policy");
  if (input.decision === "APPROVE" && !isApprover && !isReviewer) throw new ForbiddenError();
  const role = isApprover ? "APPROVER" : "REVIEWER";

  return db.$transaction(async (tx) => {
    await tx.approvalDecision.create({ data: { revisionId: r.id, versionId: r.draftVersionId, deciderId: ctx.userId, role, decision: input.decision, comment: input.comment } });
    await tx.reviewAssignment.updateMany({ where: { revisionId: r.id, assigneeId: ctx.userId }, data: { status: "COMPLETED" } });
    let newStatus: PolicyVersion["status"] = "UNDER_REVIEW";
    if (input.decision === "REQUEST_CHANGES") newStatus = "CHANGES_REQUESTED";
    else if (input.decision === "REJECT" && isApprover) newStatus = "REJECTED";
    else if (input.decision === "APPROVE" && isApprover) {
      const approvals = await tx.approvalDecision.findMany({
        where: { revisionId: r.id, versionId: r.draftVersionId, role: "APPROVER", decision: "APPROVE", createdAt: { gte: r.submittedAt ?? new Date(0) } },
        distinct: ["deciderId"],
      });
      if (approvals.length >= OPTIONAL_REVIEW_APPROVALS) newStatus = "APPROVED";
    }
    if (newStatus !== "UNDER_REVIEW") {
      await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: newStatus, approvedAt: newStatus === "APPROVED" ? new Date() : undefined } });
      if (newStatus === "REJECTED") await tx.policyRevision.update({ where: { id: r.id }, data: { closedAt: new Date() } });
    }
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: `revision.${input.decision.toLowerCase()}`, entityType: "PolicyRevision", entityId: r.id, data: { role, comment: input.comment, resultingStatus: newStatus } }, tx);
    if (newStatus === "CHANGES_REQUESTED" && r.authorId) {
      await notify({
        organisationId: r.organisationId,
        userIds: [r.authorId],
        type: "revision.changes_requested",
        title: `Changes requested: ${r.policy.ref} ${r.policy.title}`,
        body: input.comment,
        reason: "You are the author of this revision.",
        links: [{ label: "Open draft", url: `/revisions/${r.id}` }],
        actionUrl: `/revisions/${r.id}`,
        dedupeKey: `revision-changes:${r.id}:${Date.now()}`,
      });
    }
    return newStatus;
  });
}

/** Version states a publisher can take straight to publication. UNDER_REVIEW and APPROVED are legacy states. */
export const PUBLISHABLE_STATES = ["DRAFT", "CHANGES_REQUESTED", "UNDER_REVIEW", "APPROVED"] as const;
const EDITABLE_STATES = ["DRAFT", "CHANGES_REQUESTED"];

export type PublishInput = {
  effectiveDate?: Date;
  scheduleFor?: Date | null;
  requireAcknowledgement?: boolean;
  acknowledgementDueDays?: number;
  materialRevision?: boolean;
  governance?: Partial<Record<GovernanceKey, boolean>>;
  assignBranchStaff?: boolean;
  /** What changed, shown in version history and the monthly updates register. Required when replacing a published version. */
  changeSummary?: string;
};

/**
 * Checks a draft is fit to publish: it has content, its stored fingerprint matches its sections, it differs from the
 * version it replaces, generated drafts have no "review required" markers left, and automatic revisions have not
 * changed any of the organisation's local sections.
 */
async function validateForPublication(r: RevisionFull) {
  const sections = await db.policySection.findMany({ where: { versionId: r.draftVersionId }, orderBy: { position: "asc" } });
  if (!sections.length) throw new ValidationError("Add at least one section before publishing");
  const empty = sections.filter((s) => !s.body.trim() || !s.heading.trim());
  if (empty.length) throw new ValidationError(`Complete these sections before publishing: ${empty.map((s) => s.heading || s.key).join(", ")}`);
  const inputs = toSectionInputs(sections);
  if (r.draftVersion.contentHash && r.draftVersion.contentHash !== sectionsHash(inputs)) throw new ConflictError("The draft changed while it was being published. Reload it and try again.");
  if (await db.policyGenerationRun.findUnique({ where: { revisionId: r.id }, select: { id: true } })) {
    const marked = sections.filter((s) => s.body.includes(REVIEW_MARKER));
    if (marked.length) throw new ValidationError(`Complete the sections marked "${REVIEW_MARKER}" before publishing: ${marked.map((m) => m.heading).join(", ")}.`);
  }
  if (!r.baseVersionId) return;
  const base = await db.policyVersion.findUniqueOrThrow({ where: { id: r.baseVersionId }, include: { sections: true } });
  if (base.contentHash === sectionsHash(inputs)) throw new ValidationError("The draft is identical to the current published version; there is nothing to publish");
  // An automatic revision (regulatory or central update) must never change customer-owned local sections by accident.
  if (r.kind === "REGULATORY" || r.kind === "MASTER_SYNC") {
    const draftByKey = new Map(inputs.map((s) => [s.key, s]));
    const touched = base.sections.filter((b) => b.isLocal && draftByKey.get(b.key)?.body !== b.body);
    if (touched.length) throw new ConflictError(`This automatic revision changes your local section(s) ${touched.map((t) => t.heading).join(", ")}. Restore your wording before publishing.`);
  }
}

/**
 * Publishes now, or schedules publication for a future date. An authorised publisher (policy.publish for organisation
 * documents, master.publish for CSB central content) publishes directly: no review or second-person approval is needed.
 * Drafts that were sent for review under the old process can be published too; their review is closed, never deleted.
 */
export async function publishRevision(ctx: Ctx, revisionId: string, input: PublishInput = {}) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "publish");
  if (r.policy.status !== "ACTIVE") throw new ConflictError("This policy is archived. Restore it before publishing.");
  if (r.closedAt) throw new ConflictError("This draft is closed and can no longer be published");
  if (!(PUBLISHABLE_STATES as readonly string[]).includes(r.draftVersion.status)) {
    throw new ConflictError(r.draftVersion.status === "SCHEDULED" ? "This draft is already scheduled for publication" : `A ${r.draftVersion.status.toLowerCase().replace(/_/g, " ")} version cannot be published`);
  }
  // Fail fast on a stale draft; performPublication re-checks under a row lock.
  if ((r.baseVersionId ?? null) !== (r.policy.currentPublishedVersionId ?? null)) {
    throw new ConflictError("The policy was republished after this draft was created. Start a new revision from the current version.");
  }
  await validateForPublication(r);
  const summary = input.changeSummary?.trim() || r.draftVersion.changeSummary?.trim() || "";
  if (r.baseVersionId && !summary && !r.draftVersion.reasonForChange?.trim()) throw new ValidationError("Describe what changed in this version");
  if (summary.length > 2000) throw new ValidationError("Keep the summary of changes under 2,000 characters");
  // Generated (branch-specific) drafts also need the manager's pre-publication confirmations and no open critical gaps.
  const governanceChecks = await generatedPublicationCheck(r.id, r.draftVersionId, input.governance, ctx.userId);
  const now = new Date();
  const scheduleFor = input.scheduleFor && input.scheduleFor > now ? input.scheduleFor : null;
  const effectiveDate = input.effectiveDate ?? scheduleFor ?? now;
  const requireAck = input.requireAcknowledgement ?? r.policy.kind === "CUSTOMER";
  const ackDue = new Date((scheduleFor ?? now).getTime() + (input.acknowledgementDueDays ?? 14) * 86400_000);
  const legacyStatus = r.draftVersion.status;
  const approvalsRecorded = await db.approvalDecision.count({ where: { versionId: r.draftVersionId, decision: "APPROVE" } });

  const publication = await db.$transaction(async (tx) => {
    // Only moves from the state we checked, so two publishers acting at once cannot both succeed.
    if (legacyStatus === "UNDER_REVIEW") {
      const moved = await tx.policyVersion.updateMany({ where: { id: r.draftVersionId, status: "UNDER_REVIEW" }, data: { status: "DRAFT" } });
      if (!moved.count) throw new ConflictError("This draft changed while it was being published. Reload it and try again.");
    }
    const editable = legacyStatus === "UNDER_REVIEW" || EDITABLE_STATES.includes(legacyStatus);
    if (editable && summary && summary !== r.draftVersion.changeSummary) await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { changeSummary: summary } });
    // Reviews requested under the old process are closed, not deleted: they stay on the revision as history.
    await tx.reviewAssignment.updateMany({ where: { revisionId: r.id, status: "PENDING" }, data: { status: "CLOSED" } });
    const existing = await tx.policyPublication.findUnique({ where: { versionId: r.draftVersionId } });
    if (existing && existing.status !== "CANCELLED") throw new ConflictError("This draft has already been published or scheduled");
    const data = {
      status: scheduleFor ? ("SCHEDULED" as const) : ("PUBLISHED" as const),
      scheduledFor: scheduleFor,
      publishedAt: null,
      effectiveDate,
      publishedById: ctx.userId,
      requiresAcknowledgement: requireAck,
      // A material change is assigned to staff again; a non-material one keeps the previous acknowledgements as evidence.
      materialRevision: input.materialRevision ?? true,
      acknowledgementDueAt: requireAck ? ackDue : null,
      governanceChecks: governanceChecks ?? undefined,
    };
    // A cancelled schedule keeps its row (one publication per version); publishing again reuses it.
    const pub = existing
      ? await tx.policyPublication.update({ where: { id: existing.id }, data })
      : await tx.policyPublication.create({ data: { ...data, policyId: r.policyId, organisationId: r.organisationId, versionId: r.draftVersionId } });
    if (scheduleFor) await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: "SCHEDULED", effectiveDate } });
    await audit(
      {
        organisationId: r.organisationId,
        actorId: ctx.userId,
        action: scheduleFor ? "revision.scheduled" : "revision.publish_requested",
        entityType: "PolicyRevision",
        entityId: r.id,
        data: { directPublication: true, previousStatus: legacyStatus, approvalsRecorded, scheduleFor: scheduleFor?.toISOString() ?? null, changeSummary: summary || null },
      },
      tx,
    );
    return pub;
  });
  if (governanceChecks && input.assignBranchStaff !== false) await db.$transaction((tx) => ensureBranchAssignmentRules(tx, r.id, ctx.userId));
  if (scheduleFor) {
    await enqueue("publication.publish", { publicationId: publication.id }, { idempotencyKey: `publish:${publication.id}:${scheduleFor.getTime()}`, runAfter: scheduleFor, maxAttempts: 3 });
    return { publicationId: publication.id, scheduled: true };
  }
  await performPublication(publication.id);
  return { publicationId: publication.id, scheduled: false };
}

/** Cancels a scheduled publication. The version returns to draft so it can be edited or published again. */
export async function cancelScheduledPublication(ctx: Ctx, revisionId: string) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "publish");
  if (r.draftVersion.status !== "SCHEDULED") throw new ConflictError("This draft is not scheduled");
  await db.$transaction(async (tx) => {
    const { count } = await tx.policyPublication.updateMany({ where: { versionId: r.draftVersionId, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    if (!count) throw new ConflictError("This publication has already gone ahead or been cancelled");
    await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: "DRAFT" } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.schedule_cancelled", entityType: "PolicyRevision", entityId: r.id }, tx);
  });
}

/** Brings a draft that was sent for review under the old process back to draft, so it can be edited. Its review history is kept. */
export async function returnToDraft(ctx: Ctx, revisionId: string) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "author");
  if (r.closedAt) throw new ConflictError("This draft is closed");
  if (r.draftVersion.status !== "UNDER_REVIEW") throw new ConflictError("Only a draft waiting for review can be returned to draft");
  await db.$transaction(async (tx) => {
    const { count } = await tx.policyVersion.updateMany({ where: { id: r.draftVersionId, status: "UNDER_REVIEW" }, data: { status: "DRAFT" } });
    if (!count) throw new ConflictError("This draft changed. Reload it and try again.");
    await tx.reviewAssignment.updateMany({ where: { revisionId: r.id, status: "PENDING" }, data: { status: "CLOSED" } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.returned_to_draft", entityType: "PolicyRevision", entityId: r.id }, tx);
  });
}

/** Withdraws a draft that will not be published. The version is kept (marked rejected) for the record. */
export async function discardDraft(ctx: Ctx, revisionId: string, reason: string) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "author");
  if (r.closedAt) throw new ConflictError("This draft is already closed");
  if (!EDITABLE_STATES.includes(r.draftVersion.status) && r.draftVersion.status !== "UNDER_REVIEW") throw new ConflictError(`A ${r.draftVersion.status.toLowerCase()} draft cannot be discarded`);
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for discarding the draft");
  await db.$transaction(async (tx) => {
    await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: "REJECTED" } });
    await tx.policyRevision.update({ where: { id: r.id }, data: { closedAt: new Date() } });
    await tx.reviewAssignment.updateMany({ where: { revisionId: r.id, status: "PENDING" }, data: { status: "CLOSED" } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.discarded", entityType: "PolicyRevision", entityId: r.id, data: { reason: reason.trim() } }, tx);
  });
}

/**
 * The publication transaction: locks the policy row, verifies the draft is based
 * on the version currently published (no lost updates), supersedes the old
 * version and publishes the new one atomically.
 */
export async function performPublication(publicationId: string) {
  const pub = await db.policyPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { version: { include: { revisionAsDraft: true } }, policy: true } });
  if (pub.status === "PUBLISHED" && pub.publishedAt) return pub; // idempotent
  if (pub.status === "CANCELLED") throw new PermanentJobError("Publication was cancelled");
  // A job left over from an earlier schedule must not publish before the current scheduled time.
  if (pub.status === "SCHEDULED" && pub.scheduledFor && pub.scheduledFor.getTime() > Date.now() + 1000) return pub;
  const revision = pub.version.revisionAsDraft;
  try {
    await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ currentPublishedVersionId: string | null }[]>`SELECT "currentPublishedVersionId" FROM "Policy" WHERE id = ${pub.policyId} FOR UPDATE`;
        const current = rows[0]?.currentPublishedVersionId ?? null;
        const expectedBase = revision?.baseVersionId ?? null;
        if (current !== expectedBase) {
          throw new ConflictError("The policy was republished after this draft was created. Rebase the draft on the current version before publishing.");
        }
        const now = new Date();
        if (current) await tx.policyVersion.update({ where: { id: current }, data: { status: "SUPERSEDED", supersededAt: now } });
        await tx.policyVersion.update({ where: { id: pub.versionId }, data: { status: "PUBLISHED", publishedAt: now, effectiveDate: pub.effectiveDate } });
        await tx.policy.update({
          where: { id: pub.policyId },
          data: {
            currentPublishedVersionId: pub.versionId,
            lockVersion: { increment: 1 },
            nextReviewDate: new Date(now.getTime() + pub.policy.reviewIntervalMonths * 30.44 * 86400_000),
          },
        });
        await tx.policyPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", publishedAt: now } });
        if (revision) await tx.policyRevision.update({ where: { id: revision.id }, data: { closedAt: now } });
        if (pub.requiresAcknowledgement && pub.organisationId && pub.materialRevision) await assignPublication(tx, pub.id, { actorId: pub.publishedById });
        await audit({ organisationId: pub.organisationId, actorId: pub.publishedById, action: "policy.published", entityType: "PolicyVersion", entityId: pub.versionId, data: { publicationId: pub.id, superseded: current, changeSummary: pub.version.changeSummary, kind: pub.policy.kind } }, tx);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e instanceof ConflictError) {
      await db.policyPublication.update({ where: { id: pub.id }, data: { status: "CANCELLED" } });
      // The draft goes back to being a draft so it can be corrected; nothing is lost.
      await db.policyVersion.updateMany({ where: { id: pub.versionId, status: "SCHEDULED" }, data: { status: "DRAFT" } });
    }
    throw e;
  }
  await indexPolicyVersion(pub.versionId);
  await afterPublication(pub.id);
  return db.policyPublication.findUniqueOrThrow({ where: { id: pub.id } });
}

async function afterPublication(publicationId: string) {
  const pub = await db.policyPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { policy: true, version: true, acknowledgements: true } });
  const label = pub.version.isSimulated ? "[SIMULATED] " : "";
  if (pub.policy.kind === "MASTER") {
    await enqueue("master.sync", { masterVersionId: pub.versionId }, { idempotencyKey: `master.sync:${pub.versionId}` });
    return;
  }
  await notify({
    organisationId: pub.organisationId,
    userIds: pub.acknowledgements.filter((a) => !a.supersededAt).map((a) => a.userId).filter((u): u is string => !!u),
    type: "policy.published",
    title: `${label}Updated policy: ${pub.policy.ref} ${pub.policy.title} (${pub.version.label})`,
    body: `${pub.version.changeSummary ?? "This policy has been updated."} Effective from ${pub.effectiveDate.toDateString()}.${pub.requiresAcknowledgement ? " Please read it and confirm you have done so." : ""}`,
    reason: "This policy applies to your organisation and you are required to read it.",
    links: [{ label: "Read the policy", url: `/policies/${pub.policyId}` }],
    actionUrl: `/acknowledgements`,
    dueAt: pub.acknowledgementDueAt,
    dedupeKey: `published:${pub.id}`,
  });
}

/** The signed-in person acknowledges their own reading assignment (see assignment.ts for the rules). */
export async function acknowledge(ctx: Ctx, acknowledgementId: string) {
  return acknowledgeRow(ctx, acknowledgementId);
}

/** "Log Read & Sign" from a policy page: records that the signed-in user has read the policy's current version, whether or not it was on their reading list. */
export async function logReadAndSign(ctx: Ctx, policyId: string) {
  if (!ctx.organisationId) throw new ForbiddenError();
  const policy = await db.policy.findFirst({ where: { id: policyId, organisationId: ctx.organisationId } });
  if (!policy) throw new NotFoundError("Policy");
  const pub = await materialPublication(db, policyId);
  if (!pub) throw new ConflictError("This policy has not been published to staff yet, so there is nothing to sign");
  const existing = await db.acknowledgement.findFirst({ where: { publicationId: pub.id, userId: ctx.userId, supersededAt: null } });
  if (existing?.acknowledgedAt) return existing;
  if (existing && (existing.state === "WITHDRAWN" || existing.state === "EXEMPTED")) throw new ConflictError("This policy is no longer on your reading list");
  const row = existing ?? (await db.$transaction(async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { organisationId: ctx.organisationId!, userId: ctx.userId }, select: { id: true } });
    const created = await tx.acknowledgement.create({ data: { publicationId: pub.id, organisationId: ctx.organisationId!, userId: ctx.userId, staffMemberId: staff?.id ?? null, mandatory: false } });
    await tx.acknowledgementEvent.create({ data: { organisationId: created.organisationId, acknowledgementId: created.id, type: "ASSIGNED", actorId: ctx.userId, note: "Self-recorded from the policy page" } });
    return created;
  }));
  return acknowledgeRow(ctx, row.id);
}

/** Separate stage: the organisation confirms it has implemented the change in practice. */
export async function confirmImplementation(ctx: Ctx, publicationId: string, notes: string) {
  const pub = await db.policyPublication.findUnique({ where: { id: publicationId } });
  if (!pub || pub.organisationId !== ctx.organisationId) throw new NotFoundError("Publication");
  if (!ctx.orgRoles.some((r) => r === "COMPLIANCE_LEAD" || r === "ORG_ADMIN")) throw new ForbiddenError();
  if (pub.status !== "PUBLISHED") throw new ConflictError("Only published versions can be confirmed as implemented");
  if (!notes.trim()) throw new ValidationError("Describe how the change was implemented");
  await db.policyPublication.update({ where: { id: pub.id }, data: { implementationConfirmedAt: new Date(), implementationConfirmedById: ctx.userId, implementationNotes: notes } });
  await audit({ organisationId: pub.organisationId, actorId: ctx.userId, action: "publication.implementation_confirmed", entityType: "PolicyPublication", entityId: pub.id, data: { notes } });
}

/** Reminders and escalation live with the assignment rules. */
export { sendAcknowledgementReminders } from "./assignment";

export async function publishDueScheduled(now = new Date()) {
  const due = await db.policyPublication.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: now } } });
  for (const p of due) await enqueue("publication.publish", { publicationId: p.id }, { idempotencyKey: `publish:${p.id}:${p.scheduledFor!.getTime()}`, runAfter: now });
  return due.length;
}

export type { SectionInput };
