import type { ChangeAnalysis, ImpactAssessmentOutput, RevisionDraftOutput, AssistantAnswer, CareSummaryOutput, BodyMapRecommendationOutput, SupportPlanExtraction } from "./schemas";
import type { SectionChange } from "../changes/diff";

export interface SourceSectionInput {
  ref: string;
  heading: string;
  text: string;
}

export interface PolicySectionInput {
  key: string;
  heading: string;
  body: string;
  locked: boolean;
}

export interface ChangeAnalysisInput {
  sourceName: string;
  documentTitle: string;
  legalStatus: string;
  changes: SectionChange[];
  candidatePolicies: { ref: string; title: string; category: string }[];
  serviceTypes: string[];
}

export interface ImpactInput {
  change: ChangeAnalysisInput;
  policy: { ref: string; title: string; serviceTypes: string[]; sections: PolicySectionInput[] };
  requirements: { ref: string; title: string; exactReference: string; excerpt: string; sectionKey: string | null }[];
  flagReasons: string[];
}

export interface RevisionInput extends ImpactInput {
  assessment: { rationale: string; affectedSectionKeys: string[] };
}

export interface AssistantInput {
  question: string;
  chunks: { id: string; heading: string; text: string; legalStatus: string; kind: string }[];
  facts: string[];
}

/** One care record given to the Care Summary, identified only by a short id (N1, T2…). No names are sent. */
export interface CareRecordInput {
  sid: string;
  kind: string;
  date: string;
  text: string;
}

export interface CareSummaryInput {
  from: string;
  to: string;
  records: CareRecordInput[];
  /** Counted facts from the database (visits delivered, missed and so on), stated as plain sentences. */
  facts: string[];
}

/** One record given to body map recommendations, by short id only (O1 = this observation, H = earlier observations of
 *  the same area, N = notes and follow-ups, P = care plan sections, R = risk assessments, I = incidents, M = medicines
 *  with a documented application site, G = the organisation's own approved policies). No names, no photographs. */
export interface BodyMapRecordInput {
  sid: string;
  kind: string;
  date: string;
  text: string;
}

export interface BodyMapRecommendationInput {
  /** The observation itself, as structured facts. */
  observation: { sid: "O1"; category: string; area: string; view: string; observedOn: string; pain: string; size: string | null; appearance: string | null; description: string; followUpOn: string | null; status: string; incidentDecision: string | null; photoCount: number };
  records: BodyMapRecordInput[];
  /** Plain sentences about what could not be considered (e.g. medication records switched off). */
  limits: string[];
  today: string;
}

/**
 * Provider abstraction. Implementations must return outputs matching the zod
 * schemas; callers validate again and verify every citation against stored text.
 */
export interface LlmProvider {
  name: string;
  isSimulated: boolean;
  analyseChange(input: ChangeAnalysisInput): Promise<ChangeAnalysis>;
  assessImpact(input: ImpactInput): Promise<ImpactAssessmentOutput>;
  draftRevision(input: RevisionInput): Promise<RevisionDraftOutput>;
  answer(input: AssistantInput): Promise<AssistantAnswer>;
  /** Care Summary for a person's recorded care. Optional, so providers that do not offer it simply leave it out. */
  summariseCare?(input: CareSummaryInput): Promise<CareSummaryOutput>;
  /** Body map AI-Assisted Recommendations. Optional, like summariseCare. */
  recommendBodyMap?(input: BodyMapRecommendationInput): Promise<BodyMapRecommendationOutput>;
  /** Reads a council support plan PDF into a field-by-field proposal with page references. Optional; the simulated
   *  provider cannot read documents, so the import screen then opens with an empty form. */
  extractSupportPlan?(input: SupportPlanExtractionInput): Promise<SupportPlanExtraction>;
}

export interface SupportPlanExtractionInput {
  /** The PDF, base64-encoded. Only the support plan is read; medical letters are never sent. */
  pdfBase64: string;
  filename: string;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI provider is not configured or unavailable") {
    super(message);
  }
}
