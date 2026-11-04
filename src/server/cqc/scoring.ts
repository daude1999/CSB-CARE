/**
 * Internal CQC readiness scoring, method version "CSB-READINESS-1". Pure and deterministic: the same records always
 * give the same figures, so it can be tested and explained. It is a management aid that shows where work is needed. It
 * is not, and does not try to reproduce, a CQC rating.
 *
 * For each assessment area (criterion) in an assessment:
 *   1. Not Applicable (with its recorded reason) is left out of every figure.
 *   2. No result yet: "Not assessed". It is counted as applicable but gets no score, and lowers coverage.
 *   3. Result points: Met 100, Partially met 50, Not met 0.
 *   4. Evidence factor: 1 when the area has at least one verified, in-date piece of evidence; otherwise 0.5. Missing,
 *      suggested, awaiting-review, rejected, outdated and superseded evidence never count as verified.
 *   5. Deduction: 10 points for each overdue improvement action raised against the area, at most 30.
 *   Area score = max(0, round(points x factor) - deduction).
 *
 * Key question score = the average of its scored areas. It is shown only when at least 75% of its applicable areas have
 * been assessed ("High confidence"); below that the figure is held back and the key question shows "Low confidence"
 * with how many areas are assessed. With nothing assessed it shows "Not assessed".
 * Overall score = the average of every scored area, shown only when every key question has a high-confidence score.
 *
 * Evidence coverage (areas with verified, in-date evidence / applicable areas) is reported beside the score and never
 * mixed into it beyond step 4, so having evidence is never confused with being compliant. Critical concerns (open
 * safeguarding, serious incidents, high risks, overdue investigations) are reported separately and never raise or hide
 * behind the score. Closing an RCA or an action does not change any figure by itself.
 */
export const SCORING_METHOD = "CSB-READINESS-1";
export const MIN_CONFIDENT_COVERAGE = 0.75;
export const RESULT_POINTS = { MET: 100, PARTIALLY_MET: 50, NOT_MET: 0 } as const;
export const NO_EVIDENCE_FACTOR = 0.5;
export const OVERDUE_ACTION_DEDUCTION = 10;
export const MAX_DEDUCTION = 30;

export const KEY_QUESTIONS = ["SAFE", "EFFECTIVE", "CARING", "RESPONSIVE", "WELL_LED"] as const;
export type KeyQuestion = (typeof KEY_QUESTIONS)[number];
export const KQ_LABEL: Record<KeyQuestion, string> = { SAFE: "Safe", EFFECTIVE: "Effective", CARING: "Caring", RESPONSIVE: "Responsive", WELL_LED: "Well-led" };
export const RESULT_LABEL: Record<string, string> = { MET: "Met", PARTIALLY_MET: "Partially met", NOT_MET: "Not met", NOT_APPLICABLE: "Not applicable" };

export type Confidence = "HIGH" | "LOW" | "NOT_ASSESSED";

export interface CriterionInput {
  id: string;
  keyQuestion: KeyQuestion;
  essential: boolean;
  result: "MET" | "PARTIALLY_MET" | "NOT_MET" | "NOT_APPLICABLE" | null;
  verifiedEvidence: number;
  overdueActions: number;
}

export interface CriterionScore {
  id: string;
  state: "SCORED" | "NOT_ASSESSED" | "NOT_APPLICABLE";
  points: number | null;
  evidenceFactor: number | null;
  deduction: number;
  score: number | null;
  hasVerifiedEvidence: boolean;
  essentialGap: boolean;
}

export interface GroupScore {
  applicable: number;
  assessed: number;
  notAssessed: number;
  notApplicable: number;
  withVerifiedEvidence: number;
  coverage: number;
  evidenceCoverage: number;
  /** The average, even when held back (shown only in the method breakdown). */
  provisional: number | null;
  /** The figure to show: null when confidence is not HIGH. */
  score: number | null;
  confidence: Confidence;
}

export interface Readiness {
  method: string;
  criteria: CriterionScore[];
  byQuestion: Record<KeyQuestion, GroupScore>;
  overall: GroupScore;
}

export function scoreCriterion(c: CriterionInput): CriterionScore {
  const hasVerifiedEvidence = c.verifiedEvidence > 0;
  if (c.result === "NOT_APPLICABLE") return { id: c.id, state: "NOT_APPLICABLE", points: null, evidenceFactor: null, deduction: 0, score: null, hasVerifiedEvidence, essentialGap: false };
  const essentialGap = c.essential && !hasVerifiedEvidence;
  if (!c.result) return { id: c.id, state: "NOT_ASSESSED", points: null, evidenceFactor: null, deduction: 0, score: null, hasVerifiedEvidence, essentialGap };
  const points = RESULT_POINTS[c.result];
  const evidenceFactor = hasVerifiedEvidence ? 1 : NO_EVIDENCE_FACTOR;
  const deduction = Math.min(MAX_DEDUCTION, Math.max(0, c.overdueActions) * OVERDUE_ACTION_DEDUCTION);
  return { id: c.id, state: "SCORED", points, evidenceFactor, deduction, score: Math.max(0, Math.round(points * evidenceFactor) - deduction), hasVerifiedEvidence, essentialGap };
}

function group(rows: CriterionScore[]): GroupScore {
  const applicable = rows.filter((r) => r.state !== "NOT_APPLICABLE");
  const scored = applicable.filter((r) => r.state === "SCORED");
  const coverage = applicable.length ? scored.length / applicable.length : 0;
  const provisional = scored.length ? Math.round(scored.reduce((n, r) => n + (r.score ?? 0), 0) / scored.length) : null;
  const confidence: Confidence = scored.length === 0 ? "NOT_ASSESSED" : coverage >= MIN_CONFIDENT_COVERAGE ? "HIGH" : "LOW";
  const withVerifiedEvidence = applicable.filter((r) => r.hasVerifiedEvidence).length;
  return {
    applicable: applicable.length,
    assessed: scored.length,
    notAssessed: applicable.length - scored.length,
    notApplicable: rows.length - applicable.length,
    withVerifiedEvidence,
    coverage,
    evidenceCoverage: applicable.length ? withVerifiedEvidence / applicable.length : 0,
    provisional,
    score: confidence === "HIGH" ? provisional : null,
    confidence,
  };
}

export function scoreReadiness(criteria: CriterionInput[]): Readiness {
  const scores = criteria.map(scoreCriterion);
  const byId = new Map(criteria.map((c) => [c.id, c.keyQuestion]));
  const byQuestion = Object.fromEntries(KEY_QUESTIONS.map((kq) => [kq, group(scores.filter((s) => byId.get(s.id) === kq))])) as Record<KeyQuestion, GroupScore>;
  const overall = group(scores);
  // The overall figure is held back unless every key question that has applicable areas has a confident score.
  const allConfident = KEY_QUESTIONS.every((kq) => byQuestion[kq].applicable === 0 || byQuestion[kq].confidence === "HIGH");
  if (overall.confidence === "HIGH" && !allConfident) {
    overall.confidence = "LOW";
    overall.score = null;
  }
  return { method: SCORING_METHOD, criteria: scores, byQuestion, overall };
}

/** A score's colour band for display only: 80+ green, 60-79 amber, under 60 red. */
export function scoreTone(score: number | null): "green" | "amber" | "red" | "grey" {
  if (score === null) return "grey";
  return score >= 80 ? "green" : score >= 60 ? "amber" : "red";
}
