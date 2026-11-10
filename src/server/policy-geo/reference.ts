import type { GeoLevel, Prisma, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, hasPlatformPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { enqueue } from "../jobs/queue";
import { sourceAppliesTo, sourceCoversTopic, sourceTrust, type SourceTrust } from "./applicability";
import { LOCAL_AUTHORITIES, REGION_CODES, laCode, regionName } from "./regions";
import { GEO_SOURCES } from "./reference-sources";

/**
 * The Local Regulatory & Safeguarding Reference Library. It extends the existing regulatory source register
 * (RegulatorySource) with where each source applies, rather than keeping a second source database, so the existing
 * monitoring engine checks local pages exactly as it checks national ones. Each organisation records its own check of
 * a source (OrgSourceReview); one organisation's check never vouches for a source for another.
 */

/** Adds the starter local authorities and regional and local sources if they are missing. Idempotent and cheap. */
export async function ensureGeoReference() {
  const known = await db.localAuthority.count();
  if (known < LOCAL_AUTHORITIES.length) {
    await db.localAuthority.createMany({ data: LOCAL_AUTHORITIES, skipDuplicates: true });
  }
  const have = new Set((await db.regulatorySource.findMany({ where: { key: { in: GEO_SOURCES.map((s) => s.key) } }, select: { key: true } })).map((s) => s.key));
  for (const s of GEO_SOURCES.filter((x) => !have.has(x.key))) {
    await db.regulatorySource.create({
      data: {
        key: s.key,
        name: s.name,
        canonicalUrl: s.canonicalUrl,
        category: s.category,
        serviceTypes: [],
        monitoringMethod: s.monitoringMethod,
        coverage: s.coverage,
        config: s.config as Prisma.InputJsonValue,
        frequencyMinutes: s.frequencyMinutes,
        freshnessWindowHours: Math.max(48, Math.round((s.frequencyMinutes / 60) * 2)),
        monitoringNotes: s.monitoringNotes,
        licence: "Public sector information; check the publisher's terms before reusing text",
        geoLevel: s.geoLevel,
        regionCodes: s.regionCodes,
        localAuthorityCodes: s.localAuthorityCodes,
        issuingOrganisation: s.issuingOrganisation,
        topics: s.topics,
        versionLabel: s.versionLabel ?? null,
      },
    });
  }
}

export type LibraryFilters = { level?: string; la?: string; trust?: string; topic?: string; q?: string };

const visibleSourceWhere = { isSimulated: false } satisfies Prisma.RegulatorySourceWhereInput;

/** The library as one organisation sees it: every real source, with that organisation's own check of it. */
export async function referenceLibrary(ctx: Ctx, f: LibraryFilters = {}) {
  if (!ctx.organisationId) throw new ForbiddenError();
  await ensureGeoReference();
  const now = new Date();
  const where: Prisma.RegulatorySourceWhereInput = {
    AND: [
      visibleSourceWhere,
      f.level && ["NATIONAL", "REGIONAL", "LOCAL"].includes(f.level) ? { geoLevel: f.level as GeoLevel } : {},
      f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { issuingOrganisation: { contains: f.q, mode: "insensitive" } }] } : {},
      f.topic ? { OR: [{ topics: { has: f.topic } }, { topics: { isEmpty: true } }] } : {},
    ],
  };
  const [sources, reviews, las, links] = await Promise.all([
    db.regulatorySource.findMany({ where, orderBy: [{ geoLevel: "asc" }, { name: "asc" }], include: { _count: { select: { changes: true } } } }),
    db.orgSourceReview.findMany({ where: { organisationId: ctx.organisationId } }),
    db.localAuthority.findMany({ orderBy: { name: "asc" } }),
    db.policySourceLink.groupBy({ by: ["sourceId"], where: { organisationId: ctx.organisationId }, _count: { _all: true } }),
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.sourceId, r]));
  const laName = new Map(las.map((l) => [l.code, l.name]));
  const linkCount = new Map(links.map((l) => [l.sourceId, l._count._all]));
  let rows = sources.map((s) => {
    const review = reviewBy.get(s.id) ?? null;
    const trust = sourceTrust(s, review, now);
    return {
      ...s,
      review,
      trust,
      policies: linkCount.get(s.id) ?? 0,
      areas: s.geoLevel === "NATIONAL" ? "England" : s.localAuthorityCodes.length ? s.localAuthorityCodes.map((c) => laName.get(c) ?? c).join(", ") : s.regionCodes.map((c) => regionName(c)).join(", "),
    };
  });
  if (f.la) {
    const la = las.find((l) => l.code === f.la);
    rows = rows.filter((r) => sourceAppliesTo(r, { localAuthorityCode: f.la!, regionCode: la?.regionCode ?? null }));
  }
  if (f.trust) rows = rows.filter((r) => r.trust === f.trust);
  return { rows, localAuthorities: las };
}

