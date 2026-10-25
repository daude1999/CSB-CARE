import type { CandidateReason } from "@prisma/client";
import { db } from "@/lib/db";
import { canonicalForMatch, truncate } from "@/lib/text";
import type { SectionChange } from "../changes/diff";
import { keywordQuery, searchChunks } from "../search/index-chunks";

interface CandidateDraft {
  policyId: string;
  organisationId: string | null;
  reason: CandidateReason;
  requirementId: string | null;
  sectionKey: string | null;
  evidence: string;
  score: number | null;
}

/**
 * Identifies policies potentially affected by a change. Deterministic links
 * (requirements register, cited sources) come first; full-text similarity is
 * recorded separately as supporting evidence, never as the sole basis of a link
 * without being labelled as such.
 */
export async function identifyCandidates(changeId: string) {
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });
  const changes = change.changedSections as unknown as SectionChange[];
  const changedRefs = new Set(changes.map((c) => c.ref));
  const changedBefore = changes.map((c) => c.before).join("\n");
  const drafts: CandidateDraft[] = [];

  const requirements = await db.regulatoryRequirement.findMany({
    where: { OR: [{ sourceDocumentId: change.documentId }, { sourceId: change.sourceId, sourceDocumentId: null }] },
    include: { policyLinks: { include: { policy: true } } },
  });
  const affectedReqIds: string[] = [];
  for (const r of requirements) {
    const sectionHit = r.sourceSectionRef ? changedRefs.has(r.sourceSectionRef) : false;
    const excerptHit = r.excerpt && canonicalForMatch(changedBefore).includes(canonicalForMatch(r.excerpt).slice(0, 120));
    if (!sectionHit && !excerptHit && r.sourceDocumentId) continue;
    if (!r.sourceDocumentId && !excerptHit) continue;
    affectedReqIds.push(r.id);
    for (const link of r.policyLinks) {
      drafts.push({
        policyId: link.policyId,
        organisationId: link.policy.organisationId,
        reason: "REQUIREMENT_LINK",
        requirementId: r.id,
        sectionKey: link.sectionKey,
        evidence: `Requirement ${r.ref} (${r.exactReference}) is drawn from ${sectionHit ? `source section "${r.sourceSectionRef}", which changed` : "text that changed in this document"}; it is mapped to section "${link.sectionKey ?? "whole policy"}". Mapping rationale: ${link.rationale}`,
        score: null,
      });
    }
  }

  const citing = await db.policy.findMany({ where: { supportingSourceDocumentIds: { has: change.documentId }, status: "ACTIVE" } });
  for (const p of citing) {
    drafts.push({ policyId: p.id, organisationId: p.organisationId, reason: "SOURCE_LINK", requirementId: null, sectionKey: null, evidence: `Policy lists "${change.title}" as a supporting source`, score: null });
  }

  // Supporting evidence only: full-text similarity against master templates (shared chunks).
  const q = keywordQuery(changes.flatMap((c) => [...c.addedSentences, ...c.removedSentences]).join(" "));
  if (q) {
    const hits = await searchChunks(q, { organisationId: null, kind: "POLICY", limit: 5 });
    for (const h of hits.filter((x) => x.policyId && x.rank > 0.05)) {
      drafts.push({
        policyId: h.policyId!,
        organisationId: null,
        reason: "TEXT_MATCH",
        requirementId: null,
        sectionKey: h.sectionRef.split("#")[0] ?? null,
        evidence: `Text similarity (supporting evidence only, rank ${h.rank.toFixed(3)}): "${truncate(h.text, 200)}"`,
        score: h.rank,
      });
    }
  }

  // Customer policies derived from a flagged master inherit the flag, with an explicit reason.
  const masterIds = [...new Set(drafts.filter((d) => d.organisationId === null && d.reason !== "TEXT_MATCH").map((d) => d.policyId))];
  if (masterIds.length) {
    const derived = await db.policy.findMany({ where: { templateId: { in: masterIds }, status: "ACTIVE" }, include: { template: true } });
    for (const p of derived) {
      const parent = drafts.find((d) => d.policyId === p.templateId);
      drafts.push({
        policyId: p.id,
        organisationId: p.organisationId,
        reason: parent!.reason,
        requirementId: parent!.requirementId,
        sectionKey: parent!.sectionKey,
        evidence: `Derived from master template ${p.template?.ref} "${p.template?.title}", which was flagged: ${parent!.evidence}`,
        score: null,
      });
    }
  }

  for (const d of drafts) {
    await db.changePolicyCandidate.upsert({
      where: { changeId_policyId_reason_requirementId: { changeId, policyId: d.policyId, reason: d.reason, requirementId: d.requirementId ?? "" } },
      create: { changeId, ...d, requirementId: d.requirementId ?? "" },
      update: {},
    });
  }
  if (affectedReqIds.length) await db.regulatoryChange.update({ where: { id: changeId }, data: { affectedRequirementIds: affectedReqIds } });
  return db.changePolicyCandidate.findMany({ where: { changeId } });
}
