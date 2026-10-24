import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canonicalForMatch, splitSentences } from "@/lib/text";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requireAi } from "../ai";
import { verifyQuote } from "../ai/citations";
import type { RevisionDraftOutput } from "../ai/schemas";
import { changeRatio } from "../changes/diff";
import { buildImpactInput } from "../impact/assess";
import { audit } from "../audit-log";
import { createDraftVersion, sectionsHash, toSectionInputs, type SectionInput } from "./versions";
import type { Section } from "../sources/extract";

type Edit = RevisionDraftOutput["edits"][number];

export interface RevisionValidation {
  provider: string;
  simulated: boolean;
  applied: { sectionKey: string; operation: string; rationale: string; changeRatio: number; citations: { quote: string; verified: boolean; note: string; sectionRef: string | null }[] }[];
  rejected: { sectionKey: string; operation: string; reason: string; proposedBody: string | null }[];
  warnings: string[];
  conflicts: string[];
  uncertainties: string[];
  unchangedSectionsVerified: boolean;
  unsupportedStatements: { sectionKey: string; sentence: string }[];
}

const LARGE_REWRITE = 0.6;

function contentWords(s: string) {
  return canonicalForMatch(s)
    .split(" ")
    .filter((w) => w.length > 3);
}

/** Flags sentences added by an edit that share little vocabulary with any verified citation. */
function unsupportedSentences(before: string, after: string, quotes: string[]): string[] {
  const old = new Set(splitSentences(before).map(canonicalForMatch));
  const quoteWords = new Set(quotes.flatMap(contentWords));
  return splitSentences(after)
    .filter((s) => !old.has(canonicalForMatch(s)))
    .filter((s) => {
      const w = contentWords(s);
      if (w.length < 4) return false;
      const supported = w.filter((x) => quoteWords.has(x)).length / w.length;
      return supported < 0.3;
    });
}

/**
 * Applies AI-proposed edits to a copy of the approved version, keeping only
 * edits that are structurally valid, touch editable sections and are backed by
 * at least one citation verified against the stored source text.
 */
export function applyEdits(base: SectionInput[], out: RevisionDraftOutput, sourceSections: Section[], meta: { provider: string; simulated: boolean }) {
  const sections = base.map((s) => ({ ...s }));
  const v: RevisionValidation = { provider: meta.provider, simulated: meta.simulated, applied: [], rejected: [], warnings: [], conflicts: out.conflicts, uncertainties: out.uncertainties, unchangedSectionsVerified: false, unsupportedStatements: [] };
  const touched = new Set<string>();

  for (const e of out.edits as Edit[]) {
    const idx = sections.findIndex((s) => s.key === e.sectionKey);
    const target = idx >= 0 ? sections[idx] : undefined;
    const reject = (reason: string) => v.rejected.push({ sectionKey: e.sectionKey, operation: e.operation, reason, proposedBody: e.newBody });
    if (touched.has(e.sectionKey)) {
      reject("Multiple edits to the same section in one draft");
      continue;
    }
    if (e.operation !== "add" && !target) {
      reject("Section does not exist in the approved version");
      continue;
    }
    if (e.operation === "add" && target) {
      reject("A section with this key already exists");
      continue;
    }
    if (target?.isLocal) {
      reject("Customer-specific section (contacts, routes or responsibilities) cannot be changed automatically");
      continue;
    }
    if (e.operation !== "delete" && !e.newBody?.trim()) {
      reject("Edit has no replacement text");
      continue;
    }
    const checks = e.citations.map((c) => ({ ...verifyQuote(c.quote, sourceSections, c.sectionRef), quote: c.quote }));
    if (!checks.some((c) => c.verified)) {
      reject(checks.length ? "No citation could be verified against the stored source text" : "Edit has no supporting citation");
      continue;
    }
    if (e.operation === "modify" && target && target.body === e.newBody) {
      reject("Proposed text is identical to the approved text");
      continue;
    }
    const ratio = e.operation === "modify" && target ? changeRatio(target.body, e.newBody ?? "") : 1;
    if (e.operation === "modify" && ratio > LARGE_REWRITE) v.warnings.push(`Section "${e.sectionKey}" is ${Math.round(ratio * 100)}% rewritten; check that the amendment is the smallest justified change`);
    if (e.operation === "delete") v.warnings.push(`Section "${e.sectionKey}" would be deleted; deletions need particular care`);
    const verifiedQuotes = checks.filter((c) => c.verified).map((c) => c.quote);
    for (const s of unsupportedSentences(target?.body ?? "", e.newBody ?? "", verifiedQuotes)) v.unsupportedStatements.push({ sectionKey: e.sectionKey, sentence: s });

    if (e.operation === "modify" && target) sections[idx] = { ...target, body: e.newBody!, heading: e.heading ?? target.heading };
    else if (e.operation === "delete") sections.splice(idx, 1);
    else {
      const after = e.insertAfterKey ? sections.findIndex((s) => s.key === e.insertAfterKey) : sections.length - 1;
      sections.splice((after < 0 ? sections.length - 1 : after) + 1, 0, { key: e.sectionKey, heading: e.heading ?? e.sectionKey, body: e.newBody!, isLocal: false, masterKey: null });
    }
    touched.add(e.sectionKey);
    v.applied.push({ sectionKey: e.sectionKey, operation: e.operation, rationale: e.rationale, changeRatio: ratio, citations: checks.map((c) => ({ quote: c.quote, verified: c.verified, note: c.note, sectionRef: c.sectionRef })) });
  }
  if (v.unsupportedStatements.length) v.warnings.push(`${v.unsupportedStatements.length} added sentence(s) are not clearly supported by the cited source text`);

  // Unaffected content must be byte-identical to the approved version.
  const baseMap = new Map(base.map((s) => [s.key, s]));
  v.unchangedSectionsVerified = sections.filter((s) => !touched.has(s.key)).every((s) => {
    const b = baseMap.get(s.key);
    return b && b.body === s.body && b.heading === s.heading && Boolean(b.isLocal) === Boolean(s.isLocal);
  });
  if (!v.unchangedSectionsVerified) throw new Error("Internal check failed: unaffected sections changed");
  return { sections, validation: v };
}

