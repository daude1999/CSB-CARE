import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { branchScope } from "./common";

/**
 * Evidence for CQC assessment areas. The evidence itself stays where it already lives (the Evidence Library, training
 * records, audits, care plans, missed-call cases, RCAs...). A CqcEvidenceLink only says "this record may support this
 * area" and whether an authorised reviewer has verified it. Files are never copied. Verification status is separate
 * from malware scanning, which stays on the Evidence Library file.
 */
export const SOURCE_TYPES = {
  EVIDENCE_DOCUMENT: "Evidence file",
  POLICY: "Policy",
  AUDIT: "Audit",
  ACTION: "Completed action",
  INCIDENT: "Incident",
  RCA: "Root cause analysis",
  MISSED_CALL: "Missed call investigation",
  TRAINING: "Training",
  CARE_PLAN: "Care plan review",
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;
export const isSourceType = (t: string): t is SourceType => t in SOURCE_TYPES;

export const LINK_STATUS = { SUGGESTED: "Suggested", AWAITING_REVIEW: "Awaiting review", VERIFIED: "Verified", REJECTED: "Rejected", OUTDATED: "Outdated", SUPERSEDED: "Superseded" } as const;
export type LinkStatus = keyof typeof LINK_STATUS;
const REVIEW_TO: LinkStatus[] = ["VERIFIED", "REJECTED", "OUTDATED", "SUPERSEDED", "AWAITING_REVIEW"];
const DAY = 86_400_000;
/** A verified piece of evidence with no expiry of its own counts for a year from verification. */
export const DEFAULT_CURRENCY_DAYS = 365;

export interface SourceInfo {
  label: string;
  href: string | null;
  branchId: string | null;
  /** The source's own expiry or review date, if it has one. */
  expiresAt: Date | null;
  /** A reason the source no longer stands as evidence (superseded plan, policy past review...). */
  stale: string | null;
  restricted: boolean;
  exists: boolean;
}

const key = (t: string, id: string) => `${t}:${id}`;

/** Reads each linked record inside the organisation and describes it. Missing or foreign records come back as not existing. */
export async function describeSources(ctx: Ctx, organisationId: string, links: { sourceType: string; sourceId: string; sourceRef?: string | null }[], now = new Date()): Promise<Map<string, SourceInfo>> {
  const ids = (t: SourceType) => [...new Set(links.filter((l) => l.sourceType === t).map((l) => l.sourceId))];
  const seeRestricted = hasOrgPermission(ctx, "rca.safeguarding");
  const [docs, policies, audits, actions, incidents, rcas, missed, training, plans] = await Promise.all([
    ids("EVIDENCE_DOCUMENT").length ? db.evidenceDocument.findMany({ where: { organisationId, id: { in: ids("EVIDENCE_DOCUMENT") } }, select: { id: true, filename: true, description: true, retainUntil: true } }) : [],
    ids("POLICY").length ? db.policy.findMany({ where: { organisationId, id: { in: ids("POLICY") } }, select: { id: true, ref: true, title: true, status: true, nextReviewDate: true, branchId: true, currentPublishedVersionId: true } }) : [],
    ids("AUDIT").length ? db.audit.findMany({ where: { organisationId, id: { in: ids("AUDIT") } }, select: { id: true, title: true, status: true, completedAt: true, branchId: true } }) : [],
    ids("ACTION").length ? db.complianceAction.findMany({ where: { organisationId, id: { in: ids("ACTION") } }, select: { id: true, title: true, status: true, verifiedAt: true } }) : [],
    ids("INCIDENT").length ? db.incident.findMany({ where: { organisationId, id: { in: ids("INCIDENT") } }, select: { id: true, reference: true, category: true, status: true, safeguarding: true, serviceUser: { select: { branchId: true } } } }) : [],
    ids("RCA").length ? db.rcaInvestigation.findMany({ where: { organisationId, id: { in: ids("RCA") } }, select: { id: true, reference: true, title: true, status: true, restricted: true, branchId: true, ownerId: true, managerId: true } }) : [],
    ids("MISSED_CALL").length ? db.missedCallCase.findMany({ where: { organisationId, id: { in: ids("MISSED_CALL") } }, select: { id: true, scheduledStart: true, stage: true, signedOffAt: true, visit: { select: { reference: true, serviceUser: { select: { branchId: true } } } } } }) : [],
    ids("TRAINING").length ? db.readinessRequirement.findMany({ where: { organisationId, id: { in: ids("TRAINING") } }, select: { id: true, name: true, status: true } }) : [],
    ids("CARE_PLAN").length ? db.carePlan.findMany({ where: { organisationId, id: { in: ids("CARE_PLAN") } }, select: { id: true, version: true, status: true, approvedAt: true, reviewDue: true, supersededAt: true, serviceUserId: true, serviceUser: { select: { reference: true, branchId: true } } } }) : [],
  ]);
  // Live training coverage for each training requirement: staff with a verified, in-date record.
  const trainingCounts = new Map<string, { done: number; staff: number }>();
  if (training.length) {
    const staff = await db.staffMember.count({ where: { organisationId, employmentStatus: "ACTIVE", ...branchScope(ctx) } });
    for (const t of training) {
      const done = await db.staffTrainingRecord.findMany({ where: { organisationId, requirementId: t.id, verificationStatus: "VERIFIED", OR: [{ expiresAt: null }, { expiresAt: { gte: now } }], staff: { employmentStatus: "ACTIVE", ...branchScope(ctx) } }, distinct: ["staffId"], select: { staffId: true } });
      trainingCounts.set(t.id, { done: done.length, staff });
    }
  }
  const out = new Map<string, SourceInfo>();
  const put = (t: SourceType, id: string, info: Omit<SourceInfo, "exists" | "restricted"> & { restricted?: boolean }) => out.set(key(t, id), { restricted: false, ...info, exists: true });
  for (const d of docs) put("EVIDENCE_DOCUMENT", d.id, { label: d.description ? `${d.filename}: ${d.description}` : d.filename, href: `/api/evidence/${d.id}`, branchId: null, expiresAt: d.retainUntil, stale: null });
  for (const p of policies) put("POLICY", p.id, { label: `${p.ref} ${p.title}`, href: `/policies/${p.id}`, branchId: p.branchId, expiresAt: p.nextReviewDate, stale: p.status !== "ACTIVE" ? "Policy archived" : !p.currentPublishedVersionId ? "No published version" : p.nextReviewDate && p.nextReviewDate < now ? "Policy review overdue" : null });
  for (const a of audits) put("AUDIT", a.id, { label: a.title, href: `/audits/${a.id}`, branchId: a.branchId, expiresAt: a.completedAt ? new Date(a.completedAt.getTime() + DEFAULT_CURRENCY_DAYS * DAY) : null, stale: a.status !== "COMPLETED" ? "Audit not completed" : null });
  for (const a of actions) put("ACTION", a.id, { label: a.title, href: `/actions/${a.id}`, branchId: null, expiresAt: null, stale: a.status === "VERIFIED" || a.status === "CLOSED" ? null : "Action not yet verified" });
  for (const i of incidents) {
    const hidden = i.safeguarding && !seeRestricted;
    put("INCIDENT", i.id, { label: hidden ? `${i.reference} (safeguarding, restricted)` : `${i.reference} ${i.category}`, href: hidden ? null : `/rota/incidents/${i.id}`, branchId: i.serviceUser?.branchId ?? null, expiresAt: null, stale: i.status !== "CLOSED" ? "Incident still open" : null, restricted: hidden });
  }
  for (const r of rcas) {
    const hidden = r.restricted && !seeRestricted && r.ownerId !== ctx.userId && r.managerId !== ctx.userId;
    put("RCA", r.id, { label: hidden ? `${r.reference} (restricted investigation)` : `${r.reference} ${r.title}`, href: hidden ? null : `/compliance/cqc/rca/${r.id}`, branchId: r.branchId, expiresAt: null, stale: ["NEW", "INVESTIGATING", "AWAITING_REVIEW"].includes(r.status) ? "Findings not yet approved" : null, restricted: hidden });
  }
  for (const m of missed) put("MISSED_CALL", m.id, { label: `Missed call investigation, visit ${m.visit.reference} (${m.scheduledStart.toISOString().slice(0, 10)})`, href: `/rota/missed/${m.id}`, branchId: m.visit.serviceUser?.branchId ?? null, expiresAt: null, stale: m.signedOffAt ? null : "Investigation not signed off" });
  for (const t of training) {
    const c = trainingCounts.get(t.id) ?? { done: 0, staff: 0 };
    put("TRAINING", t.id, { label: `${t.name}: ${c.done} of ${c.staff} active staff verified and in date`, href: "/rota/readiness", branchId: null, expiresAt: null, stale: t.status !== "ACTIVE" ? "Requirement retired" : null });
  }
  for (const p of plans) put("CARE_PLAN", p.id, { label: `Care plan v${p.version} for ${p.serviceUser.reference}${p.approvedAt ? `, approved ${p.approvedAt.toISOString().slice(0, 10)}` : ""}`, href: `/rota/service-users/${p.serviceUserId}?tab=care-plans`, branchId: p.serviceUser.branchId, expiresAt: p.reviewDue, stale: p.supersededAt ? "Replaced by a newer plan" : p.status !== "ACTIVE" ? "Plan not current" : p.reviewDue && p.reviewDue < now ? "Review overdue" : null });
  for (const l of links) if (!out.has(key(l.sourceType, l.sourceId))) out.set(key(l.sourceType, l.sourceId), { label: l.sourceRef ?? "Record no longer available", href: null, branchId: null, expiresAt: null, stale: "Record no longer available", restricted: false, exists: false });
  return out;
}

export function sourceInfo(map: Map<string, SourceInfo>, l: { sourceType: string; sourceId: string }) {
  return map.get(key(l.sourceType, l.sourceId))!;
}

/**
 * The status a link is shown and scored with. A verified link counts only while it is in date and its source still
 * stands; otherwise it is shown as Outdated (the stored status is not rewritten, so the reviewer's decision is kept).
 */
export function effectiveStatus(l: { status: string; validUntil: Date | null }, info: SourceInfo | undefined, now = new Date()): LinkStatus {
  const s = l.status as LinkStatus;
  if (s !== "VERIFIED") return s;
  if (!info || !info.exists || info.stale) return "OUTDATED";
  if (l.validUntil && l.validUntil < now) return "OUTDATED";
  return "VERIFIED";
}

/** Links a member may see: organisation-wide ones and those for their branches. */
export function linkScopeWhere(ctx: Ctx, branchId?: string | null) {
  if (branchId) return { OR: [{ branchId }, { branchId: null }] };
  return branchScope(ctx);
}

/** Links an existing record to an assessment area by hand. It waits for a reviewer; linking never verifies. */
export async function linkEvidence(ctx: Ctx, input: { criterionId: string; sourceType: string; sourceId: string; note?: string }) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  if (!isSourceType(input.sourceType)) throw new ValidationError("Choose what kind of record this is");
  const criterion = await db.cqcCriterion.findUnique({ where: { id: input.criterionId }, select: { id: true, code: true } });
  if (!criterion) throw new NotFoundError("Assessment area");
  const info = sourceInfo(await describeSources(ctx, organisationId, [input]), input);
  if (!info.exists) throw new NotFoundError("Record");
  if (info.restricted) throw new ForbiddenError("You cannot link a restricted record");
  if (info.branchId && ctx.branchIds && !ctx.branchIds.includes(info.branchId)) throw new NotFoundError("Record");
  const existing = await db.cqcEvidenceLink.findUnique({ where: { organisationId_criterionId_sourceType_sourceId: { organisationId, criterionId: criterion.id, sourceType: input.sourceType, sourceId: input.sourceId } } });
  if (existing && existing.status !== "SUGGESTED" && existing.status !== "REJECTED") throw new ConflictError("This record is already linked to this area");
  const link = existing
    ? await db.cqcEvidenceLink.update({ where: { id: existing.id }, data: { status: "AWAITING_REVIEW", origin: "MANUAL", linkedById: ctx.userId, note: input.note?.trim() || existing.note } })
    : await db.cqcEvidenceLink.create({ data: { organisationId, criterionId: criterion.id, branchId: info.branchId, sourceType: input.sourceType, sourceId: input.sourceId, sourceRef: info.label.slice(0, 200), status: "AWAITING_REVIEW", origin: "MANUAL", linkedById: ctx.userId, note: input.note?.trim() || null } });
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.evidence.linked", entityType: "CqcEvidenceLink", entityId: link.id, data: { criterion: criterion.code, sourceType: input.sourceType, sourceId: input.sourceId, from: existing?.status ?? null, to: "AWAITING_REVIEW" } });
  return link;
}

