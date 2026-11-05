/**
 * How the Policy Reader arranges a version's sections into one continuous document (owner's spec of 5 Nov 2026).
 *
 * Every stored section appears exactly once, in a fixed reading order: Purpose, Scope, Objectives, Policy, Procedure,
 * Definitions, Key Facts, records and monitoring, branch appendices, Further Reading, Outstanding Practice. Sections
 * the spec did not name (responsibilities, escalation, record keeping, training, local contacts, appendices...) are
 * kept inside the nearest part rather than dropped. A part with no stored section is left out of the reader, never
 * shown as an empty heading; `missingParts` lists the ones the author still has to write.
 */

export type ReaderSection = { key: string; heading: string; body: string; isLocal?: boolean };

export type ReaderPartId =
  | "purpose"
  | "scope"
  | "objectives"
  | "policy"
  | "procedure"
  | "definitions"
  | "keyfacts-staff"
  | "keyfacts-service-users"
  | "monitoring"
  | "appendices"
  | "further-reading"
  | "outstanding-practice"
  | "about"
  | "use"
  | "content"
  | "questions"
  | "local";

export type ReaderPart = { id: ReaderPartId; label: string; sections: ReaderSection[]; derived?: boolean };

const POLICY_ORDER: [ReaderPartId, string][] = [
  ["purpose", "Purpose"],
  ["scope", "Scope"],
  ["objectives", "Objectives"],
  ["policy", "Policy"],
  ["procedure", "Procedure"],
  ["definitions", "Definitions"],
  ["keyfacts-staff", "Key Facts (Staff)"],
  ["keyfacts-service-users", "Key Facts (Service Users)"],
  ["monitoring", "Records & Monitoring"],
  ["appendices", "Branch Appendices"],
  ["further-reading", "Further Reading"],
  ["outstanding-practice", "Outstanding Practice"],
];

const RESOURCE_ORDER: [ReaderPartId, string][] = [
  ["about", "About"],
  ["use", "How to Use"],
  ["content", "Content"],
  ["questions", "Audit Questions"],
  ["local", "Local Adaptations"],
  ["further-reading", "Further Reading"],
  ["monitoring", "Review"],
];

/** The parts the spec expects in every policy, which the author is told about when they are missing. */
export const EXPECTED_POLICY_PARTS: ReaderPartId[] = ["purpose", "scope", "objectives", "policy", "procedure", "definitions", "keyfacts-staff", "keyfacts-service-users", "further-reading"];

/** Which reader part a policy, procedure or guidance section belongs to. */
export function policyPartFor(key: string): ReaderPartId {
  if (key === "purpose") return "purpose";
  if (key === "scope") return "scope";
  if (/^objectives?(\.|$)/.test(key)) return "objectives";
  if (key.startsWith("procedure.") || key === "procedure" || key === "escalation" || key === "local.contacts") return "procedure";
  if (key === "definitions") return "definitions";
  if (/^key-?facts\.(service|su)/.test(key)) return "keyfacts-service-users";
  if (/^key-?facts(\.|$)/.test(key)) return "keyfacts-staff";
  if (["records", "training", "monitoring", "review"].includes(key)) return "monitoring";
  if (key.startsWith("appendix.") || key.startsWith("branch.") || key === "generated.local-arrangements") return "appendices";
  if (["framework", "related", "references", "generated.references", "generated.legal-framework"].includes(key)) return "further-reading";
  if (/^outstanding(-practice)?(\.|$)/.test(key)) return "outstanding-practice";
  return "policy";
}

/** Which reader part a form, checklist, template, audit tool or risk assessment section belongs to. */
export function resourcePartFor(key: string): ReaderPartId {
  if (key === "purpose") return "about";
  if (key === "use") return "use";
  if (key === "questions") return "questions";
  if (key === "local.contacts") return "local";
  if (key === "framework" || key === "related") return "further-reading";
  if (key === "review") return "monitoring";
  return "content";
}

export function readerParts(sections: ReaderSection[], kind: "policy" | "resource"): ReaderPart[] {
  const order = kind === "policy" ? POLICY_ORDER : RESOURCE_ORDER;
  const partFor = kind === "policy" ? policyPartFor : resourcePartFor;
  const by = new Map<ReaderPartId, ReaderSection[]>();
  for (const s of sections) {
    const id = partFor(s.key);
    by.set(id, [...(by.get(id) ?? []), s]);
  }
  const parts: ReaderPart[] = [];
  for (const [id, label] of order) {
    const list = by.get(id);
    if (list?.length) parts.push({ id, label, sections: list });
    // With no written staff summary, the reader lists the first line of each procedure step instead, labelled as such.
    else if (id === "keyfacts-staff" && kind === "policy" && by.get("procedure")?.some((s) => s.key.startsWith("procedure."))) parts.push({ id, label, sections: [], derived: true });
  }
  return parts;
}

/** Parts the spec expects in a policy that have no written section yet (a derived summary does not count as written). */
export function missingParts(parts: ReaderPart[]): string[] {
  const written = new Set(parts.filter((p) => !p.derived).map((p) => p.id));
  return POLICY_ORDER.filter(([id]) => EXPECTED_POLICY_PARTS.includes(id) && !written.has(id)).map(([, label]) => label);
}

/** First sentence of a section, for the derived staff key facts. */
export function firstSentence(body: string) {
  const text = body.split("\n").map((l) => l.replace(/^(\d+[.)]|[•\-*])\s+/, "")).find(Boolean) ?? "";
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

/** Old `?view=` links (Policy Text, Procedure, Forms, All Policy) open the reader at the matching section. */
export function sectionForView(view: string | undefined): string | undefined {
  if (view === "text") return "policy";
  if (view === "procedure") return "procedure";
  if (view === "forms") return "forms";
  return undefined;
}
