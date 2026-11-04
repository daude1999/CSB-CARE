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

// ── Care Summary (Care Plans) ──────────────────────────────────────────────

const CarePoint = z.object({
  text: z.string().describe("One factual sentence in plain English. No diagnosis, no medical conclusion, no medication advice."),
  sources: z.array(z.string()).describe("The record ids (for example N3, T1, I2) that this sentence is based on. Every point needs at least one."),
});

export const CareSummarySchema = z.object({
  summary: z.array(CarePoint).describe("Summary of recent care: what the records say happened, in date order where it helps."),
  changes: z.array(CarePoint).describe("Possible changes to review: patterns or differences in the records that a manager may want to look at. Describe what was recorded, never what it means clinically."),
  concerns: z.array(CarePoint).describe("Outstanding concerns: documented issues that the records show as still open or unresolved."),
  nextActions: z.array(CarePoint).describe("Suggested next actions, phrased as something to check or consider (for example 'Consider reviewing the nutrition section of the care plan'). Never an instruction to change care or medication."),
  gaps: z.array(z.string()).describe("What the records do not show, or where the evidence is too thin to say anything."),
});
export type CareSummaryOutput = z.infer<typeof CareSummarySchema>;

// ── Body map AI-Assisted Recommendations ───────────────────────────────────

export const BODY_MAP_REC_CATEGORIES = ["OBSERVATION_FOLLOW_UP", "CARE_PLAN_REVIEW", "RISK_REVIEW", "INCIDENT_SAFEGUARDING", "MEDICATION_REVIEW", "HISTORICAL_COMPARISON"] as const;
export const BODY_MAP_ACTION_KINDS = ["FOLLOW_UP", "CARE_PLAN_REVIEW", "RISK_REVIEW", "INCIDENT_ASSESSMENT", "MANAGER_REVIEW"] as const;

export const BodyMapRecommendationSchema = z.object({
  recommendations: z.array(
    z.object({
      category: z.enum(BODY_MAP_REC_CATEGORIES).describe("Which kind of review the suggestion is about."),
      title: z.string().describe("Short title phrased as something to consider, e.g. 'Consider risk assessment review'. Never an instruction."),
      explanation: z.string().describe("One or two plain sentences on why, describing what the records say. No diagnosis, no conclusion about abuse, no medication advice."),
      suggestedAction: z.string().describe("The next step for a manager to consider, e.g. 'Ask the registered manager to review the skin-integrity risk assessment'."),
      actionKind: z.enum(BODY_MAP_ACTION_KINDS).nullable().describe("The follow-up task a manager could create, or null if none fits."),
      facts: z.array(z.string()).describe("The recorded facts this relies on, quoted or closely paraphrased from the records. Facts only, no interpretation."),
      sources: z.array(z.string()).describe("Ids of the records and approved policies (O1, H2, N1, P1, R1, I1, M1, G1…) this suggestion is based on. At least one."),
    }),
  ),
  gaps: z.array(z.string()).describe("Information that is missing or too thin to say anything, stated plainly."),
});
export type BodyMapRecommendationOutput = z.infer<typeof BodyMapRecommendationSchema>;
