import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { canOnPolicy, hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { POLICY_DOC_TYPES, RESOURCE_DOC_TYPES, RESOURCE_TYPE_LABELS, isResourceDocType } from "./catalogue";

/**
 * Explicit links from a policy or procedure to the forms, templates, checklists and tools it relies on (Forms PR 1).
 *
 * A link belongs to one organisation (or to the CSB master library) and can be placed at one stable section of the
 * policy, normally a procedure step (`procedure.reporting`). The database guarantees both ends are in the same
 * organisation and that a link is only ever withdrawn, never edited, so its history stays.
 *
 * Until every policy has been checked, the reader still offers resources whose "Related policies" text names the
 * policy (the old behaviour) when no explicit link, active or withdrawn, exists for that pair. Those are labelled.
 */

export type ResourcePlacement = { sectionKey: string; heading: string; step: number | null };

/** One explicit link of a resource to this policy: where it is used and why. */
export type ResourceUse = {
  linkId: string;
  /** Where in the policy the resource is used; null for the whole document or when the section no longer exists. */
  placement: ResourcePlacement | null;
  /** The link names a section the current version does not have (renamed or removed in a later revision). */
  placementMissing: boolean;
  useWhen: string | null;
  required: boolean;
};

/** A resource offered with a policy, once, with every place it is linked. */
export type LinkedResource = {
  id: string;
  ref: string;
  title: string;
  docType: string;
  typeLabel: string;
  versionLabel: string | null;
  starter: boolean;
  /** Explicit links, in their order; empty for a resource named only in text. */
  uses: ResourceUse[];
  /** Required at any of its places. */
  required: boolean;
  /** LINK: an explicit link. TEXT: only the resource's "Related policies" text names this policy. */
  source: "LINK" | "TEXT";
};

type SectionLike = { key: string; heading: string };

/** Procedure steps are the policy's `procedure.*` sections, numbered in reading order like the Policy Reader. */
export function placementsFor(sections: SectionLike[]): ResourcePlacement[] {
  let step = 0;
  return sections.filter((s) => s.key.startsWith("procedure.")).map((s) => ({ sectionKey: s.key, heading: s.heading, step: ++step }));
}

const resourceSelect = {
  id: true, ref: true, title: true, docType: true, status: true,
  currentPublishedVersion: { select: { label: true, origin: true, approvals: { where: { decision: "APPROVE" as const }, select: { id: true }, take: 1 } } },
} as const;

/**
 * The resources a reader of this policy is offered: explicit links first (in their order), then resources linked only
 * by "Related policies" text. Only active resources with a published version, in the policy's own organisation (or
 * CSB masters for a master policy). The caller must already have checked the reader may read the policy.
 */
export async function linkedResourcesFor(policy: { id: string; ref: string; organisationId: string | null }, sections: SectionLike[]): Promise<LinkedResource[]> {
  const placements = new Map(placementsFor(sections).map((p) => [p.sectionKey, p]));
  const headings = new Map(sections.map((s) => [s.key, s.heading]));
  const live = { status: "ACTIVE" as const, currentPublishedVersionId: { not: null }, organisationId: policy.organisationId };
  const [links, everLinked] = await Promise.all([
    db.policyResourceLink.findMany({
      where: { policyId: policy.id, withdrawnAt: null, resource: live },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sectionKey: true, useWhen: true, required: true, resource: { select: resourceSelect } },
    }),
    db.policyResourceLink.findMany({ where: { policyId: policy.id }, select: { resourceId: true } }),
  ]);
  const skip = [...new Set([policy.id, ...everLinked.map((l) => l.resourceId)])];
  const text = await db.policy.findMany({
    where: { ...live, docType: { in: [...RESOURCE_DOC_TYPES] }, id: { notIn: skip }, currentPublishedVersion: { sections: { some: { key: "related", body: { contains: policy.ref } } } } },
    orderBy: { ref: "asc" },
    select: resourceSelect,
  });
  const view = (r: (typeof text)[number]) => ({
    id: r.id, ref: r.ref, title: r.title, docType: r.docType,
    typeLabel: isResourceDocType(r.docType) ? RESOURCE_TYPE_LABELS[r.docType] : r.docType,
    versionLabel: r.currentPublishedVersion?.label ?? null,
    starter: r.currentPublishedVersion?.origin === "SEED" && !r.currentPublishedVersion.approvals.length,
  });
  const byResource = new Map<string, LinkedResource>();
  for (const l of links) {
    const placement = l.sectionKey ? placements.get(l.sectionKey) ?? (headings.has(l.sectionKey) ? { sectionKey: l.sectionKey, heading: headings.get(l.sectionKey)!, step: null } : null) : null;
    const use: ResourceUse = { linkId: l.id, placement, placementMissing: Boolean(l.sectionKey && !placement), useWhen: l.useWhen, required: l.required };
    const item = byResource.get(l.resource.id) ?? { ...view(l.resource), uses: [], required: false, source: "LINK" as const };
    item.uses.push(use);
    item.required ||= l.required;
    byResource.set(l.resource.id, item);
  }
  return [...byResource.values(), ...text.map((r): LinkedResource => ({ ...view(r), uses: [], required: false, source: "TEXT" }))];
}