const reviewSchema = z.object({
  status: z.enum(["VERIFIED", "UNVERIFIED", "NEEDS_REVIEW"]),
  note: z.string().trim().max(2000).optional(),
  nextReviewDate: z.coerce.date<Date>().optional(),
});

/** Records the organisation's own check of a source. "Verified" needs a note of what was checked and a next review date. */
export async function reviewSource(ctx: Ctx, sourceId: string, input: z.input<typeof reviewSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "policy.sources.verify");
  const p = reviewSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the review");
  const d = p.data;
  const source = await db.regulatorySource.findFirst({ where: { id: sourceId, ...visibleSourceWhere }, include: { documents: { include: { currentVersion: { select: { contentHash: true } } } } } });
  if (!source) throw new NotFoundError("Source");
  if (d.status === "VERIFIED") {
    if (!d.note || d.note.length < 10) throw new ValidationError("Say what you checked on the official page (at least a short sentence)");
    if (!d.nextReviewDate) throw new ValidationError("Set the date this source should next be checked");
    if (d.nextReviewDate <= new Date()) throw new ValidationError("The next review date must be in the future");
    if (source.lifecycle === "SUPERSEDED") throw new ConflictError("This source has been superseded; verify its replacement instead");
  }
  const hash = source.documents.map((x) => x.currentVersion?.contentHash ?? "").sort().join(",") || null;
  return db.$transaction(async (tx) => {
    const before = await tx.orgSourceReview.findUnique({ where: { organisationId_sourceId: { organisationId, sourceId } } });
    const data = { status: d.status as VerificationStatus, note: d.note ?? null, lastCheckedAt: new Date(), reviewerId: ctx.userId, nextReviewDate: d.nextReviewDate ?? null, verifiedContentHash: d.status === "VERIFIED" ? hash : null };
    const row = await tx.orgSourceReview.upsert({ where: { organisationId_sourceId: { organisationId, sourceId } }, create: { organisationId, sourceId, ...data }, update: data });
    await audit({ organisationId, actorId: ctx.userId, action: "source.reviewed", entityType: "RegulatorySource", entityId: sourceId, data: { from: before?.status ?? "UNVERIFIED", to: d.status, note: d.note ?? null, nextReviewDate: d.nextReviewDate?.toISOString() ?? null } }, tx);
    return row;
  });
}

const proposeSchema = z.object({
  name: z.string().trim().min(5, "Give the source's official title").max(300),
  issuingOrganisation: z.string().trim().min(2, "Name the organisation that publishes it").max(200),
  canonicalUrl: z.string().trim().url("Give the official web address").refine((u) => u.startsWith("https://"), "Use the official https:// address"),
  geoLevel: z.enum(["NATIONAL", "REGIONAL", "LOCAL"]),
  regionCodes: z.array(z.enum(REGION_CODES)).default([]),
  localAuthorityCodes: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  documentReference: z.string().trim().max(200).optional(),
  versionLabel: z.string().trim().max(200).optional(),
  publishedOn: z.coerce.date<Date>().optional(),
  effectiveOn: z.coerce.date<Date>().optional(),
  referenceSummary: z.string().trim().max(4000).optional(),
});

