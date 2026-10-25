/**
 * Authoring format for the Evantix starter library. Each policy is written once
 * as a PolicySpec; build.ts turns the specs into templates with generated
 * framework/related sections and a demo version history.
 *
 * All wording is original to Evantix Care. It is NOT professionally reviewed,
 * legally verified or approved. Providers must adapt and approve it through
 * their own governance before use.
 */

export const ALL = ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"];
export const HOMES = ["RESIDENTIAL", "NURSING"];
export const COMMUNITY = ["DOMICILIARY", "SUPPORTED_LIVING"];

export interface SpecSection {
  key: string;
  heading: string;
  body: string;
}

/** An earlier version: section keys mapped to their previous body, or null if the section did not exist yet. */
export interface SpecHistory {
  monthsAgo: number;
  summary: string;
  reason: string;
  older: Record<string, string | null>;
}

export interface PolicySpec {
  ref: string;
  title: string;
  category: string;
  /** One sentence describing what the policy covers; used for the description. */
  summary: string;
  serviceTypes?: string[];
  reviewMonths?: number;
  purpose: string;
  scope?: string;
  definitions?: string;
  responsibilities: string;
  statement: string;
  procedures: SpecSection[];
  escalation?: string;
  /** What the local contacts section is for, e.g. "safeguarding referrals". */
  localFor: string;
  records: string;
  training: string;
  monitoring: string;
  /** Requirement register refs and the section of this policy that addresses each one. */
  links: [string, string][];
  /** CQC quality statement codes (see requirements.ts). */
  qs: string[];
  related: string[];
  history?: SpecHistory[];
}
