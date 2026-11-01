import { ackBucket } from "./assignment";
import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { POLICY_AREAS } from "@/lib/policy-areas";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { searchChunks } from "../search/index-chunks";
import { getPolicy } from "./library";
import { DOC_TYPES } from "../../../prisma/seed-data/library/types";

/**
 * The Policy Library workspace: one tenant-scoped load of the library's rows, then
 * filtering, sorting, counting and paging in memory so the register, category tree,
 * quick filters and status pills always agree. Libraries are hundreds of documents,
 * not millions, so this stays a single indexed query per page view.
 */

export const LIBRARY_TABS = ["policies", "templates", "archived", "calendar"] as const;
export const STATUS_KEYS = ["published", "not_approved", "draft", "under_review", "approved", "review_due", "overdue", "template", "archived"] as const;
export const QUICK_KEYS = ["due", "overdue", "recent", "awaiting"] as const;
export const SORT_KEYS = ["updated", "title", "ref", "review"] as const;
export const PANE_KEYS = ["document", "overview", "history", "signoff", "linked"] as const;
export const LAYOUTS = ["list", "grid"] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];
export type StatusKey = (typeof STATUS_KEYS)[number];
export type QuickKey = (typeof QUICK_KEYS)[number];
export type SortKey = (typeof SORT_KEYS)[number];
export type PaneKey = (typeof PANE_KEYS)[number];

export const DUE_WINDOW_DAYS = 60;
export const RECENT_DAYS = 30;
export const PAGE_SIZE = 12;
const DAY = 86_400_000;

export const STATUS_LABELS: Record<StatusKey, string> = {
  published: "Published",
  not_approved: "Not yet approved",
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved, not yet published",
  review_due: "Review due",
  overdue: "Review overdue",
  template: "Starter template",
  archived: "Archived",
};

export const QUICK_LABELS: Record<QuickKey, string> = { due: "Due for review", overdue: "Overdue", recent: "Recently updated", awaiting: "Awaiting approval" };
export const SORT_LABELS: Record<SortKey, string> = { updated: "Last updated", title: "Title", ref: "Reference", review: "Next review" };
export const DOC_TYPE_NAMES = new Map<string, string>(DOC_TYPES);

const optional = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined);
const text = z.string().trim().max(120).optional().catch(undefined);
const id = z.string().regex(/^[a-z0-9]{8,40}$/i).optional().catch(undefined);

const QuerySchema = z.object({
  tab: optional(LIBRARY_TABS),
  q: text,
  area: text,
  category: text,
  status: optional(STATUS_KEYS),
  owner: id,
  type: text,
  service: text,
  quick: optional(QUICK_KEYS),
  sort: optional(SORT_KEYS),
  layout: optional(LAYOUTS),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
  selected: id,
  pane: optional(PANE_KEYS),
});

export type LibraryQuery = {
  tab: LibraryTab;
  q?: string;
  area?: string;
  category?: string;
  status?: StatusKey;
  owner?: string;
  type?: string;
  service?: string;
  quick?: QuickKey;
  sort: SortKey;
  layout: (typeof LAYOUTS)[number];
  page: number;
  selected?: string;
  pane: PaneKey;
};

/**
 * Reads the workspace state from the address bar. Unknown or malformed values are dropped, never trusted,
 * and nothing here can name an organisation. Older addresses (?view=index, ?tab=templates, ?overdue=1) keep working.
 */
export function parseLibraryQuery(sp: Record<string, string | string[] | undefined>, hasOrganisation = true): LibraryQuery {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const raw = Object.fromEntries(["tab", "q", "area", "category", "status", "owner", "type", "service", "quick", "sort", "layout", "page", "selected", "pane"].map((k) => [k, one(k) || undefined]));
  if (!raw.quick && one("overdue") === "1") raw.quick = "overdue";
  const p = QuerySchema.parse(raw);
  const category = p.category && /^[A-Z_]{2,40}$/.test(p.category) ? p.category : undefined;
  const areaDef = POLICY_AREAS.find((a) => a.key === p.area);
  // A category chosen from the filter bar wins over an area it doesn't belong to.
  const area = areaDef && (!category || areaDef.categories.some((c) => c === category)) ? areaDef.key : undefined;
  return {
    tab: p.tab ?? (hasOrganisation ? "policies" : "templates"),
    q: p.q || undefined,
    area,
    category,
    status: p.status,
    owner: p.owner,
    type: p.type && DOC_TYPE_NAMES.has(p.type) ? p.type : undefined,
    service: p.service && /^[A-Z_]{2,40}$/.test(p.service) ? p.service : undefined,
    quick: p.quick,
    sort: p.sort ?? "updated",
    layout: p.layout ?? "list",
    page: p.page ?? 1,
    selected: p.selected,
    pane: p.pane ?? "document",
  };
}