/**
 * A reviewer's decision on one piece of evidence. Verifying sets how long it counts (the source's own expiry, or a year).
 * An RCA counts only once its findings have been approved by a manager. Every decision is kept in the audit log.
 */
export async function reviewEvidence(ctx: Ctx, linkId: string, input: { to: string; note?: string; expectedUpdatedAt?: string }) {
  const organisationId = requireOrgPermission(ctx, "cqc.evidence.verify");
  const to = REVIEW_TO.find((s) => s === input.to);
  if (!to) throw new ValidationError("Choose a decision");
  const note = input.note?.trim() ?? "";
  if (to !== "VERIFIED" && to !== "AWAITING_REVIEW" && note.length < 3) throw new ValidationError("Say why (for example what is wrong with it or what replaced it)");
  const link = await db.cqcEvidenceLink.findFirst({ where: { id: linkId, organisationId, ...linkScopeWhere(ctx) } });
  if (!link) throw new NotFoundError("Evidence link");
  if (input.expectedUpdatedAt && link.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictError("Someone else reviewed this evidence since you opened it. Reload and check their decision.");
  const info = sourceInfo(await describeSources(ctx, organisationId, [link]), link);
  if (to === "VERIFIED") {
    if (!info.exists) throw new ConflictError("The record no longer exists, so it cannot be verified");
    if (info.restricted) throw new ForbiddenError("You cannot verify a restricted record");
    if (info.stale) throw new ConflictError(`This cannot be verified yet: ${info.stale.toLowerCase()}`);
    if (link.sourceType === "RCA") {
      const confirmed = await db.rcaFinding.count({ where: { rcaId: link.sourceId, organisationId, status: "CONFIRMED" } });
      if (!confirmed) throw new ConflictError("This investigation has no manager-confirmed findings yet, so it cannot count as evidence");
    }
  }
  const now = new Date();
  const validUntil = to === "VERIFIED" ? (info.expiresAt && info.expiresAt > now ? info.expiresAt : new Date(now.getTime() + DEFAULT_CURRENCY_DAYS * DAY)) : link.validUntil;
  const { count } = await db.cqcEvidenceLink.updateMany({ where: { id: link.id, updatedAt: link.updatedAt }, data: { status: to, reviewedById: ctx.userId, reviewedAt: now, reviewNote: note || null, validUntil } });
  if (!count) throw new ConflictError("Someone else reviewed this evidence since you opened it. Reload and check their decision.");
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.evidence.reviewed", entityType: "CqcEvidenceLink", entityId: link.id, data: { from: link.status, to, note: note || null, validUntil: validUntil?.toISOString() ?? null } });
}

/** Moves a suggestion into the review queue without deciding it. */
export async function proposeSuggestion(ctx: Ctx, linkId: string) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const link = await db.cqcEvidenceLink.findFirst({ where: { id: linkId, organisationId, status: "SUGGESTED", ...linkScopeWhere(ctx) } });
  if (!link) throw new NotFoundError("Suggestion");
  await db.cqcEvidenceLink.update({ where: { id: link.id }, data: { status: "AWAITING_REVIEW", linkedById: ctx.userId } });
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.evidence.proposed", entityType: "CqcEvidenceLink", entityId: link.id, data: { from: "SUGGESTED", to: "AWAITING_REVIEW" } });
}

