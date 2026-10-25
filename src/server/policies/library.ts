import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { canOnPolicy, hasOrgPermission, requireOnPolicy, requireOrgPermission, visiblePolicyWhere, type Ctx } from "../auth/rbac";
import { createDraftVersion, toSectionInputs, type SectionInput } from "./versions";
import { ForbiddenError } from "@/lib/errors";

export async function listPolicies(ctx: Ctx, opts: { q?: string; category?: string; kind?: "MASTER" | "CUSTOMER"; docType?: string; page?: number; pageSize?: number; overdueOnly?: boolean } = {}) {
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const page = Math.max(1, opts.page ?? 1);
  const where = {
    AND: [
      visiblePolicyWhere(ctx),
      opts.kind ? { kind: opts.kind } : {},
      opts.category ? { categoryCode: opts.category } : {},
      opts.docType ? { docType: opts.docType } : {},
      opts.q ? { OR: [{ title: { contains: opts.q, mode: "insensitive" as const } }, { ref: { contains: opts.q, mode: "insensitive" as const } }, { description: { contains: opts.q, mode: "insensitive" as const } }] } : {},
      opts.overdueOnly ? { nextReviewDate: { lt: new Date() } } : {},
      { status: "ACTIVE" as const },
    ],
  };
  const [total, items] = await Promise.all([
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: { category: true, currentPublishedVersion: true, revisions: { where: { closedAt: null }, select: { id: true, kind: true } } },
      orderBy: [{ kind: "desc" }, { title: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items, page, pageSize };
}

export async function getPolicy(ctx: Ctx, policyId: string) {
  const policy = await db.policy.findUnique({
    where: { id: policyId },
    include: {
      category: true,
      template: true,
      currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } },
      versions: { orderBy: { versionNumber: "desc" }, include: { revisionAsDraft: true, publication: true, approvals: true } },
      requirementLinks: { include: { requirement: true } },
      revisions: { orderBy: { createdAt: "desc" }, include: { draftVersion: true } },
      publications: { orderBy: { createdAt: "desc" }, include: { acknowledgements: true } },
      candidates: { include: { change: true }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!policy || !canOnPolicy(ctx, policy, "read")) throw new NotFoundError("Policy");
  return policy;
}

export async function createPolicy(
  ctx: Ctx,
  input: { ref: string; title: string; description: string; categoryCode: string; serviceTypes: string[]; sections: SectionInput[]; master?: boolean; reviewIntervalMonths?: number },
) {
  const isMaster = Boolean(input.master);
  if (isMaster) requireOnPolicy(ctx, { kind: "MASTER", organisationId: null }, "author");
  else requireOrgPermission(ctx, "policy.author");
  if (!input.title.trim() || !input.ref.trim()) throw new ValidationError("Reference and title are required");
  if (!input.sections.length) throw new ValidationError("A policy needs at least one section");
  const keys = new Set(input.sections.map((s) => s.key));
  if (keys.size !== input.sections.length) throw new ValidationError("Section keys must be unique");
  const organisationId = isMaster ? null : ctx.organisationId;
  const dup = await db.policy.findFirst({ where: { organisationId, ref: input.ref } });
  if (dup) throw new ConflictError(`A policy with reference ${input.ref} already exists`);
  return db.$transaction(async (tx) => {
    const policy = await tx.policy.create({
      data: {
        kind: isMaster ? "MASTER" : "CUSTOMER",
        organisationId,
        ref: input.ref,
        title: input.title,
        description: input.description,
        categoryCode: input.categoryCode,
        serviceTypes: input.serviceTypes,
        ownerId: ctx.userId,
        reviewIntervalMonths: input.reviewIntervalMonths ?? 12,
      },
    });
    const draft = await createDraftVersion(tx, { policyId: policy.id, organisationId, sections: input.sections, origin: "MANUAL", createdById: ctx.userId, reasonForChange: "New policy", changeSummary: "First version" });
    const rev = await tx.policyRevision.create({ data: { policyId: policy.id, organisationId, kind: "MANUAL", draftVersionId: draft.id, title: `New policy ${input.ref}`, createdById: ctx.userId, authorId: ctx.userId } });
    await audit({ organisationId, actorId: ctx.userId, action: "policy.created", entityType: "Policy", entityId: policy.id }, tx);
    return { policy, revision: rev };
  });
}

/** Creates a customer policy from a published master template. It is a draft until the organisation approves it. */
export async function adoptTemplate(ctx: Ctx, templateId: string) {
  const orgId = requireOrgPermission(ctx, "policy.author");
  const tpl = await db.policy.findUnique({ where: { id: templateId }, include: { currentPublishedVersion: { include: { sections: true } } } });
  if (!tpl || tpl.kind !== "MASTER") throw new NotFoundError("Template");
  if (!tpl.currentPublishedVersion) throw new ConflictError("This template has no published version yet");
  const exists = await db.policy.findFirst({ where: { organisationId: orgId, templateId } });
  if (exists) throw new ConflictError("Your organisation already uses this template");
  const sections = toSectionInputs(tpl.currentPublishedVersion.sections).map((s) => ({ ...s, masterKey: s.isLocal ? null : s.key }));
  return db.$transaction(async (tx) => {
    const policy = await tx.policy.create({
      data: { kind: "CUSTOMER", organisationId: orgId, templateId, ref: tpl.ref, docType: tpl.docType, title: tpl.title, description: tpl.description, categoryCode: tpl.categoryCode, serviceTypes: tpl.serviceTypes, jurisdiction: tpl.jurisdiction, ownerId: ctx.userId, reviewIntervalMonths: tpl.reviewIntervalMonths, supportingSourceDocumentIds: tpl.supportingSourceDocumentIds },
    });
    const draft = await createDraftVersion(tx, { policyId: policy.id, organisationId: orgId, sections, origin: "MASTER_SYNC", createdById: ctx.userId, basedOnMasterVersionId: tpl.currentPublishedVersion!.id, reasonForChange: `Adopted from template ${tpl.ref} ${tpl.currentPublishedVersion!.label}`, changeSummary: "Adopted from CSB template; complete the local sections before approval." });
    const rev = await tx.policyRevision.create({ data: { policyId: policy.id, organisationId: orgId, kind: "MASTER_SYNC", draftVersionId: draft.id, title: `Adopt template ${tpl.ref}`, createdById: ctx.userId, authorId: ctx.userId } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "policy.adopted_template", entityType: "Policy", entityId: policy.id, data: { templateId } }, tx);
    return { policy, revision: rev };
  });
}

export async function getRevision(ctx: Ctx, revisionId: string) {
  const r = await db.policyRevision.findUnique({
    where: { id: revisionId },
    include: {
      policy: true,
      draftVersion: { include: { sections: { orderBy: { position: "asc" } } } },
      baseVersion: true,
      impactAssessment: { include: { change: { include: { source: true } }, citations: true } },
      decisions: { orderBy: { createdAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      assignments: true,
      citations: { include: { sourceVersion: { include: { document: true } } } },
    },
  });
  if (!r || !canOnPolicy(ctx, r.policy, "read")) throw new NotFoundError("Revision");
  if (r.policy.kind === "CUSTOMER" && !hasOrgPermission(ctx, "policy.review") && !hasOrgPermission(ctx, "policy.author") && !hasOrgPermission(ctx, "policy.approve")) {
    throw new ForbiddenError("Drafts are visible to authors, reviewers and approvers only");
  }
  return r;
}
