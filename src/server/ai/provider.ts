import type { ChangeAnalysis, ImpactAssessmentOutput, RevisionDraftOutput, AssistantAnswer } from "./schemas";
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
}

export class AiUnavailableError extends Error {
  constructor(message = "AI provider is not configured or unavailable") {
    super(message);
  }
}