const CAP = 6;

/**
 * Looks through existing records for things that may support each assessment area and adds them as Suggested. It only
 * ever adds suggestions: it never verifies, never changes a reviewer's decision and never copies files. Matching is by
 * the area's record kinds and keywords, so suggestions can be wrong; a reviewer decides.
 */
export async function discoverEvidence(ctx: Ctx, opts: { frameworkId: string; branchId?: string | null; now?: Date }) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const now = opts.now ?? new Date();
  const criteria = await db.cqcCriterion.findMany({ where: { frameworkId: opts.frameworkId } });
  const branch = opts.branchId ? { OR: [{ branchId: opts.branchId }, { branchId: null }] } : branchScope(ctx);
  const suBranch = opts.branchId ? { serviceUser: { branchId: opts.branchId } } : ctx.branchIds ? { serviceUser: { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } } : {};
  const year = new Date(now.getTime() - 365 * DAY);
  const words = (k: string[], field: string) => k.map((w) => ({ [field]: { contains: w, mode: "insensitive" as const } }));
  const rows: { organisationId: string; criterionId: string; branchId: string | null; sourceType: string; sourceId: string; sourceRef: string; status: string; origin: string }[] = [];
  const add = (criterionId: string, sourceType: SourceType, sourceId: string, label: string, branchId: string | null) => rows.push({ organisationId, criterionId, branchId, sourceType, sourceId, sourceRef: label.slice(0, 200), status: "SUGGESTED", origin: "DISCOVERED" });
  for (const c of criteria) {
    const kinds = new Set(c.discoveryKinds);
    const kw = c.keywords;
    if (kinds.has("POLICY") && kw.length) {
      for (const p of await db.policy.findMany({ where: { organisationId, kind: "CUSTOMER", status: "ACTIVE", currentPublishedVersionId: { not: null }, OR: words(kw, "title"), ...branch }, select: { id: true, ref: true, title: true, branchId: true }, take: CAP })) add(c.id, "POLICY", p.id, `${p.ref} ${p.title}`, p.branchId);
    }
    if (kinds.has("AUDIT") && kw.length) {
      for (const a of await db.audit.findMany({ where: { organisationId, status: "COMPLETED", completedAt: { gte: year }, OR: words(kw, "title"), ...branch }, select: { id: true, title: true, branchId: true }, take: CAP })) add(c.id, "AUDIT", a.id, a.title, a.branchId);
    }
    if (kinds.has("EVIDENCE_DOCUMENT") && kw.length) {
      for (const d of await db.evidenceDocument.findMany({ where: { organisationId, scanStatus: { not: "INFECTED" }, OR: [...words(kw, "description"), ...words(kw, "filename")] }, select: { id: true, filename: true }, take: CAP })) add(c.id, "EVIDENCE_DOCUMENT", d.id, d.filename, null);
    }
    if (kinds.has("ACTION") && kw.length) {
      for (const a of await db.complianceAction.findMany({ where: { organisationId, status: { in: ["VERIFIED", "CLOSED"] }, OR: words(kw, "title") }, select: { id: true, title: true }, take: CAP })) add(c.id, "ACTION", a.id, a.title, null);
    }
    if (kinds.has("TRAINING") && kw.length) {
      for (const t of await db.readinessRequirement.findMany({ where: { organisationId, status: "ACTIVE", OR: words(kw, "name") }, select: { id: true, name: true }, take: CAP })) add(c.id, "TRAINING", t.id, t.name, null);
    }
    if (kinds.has("CARE_PLAN")) {
      for (const p of await db.carePlan.findMany({ where: { organisationId, status: "ACTIVE", approvedAt: { gte: year }, ...suBranch }, select: { id: true, version: true, serviceUser: { select: { reference: true, branchId: true } } }, orderBy: { approvedAt: "desc" }, take: 3 })) add(c.id, "CARE_PLAN", p.id, `Care plan v${p.version} for ${p.serviceUser.reference}`, p.serviceUser.branchId);
    }
    if (kinds.has("MISSED_CALL")) {
      for (const m of await db.missedCallCase.findMany({ where: { organisationId, signedOffAt: { not: null, gte: year }, visit: opts.branchId ? { serviceUser: { branchId: opts.branchId } } : {} }, select: { id: true, visit: { select: { reference: true, serviceUser: { select: { branchId: true } } } } }, orderBy: { signedOffAt: "desc" }, take: 3 })) add(c.id, "MISSED_CALL", m.id, `Missed call investigation, visit ${m.visit.reference}`, m.visit.serviceUser?.branchId ?? null);
    }
    if (kinds.has("INCIDENT") && kw.length) {
      // Only closed incidents with an outcome, and never safeguarding ones (those go through an RCA and a reviewer).
      for (const i of await db.incident.findMany({ where: { organisationId, status: "CLOSED", safeguarding: false, closedAt: { gte: year }, OR: [...words(kw, "category"), ...words(kw, "outcome")], ...suBranch }, select: { id: true, reference: true, category: true, serviceUser: { select: { branchId: true } } }, orderBy: { closedAt: "desc" }, take: 3 })) add(c.id, "INCIDENT", i.id, `${i.reference} ${i.category}`, i.serviceUser?.branchId ?? null);
    }
    if (kinds.has("RCA")) {
      // An RCA is suggested once a manager has confirmed at least one finding; unconfirmed findings never count.
      for (const r of await db.rcaInvestigation.findMany({ where: { organisationId, status: { in: ["ACTIONS_IN_PROGRESS", "EFFECTIVENESS_REVIEW", "CLOSED"] }, restricted: false, findings: { some: { status: "CONFIRMED" } }, ...branch }, select: { id: true, reference: true, title: true, branchId: true }, orderBy: { openedAt: "desc" }, take: CAP })) add(c.id, "RCA", r.id, `${r.reference} ${r.title}`, r.branchId);
    }
  }
  const { count } = rows.length ? await db.cqcEvidenceLink.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.evidence.discovered", entityType: "CqcFramework", entityId: opts.frameworkId, data: { branchId: opts.branchId ?? null, considered: rows.length, added: count } });
  return { added: count, considered: rows.length };
}

/** Evidence links for some areas, with their source described and their effective status, in the caller's scope. */
export async function linksFor(ctx: Ctx, organisationId: string, where: { criterionIds?: string[]; branchId?: string | null; status?: string; sourceType?: string; sourceId?: string }, now = new Date()) {
  const links = await db.cqcEvidenceLink.findMany({
    where: { organisationId, ...(where.criterionIds ? { criterionId: { in: where.criterionIds } } : {}), ...(where.sourceType ? { sourceType: where.sourceType } : {}), ...(where.sourceId ? { sourceId: where.sourceId } : {}), AND: [linkScopeWhere(ctx, where.branchId)] },
    include: { criterion: { select: { id: true, code: true, title: true, keyQuestion: true, frameworkId: true } } },
    orderBy: [{ updatedAt: "desc" }],
  });
  const info = await describeSources(ctx, organisationId, links, now);
  const rows = links.map((l) => {
    const i = sourceInfo(info, l);
    return { ...l, info: i, effective: effectiveStatus(l, i, now) };
  });
  return where.status ? rows.filter((r) => (where.status === "AWAITING" ? r.effective === "SUGGESTED" || r.effective === "AWAITING_REVIEW" : r.effective === where.status)) : rows;
}
