import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ConflictError, ValidationError } from "@/lib/errors";
import { getAiProvider } from "../ai";
import { verifyQuote } from "../ai/citations";
import type { ChangeAnalysisInput, ImpactInput } from "../ai/provider";
import type { SectionChange } from "../changes/diff";
import type { Section } from "../sources/extract";

export async function buildChangeInput(changeId: string): Promise<{ input: ChangeAnalysisInput; newSections: Section[]; prevSections: Section[] }> {
  const change = await db.regulatoryChange.findUniqueOrThrow({
    where: { id: changeId },
    include: { source: true, newVersion: { include: { document: true } }, previousVersion: true, candidates: { include: { policy: true } } },
  });
  const policies = [...new Map(change.candidates.filter((c) => c.policy.kind === "MASTER").map((c) => [c.policyId, c.policy])).values()];
  return {
    input: {
      sourceName: change.source.name,
      documentTitle: change.title,
      legalStatus: change.newVersion.document.legalStatus,
      changes: change.changedSections as unknown as SectionChange[],
      candidatePolicies: policies.map((p) => ({ ref: p.ref, title: p.title, category: p.categoryCode })),
      serviceTypes: change.affectedServiceTypes,
    },
    newSections: change.newVersion.sections as unknown as Section[],
    prevSections: (change.previousVersion?.sections ?? []) as unknown as Section[],
  };
}

/** AI comparison of previous and current source content (proposal only). Citations are verified against stored versions. */
export async function analyseChangeWithAi(changeId: string) {
  const ai = getAiProvider();
  if (!ai) {
    await db.changeStatusEvent.create({ data: { changeId, to: (await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } })).status, reason: "AI provider unavailable; analysis must be done manually" } });
    return null;
  }
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });
  const { input, newSections, prevSections } = await buildChangeInput(changeId);
  const out = await ai.analyseChange(input);
  await db.aiCitation.deleteMany({ where: { changeId } });
  let verified = 0;
  for (const ex of out.supportingExcerpts) {
    const check = verifyQuote(ex.quote, ex.side === "previous" ? prevSections : newSections, ex.sectionRef);
    if (check.verified) verified++;
    await db.aiCitation.create({
      data: {
        changeId,
        sourceVersionId: ex.side === "previous" ? change.previousVersionId : change.newVersionId,
        sectionRef: check.sectionRef,
        quote: ex.quote,
        verified: check.verified,
        verificationNote: check.note,
      },
    });
  }
  const upgrade = out.classification === "POTENTIALLY_SUBSTANTIVE" && change.status === "AWAITING_CLASSIFICATION";
  await db.regulatoryChange.update({
    where: { id: changeId },
    data: {
      aiAnalysis: out as unknown as Prisma.InputJsonValue,
      aiProvider: ai.name,
      aiIsSimulated: ai.isSimulated,
      confidence: out.confidence,
      affectedCategories: [...new Set([...change.affectedCategories, ...out.affectedCategories])],
      affectedServiceTypes: [...new Set([...change.affectedServiceTypes, ...out.affectedServiceTypes])],
      status: upgrade ? "POTENTIALLY_SUBSTANTIVE" : undefined,
      events: {
        create: {
          from: change.status,
          to: upgrade ? "POTENTIALLY_SUBSTANTIVE" : change.status,
          reason: `AI analysis (${ai.name}) proposed ${out.classification}; ${verified}/${out.supportingExcerpts.length} excerpts verified against stored source text`,
        },
      },
    },
  });
  return out;
}

export async function buildImpactInput(changeId: string, policyId: string): Promise<{ input: ImpactInput; newSections: Section[]; policyVersionId: string } | null> {
  const policy = await db.policy.findUniqueOrThrow({
    where: { id: policyId },
    include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } }, requirementLinks: { include: { requirement: true } } },
  });
  if (!policy.currentPublishedVersion) return null;
  const { input: change, newSections } = await buildChangeInput(changeId);
  const candidates = await db.changePolicyCandidate.findMany({ where: { changeId, policyId } });
  const changeRow = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });
  const reqLinks = policy.kind === "CUSTOMER" && policy.templateId
    ? await db.requirementPolicyLink.findMany({ where: { policyId: policy.templateId }, include: { requirement: true } })
    : policy.requirementLinks;
  return {
    policyVersionId: policy.currentPublishedVersion.id,
    newSections,
    input: {
      change,
      policy: {
        ref: policy.ref,
        title: policy.title,
        serviceTypes: policy.serviceTypes,
        sections: policy.currentPublishedVersion.sections.map((s) => ({ key: s.key, heading: s.heading, body: s.body, locked: s.isLocal })),
      },
      requirements: reqLinks
        .filter((l) => changeRow.affectedRequirementIds.includes(l.requirementId))
        .map((l) => ({ ref: l.requirement.ref, title: l.requirement.title, exactReference: l.requirement.exactReference, excerpt: l.requirement.excerpt, sectionKey: l.sectionKey })),
      flagReasons: candidates.map((c) => `${c.reason}: ${c.evidence}`),
    },
  };
}

