import type { Prisma, VersionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { outstandingAckWhere } from "../policies/assignment";
import { needsLocalArrangements, sourceTrust } from "./applicability";
import { listBranchProfiles } from "./branches";

/**
 * Branch policy coverage: which policies each branch has, as a national policy, a shared policy with a local appendix,
 * or a separate branch policy, and in what state. Every value comes from stored records; nothing is estimated.
 */
export type CellState = "approved" | "approved_needs_review" | "awaiting_approval" | "draft" | "missing_local" | "national" | "not_started";
export const CELL_LABEL: Record<CellState, string> = {
  approved: "Published",
  approved_needs_review: "Needs review",
  // Scheduled, or sent for review under the earlier process: either way it can be published now.
  awaiting_approval: "Ready to publish",
  draft: "Draft",
  missing_local: "Missing local arrangements",
  national: "National policy only",
  not_started: "Not started",
};

export type CoverageFilters = { branch?: string; region?: string; la?: string; category?: string; status?: string; owner?: string; q?: string };

function draftState(s: VersionStatus | null | undefined): CellState | null {
  if (!s) return null;
  if (s === "UNDER_REVIEW" || s === "APPROVED" || s === "SCHEDULED") return "awaiting_approval";
  if (s === "DRAFT" || s === "CHANGES_REQUESTED") return "draft";
  return null;
}

export async function coverageView(ctx: Ctx, f: CoverageFilters = {}) {
  const organisationId = requireOrgPermission(ctx, "policy.coverage");
  if (!organisationId) throw new ForbiddenError();
  const now = new Date();
  let branches = await listBranchProfiles(ctx);
  if (f.branch) branches = branches.filter((b) => b.id === f.branch);
  if (f.region) branches = branches.filter((b) => b.policyProfile?.regionCode === f.region);
  if (f.la) branches = branches.filter((b) => b.policyProfile?.localAuthorityCode === f.la);
  const where: Prisma.PolicyWhereInput = {
    organisationId,
    kind: "CUSTOMER",
    status: "ACTIVE",
    docType: "POLICY",
    ...(f.category ? { categoryCode: f.category } : {}),
    ...(f.owner ? { ownerId: f.owner } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { ref: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const policies = await db.policy.findMany({
    where,
    orderBy: [{ categoryCode: "asc" }, { ref: "asc" }],
    include: {
      category: true,
      branchScopes: true,
      sourceLinks: { include: { source: true } },
      revisions: { where: { closedAt: null }, include: { draftVersion: { select: { status: true } } } },
      generationRuns: { include: { gaps: { where: { resolvedAt: null, severity: "CRITICAL" }, select: { id: true, branchId: true } } } },
    },
  });
  const reviews = new Map((await db.orgSourceReview.findMany({ where: { organisationId } })).map((r) => [r.sourceId, r]));
  const variants = policies.filter((p) => p.parentPolicyId && p.branchId);
  const companyRows = policies.filter((p) => !(p.parentPolicyId && p.branchId) && !(p.scopeMode === "BRANCH_SPECIFIC" && p.branchId));
  const orphanVariants = policies.filter((p) => p.scopeMode === "BRANCH_SPECIFIC" && p.branchId && !p.parentPolicyId);
  const pubs = await db.policyPublication.findMany({ where: { organisationId, status: "PUBLISHED", materialRevision: true, policyId: { in: policies.map((p) => p.id) } }, orderBy: { publishedAt: "desc" }, select: { id: true, policyId: true } });
  const latestPub = new Map<string, string>();
  for (const p of pubs) if (!latestPub.has(p.policyId)) latestPub.set(p.policyId, p.id);
  const outstanding = await db.acknowledgement.findMany({ where: { ...outstandingAckWhere, publicationId: { in: [...latestPub.values()] } }, select: { publicationId: true, staffMember: { select: { branchId: true } } } });

  const stale = (p: (typeof policies)[number], branchId: string | null) =>
    p.sourceLinks.some((l) => (l.branchKey === "" || l.branchKey === branchId) && l.source.geoLevel !== "NATIONAL" && sourceTrust(l.source, reviews.get(l.sourceId) ?? null, now) !== "verified") ||
    p.generationRuns.some((r) => r.gaps.some((g) => !branchId || g.branchId === branchId || g.branchId === null));

  function stateOf(p: (typeof policies)[number], branchId: string | null): CellState {
    const open = draftState(p.revisions[0]?.draftVersion.status);
    if (!p.currentPublishedVersionId) return open ?? "not_started";
    if (open) return open;
    return stale(p, branchId) ? "approved_needs_review" : "approved";
  }
  const pendingAcks = (policyId: string, branchId: string | null) => {
    const pub = latestPub.get(policyId);
    return outstanding.filter((a) => a.publicationId === pub && (!branchId || a.staffMember?.branchId === branchId)).length;
  };

  const rows = [...companyRows, ...orphanVariants].map((p) => {
    const cells = branches.map((b) => {
      const variant = variants.find((v) => v.parentPolicyId === p.id && v.branchId === b.id) ?? (p.scopeMode === "BRANCH_SPECIFIC" && p.branchId === b.id ? p : undefined);
      if (variant) return { branchId: b.id, how: "branch_policy" as const, policyId: variant.id, ref: variant.ref, state: stateOf(variant, b.id), pendingAcks: pendingAcks(variant.id, b.id) };
      if (p.scopeMode === "BRANCH_SPECIFIC") return { branchId: b.id, how: "not_applicable" as const, policyId: null, ref: null, state: "not_started" as CellState, pendingAcks: 0 };
      const scope = p.branchScopes.find((s) => s.branchId === b.id);
      if (scope?.appendixKey) return { branchId: b.id, how: "appendix" as const, policyId: p.id, ref: p.ref, state: stateOf(p, b.id), pendingAcks: pendingAcks(p.id, b.id) };
      const base = stateOf(p, null);
      const missing = needsLocalArrangements(p.categoryCode) && (base === "approved" || base === "approved_needs_review");
      return { branchId: b.id, how: "national" as const, policyId: p.id, ref: p.ref, state: missing ? ("missing_local" as CellState) : base === "approved" ? ("national" as CellState) : base, pendingAcks: pendingAcks(p.id, b.id) };
    });
    return { id: p.id, ref: p.ref, title: p.title, category: p.category.name, categoryCode: p.categoryCode, scopeMode: p.scopeMode, ownerId: p.ownerId, cells };
  });
  const filtered = f.status ? rows.filter((r) => r.cells.some((c) => c.state === f.status)) : rows;

  const all = filtered.flatMap((r) => r.cells);
  const geoSourceIds = [...new Set(policies.flatMap((p) => p.sourceLinks.filter((l) => l.source.geoLevel !== "NATIONAL").map((l) => l.sourceId)))];
  const [localChanges, owners] = await Promise.all([
    geoSourceIds.length ? db.regulatoryChange.count({ where: { sourceId: { in: geoSourceIds }, status: { in: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW"] } } }) : 0,
    db.user.findMany({ where: { id: { in: [...new Set(policies.map((p) => p.ownerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const summary = {
    national: companyRows.filter((p) => p.scopeMode === "NATIONAL").length,
    shared: companyRows.filter((p) => p.scopeMode === "SHARED_WITH_APPENDICES").length,
    branchPolicies: variants.length + orphanVariants.length,
    approved: all.filter((c) => c.state === "approved" || c.state === "national").length,
    drafts: all.filter((c) => c.state === "draft").length,
    awaiting: all.filter((c) => c.state === "awaiting_approval").length,
    missingLocal: all.filter((c) => c.state === "missing_local").length,
    needsReview: all.filter((c) => c.state === "approved_needs_review").length,
    localChanges,
    /** Outstanding acknowledgements of the current versions of the policies shown. */
    staffOutstanding: outstanding.length,
  };
  return { branches, rows: filtered, summary, owners };
}