/**
 * Adds an official source to the shared library. It starts unverified and reviewed by hand (no automatic checking
 * until CSB platform staff confirm the site permits it), so nothing is scraped on the strength of a form.
 */
export async function proposeSource(ctx: Ctx, input: z.input<typeof proposeSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  const p = proposeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the source details");
  const d = p.data;
  if (d.geoLevel === "REGIONAL" && !d.regionCodes.length) throw new ValidationError("Choose the region this source applies to");
  if (d.geoLevel === "LOCAL" && !d.localAuthorityCodes.length) throw new ValidationError("Choose the local authority this source applies to");
  if (d.localAuthorityCodes.length) {
    const found = await db.localAuthority.count({ where: { code: { in: d.localAuthorityCodes } } });
    if (found !== d.localAuthorityCodes.length) throw new ValidationError("Choose local authorities from the list");
  }
  const dup = await db.regulatorySource.findFirst({ where: { canonicalUrl: d.canonicalUrl } });
  if (dup) throw new ConflictError(`That address is already in the library as "${dup.name}"`);
  const key = `org-${laCode(d.name).slice(0, 50)}-${Date.now().toString(36)}`;
  return db.$transaction(async (tx) => {
    const s = await tx.regulatorySource.create({
      data: {
        key,
        name: d.name,
        canonicalUrl: d.canonicalUrl,
        category: "GOVERNMENT_GUIDANCE",
        monitoringMethod: "MANUAL",
        coverage: "MANUAL_REVIEW_ONLY",
        frequencyMinutes: 7 * 1440,
        monitoringNotes: "Added by a provider organisation. Reviewed by hand until CSB confirms the site may be checked automatically.",
        geoLevel: d.geoLevel,
        regionCodes: d.geoLevel === "NATIONAL" ? [] : d.regionCodes,
        localAuthorityCodes: d.geoLevel === "NATIONAL" ? [] : d.localAuthorityCodes,
        topics: d.topics,
        issuingOrganisation: d.issuingOrganisation,
        documentReference: d.documentReference || null,
        versionLabel: d.versionLabel || null,
        publishedOn: d.publishedOn ?? null,
        effectiveOn: d.effectiveOn ?? null,
        referenceSummary: d.referenceSummary || null,
        addedByOrganisationId: organisationId,
      },
    });
    await tx.orgSourceReview.create({ data: { organisationId, sourceId: s.id, status: "UNVERIFIED" } });
    await audit({ organisationId, actorId: ctx.userId, action: "source.proposed", entityType: "RegulatorySource", entityId: s.id, data: { name: d.name, url: d.canonicalUrl, geoLevel: d.geoLevel } }, tx);
    return s;
  });
}

const detailSchema = z.object({
  referenceSummary: z.string().trim().max(4000).optional(),
  versionLabel: z.string().trim().max(200).optional(),
  documentReference: z.string().trim().max(200).optional(),
  publishedOn: z.coerce.date<Date>().optional(),
  effectiveOn: z.coerce.date<Date>().optional(),
});

/**
 * Updates the descriptive details of a source the organisation added (summary, version, dates). Sources curated by
 * CSB are changed by CSB platform staff only. The previous values are kept in the audit log.
 */
export async function updateSourceDetails(ctx: Ctx, sourceId: string, input: z.input<typeof detailSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  const p = detailSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  const s = await db.regulatorySource.findFirst({ where: { id: sourceId, ...visibleSourceWhere } });
  if (!s) throw new NotFoundError("Source");
  if (s.addedByOrganisationId !== organisationId && !hasPlatformPermission(ctx, "sources.manage")) throw new ForbiddenError("Only CSB can change the details of sources it curates. Record your own check instead.");
  const d = p.data;
  await db.$transaction(async (tx) => {
    await tx.regulatorySource.update({ where: { id: s.id }, data: { referenceSummary: d.referenceSummary ?? s.referenceSummary, versionLabel: d.versionLabel ?? s.versionLabel, documentReference: d.documentReference ?? s.documentReference, publishedOn: d.publishedOn ?? s.publishedOn, effectiveOn: d.effectiveOn ?? s.effectiveOn } });
    await audit({ organisationId, actorId: ctx.userId, action: "source.details_updated", entityType: "RegulatorySource", entityId: s.id, data: { before: { referenceSummary: s.referenceSummary, versionLabel: s.versionLabel, documentReference: s.documentReference } } }, tx);
  });
}

