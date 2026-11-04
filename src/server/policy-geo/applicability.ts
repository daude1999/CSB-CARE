import type { GeoLevel, VerificationStatus } from "@prisma/client";

/**
 * Which sources apply where. Pure functions, so the geographic rules are tested without a database.
 *
 * The rule is deliberately narrow: a national source applies to every branch in England; a regional or local source
 * applies only when the branch's recorded local authority is one it names, or (when it names none) when the branch's
 * recorded region is one it names. Nothing is inferred from a branch's name or address, and a branch with no recorded
 * local authority receives national sources only.
 */
export type GeoSourceLike = { geoLevel: GeoLevel; regionCodes: string[]; localAuthorityCodes: string[]; topics: string[]; lifecycle: string; active: boolean };
export type BranchGeo = { localAuthorityCode: string | null; regionCode: string | null };

export function sourceAppliesTo(source: GeoSourceLike, branch: BranchGeo): boolean {
  if (source.geoLevel === "NATIONAL") return true;
  if (source.localAuthorityCodes.length) return !!branch.localAuthorityCode && source.localAuthorityCodes.includes(branch.localAuthorityCode);
  return !!branch.regionCode && source.regionCodes.includes(branch.regionCode);
}

export function sourceCoversTopic(source: Pick<GeoSourceLike, "topics">, categoryCode: string | null): boolean {
  return !source.topics.length || !categoryCode || source.topics.includes(categoryCode);
}

/** Policy categories whose branch policies must carry local arrangements (a local appendix or a branch policy). */
export const LOCAL_ARRANGEMENT_CATEGORIES = ["SAFEGUARDING", "INCIDENTS", "COMPLAINTS", "HOME_CARE"] as const;
export const needsLocalArrangements = (categoryCode: string) => (LOCAL_ARRANGEMENT_CATEGORIES as readonly string[]).includes(categoryCode);

export type SourceTrust = "verified" | "unverified" | "needs_review" | "review_overdue" | "superseded" | "check_failed";

export const TRUST_LABEL: Record<SourceTrust, string> = {
  verified: "Verified",
  unverified: "Not yet verified",
  needs_review: "Needs review",
  review_overdue: "Review overdue",
  superseded: "Superseded",
  check_failed: "Could not be checked",
};

/**
 * How far an organisation may rely on a source today. Only a check recorded by the organisation counts as verified; a
 * failed automatic check is never reported as "unchanged", and a review date in the past makes it overdue.
 */
export function sourceTrust(
  source: { lifecycle: string; retrievalStatus: string; coverage: string },
  review: { status: VerificationStatus; nextReviewDate: Date | null } | null,
  now = new Date(),
): SourceTrust {
  if (source.lifecycle === "SUPERSEDED") return "superseded";
  if (source.coverage !== "MANUAL_REVIEW_ONLY" && source.retrievalStatus === "FAILING") return "check_failed";
  if (!review || review.status === "UNVERIFIED") return "unverified";
  if (review.status === "NEEDS_REVIEW") return "needs_review";
  if (review.nextReviewDate && review.nextReviewDate < now) return "review_overdue";
  return "verified";
}

export type GapDraft = { kind: string; severity: "CRITICAL" | "WARNING"; message: string; branchId: string | null; sourceId: string | null };

/**
 * What is missing before a branch's local arrangements can be relied on. Missing contacts and procedures are critical
 * for categories that need local arrangements; an unverified or failing source is critical when it is the only local
 * source the branch has.
 */
export function branchGaps(args: {
  branch: { id: string; name: string };
  profile: { localAuthorityCode: string | null; regionCode: string | null; localProcedures: string | null; safeguardingContacts: string | null; outOfHoursContacts: string | null; referralUrl: string | null; lastVerifiedAt: Date | null; contactsVerifiedAt: Date | null; nextReviewDate: Date | null } | null;
  categoryCode: string;
  sources: { id: string; name: string; geoLevel: GeoLevel; trust: SourceTrust }[];
  now?: Date;
}): GapDraft[] {
  const { branch, profile, categoryCode } = args;
  const now = args.now ?? new Date();
  const local = needsLocalArrangements(categoryCode);
  const sev = (critical: boolean) => (critical ? "CRITICAL" : "WARNING") as "CRITICAL" | "WARNING";
  const out: GapDraft[] = [];
  const g = (kind: string, critical: boolean, message: string, sourceId: string | null = null) => out.push({ kind, severity: sev(critical), message, branchId: branch.id, sourceId });
  if (!profile?.localAuthorityCode) g("PROFILE_INCOMPLETE", true, `${branch.name}: no local authority is recorded, so only national requirements could be assembled. Record it in Branch & Local Authority Configuration.`);
  if (!profile?.regionCode) g("PROFILE_INCOMPLETE", local, `${branch.name}: no region is recorded, so regional procedures could not be identified.`);
  if (local) {
    if (!profile?.localProcedures?.trim()) g("MISSING_PROCEDURE", true, `${branch.name}: the local safeguarding referral procedure has not been recorded. It must be taken from the official local source, not written from memory.`);
    if (!profile?.safeguardingContacts?.trim()) g("MISSING_CONTACTS", true, `${branch.name}: no local safeguarding contact details are recorded. Add them from the council's official page; none are invented.`);
    if (!profile?.outOfHoursContacts?.trim()) g("MISSING_CONTACTS", true, `${branch.name}: no out-of-hours or emergency arrangements are recorded.`);
    if (!profile?.referralUrl?.trim()) g("MISSING_CONTACTS", false, `${branch.name}: no local referral web page is recorded.`);
    if (profile && profile.safeguardingContacts?.trim() && !profile.contactsVerifiedAt) g("CONTACTS_UNVERIFIED", true, `${branch.name}: the local contact details have not been confirmed against the official source.`);
  }
  if (profile && !profile.lastVerifiedAt) g("PROFILE_UNVERIFIED", local, `${branch.name}: the branch's local authority configuration has not been verified by a manager.`);
  if (profile?.nextReviewDate && profile.nextReviewDate < now) g("PROFILE_REVIEW_OVERDUE", local, `${branch.name}: the branch configuration was due for review on ${profile.nextReviewDate.toDateString()}.`);
  const nonNational = args.sources.filter((s) => s.geoLevel !== "NATIONAL");
  if (local && profile?.localAuthorityCode && !nonNational.some((s) => s.geoLevel === "LOCAL")) g("MISSING_SOURCE", true, `${branch.name}: no local authority source is recorded for this area. Add the official local procedure to the reference library.`);
  if (local && profile?.regionCode && !nonNational.some((s) => s.geoLevel === "REGIONAL")) g("MISSING_SOURCE", false, `${branch.name}: no regional safeguarding procedure is recorded for this region.`);
  const usable = nonNational.filter((s) => s.trust === "verified");
  for (const s of nonNational) {
    if (s.trust === "verified") continue;
    const critical = local && !usable.length;
    const kind = s.trust === "check_failed" ? "SOURCE_CHECK_FAILED" : s.trust === "superseded" || s.trust === "review_overdue" ? "OUTDATED_SOURCE" : "UNVERIFIED_SOURCE";
    g(kind, critical, `${branch.name}: "${s.name}" is ${TRUST_LABEL[s.trust].toLowerCase()}. Statements drawn from it must be checked before publication.`, s.id);
  }
  return out;
}