/** Builds a workspace address from the current state plus changes; empty values and defaults are left out. */
export function libraryHref(q: LibraryQuery, over: Partial<Record<keyof LibraryQuery, string | number | undefined>> = {}): string {
  const merged: Record<string, string | number | undefined> = { ...q, ...over };
  const defaults: Record<string, string | number> = { tab: "policies", sort: "updated", layout: "list", page: 1, pane: "document" };
  const params = new URLSearchParams();
  for (const k of ["tab", "q", "area", "category", "status", "owner", "type", "service", "quick", "sort", "layout", "page", "selected", "pane"]) {
    const v = merged[k];
    if (v === undefined || v === "" || defaults[k] === v) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return `/policies${qs ? `?${qs}` : ""}`;
}

/** The facts a status is derived from. */
export interface StatusInput {
  currentPublishedVersion: { approved: boolean } | null;
  /** The open revision; draftStatus is its draft version's status (APPROVED or SCHEDULED once approved). */
  openRevision: { submittedAt: Date | null; draftStatus?: string | null } | null;
  nextReviewDate: Date | null;
  /** A CSB starter template as a provider sees it: never described as the provider's own approved policy. */
  starterTemplate?: boolean;
  archived?: boolean;
}

/** One status per document, in priority order, so every part of the page says the same thing. */
export function policyStatus(p: StatusInput, now: Date): StatusKey {
  if (p.archived) return "archived";
  if (p.starterTemplate) return "template";
  if (p.openRevision?.submittedAt) return p.openRevision.draftStatus === "APPROVED" || p.openRevision.draftStatus === "SCHEDULED" ? "approved" : "under_review";
  if (p.nextReviewDate && p.currentPublishedVersion) {
    if (p.nextReviewDate < now) return "overdue";
    if (p.nextReviewDate.getTime() - now.getTime() <= DUE_WINDOW_DAYS * DAY) return "review_due";
  }
  if (!p.currentPublishedVersion) return "draft";
  return p.currentPublishedVersion.approved ? "published" : "not_approved";
}

export interface LibraryRow {
  id: string;
  ref: string;
  title: string;
  description: string;
  docType: string;
  categoryCode: string;
  categoryName: string;
  areaKey: string | null;
  areaLabel: string | null;
  serviceTypes: string[];
  kind: "MASTER" | "CUSTOMER";
  ownerId: string | null;
  ownerName: string | null;
  reviewerId: string | null;
  version: string | null;
  approved: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
  nextReviewDate: Date | null;
  openRevisionId: string | null;
  submitted: boolean;
  adopted: boolean;
  status: StatusKey;
}

const AREA_OF = new Map<string, { key: string; label: string }>(POLICY_AREAS.flatMap((a) => a.categories.map((c) => [c, { key: a.key, label: a.label }] as const)));

/** The tenant boundary for each tab. Organisation documents only ever come from the session's organisation. */
function tabWhere(ctx: Ctx, tab: LibraryTab): Prisma.PolicyWhereInput {
  if (tab === "templates") return { kind: "MASTER", organisationId: null, status: "ACTIVE" };
  if (!ctx.organisationId) return { id: { in: [] } };
  return { kind: "CUSTOMER", organisationId: ctx.organisationId, status: tab === "archived" ? "ARCHIVED" : "ACTIVE" };
}

/** Loads every document on a tab with the fields the workspace shows. */
export async function loadLibraryRows(ctx: Ctx, tab: LibraryTab, now = new Date()): Promise<LibraryRow[]> {
  const [policies, categories] = await Promise.all([
    db.policy.findMany({
      where: tabWhere(ctx, tab),
      select: {
        id: true, ref: true, title: true, description: true, docType: true, categoryCode: true, serviceTypes: true, kind: true,
        ownerId: true, reviewerId: true, nextReviewDate: true, updatedAt: true, status: true,
        currentPublishedVersion: { select: { label: true, publishedAt: true, approvals: { where: { decision: "APPROVE" }, select: { id: true }, take: 1 } } },
        revisions: { where: { closedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, submittedAt: true, draftVersion: { select: { status: true } } } },
      },
    }),
    db.policyCategory.findMany(),
  ]);
  const people = await db.user.findMany({ where: { id: { in: [...new Set(policies.map((p) => p.ownerId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
  const name = new Map(people.map((u) => [u.id, u.name]));
  const categoryName = new Map(categories.map((c) => [c.code, c.name]));
  const adopted = tab === "templates" && ctx.organisationId
    ? new Set((await db.policy.findMany({ where: { organisationId: ctx.organisationId, templateId: { not: null } }, select: { templateId: true } })).map((p) => p.templateId))
    : new Set<string | null>();
  return policies.map((p) => {
    const v = p.currentPublishedVersion;
    const open = p.revisions[0] ?? null;
    const approved = Boolean(v?.approvals.length);
    const area = AREA_OF.get(p.categoryCode) ?? null;
    return {
      id: p.id, ref: p.ref, title: p.title, description: p.description, docType: p.docType, categoryCode: p.categoryCode,
      categoryName: categoryName.get(p.categoryCode) ?? p.categoryCode, areaKey: area?.key ?? null, areaLabel: area?.label ?? null,
      serviceTypes: p.serviceTypes, kind: p.kind, ownerId: p.ownerId, ownerName: p.ownerId ? (name.get(p.ownerId) ?? null) : null, reviewerId: p.reviewerId,
      version: v?.label ?? null, approved, publishedAt: v?.publishedAt ?? null, updatedAt: p.updatedAt, nextReviewDate: p.nextReviewDate,
      openRevisionId: open?.id ?? null, submitted: Boolean(open?.submittedAt), adopted: adopted.has(p.id),
      status: policyStatus({ currentPublishedVersion: v ? { approved } : null, openRevision: open ? { submittedAt: open.submittedAt, draftStatus: open.draftVersion.status } : null, nextReviewDate: p.nextReviewDate, starterTemplate: p.kind === "MASTER" && Boolean(ctx.organisationId), archived: p.status === "ARCHIVED" }, now),
    };
  });
}

export function matchesQuick(r: LibraryRow, quick: QuickKey, now: Date): boolean {
  const review = r.nextReviewDate?.getTime();
  switch (quick) {
    case "overdue":
      return review !== undefined && review < now.getTime();
    case "due":
      return review !== undefined && review >= now.getTime() && review - now.getTime() <= DUE_WINDOW_DAYS * DAY;
    case "recent":
      return Boolean(r.publishedAt && now.getTime() - r.publishedAt.getTime() <= RECENT_DAYS * DAY);
    case "awaiting":
      return r.submitted;
  }
}

function lastUpdated(r: LibraryRow) {
  return (r.publishedAt ?? r.updatedAt).getTime();
}

/** Applies everything except the category tree, so the tree can count what the other filters leave. */
function applyFilters(rows: LibraryRow[], q: LibraryQuery, now: Date, textHits: Set<string> | null, skipCategory = false) {
  const needle = q.q?.toLowerCase();
  return rows.filter((r) => {
    if (needle && !(r.title.toLowerCase().includes(needle) || r.ref.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle) || textHits?.has(r.id))) return false;
    if (!skipCategory) {
      if (q.area && r.areaKey !== q.area) return false;
      if (q.category && r.categoryCode !== q.category) return false;
    }
    if (q.status && r.status !== q.status) return false;
    if (q.owner && r.ownerId !== q.owner) return false;
    if (q.type && r.docType !== q.type) return false;
    if (q.service && !r.serviceTypes.includes(q.service)) return false;
    if (q.quick && !matchesQuick(r, q.quick, now)) return false;
    return true;
  });
}

export function sortRows(rows: LibraryRow[], sort: SortKey): LibraryRow[] {
  const by: Record<SortKey, (a: LibraryRow, b: LibraryRow) => number> = {
    updated: (a, b) => lastUpdated(b) - lastUpdated(a) || a.ref.localeCompare(b.ref),
    title: (a, b) => a.title.localeCompare(b.title),
    ref: (a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }),
    review: (a, b) => (a.nextReviewDate?.getTime() ?? Infinity) - (b.nextReviewDate?.getTime() ?? Infinity) || a.ref.localeCompare(b.ref),
  };
  return [...rows].sort(by[sort]);
}

export interface TreeNode {
  key: string;
  label: string;
  count: number;
  categories: { code: string; label: string; count: number }[];
}

/** The category explorer: areas of care, then the categories inside them, counting documents the other filters leave. */
export function buildTree(rows: LibraryRow[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const area of POLICY_AREAS) {
    const inArea = rows.filter((r) => r.areaKey === area.key);
    if (!inArea.length) continue;
    const categories = area.categories
      .map((code) => ({ code, label: inArea.find((r) => r.categoryCode === code)?.categoryName ?? code, count: inArea.filter((r) => r.categoryCode === code).length }))
      .filter((c) => c.count);
    nodes.push({ key: area.key, label: area.label, count: inArea.length, categories });
  }
  const other = rows.filter((r) => !r.areaKey);
  if (other.length) {
    const codes = [...new Set(other.map((r) => r.categoryCode))].sort();
    nodes.push({ key: "other", label: "Other", count: other.length, categories: codes.map((code) => ({ code, label: other.find((r) => r.categoryCode === code)!.categoryName, count: other.filter((r) => r.categoryCode === code).length })) });
  }
  return nodes;
}

export interface LibraryView {
  query: LibraryQuery;
  total: number;
  tabTotal: number;
  pageCount: number;
  rows: LibraryRow[];
  tree: TreeNode[];
  treeTotal: number;
  quickCounts: Record<QuickKey, number>;
  owners: { id: string; name: string }[];
  services: { code: string; name: string }[];
  docTypes: { code: string; name: string }[];
  tabCounts: Partial<Record<LibraryTab, number>>;
  calendar: { month: string; rows: LibraryRow[] }[];
}

/** Everything the workspace shows for one address, scoped to the signed-in organisation. */
export async function libraryView(ctx: Ctx, query: LibraryQuery, now = new Date()): Promise<LibraryView> {
  const sourceTab: LibraryTab = query.tab === "calendar" ? "policies" : query.tab;
  const [all, services, tabCounts, textHits] = await Promise.all([
    loadLibraryRows(ctx, sourceTab, now),
    db.serviceType.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    countTabs(ctx),
    query.q ? policyTextHits(ctx, query.q) : Promise.resolve(null),
  ]);
  const forTree = applyFilters(all, query, now, textHits, true);
  const filtered = applyFilters(all, query, now, textHits);
  const sorted = sortRows(filtered, query.sort);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const baseForQuick = applyFilters(all, { ...query, quick: undefined }, now, textHits);
  const owners = [...new Map(all.filter((r) => r.ownerId && r.ownerName).map((r) => [r.ownerId!, r.ownerName!])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const presentServices = new Set(all.flatMap((r) => r.serviceTypes));
  const presentTypes = new Set(all.map((r) => r.docType));
  const calendar = query.tab === "calendar" ? reviewCalendar(filtered) : [];
  return {
    query: { ...query, page },
    total: sorted.length,
    tabTotal: all.length,
    pageCount,
    rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    tree: buildTree(forTree),
    treeTotal: forTree.length,
    quickCounts: Object.fromEntries(QUICK_KEYS.map((k) => [k, baseForQuick.filter((r) => matchesQuick(r, k, now)).length])) as Record<QuickKey, number>,
    owners,
    services: services.filter((s) => presentServices.has(s.code)),
    docTypes: DOC_TYPES.filter(([code]) => presentTypes.has(code)).map(([code, name]) => ({ code, name })),
    tabCounts,
    calendar,
  };
}

/** Reviews grouped by month, earliest first, with anything overdue at the top. */
export function reviewCalendar(rows: LibraryRow[]): { month: string; rows: LibraryRow[] }[] {
  const dated = rows.filter((r) => r.nextReviewDate).sort((a, b) => a.nextReviewDate!.getTime() - b.nextReviewDate!.getTime());
  const groups = new Map<string, LibraryRow[]>();
  for (const r of dated) {
    const key = r.nextReviewDate!.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([month, rs]) => ({ month, rows: rs }));
}

async function countTabs(ctx: Ctx): Promise<Partial<Record<LibraryTab, number>>> {
  const [templates, policies, archived] = await Promise.all([
    db.policy.count({ where: tabWhere(ctx, "templates") }),
    ctx.organisationId ? db.policy.count({ where: tabWhere(ctx, "policies") }) : 0,
    ctx.organisationId ? db.policy.count({ where: tabWhere(ctx, "archived") }) : 0,
  ]);
  return { policies, templates, archived };
}

/** Documents whose published text matches the search, from the full-text index (shared templates and this organisation only). */
async function policyTextHits(ctx: Ctx, q: string): Promise<Set<string>> {
  try {
    const hits = await searchChunks(q, { organisationId: ctx.organisationId, kind: "POLICY", limit: 50 });
    return new Set(hits.map((h) => h.policyId).filter((x): x is string => Boolean(x)));
  } catch {
    // A malformed search phrase must not break the page; title and reference matching still apply.
    return new Set();
  }
}

/* ───────────────────────── Inspector ───────────────────────── */

/** One policy for the inspector. Read access is checked by getPolicy, so other organisations' documents are "not found". */
export async function inspectPolicy(ctx: Ctx, policyId: string, now = new Date()) {
  const p = await getPolicy(ctx, policyId);
  const v = p.currentPublishedVersion;
  const published = v ? p.versions.find((x) => x.id === v.id) : undefined;
  const approvals = published?.approvals.filter((a) => a.decision === "APPROVE") ?? [];
  const open = p.revisions.find((r) => !r.closedAt) ?? null;
  const history = p.versions.filter((x) => x.status === "PUBLISHED" || x.status === "SUPERSEDED");
  // Staff acknowledge the latest material publication; a wording-only update keeps the earlier acknowledgements.
  const latestPub = p.publications.find((x) => x.status === "PUBLISHED" && x.materialRevision) ?? p.publications.find((x) => x.status === "PUBLISHED") ?? null;
  const canSeeCoverage = Boolean(p.organisationId) && hasOrgPermission(ctx, "staff.view");
  const ownAck = latestPub?.acknowledgements.find((a) => a.userId === ctx.userId) ?? null;
  const acks = canSeeCoverage ? (latestPub?.acknowledgements ?? []) : [];

  const inheritedLinks = !p.requirementLinks.length && p.templateId;
  const links = inheritedLinks
    ? await db.requirementPolicyLink.findMany({ where: { policyId: p.templateId! }, include: { requirement: true } })
    : p.requirementLinks;
  const relatedRefs = [...new Set([...(v?.sections.find((s) => s.key === "related")?.body.matchAll(/CSB-[A-Z]+-\d+/g) ?? [])].map((m) => m[0]))];
  const peopleIds = [...approvals.map((a) => a.deciderId), ...history.flatMap((h) => h.approvals.filter((a) => a.decision === "APPROVE").map((a) => a.deciderId)), p.ownerId, p.reviewerId, p.approverId, ...acks.map((a) => a.userId)].filter((x): x is string => Boolean(x));
  const [people, related, assessments, reviewers, services, template] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(peopleIds)] } }, select: { id: true, name: true } }),
    db.policy.findMany({
          where: {
            organisationId: p.organisationId,
            status: "ACTIVE",
            id: { not: p.id },
            OR: [{ ref: { in: relatedRefs } }, { currentPublishedVersion: { sections: { some: { key: "related", body: { contains: p.ref } } } } }],
          },
          orderBy: { ref: "asc" },
          take: 20,
          select: { id: true, ref: true, title: true, docType: true },
        }),
    db.impactAssessment.findMany({
      where: { policyId: p.id, ...(p.organisationId ? { organisationId: p.organisationId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, outcome: true, urgency: true, status: true, createdAt: true, isSimulated: true, change: { select: { id: true, title: true } } },
    }),
    p.organisationId && hasOrgPermission(ctx, "policy.author") ? reviewerOptions(p.organisationId) : Promise.resolve([]),
    db.serviceType.findMany({ where: { code: { in: p.serviceTypes } }, select: { code: true, name: true } }),
    p.template ? Promise.resolve({ id: p.template.id, ref: p.template.ref, title: p.template.title }) : Promise.resolve(null),
  ]);
  const person = new Map(people.map((u) => [u.id, u.name]));
  const area = AREA_OF.get(p.categoryCode) ?? null;
  const status = policyStatus({ currentPublishedVersion: v ? { approved: approvals.length > 0 } : null, openRevision: open ? { submittedAt: open.submittedAt, draftStatus: open.draftVersion?.status } : null, nextReviewDate: p.nextReviewDate, starterTemplate: p.kind === "MASTER" && Boolean(ctx.organisationId), archived: p.status === "ARCHIVED" }, now);
  const signed = acks.filter((a) => ackBucket(a, now).bucket === "acknowledged").length;
  const overdueAcks = acks.filter((a) => ackBucket(a, now).overdue).length;

  return {
    policy: p,
    status,
    area,
    version: v ? { id: v.id, label: v.label, origin: v.origin, publishedAt: v.publishedAt, effectiveDate: v.effectiveDate, sections: v.sections.map((s) => ({ key: s.key, heading: s.heading })) } : null,
    approvals: approvals.map((a) => ({ id: a.id, name: person.get(a.deciderId) ?? "A former member", at: a.createdAt })),
    openRevision: open ? { id: open.id, title: open.title, submitted: Boolean(open.submittedAt) } : null,
    history: history.map((h) => ({
      id: h.id, label: h.label, status: h.status, origin: h.origin, publishedAt: h.publishedAt, changeSummary: h.changeSummary, reasonForChange: h.reasonForChange, isSimulated: h.isSimulated,
      approvers: h.approvals.filter((a) => a.decision === "APPROVE").map((a) => person.get(a.deciderId) ?? "A former member"),
    })),
    owner: p.ownerId ? (person.get(p.ownerId) ?? null) : null,
    reviewer: p.reviewerId ? (person.get(p.reviewerId) ?? null) : null,
    services,
    template,
    signOff: latestPub
      ? {
          publicationId: latestPub.id,
          publishedAt: latestPub.publishedAt,
          dueAt: latestPub.acknowledgementDueAt,
          own: ownAck ? { acknowledgedAt: ownAck.acknowledgedAt, dueAt: ownAck.dueAt } : null,
          coverage: canSeeCoverage
            ? {
                assigned: acks.length,
                signed,
                outstanding: acks.filter((a) => ackBucket(a, now).outstanding).length,
                overdue: overdueAcks,
                people: acks
                  .map((a) => ({ name: (a.userId ? person.get(a.userId) : null) ?? a.staffMember?.displayName ?? "A former member", acknowledgedAt: a.acknowledgedAt, dueAt: a.dueAt }))
                  .sort((a, b) => Number(Boolean(a.acknowledgedAt)) - Number(Boolean(b.acknowledgedAt)) || a.name.localeCompare(b.name)),
              }
            : null,
        }
      : null,
    linked: {
      requirements: links.map((l) => ({ id: l.requirement.id, ref: l.requirement.ref, title: l.requirement.title, legalStatus: l.requirement.legalStatus })).sort((a, b) => a.ref.localeCompare(b.ref)),
      inherited: Boolean(inheritedLinks),
      changes: p.candidates.map((c) => ({ id: c.change.id, title: c.change.title, reason: c.reason, at: c.createdAt })),
      assessments,
      related,
    },
    reviewers,
  };
}

export type PolicyInspection = Awaited<ReturnType<typeof inspectPolicy>>;

/** Members who can review policies, the only people a policy's reviewer can be set to. */
export async function reviewerOptions(organisationId: string) {
  const ms = await db.membership.findMany({
    where: { organisationId, roles: { hasSome: ["POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD"] } },
    select: { user: { select: { id: true, name: true } } },
  });
  return ms.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name));
}