/**
 * Marks a source as superseded by another, keeping both (history is never deleted). Organisations' reviews of the old
 * source move to "Needs review" so policies relying on it are flagged.
 */
export async function supersedeSource(ctx: Ctx, sourceId: string, replacementId: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  if (reason.trim().length < 5) throw new ValidationError("Say why the source is superseded");
  if (sourceId === replacementId) throw new ValidationError("Choose a different replacement");
  const [s, r] = await Promise.all([db.regulatorySource.findFirst({ where: { id: sourceId, ...visibleSourceWhere } }), db.regulatorySource.findFirst({ where: { id: replacementId, ...visibleSourceWhere } })]);
  if (!s || !r) throw new NotFoundError("Source");
  if (s.addedByOrganisationId !== organisationId && !hasPlatformPermission(ctx, "sources.manage")) throw new ForbiddenError("Only CSB can retire sources it curates. Mark your check as needing review instead.");
  await db.$transaction(async (tx) => {
    await tx.regulatorySource.update({ where: { id: s.id }, data: { lifecycle: "SUPERSEDED", supersededById: r.id } });
    await tx.orgSourceReview.updateMany({ where: { sourceId: s.id, status: "VERIFIED" }, data: { status: "NEEDS_REVIEW" } });
    await audit({ organisationId, actorId: ctx.userId, action: "source.superseded", entityType: "RegulatorySource", entityId: s.id, data: { replacementId: r.id, reason } }, tx);
  });
}

/**
 * Asks the monitoring service to check a source now (manual refresh). Only for automatically monitored sources; at most
 * once an hour per source, so a busy page never turns into excessive retrieval of a council's website.
 */
export async function requestSourceRefresh(ctx: Ctx, sourceId: string) {
  if (!hasOrgPermission(ctx, "policy.sources.verify") && !hasPlatformPermission(ctx, "sources.manage")) throw new ForbiddenError();
  const s = await db.regulatorySource.findFirst({ where: { id: sourceId, ...visibleSourceWhere } });
  if (!s) throw new NotFoundError("Source");
  if (s.coverage === "MANUAL_REVIEW_ONLY" || s.monitoringMethod === "MANUAL") throw new ConflictError("This source is reviewed by hand; it is not checked automatically. Open it and record your check.");
  const hour = Math.floor(Date.now() / 3600_000);
  const { created } = await enqueue("source.check", { sourceId: s.id, trigger: "MANUAL", requestedBy: ctx.userId }, { idempotencyKey: `source.check:${s.id}:org-refresh:${hour}`, maxAttempts: 2 });
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "source.refresh_requested", entityType: "RegulatorySource", entityId: s.id, data: { queued: created } });
  return created;
}

/** Every real source that applies to a branch's geography and the policy category, with the organisation's trust in it. */
export async function sourcesForBranch(organisationId: string, branch: { localAuthorityCode: string | null; regionCode: string | null; extraSourceIds?: string[] }, categoryCode: string | null) {
  const [sources, reviews] = await Promise.all([
    db.regulatorySource.findMany({ where: { ...visibleSourceWhere, active: true }, orderBy: [{ geoLevel: "asc" }, { name: "asc" }] }),
    db.orgSourceReview.findMany({ where: { organisationId } }),
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.sourceId, r]));
  const now = new Date();
  return sources
    .filter((s) => (sourceAppliesTo(s, branch) || (branch.extraSourceIds ?? []).includes(s.id)) && sourceCoversTopic(s, categoryCode))
    .filter((s) => s.lifecycle !== "SUPERSEDED" || (branch.extraSourceIds ?? []).includes(s.id))
    .map((s) => ({ ...s, review: reviewBy.get(s.id) ?? null, trust: sourceTrust(s, reviewBy.get(s.id) ?? null, now) as SourceTrust }));
}
