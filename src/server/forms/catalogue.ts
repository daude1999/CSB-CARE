import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";

/**
 * The Forms & Resources register in the Policy Library (`/policies/forms`). It lists existing versioned CSB documents
 * (forms, templates, checklists, audit tools and risk assessment templates). A downloadable document is not a digital
 * form: nothing here records a completed form.
 */
export const RESOURCE_DOC_TYPES = ["FORM", "TEMPLATE", "CHECKLIST", "AUDIT_TOOL", "RISK_ASSESSMENT"] as const;
export type ResourceDocType = (typeof RESOURCE_DOC_TYPES)[number];
export const RESOURCE_TYPE_LABELS: Record<ResourceDocType, string> = {
  FORM: "Form",
  TEMPLATE: "Template",
  CHECKLIST: "Checklist",
  AUDIT_TOOL: "Audit tool",
  RISK_ASSESSMENT: "Risk assessment template",
};
export const POLICY_DOC_TYPES = ["POLICY", "PROCEDURE", "GUIDANCE"] as const;

export function isResourceDocType(value: string): value is ResourceDocType {
  return (RESOURCE_DOC_TYPES as readonly string[]).includes(value);
}

/**
 * Which resources the caller sees: their organisation's own copies, plus CSB templates the organisation has not adopted
 * (so the same form is never listed twice). Without an organisation, the CSB templates only. Only active resources
 * with a published version, so a draft is never handed out as though it were approved.
 */
export function resourceRegisterWhere(ctx: Ctx): Prisma.PolicyWhereInput {
  const orgId = ctx.organisationId;
  const base: Prisma.PolicyWhereInput = { status: "ACTIVE", docType: { in: [...RESOURCE_DOC_TYPES] }, currentPublishedVersionId: { not: null } };
  const masters: Prisma.PolicyWhereInput = { kind: "MASTER", organisationId: null, ...(orgId ? { derived: { none: { organisationId: orgId } } } : {}) };
  return { AND: [base, orgId ? { OR: [{ kind: "CUSTOMER", organisationId: orgId }, masters] } : masters] };
}

export type RegisterFilters = { q: string; type: ResourceDocType | ""; category: string; page: number };
export const REGISTER_PAGE_SIZE = 25;

export async function resourceRegister(ctx: Ctx, f: RegisterFilters) {
  const where: Prisma.PolicyWhereInput = {
    AND: [
      resourceRegisterWhere(ctx),
      ...(f.type ? [{ docType: f.type }] : []),
      ...(f.category ? [{ categoryCode: f.category }] : []),
      ...(f.q
        ? [{ OR: [
            { ref: { contains: f.q, mode: "insensitive" as const } },
            { title: { contains: f.q, mode: "insensitive" as const } },
            { description: { contains: f.q, mode: "insensitive" as const } },
          ] }]
        : []),
    ],
  };
  const [total, categories] = await Promise.all([
    db.policy.count({ where }),
    db.policyCategory.findMany({ select: { code: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / REGISTER_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), pages);
  const rows = await db.policy.findMany({
    where,
    skip: (page - 1) * REGISTER_PAGE_SIZE,
    take: REGISTER_PAGE_SIZE,
    orderBy: [{ title: "asc" }, { ref: "asc" }],
    select: {
      id: true, ref: true, title: true, description: true, docType: true, kind: true, nextReviewDate: true,
      category: { select: { name: true } },
      currentPublishedVersion: { select: { label: true, origin: true, approvals: { where: { decision: "APPROVE" }, select: { id: true }, take: 1 } } },
      // Explicit links only; both ends of a link belong to the same organisation (enforced in the database).
      linkedFrom: { where: { withdrawnAt: null, policy: { status: "ACTIVE" } }, orderBy: { policy: { ref: "asc" } }, select: { policy: { select: { id: true, ref: true, title: true } } } },
    },
  });
  return {
    total, page, pages, categories,
    rows: rows.map((r) => ({
      id: r.id, ref: r.ref, title: r.title, description: r.description, kind: r.kind, nextReviewDate: r.nextReviewDate,
      typeLabel: isResourceDocType(r.docType) ? RESOURCE_TYPE_LABELS[r.docType] : r.docType,
      category: r.category.name,
      versionLabel: r.currentPublishedVersion?.label ?? null,
      approval: r.kind === "MASTER" ? ("STARTER" as const) : r.currentPublishedVersion?.approvals.length ? ("APPROVED" as const) : ("NOT_APPROVED" as const),
      policies: [...new Map(r.linkedFrom.map((l) => [l.policy.id, l.policy])).values()],
    })),
  };
}