/** Creates (or refreshes, while still PROPOSED) an AI impact assessment for one policy. */
export async function assessPolicyImpact(changeId: string, policyId: string) {
  const ai = getAiProvider();
  if (!ai) return null;
  const existing = await db.impactAssessment.findUnique({ where: { changeId_policyId: { changeId, policyId } } });
  if (existing && existing.status !== "PROPOSED") return existing; // never overwrite a reviewed assessment
  const built = await buildImpactInput(changeId, policyId);
  if (!built) return null;
  const policy = await db.policy.findUniqueOrThrow({ where: { id: policyId } });
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId } });
  const out = await ai.assessImpact(built.input);

  const validKeys = new Set(built.input.policy.sections.map((s) => s.key));
  const unknownKeys = out.affectedSectionKeys.filter((k) => !validKeys.has(k));
  const affectedSectionKeys = out.affectedSectionKeys.filter((k) => validKeys.has(k));
  const checks = out.citations.map((c) => ({ c, check: verifyQuote(c.quote, built.newSections, c.sectionRef) }));
  const verifiedCount = checks.filter((x) => x.check.verified).length;
  const needsVerification = [...out.needsVerification];
  if (unknownKeys.length) needsVerification.push(`AI referenced unknown policy section(s) ${unknownKeys.join(", ")}; ignored`);

  let outcome = out.outcome;
  let applicability = out.applicability;
  if (outcome === "REVISION_RECOMMENDED" && verifiedCount === 0) {
    outcome = "UNCERTAIN";
    needsVerification.push("No citation could be verified against the stored source text, so the recommendation was downgraded to UNCERTAIN");
  }
  const svc = change.affectedServiceTypes;
  const overlaps = !svc.length || !policy.serviceTypes.length || svc.some((s) => policy.serviceTypes.includes(s));
  if (applicability === "APPLIES" && !overlaps) {
    applicability = "UNCERTAIN";
    needsVerification.push(`Policy service types (${policy.serviceTypes.join(", ")}) do not overlap the change's (${svc.join(", ")})`);
  }

  const data = {
    organisationId: policy.organisationId,
    policyVersionId: built.policyVersionId,
    applicability,
    outcome,
    urgency: out.urgency,
    rationale: out.rationale,
    needsVerification,
    affectedSectionKeys,
    aiOutput: out as unknown as Prisma.InputJsonValue,
    provider: ai.name,
    isSimulated: ai.isSimulated || change.isSimulated,
  };
  const assessment = existing
    ? await db.impactAssessment.update({ where: { id: existing.id }, data })
    : await db.impactAssessment.create({ data: { changeId, policyId, ...data } });
  await db.aiCitation.deleteMany({ where: { impactAssessmentId: assessment.id } });
  for (const { c, check } of checks) {
    await db.aiCitation.create({
      data: { impactAssessmentId: assessment.id, sourceVersionId: change.newVersionId, sectionRef: check.sectionRef, supportsSectionKey: c.supportsSectionKey, quote: c.quote, verified: check.verified, verificationNote: check.note },
    });
  }
  logger.info({ changeId, policyId, outcome }, "impact assessment proposed");
  return assessment;
}

/** Manual assessment when AI is unavailable or the reviewer prefers to write it. */
export async function createManualAssessment(args: {
  changeId: string;
  policyId: string;
  actorId: string;
  applicability: "APPLIES" | "DOES_NOT_APPLY" | "UNCERTAIN";
  outcome: "REVISION_RECOMMENDED" | "NO_REVISION_NEEDED" | "UNCERTAIN" | "CONFLICT_REQUIRES_EXPERT";
  rationale: string;
  affectedSectionKeys: string[];
}) {
  const policy = await db.policy.findUniqueOrThrow({ where: { id: args.policyId } });
  if (!policy.currentPublishedVersionId) throw new ValidationError("Policy has no published version to assess");
  const existing = await db.impactAssessment.findUnique({ where: { changeId_policyId: { changeId: args.changeId, policyId: args.policyId } } });
  if (existing && existing.status !== "PROPOSED") throw new ConflictError("This assessment has already been reviewed and cannot be replaced");
  return db.impactAssessment.upsert({
    where: { changeId_policyId: { changeId: args.changeId, policyId: args.policyId } },
    create: {
      changeId: args.changeId,
      policyId: args.policyId,
      organisationId: policy.organisationId,
      policyVersionId: policy.currentPublishedVersionId,
      applicability: args.applicability,
      outcome: args.outcome,
      urgency: "MEDIUM",
      rationale: args.rationale,
      affectedSectionKeys: args.affectedSectionKeys,
      provider: `manual:${args.actorId}`,
    },
    update: { applicability: args.applicability, outcome: args.outcome, rationale: args.rationale, affectedSectionKeys: args.affectedSectionKeys, provider: `manual:${args.actorId}` },
  });
}