/** Generates a draft revision for a policy whose assessment a human confirmed as requiring revision. */
export async function draftRevisionFromAssessment(assessmentId: string, actorId: string | null) {
  const a = await db.impactAssessment.findUnique({ where: { id: assessmentId }, include: { policy: true, change: true, revisions: true } });
  if (!a) throw new NotFoundError("Impact assessment");
  if (a.status !== "CONFIRMED_REVISION_REQUIRED") throw new ConflictError("A reviewer must confirm that a revision is required before a draft is generated");
  const open = a.revisions.find((r) => !r.closedAt);
  if (open) return { revision: open, created: false, reason: "An open revision already exists for this assessment" };
  if (a.policy.currentPublishedVersionId !== a.policyVersionId) {
    throw new ConflictError("The policy has been republished since this assessment was made; re-assess before drafting");
  }
  const built = await buildImpactInput(a.changeId, a.policyId);
  if (!built) throw new ConflictError("Policy has no published version");
  const ai = requireAi();
  const out = await ai.draftRevision({ ...built.input, assessment: { rationale: a.rationale + (a.reviewerReason ? `\nReviewer: ${a.reviewerReason}` : ""), affectedSectionKeys: a.affectedSectionKeys } });
  const baseVersion = await db.policyVersion.findUniqueOrThrow({ where: { id: a.policyVersionId }, include: { sections: true } });
  const base = toSectionInputs(baseVersion.sections);
  const { sections, validation } = applyEdits(base, out, built.newSections, { provider: ai.name, simulated: ai.isSimulated });

  if (validation.applied.length === 0) {
    await db.impactAssessment.update({
      where: { id: a.id },
      data: { needsVerification: { push: `Automatic drafting produced no supported edit (${validation.rejected.map((r) => r.reason).join("; ") || "no edits proposed"}). Draft manually.` } },
    });
    return { revision: null, created: false, reason: "No supported edit could be generated; a manual revision is needed", validation };
  }
  if (sectionsHash(sections) === sectionsHash(base)) return { revision: null, created: false, reason: "Draft identical to approved version", validation };

  const simulated = ai.isSimulated || a.isSimulated;
  const revision = await db.$transaction(async (tx) => {
    const draft = await createDraftVersion(tx, {
      policyId: a.policyId,
      organisationId: a.policy.organisationId,
      sections,
      origin: "AI_REGULATORY_REVISION",
      createdById: actorId,
      previousVersionId: baseVersion.id,
      basedOnMasterVersionId: baseVersion.basedOnMasterVersionId,
      changeSummary: out.summary,
      reasonForChange: `Regulatory change: ${a.change.title} (${a.change.canonicalUrl})`,
      isSimulated: simulated,
    });
    const rev = await tx.policyRevision.create({
      data: {
        policyId: a.policyId,
        organisationId: a.policy.organisationId,
        kind: "REGULATORY",
        impactAssessmentId: a.id,
        baseVersionId: baseVersion.id,
        draftVersionId: draft.id,
        urgency: a.urgency,
        substantive: true,
        title: `${simulated ? "[SIMULATED] " : ""}Update ${a.policy.ref} for: ${a.change.title}`,
        explanation: out.summary,
        validation: validation as unknown as Prisma.InputJsonValue,
        edits: out.edits as unknown as Prisma.InputJsonValue,
        provider: ai.name,
        isSimulated: simulated,
        createdById: actorId,
        dueAt: new Date(Date.now() + (a.urgency === "URGENT" ? 2 : a.urgency === "HIGH" ? 7 : 21) * 86400_000),
      },
    });
    for (const ap of validation.applied) {
      for (const c of ap.citations) {
        await tx.aiCitation.create({ data: { revisionId: rev.id, sourceVersionId: a.change.newVersionId, sectionRef: c.sectionRef, supportsSectionKey: ap.sectionKey, quote: c.quote, verified: c.verified, verificationNote: c.note } });
      }
    }
    await audit({ organisationId: a.policy.organisationId, actorId, action: "revision.ai_draft_created", entityType: "PolicyRevision", entityId: rev.id, data: { assessmentId: a.id, applied: validation.applied.length, rejected: validation.rejected.length, provider: ai.name } }, tx);
    return rev;
  });
  return { revision, created: true, reason: null, validation };
}
