import { z } from "zod/v4";

/** All AI outputs are proposals validated against these schemas before use. */

const Urgency = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const SourceExcerpt = z.object({
  side: z.enum(["previous", "current"]).describe("Which source version the quote is taken from"),
  sectionRef: z.string().describe("The section ref exactly as given in the input"),
  quote: z.string().describe("A short verbatim quote copied exactly from that section"),
});

export const ChangeAnalysisSchema = z.object({
  whatChanged: z.string(),
  previousPosition: z.string().describe("What the previous wording or requirement said"),
  newPosition: z.string().describe("What the current source says"),
  whyItMatters: z.string(),
  classification: z.enum(["POTENTIALLY_SUBSTANTIVE", "EDITORIAL", "UNCERTAIN"]),
  urgency: Urgency,
  potentiallyAffectedPolicyRefs: z.array(z.object({ policyRef: z.string(), reason: z.string() })),
  affectedServiceTypes: z.array(z.string()),
  affectedCategories: z.array(z.string()),
  needsHumanVerification: z.array(z.string()),
  supportingExcerpts: z.array(SourceExcerpt),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string(),
});
export type ChangeAnalysis = z.infer<typeof ChangeAnalysisSchema>;

export const ImpactAssessmentSchema = z.object({
  applicability: z.enum(["APPLIES", "DOES_NOT_APPLY", "UNCERTAIN"]),
  outcome: z.enum(["REVISION_RECOMMENDED", "NO_REVISION_NEEDED", "UNCERTAIN", "CONFLICT_REQUIRES_EXPERT"]),
  urgency: Urgency,
  rationale: z.string(),
  affectedSectionKeys: z.array(z.string()).describe("Policy section keys exactly as given in the input"),
  citations: z.array(
    z.object({
      sectionRef: z.string(),
      quote: z.string().describe("Verbatim quote from the CURRENT source version"),
      supportsSectionKey: z.string().nullable(),
    }),
  ),
  needsVerification: z.array(z.string()),
});
export type ImpactAssessmentOutput = z.infer<typeof ImpactAssessmentSchema>;

export const RevisionDraftSchema = z.object({
  summary: z.string().describe("Plain-English change summary for reviewers"),
  edits: z.array(
    z.object({
      operation: z.enum(["modify", "add", "delete"]),
      sectionKey: z.string().describe("Existing key for modify/delete; a new key for add"),
      heading: z.string().nullable(),
      newBody: z.string().nullable().describe("Full replacement body for modify/add; null for delete"),
      insertAfterKey: z.string().nullable(),
      rationale: z.string(),
      citations: z.array(z.object({ sectionRef: z.string(), quote: z.string() })),
    }),
  ),
  conflicts: z.array(z.string()),
  uncertainties: z.array(z.string()),
});
export type RevisionDraftOutput = z.infer<typeof RevisionDraftSchema>;

export const AssistantAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ chunkId: z.string(), quote: z.string() })),
  evidenceGaps: z.array(z.string()),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;
