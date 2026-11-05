import type { BranchPolicyDraftOutput, ChangeAnalysis, ImpactAssessmentOutput, RevisionDraftOutput, AssistantAnswer, CareSummaryOutput, BodyMapRecommendationOutput, SupportPlanExtraction, CareDocumentExtraction, CallNoteOrganisation } from "./schemas";
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
  /** Read-only, contextual office-assistant conversation. Never executes database writes. */
  coordinateChat?(input: CoordinatorChatInput): Promise<string>;
  /** AI CSB Coordinator with tools: the model may only call the tools it is given; every call is executed by our own
   *  server code with the employee's permissions (src/server/care/coordinator/agent-tools.ts). Optional. */
  runCoordinatorAgent?(input: CoordinatorAgentInput): Promise<CoordinatorAgentResult>;
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
  /** AI Care Coordinator: reads one care document into individual, page-referenced facts with verbatim quotes. Optional;
   *  without it (simulated, none) documents are read on our own server from their text layer only. */
  extractCareDocument?(input: CareDocumentExtractionInput): Promise<CareDocumentExtraction>;
  /** Branch-specific Policy Generator: proposes wording for the generated sections from the sources given. Optional;
   *  without it (simulated, none) the generator writes a source-guided draft with no AI. */
  draftBranchPolicy?(input: BranchPolicyDraftInput): Promise<BranchPolicyDraftOutput>;
  /** Service user Call Notes: organises a coordinator's free-text note into classified, quoted bullet points.
   *  Optional; without it (simulated, none) notes are organised on our own server by keyword rules. */
  organiseCallNote?(input: CallNoteOrganiseInput): Promise<CallNoteOrganisation>;
}

export interface CallNoteOrganiseInput {
  /** The coordinator's text, exactly as typed. The person is not named. */
  text: string;
  method: string;
  /** The relationship or role of the person spoken to ("daughter", "district nurse"), never their name. */
  contactRole: string | null;
}

export interface BranchPolicyDraftInput {
  policy: { title: string; category: string; mode: string };
  branches: { name: string; localAuthority: string | null; region: string | null; facts: string[] }[];
  sources: { ref: string; title: string; issuer: string | null; level: string; status: string; text: string | null }[];
  sections: { key: string; heading: string; body: string; editable: boolean }[];
}

export interface CareDocumentExtractionInput {
  pdfBase64: string;
  filename: string;
  /** What the office says the document is, to help the reading. */
  categoryLabel: string;
}

export interface SupportPlanExtractionInput {
  /** The PDF, base64-encoded. Only the support plan is read; medical letters are never sent. */
  pdfBase64: string;
  filename: string;
}

/** Why AI could not be used, so callers can say it plainly: not set up, model not available, rejected key, busy or
 *  rate limited, declined, or a general outage. Messages never contain the key or any care text. */
export type AiUnavailableReason = "not-configured" | "model-unavailable" | "auth" | "busy" | "refused" | "timeout" | "unavailable";

export class AiUnavailableError extends Error {
  constructor(message = "AI provider is not configured or unavailable", public readonly reason: AiUnavailableReason = "unavailable") {
    super(message);
  }
}

/** Only authenticated, redacted, approved-to-share CRM context may be passed. */
export interface CoordinatorChatInput {
  question: string;
  history: { role:"user"|"assistant"; content:string }[];
  caseContext: string;
}

/** One tool the coordinator model may call. inputSchema is a strict JSON schema; the server validates again with zod. */
export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CoordinatorAgentInput {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** The employee's message, with the page context prepended by the server. */
  message: string;
  tools: AgentToolSpec[];
  /** Runs one tool call on our server. The result is JSON text given back to the model as data. */
  execute(name: string, input: unknown): Promise<{ content: string; isError: boolean }>;
  /** Most model requests in one chat turn (each tool round trip is one). */
  maxSteps: number;
  /** Wall-clock budget for the whole turn, in milliseconds. */
  deadlineMs: number;
}

export interface CoordinatorAgentUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CoordinatorAgentResult {
  text: string;
  model: string;
  usage: CoordinatorAgentUsage;
  /** True when the step or time budget ran out before the model finished. */
  truncated: boolean;
}
