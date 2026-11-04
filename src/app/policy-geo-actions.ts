"use server";

import { handle, str } from "./action-kit";
import { addLocalAuthority, updateBranchProfile, verifyBranchProfile } from "@/server/policy-geo/branches";
import { proposeSource, requestSourceRefresh, reviewSource, supersedeSource, updateSourceDetails } from "@/server/policy-geo/reference";
import { generatePolicyDraft, recheckGaps, resolveGap } from "@/server/policy-geo/generator";
import { recordIncidentLocation, recordSafeguardingDecision, recordServiceUserGeography } from "@/server/policy-geo/cross-boundary";

/** Branch-specific policy generation: thin wrappers that read the form and call src/server/policy-geo. */

const all = (fd: FormData, k: string) => fd.getAll(k).map(String).map((s) => s.trim()).filter(Boolean);
const optDate = (fd: FormData, k: string) => str(fd, k) || undefined;

// ── Branch & Local Authority Configuration ──
export async function saveBranchProfileAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const r = await updateBranchProfile(ctx, str(fd, "branchId"), {
        branchReference: str(fd, "branchReference"),
        address: str(fd, "address"),
        postcode: str(fd, "postcode"),
        localAuthorityCode: str(fd, "localAuthorityCode"),
        regionCode: (str(fd, "regionCode") || undefined),
        serviceTypes: all(fd, "serviceTypes"),
        safeguardingAdultsBoard: str(fd, "safeguardingAdultsBoard"),
        safeguardingChildrenPartnership: str(fd, "safeguardingChildrenPartnership"),
        regionalGuidance: str(fd, "regionalGuidance"),
        localProcedures: str(fd, "localProcedures"),
        referralUrl: str(fd, "referralUrl"),
        safeguardingContacts: str(fd, "safeguardingContacts"),
        outOfHoursContacts: str(fd, "outOfHoursContacts"),
        integratedCareBoard: str(fd, "integratedCareBoard"),
        commissioningArrangements: str(fd, "commissioningArrangements"),
        extraSourceIds: all(fd, "extraSourceIds"),
        nextReviewDate: optDate(fd, "nextReviewDate"),
        responsibleManagerId: str(fd, "responsibleManagerId"),
        version: str(fd, "version"),
      });
      return { ok: r.verificationCleared ? "Branch saved. Local details changed, so a manager must verify the configuration again" : "Branch saved" };
    },
    "Branch saved",
  );
}

export async function verifyBranchProfileAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const what = str(fd, "what") === "contacts" ? "contacts" : "profile";
    await verifyBranchProfile(ctx, str(fd, "branchId"), { what, note: str(fd, "note"), nextReviewDate: str(fd, "nextReviewDate") ? new Date(str(fd, "nextReviewDate")) : undefined });
    return { ok: what === "contacts" ? "Local contacts confirmed" : "Branch configuration verified" };
  }, "Verified");
}

export async function addLocalAuthorityAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await addLocalAuthority(ctx, { name: str(fd, "name"), regionCode: str(fd, "regionCode"), subRegion: str(fd, "subRegion") })), "Local authority added");
}

// ── Reference library ──
export async function reviewSourceAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await reviewSource(ctx, str(fd, "sourceId"), { status: str(fd, "status"), note: str(fd, "note") || undefined, nextReviewDate: optDate(fd, "nextReviewDate") })), "Check recorded");
}

export async function proposeSourceAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) =>
      void (await proposeSource(ctx, {
        name: str(fd, "name"),
        issuingOrganisation: str(fd, "issuingOrganisation"),
        canonicalUrl: str(fd, "canonicalUrl"),
        geoLevel: str(fd, "geoLevel"),
        regionCodes: all(fd, "regionCodes"),
        localAuthorityCodes: all(fd, "localAuthorityCodes"),
        topics: all(fd, "topics"),
        documentReference: str(fd, "documentReference") || undefined,
        versionLabel: str(fd, "versionLabel") || undefined,
        publishedOn: optDate(fd, "publishedOn"),
        effectiveOn: optDate(fd, "effectiveOn"),
        referenceSummary: str(fd, "referenceSummary") || undefined,
      })),
    "Source added. It is marked not yet verified until someone records a check",
  );
}

export async function updateSourceDetailsAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await updateSourceDetails(ctx, str(fd, "sourceId"), { referenceSummary: str(fd, "referenceSummary") || undefined, versionLabel: str(fd, "versionLabel") || undefined, documentReference: str(fd, "documentReference") || undefined, publishedOn: optDate(fd, "publishedOn"), effectiveOn: optDate(fd, "effectiveOn") })), "Source details saved");
}

export async function supersedeSourceAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await supersedeSource(ctx, str(fd, "sourceId"), str(fd, "replacementId"), str(fd, "reason"))), "Source marked as superseded");
}

export async function refreshSourceAction(fd: FormData) {
  await handle(fd, async (ctx) => ({ ok: (await requestSourceRefresh(ctx, str(fd, "sourceId"))) ? "Check requested. The result appears here once the monitoring service has run" : "A check was already requested this hour" }), "Check requested");
}

// ── Generator ──
export async function generatePolicyAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const results = await generatePolicyDraft(ctx, {
        basis: str(fd, "basis"),
        basisPolicyId: str(fd, "basisPolicyId") || undefined,
        title: str(fd, "title") || undefined,
        ref: str(fd, "ref") || undefined,
        categoryCode: str(fd, "categoryCode") || undefined,
        mode: str(fd, "mode"),
        branchIds: all(fd, "branchIds"),
        useAi: fd.get("useAi") === "on",
      });
      const gaps = results.reduce((n, r) => n + r.criticalGaps, 0);
      const ok = `${results.length === 1 ? "Draft generated" : `${results.length} branch drafts generated`}. ${gaps ? `${gaps} critical gap(s) must be resolved before publication.` : "No critical gaps."}`;
      return results.length === 1 ? { to: `/revisions/${results[0]!.revisionId}`, ok } : { to: `/policies/generator?done=${results.map((r) => r.runId).join(",")}`, ok };
    },
    "Draft generated",
  );
}

export async function resolveGapAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await resolveGap(ctx, str(fd, "gapId"), str(fd, "resolution"))), "Gap resolved");
}

export async function recheckGapsAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const r = await recheckGaps(ctx, str(fd, "runId"));
    return { ok: `Re-checked: ${r.closed} gap(s) no longer apply${r.added ? `, ${r.added} new gap(s) found` : ""}` };
  }, "Re-checked");
}

// ── Cross-boundary safeguarding ──
export async function recordGeographyAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await recordServiceUserGeography(ctx, str(fd, "serviceUserId"), { residenceLocalAuthorityCode: str(fd, "residence"), careLocationLocalAuthorityCode: str(fd, "careLocation"), fundingAuthority: str(fd, "fundingAuthority") })), "Locations recorded");
}

export async function recordIncidentLocationAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await recordIncidentLocation(ctx, str(fd, "incidentId"), str(fd, "la") || null)), "Incident location recorded");
}

export async function recordSafeguardingDecisionAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await recordSafeguardingDecision(ctx, str(fd, "serviceUserId"), { safeguardingLocalAuthorityCode: str(fd, "la"), reasoning: str(fd, "reasoning"), incidentId: str(fd, "incidentId") || undefined })), "Decision recorded");
}