// ───────── managing links (organisation policies only)

const Id = z.string().regex(/^[a-z0-9]{8,40}$/i, "That record could not be found");
export const AddResourceLinkInput = z.object({
  policyId: Id,
  resourceId: z.string().regex(/^[a-z0-9]{8,40}$/i, "Choose a form or resource"),
  sectionKey: z.string().trim().max(120).regex(/^[a-z0-9._-]*$/i, "Choose where in the policy the form is used").optional().transform((v) => v || null),
  useWhen: z.string().trim().max(300, "Keep \"use when\" to 300 characters").optional().transform((v) => v || null),
  required: z.boolean().default(false),
});
export const WithdrawResourceLinkInput = z.object({
  linkId: Id,
  reason: z.string().trim().min(5, "Give a reason of at least a few words").max(500),
});

async function editablePolicy(ctx: Ctx, policyId: string) {
  const orgId = requireOrgPermission(ctx, "policy.author");
  const policy = await db.policy.findFirst({
    where: { id: policyId, organisationId: orgId, kind: "CUSTOMER" },
    select: { id: true, ref: true, status: true, docType: true, currentPublishedVersionId: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  if (!policy) throw new NotFoundError("Policy");
  if (!(POLICY_DOC_TYPES as readonly string[]).includes(policy.docType)) throw new ValidationError("Forms are linked from a policy, procedure or guidance document, not from another resource");
  if (policy.status !== "ACTIVE") throw new ConflictError("Archived policies cannot be changed. Restore it first.");
  return { orgId, policy };
}

/** The sections a link can be placed at: the published version's, or the latest draft's when nothing is published yet. */
async function sectionsOf(policy: { currentPublishedVersionId: string | null; versions: { id: string }[] }) {
  const versionId = policy.currentPublishedVersionId ?? policy.versions[0]?.id;
  return versionId ? db.policySection.findMany({ where: { versionId }, orderBy: { position: "asc" }, select: { key: true, heading: true } }) : [];
}

export async function addResourceLink(ctx: Ctx, raw: z.input<typeof AddResourceLinkInput>) {
  const parsed = AddResourceLinkInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Some details are missing");
  const input = parsed.data;
  const { orgId, policy } = await editablePolicy(ctx, input.policyId);
  const resource = await db.policy.findFirst({ where: { id: input.resourceId, organisationId: orgId, kind: "CUSTOMER", status: "ACTIVE", docType: { in: [...RESOURCE_DOC_TYPES] } }, select: { id: true, ref: true } });
  if (!resource) throw new ValidationError("Choose a form or resource from your organisation's library");
  if (input.sectionKey && !(await sectionsOf(policy)).some((s) => s.key === input.sectionKey)) throw new ValidationError("That step is not in this policy. Refresh the page and try again.");
  try {
    return await db.$transaction(async (tx) => {
      const same = await tx.policyResourceLink.findFirst({ where: { policyId: policy.id, resourceId: resource.id, sectionKey: input.sectionKey, withdrawnAt: null } });
      if (same) throw new ConflictError(`${resource.ref} is already linked ${input.sectionKey ? "at that step" : "to this policy"}`);
      const last = await tx.policyResourceLink.aggregate({ where: { policyId: policy.id, withdrawnAt: null }, _max: { sortOrder: true } });
      const link = await tx.policyResourceLink.create({
        data: { organisationId: orgId, policyId: policy.id, resourceId: resource.id, sectionKey: input.sectionKey, useWhen: input.useWhen, required: input.required, sortOrder: (last._max.sortOrder ?? 0) + 1, origin: "MANUAL", createdById: ctx.userId },
      });
      await audit({ organisationId: orgId, actorId: ctx.userId, action: "policy.resource_link.added", entityType: "Policy", entityId: policy.id, data: { linkId: link.id, resourceId: resource.id, resourceRef: resource.ref, sectionKey: input.sectionKey, required: input.required } }, tx);
      return link;
    });
  } catch (e) {
    // Two people adding the same link at once: the database's unique index stops the second.
    if ((e as { code?: string }).code === "P2002") throw new ConflictError(`${resource.ref} has just been linked by someone else`);
    throw e;
  }
}

export async function withdrawResourceLink(ctx: Ctx, raw: z.input<typeof WithdrawResourceLinkInput>) {
  const parsed = WithdrawResourceLinkInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Some details are missing");
  const orgId = requireOrgPermission(ctx, "policy.author");
  const link = await db.policyResourceLink.findFirst({ where: { id: parsed.data.linkId, organisationId: orgId }, select: { id: true, policyId: true, resourceId: true, withdrawnAt: true, resource: { select: { ref: true } } } });
  if (!link) throw new NotFoundError("Link");
  await editablePolicy(ctx, link.policyId);
  return db.$transaction(async (tx) => {
    // Only withdraws a link that is still active, so two people withdrawing at once cannot both succeed.
    const r = await tx.policyResourceLink.updateMany({ where: { id: link.id, withdrawnAt: null }, data: { withdrawnAt: new Date(), withdrawnById: ctx.userId, withdrawReason: parsed.data.reason } });
    if (!r.count) throw new ConflictError("This link has already been removed");
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "policy.resource_link.withdrawn", entityType: "Policy", entityId: link.policyId, data: { linkId: link.id, resourceId: link.resourceId, resourceRef: link.resource.ref, reason: parsed.data.reason } }, tx);
    return link.policyId;
  });
}

/** Everything the "Forms for this policy" page shows: links (active and removed), places and the resources to choose from. */
export async function resourceLinkAdmin(ctx: Ctx, policyId: string) {
  const policy = await db.policy.findUnique({
    where: { id: policyId },
    select: { id: true, ref: true, title: true, kind: true, organisationId: true, docType: true, status: true, currentPublishedVersionId: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  if (!policy || !canOnPolicy(ctx, policy, "read") || !(POLICY_DOC_TYPES as readonly string[]).includes(policy.docType)) throw new NotFoundError("Policy");
  const canManage = Boolean(policy.kind === "CUSTOMER" && policy.organisationId && policy.organisationId === ctx.organisationId && policy.status === "ACTIVE" && hasOrgPermission(ctx, "policy.author"));
  const [sections, links, choices] = await Promise.all([
    sectionsOf(policy),
    db.policyResourceLink.findMany({
      where: { policyId: policy.id },
      orderBy: [{ withdrawnAt: { sort: "desc", nulls: "first" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sectionKey: true, useWhen: true, required: true, origin: true, createdAt: true, createdById: true, withdrawnAt: true, withdrawnById: true, withdrawReason: true, resource: { select: { id: true, ref: true, title: true, docType: true, status: true, currentPublishedVersionId: true } } },
    }),
    canManage
      ? db.policy.findMany({ where: { organisationId: policy.organisationId, kind: "CUSTOMER", status: "ACTIVE", docType: { in: [...RESOURCE_DOC_TYPES] } }, orderBy: { ref: "asc" }, select: { id: true, ref: true, title: true, docType: true } })
      : Promise.resolve([]),
  ]);
  const people = await db.user.findMany({ where: { id: { in: links.flatMap((l) => [l.createdById, l.withdrawnById]).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const placements = placementsFor(sections);
  const headings = new Map(sections.map((s) => [s.key, s.heading]));
  return {
    policy: { id: policy.id, ref: policy.ref, title: policy.title, kind: policy.kind },
    canManage,
    placements,
    names: new Map(people.map((u) => [u.id, u.name])),
    active: links.filter((l) => !l.withdrawnAt).map((l) => ({ ...l, place: l.sectionKey ? placements.find((p) => p.sectionKey === l.sectionKey) ?? (headings.has(l.sectionKey) ? { sectionKey: l.sectionKey, heading: headings.get(l.sectionKey)!, step: null } : null) : null })),
    withdrawn: links.filter((l) => l.withdrawnAt),
    choices: choices.map((c) => ({ ...c, typeLabel: isResourceDocType(c.docType) ? RESOURCE_TYPE_LABELS[c.docType] : c.docType })),
  };
}

// ───────── keeping links in step with the library

/**
 * When an organisation adopts a CSB template, copies the CSB master links that touch it to the organisation's own
 * copies, where the organisation has adopted the document at the other end. A pair with any existing link (including a
 * removed one) is left alone, so an organisation's own decision is never undone.
 */
export async function inheritTemplateLinks(tx: Tx, orgId: string, policyId: string, templateId: string) {
  const masterLinks = await tx.policyResourceLink.findMany({
    where: { organisationId: null, withdrawnAt: null, OR: [{ policyId: templateId }, { resourceId: templateId }] },
    select: { policyId: true, resourceId: true, sectionKey: true, useWhen: true, required: true, sortOrder: true },
  });
  if (!masterLinks.length) return 0;
  const otherIds = masterLinks.map((l) => (l.policyId === templateId ? l.resourceId : l.policyId));
  const copies = await tx.policy.findMany({ where: { organisationId: orgId, templateId: { in: otherIds } }, select: { id: true, templateId: true } });
  const copyOf = new Map(copies.map((c) => [c.templateId!, c.id]));
  let made = 0;
  for (const l of masterLinks) {
    const from = l.policyId === templateId ? policyId : copyOf.get(l.policyId);
    const to = l.resourceId === templateId ? policyId : copyOf.get(l.resourceId);
    if (!from || !to) continue;
    if (await tx.policyResourceLink.findFirst({ where: { policyId: from, resourceId: to }, select: { id: true } })) continue;
    await tx.policyResourceLink.create({ data: { organisationId: orgId, policyId: from, resourceId: to, sectionKey: l.sectionKey, useWhen: l.useWhen, required: l.required, sortOrder: l.sortOrder, origin: "TEMPLATE" } });
    made += 1;
  }
  return made;
}

/**
 * Creates links from the "Related policies" section of each published resource (see the migration's
 * csb_backfill_policy_resource_links). Idempotent; the seed runs it after loading the library.
 */
export async function backfillResourceLinks(tx: Tx = db): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT csb_backfill_policy_resource_links() AS n`;
  return Number(row?.n ?? 0);
}
