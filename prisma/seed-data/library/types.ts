/**
 * Authoring format for the Evantix starter library. Each document is written
 * once as a PolicySpec or ResourceSpec; build.ts turns them into templates with
 * generated framework/related sections and a demo version history.
 *
 * All wording is original to Evantix Care. It draws on the same public
 * legislation, regulator guidance and national guidance that any provider
 * relies on (cited per document), but no third-party policy text is copied.
 * It is NOT professionally reviewed, legally verified or approved. Providers
 * must adapt and approve it through their own governance before use.
 */

export const ALL = ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"];
export const HOMES = ["RESIDENTIAL", "NURSING"];
export const COMMUNITY = ["DOMICILIARY", "SUPPORTED_LIVING"];

export type DocType = "POLICY" | "PROCEDURE" | "FORM" | "CHECKLIST" | "RISK_ASSESSMENT" | "AUDIT_TOOL" | "TEMPLATE" | "GUIDANCE";

export const DOC_TYPES: [DocType, string][] = [
  ["POLICY", "Policy"],
  ["PROCEDURE", "Procedure"],
  ["GUIDANCE", "Guidance"],
  ["FORM", "Form"],
  ["TEMPLATE", "Template"],
  ["CHECKLIST", "Checklist"],
  ["RISK_ASSESSMENT", "Risk assessment"],
  ["AUDIT_TOOL", "Audit tool"],
];

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
  /** POLICY (default), PROCEDURE or GUIDANCE. */
  docType?: DocType;
  /** One sentence describing what the policy covers; used for the description. */
  summary: string;
  serviceTypes?: string[];
  reviewMonths?: number;
  purpose: string;
  scope?: string;
  definitions?: string;
  responsibilities?: string;
  statement: string;
  procedures: SpecSection[];
  escalation?: string;
  /** What the local contacts section is for, e.g. "safeguarding referrals". Defaults to the title. */
  localFor?: string;
  records?: string;
  training?: string;
  monitoring?: string;
  /** Requirement register refs and the section of this policy that addresses each one. */
  links: [string, string][];
  /** Statutory, regulator and national guidance refs (see requirements.ts) cited in the framework section. */
  guidance?: string[];
  /** CQC quality statement codes (see requirements.ts). */
  qs: string[];
  related: string[];
  history?: SpecHistory[];
}

/** Forms, templates, checklists, risk assessments and audit tools. */
export interface ResourceSpec {
  ref: string;
  title: string;
  category: string;
  docType: Exclude<DocType, "POLICY" | "PROCEDURE" | "GUIDANCE">;
  summary: string;
  serviceTypes?: string[];
  /** How and when to use it. */
  use: string;
  parts: SpecSection[];
  /** Audit tools: the questions, also seeded as an audit template. */
  questions?: string[];
  /** Parent policy or policies. */
  policies: string[];
  links?: [string, string][];
  guidance?: string[];
  qs?: string[];
}
