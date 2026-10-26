import type { Policy, PolicyRevision, PolicyVersion } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { canOnPolicy, requireOnPolicy, type Ctx } from "../auth/rbac";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { notify, usersWithOrgRoles } from "../notifications/notify";
import { indexPolicyVersion } from "../search/index-chunks";
import { createDraftVersion, sectionsHash, toSectionInputs, type SectionInput } from "./versions";

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

function requiredApprovals(policy: Policy, orgSettings: unknown): number {
  const s = (orgSettings ?? {}) as { requiredApprovals?: number };
  return policy.kind === "MASTER" ? 1 : Math.max(1, s.requiredApprovals ?? 1);
}

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

/** Rollback never rewrites history: it drafts a new version from an earlier one, which must be approved. */
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
    body: `${r.title}. ${r.urgency === "URGENT" || r.urgency === "HIGH" ? `Urgency: ${r.urgency}. ` : ""}Approval is required before anything is published.`,
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
  const org = r.organisationId ? await db.organisation.findUnique({ where: { id: r.organisationId } }) : null;

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
      if (approvals.length >= requiredApprovals(r.policy, org?.settings)) newStatus = "APPROVED";
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

/** Publishes now, or schedules publication for a future date. Only approved versions can be published. */
export async function publishRevision(
  ctx: Ctx,
  revisionId: string,
  input: { effectiveDate?: Date; scheduleFor?: Date | null; requireAcknowledgement?: boolean; acknowledgementDueDays?: number } = {},
) {
  const r = await loadRevision(revisionId);
  requireOnPolicy(ctx, r.policy, "publish");
  if (r.draftVersion.status !== "APPROVED") throw new ConflictError("Only an approved version can be published. Human approval is mandatory.");
  const now = new Date();
  const scheduleFor = input.scheduleFor && input.scheduleFor > now ? input.scheduleFor : null;
  const effectiveDate = input.effectiveDate ?? scheduleFor ?? now;
  const requireAck = input.requireAcknowledgement ?? r.policy.kind === "CUSTOMER";
  const ackDue = new Date((scheduleFor ?? now).getTime() + (input.acknowledgementDueDays ?? 14) * 86400_000);

  const publication = await db.policyPublication.create({
    data: {
      policyId: r.policyId,
      organisationId: r.organisationId,
      versionId: r.draftVersionId,
      status: scheduleFor ? "SCHEDULED" : "PUBLISHED",
      scheduledFor: scheduleFor,
      effectiveDate,
      publishedById: ctx.userId,
      requiresAcknowledgement: requireAck,
      acknowledgementDueAt: requireAck ? ackDue : null,
    },
  });
  if (scheduleFor) {
    await db.policyVersion.update({ where: { id: r.draftVersionId }, data: { status: "SCHEDULED", effectiveDate } });
    await enqueue("publication.publish", { publicationId: publication.id }, { idempotencyKey: `publish:${publication.id}`, runAfter: scheduleFor, maxAttempts: 3 });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "revision.scheduled", entityType: "PolicyRevision", entityId: r.id, data: { scheduleFor: scheduleFor.toISOString() } });
    return { publicationId: publication.id, scheduled: true };
  }
  await performPublication(publication.id);
  return { publicationId: publication.id, scheduled: false };
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
        if (pub.requiresAcknowledgement && pub.organisationId) await createAcknowledgements(tx, pub.id, pub.organisationId, pub.policy.branchId, pub.acknowledgementDueAt);
        await audit({ organisationId: pub.organisationId, actorId: pub.publishedById, action: "policy.published", entityType: "PolicyVersion", entityId: pub.versionId, data: { publicationId: pub.id, superseded: current } }, tx);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e instanceof ConflictError) {
      await db.policyPublication.update({ where: { id: pub.id }, data: { status: "CANCELLED" } });
      if (pub.version.status === "SCHEDULED") await db.policyVersion.update({ where: { id: pub.versionId }, data: { status: "APPROVED" } });
    }
    throw e;
  }
  await indexPolicyVersion(pub.versionId);
  await afterPublication(pub.id);
  return db.policyPublication.findUniqueOrThrow({ where: { id: pub.id } });
}

async function createAcknowledgements(tx: Tx, publicationId: string, organisationId: string, branchId: string | null, dueAt: Date | null) {
  const members = await tx.membership.findMany({ where: { organisationId, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) }, select: { userId: true } });
  await tx.acknowledgement.createMany({ data: members.map((m) => ({ publicationId, organisationId, userId: m.userId, dueAt })), skipDuplicates: true });
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
    userIds: pub.acknowledgements.map((a) => a.userId),
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

export async function acknowledge(ctx: Ctx, acknowledgementId: string) {
  const ack = await db.acknowledgement.findUnique({ where: { id: acknowledgementId } });
  if (!ack || ack.userId !== ctx.userId || ack.organisationId !== ctx.organisationId) throw new NotFoundError("Acknowledgement");
  if (ack.acknowledgedAt) return ack;
  const updated = await db.acknowledgement.update({ where: { id: ack.id }, data: { acknowledgedAt: new Date() } });
  await audit({ organisationId: ack.organisationId, actorId: ctx.userId, action: "policy.acknowledged", entityType: "Acknowledgement", entityId: ack.id });
  return updated;
}

/** "Log Read & Sign" from a policy page: records that the signed-in user has read the policy's current publication, whether or not it was on their reading list. */
export async function logReadAndSign(ctx: Ctx, policyId: string) {
  if (!ctx.organisationId) throw new ForbiddenError();
  const pub = await db.policyPublication.findFirst({ where: { policyId, organisationId: ctx.organisationId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } });
  if (!pub) throw new ConflictError("This policy has not been published to staff yet, so there is nothing to sign");
  const existing = await db.acknowledgement.findUnique({ where: { publicationId_userId: { publicationId: pub.id, userId: ctx.userId } } });
  if (existing?.acknowledgedAt) return existing;
  const ack = existing
    ? await db.acknowledgement.update({ where: { id: existing.id }, data: { acknowledgedAt: new Date() } })
    : await db.acknowledgement.create({ data: { publicationId: pub.id, organisationId: ctx.organisationId, userId: ctx.userId, acknowledgedAt: new Date() } });
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "policy.acknowledged", entityType: "Acknowledgement", entityId: ack.id, data: { from: "policy page" } });
  return ack;
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

/** Sends one reminder per day for overdue acknowledgements. */
export async function sendAcknowledgementReminders(now = new Date()) {
  const overdue = await db.acknowledgement.findMany({ where: { acknowledgedAt: null, dueAt: { lt: now } }, include: { publication: { include: { policy: true } } } });
  let sent = 0;
  for (const a of overdue) {
    sent += await notify({
      organisationId: a.organisationId,
      userIds: [a.userId],
      type: "acknowledgement.overdue",
      title: `Overdue: please read ${a.publication.policy.ref} ${a.publication.policy.title}`,
      body: `Your acknowledgement was due on ${a.dueAt?.toDateString()}.`,
      reason: "You are required to read this policy.",
      links: [{ label: "Read and acknowledge", url: `/acknowledgements` }],
      actionUrl: `/acknowledgements`,
      dueAt: a.dueAt,
      dedupeKey: `ack-overdue:${a.id}:${now.toISOString().slice(0, 10)}`,
    });
  }
  return sent;
}

export async function publishDueScheduled(now = new Date()) {
  const due = await db.policyPublication.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: now } } });
  for (const p of due) await enqueue("publication.publish", { publicationId: p.id }, { idempotencyKey: `publish:${p.id}`, runAfter: now });
  return due.length;
}

export type { SectionInput };
