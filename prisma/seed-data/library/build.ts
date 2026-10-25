import { ALL, DOC_TYPES, type DocType, type PolicySpec, type ResourceSpec, type SpecSection } from "./types";
import { QUALITY_STATEMENTS, REQUIREMENT_BY_REF } from "./requirements";

export interface TemplateSection {
  key: string;
  heading: string;
  body: string;
  isLocal?: boolean;
}

export interface TemplateVersion {
  sections: TemplateSection[];
  changeSummary: string;
  reasonForChange: string;
  publishedMonthsAgo: number;
}

export interface TemplateDef {
  ref: string;
  title: string;
  category: string;
  docType: DocType;
  description: string;
  serviceTypes: string[];
  reviewIntervalMonths: number;
  /** Current published content. */
  sections: TemplateSection[];
  /** Full demo version history, oldest first; the last entry equals `sections`. */
  versions: TemplateVersion[];
  links: { requirement: string; section: string }[];
  /** Audit tools only: questions seeded as an Evantix audit template. */
  auditQuestions?: string[];
}

const DEFAULT_SCOPE =
  "This policy applies to everyone who works for or on behalf of the organisation, including employees, bank and agency workers, volunteers and students, in every service the organisation registers or operates. Where a procedure applies only to some services, this is stated in the procedure.";

const SERVICE_NAMES: Record<string, string> = {
  RESIDENTIAL: "residential care homes",
  NURSING: "care homes with nursing",
  DOMICILIARY: "domiciliary (home) care",
  SUPPORTED_LIVING: "supported living",
};

const TYPE_NAME = Object.fromEntries(DOC_TYPES) as Record<DocType, string>;

function frameworkSection(ref: string, links: [string, string][], guidance: string[], qs: string[], what: string): SpecSection {
  const seen = new Set<string>();
  const reqs = links
    .map(([r]) => REQUIREMENT_BY_REF[r])
    .filter((r) => r && !r.ref.startsWith("CQC-QS-") && !seen.has(r.ref) && seen.add(r.ref));
  const legal = reqs.filter((r) => r!.legalStatus === "LEGISLATION").map((r) => `• ${r!.exactReference}: ${r!.title}`);
  const guide = [...reqs.filter((r) => r!.legalStatus !== "LEGISLATION").map((r) => r!.ref), ...guidance.filter((g) => !seen.has(g))].map((g) => {
    const r = REQUIREMENT_BY_REF[g];
    if (!r) throw new Error(`${ref}: unknown guidance ${g}`);
    return `• ${r.exactReference}`;
  });
  const qsLines = qs.map((code) => {
    const q = QUALITY_STATEMENTS[code];
    if (!q) throw new Error(`${ref}: unknown quality statement ${code}`);
    return `• ${q.keyQuestion}: ${q.title}`;
  });
  const body: string[] = [];
  if (legal.length) body.push(`This ${what} helps the organisation meet the following legal and regulatory requirements:`, ...legal, "");
  if (guide.length) body.push("It reflects the following statutory, regulator and national guidance:", ...guide, "");
  if (qsLines.length) body.push("It supports these CQC quality statements:", ...qsLines, "");
  body.push("These references are Evantix summaries for orientation. They are not quotations and must be checked against the current official text before approval.");
  return { key: "framework", heading: "Legislation, guidance and CQC quality statements", body: body.join("\n") };
}

function relatedSection(ref: string, refs: string[], titles: Map<string, string>, heading = "Related policies"): SpecSection {
  return {
    key: "related",
    heading,
    body: refs
      .map((r) => {
        const t = titles.get(r);
        if (!t) throw new Error(`${ref}: unknown related document ${r}`);
        return `• ${r} ${t}`;
      })
      .join("\n"),
  };
}

function reviewBody(months: number) {
  return `This policy is reviewed at least every ${months} months, and sooner if legislation, regulator guidance or our own learning from incidents, complaints, audits or feedback shows a change is needed. The policy owner records each review, including when no change was required, and staff are told about any change that affects their practice.`;
}

function policySections(spec: PolicySpec, titles: Map<string, string>): TemplateSection[] {
  const months = spec.reviewMonths ?? 12;
  const lower = spec.title.toLowerCase();
  const out: TemplateSection[] = [
    { key: "purpose", heading: "Purpose", body: spec.purpose },
    { key: "scope", heading: "Scope", body: spec.scope ?? DEFAULT_SCOPE },
  ];
  if (spec.definitions) out.push({ key: "definitions", heading: "Definitions", body: spec.definitions });
  out.push({
    key: "responsibilities",
    heading: "Responsibilities",
    body: spec.responsibilities ?? "The registered manager is accountable for putting this policy into practice in their service and for making sure staff have the training, time and equipment they need. Senior staff support colleagues to follow it day to day. Every worker is responsible for reading the policy, following it and raising concerns when practice falls short.",
  });
  out.push({ key: "statement", heading: "Policy statement", body: spec.statement });
  out.push(...spec.procedures);
  if (spec.escalation) out.push({ key: "escalation", heading: "Escalation and reporting", body: spec.escalation });
  out.push({
    key: "local.contacts",
    heading: "Local contacts and reporting routes",
    isLocal: true,
    body: `[Complete locally] List the names, roles and telephone numbers your staff should use for ${spec.localFor ?? lower}, including out-of-hours arrangements. Evantix never changes this section automatically.`,
  });
  out.push({ key: "records", heading: "Record keeping", body: spec.records ?? "Records made under this policy are factual, dated, attributed to the person who made them and stored securely in line with the Data Protection and Confidentiality and Record Keeping policies." });
  out.push({ key: "training", heading: "Training requirements", body: spec.training ?? `Staff are introduced to this policy at induction and receive training appropriate to their role, recorded on the training matrix. Managers check understanding of ${lower} through supervision and observation of practice.` });
  out.push({ key: "monitoring", heading: "Monitoring and audit", body: spec.monitoring ?? "Compliance is checked through the audit programme, supervision, and review of incidents, complaints and feedback. Findings lead to recorded actions with named owners and due dates, reviewed at governance meetings." });
  out.push(frameworkSection(spec.ref, spec.links, spec.guidance ?? [], spec.qs, (spec.docType ?? "POLICY") === "PROCEDURE" ? "procedure" : "policy"));
  if (spec.related.length) out.push(relatedSection(spec.ref, spec.related, titles));
  out.push({ key: "review", heading: "Review arrangements", body: reviewBody(months) });
  return out;
}

function resourceSections(spec: ResourceSpec, titles: Map<string, string>): TemplateSection[] {
  const type = TYPE_NAME[spec.docType].toLowerCase();
  const out: TemplateSection[] = [
    { key: "purpose", heading: `About this ${type}`, body: `${spec.summary.charAt(0).toUpperCase()}${spec.summary.slice(1)}` },
    { key: "use", heading: "How to use it", body: spec.use },
    ...spec.parts,
  ];
  if (spec.questions?.length) out.push({ key: "questions", heading: "Audit questions", body: spec.questions.map((q, i) => `${i + 1}. ${q}`).join("\n") + "\n\nRecord each answer as met, partially met, not met or not applicable, with evidence. Results are an internal quality indicator, not proof of regulatory compliance." });
  out.push({ key: "local.contacts", heading: "Local adaptations", isLocal: true, body: `[Complete locally] Note any local changes to this ${type}, such as your logo, extra fields or who it is returned to. Evantix never changes this section automatically.` });
  if (spec.links?.length || spec.guidance?.length || spec.qs?.length) out.push(frameworkSection(spec.ref, spec.links ?? [], spec.guidance ?? [], spec.qs ?? [], type));
  out.push(relatedSection(spec.ref, spec.policies, titles, "Related policies"));
  out.push({ key: "review", heading: "Review arrangements", body: `This ${type} is reviewed with its parent policy, and sooner if staff find it does not capture what they need.` });
  return out;
}

/** Applies an `older` map to get the previous version's sections. */
function rollBack(sections: TemplateSection[], older: Record<string, string | null>): TemplateSection[] {
  for (const k of Object.keys(older)) if (!sections.some((s) => s.key === k)) throw new Error(`history references unknown section ${k}`);
  return sections.filter((s) => older[s.key] !== null).map((s) => (s.key in older ? { ...s, body: older[s.key]! } : s));
}

function describe(summary: string, serviceTypes: string[]) {
  const scopeNote = serviceTypes.length === ALL.length ? "" : ` For ${serviceTypes.map((t) => SERVICE_NAMES[t]).join(" and ")}.`;
  return `Starter template: ${summary}${scopeNote} Not professionally reviewed; adapt before approval.`;
}

function checkLinks(ref: string, links: [string, string][], sections: TemplateSection[]) {
  for (const [req, key] of links) {
    if (!REQUIREMENT_BY_REF[req]) throw new Error(`${ref}: unknown requirement ${req}`);
    if (!sections.some((x) => x.key === key)) throw new Error(`${ref}: link to unknown section ${key}`);
  }
}

function buildPolicy(spec: PolicySpec, i: number, titles: Map<string, string>): TemplateDef {
  const sections = policySections(spec, titles);
  const months = spec.reviewMonths ?? 12;
  const history = spec.history ?? [];
  // Demo history: initial issue, a scheduled review that added the regulatory
  // mapping, then any policy-specific revisions (oldest first).
  const currentAge = history.length ? history[history.length - 1]!.monthsAgo : 2 + (i % 8);
  const versions: TemplateVersion[] = [];
  let s = sections;
  for (let h = history.length - 1; h >= 0; h--) {
    const entry = history[h]!;
    versions.unshift({ sections: s, changeSummary: `Demo history: ${entry.summary}`, reasonForChange: entry.reason, publishedMonthsAgo: entry.monthsAgo });
    s = rollBack(s, entry.older);
  }
  const reviewedAge = history.length ? history[0]!.monthsAgo + months : currentAge;
  versions.unshift({
    sections: s,
    changeSummary: "Demo history: scheduled review. Added the legislation, guidance and CQC quality statements this policy supports, and links to related policies.",
    reasonForChange: "Scheduled review",
    publishedMonthsAgo: reviewedAge,
  });
  const initial = rollBack(s, { framework: null, ...(spec.related.length ? { related: null } : {}), review: `This policy is reviewed at least every ${months} months, or sooner if legislation or guidance changes.` });
  versions.unshift({ sections: initial, changeSummary: "Demo history: initial issue.", reasonForChange: "New policy", publishedMonthsAgo: reviewedAge + months + 1 });
  checkLinks(spec.ref, spec.links, sections);
  const serviceTypes = spec.serviceTypes ?? ALL;
  return {
    ref: spec.ref,
    title: spec.title,
    category: spec.category,
    docType: spec.docType ?? "POLICY",
    description: describe(spec.summary, serviceTypes),
    serviceTypes,
    reviewIntervalMonths: months,
    sections,
    versions,
    links: [
      ...spec.links.map(([requirement, section]) => ({ requirement, section })),
      ...(spec.guidance ?? []).map((requirement) => ({ requirement, section: "framework" })),
      ...spec.qs.map((code) => ({ requirement: `CQC-QS-${code}`, section: "framework" })),
    ],
  };
}

function buildResource(spec: ResourceSpec, i: number, titles: Map<string, string>): TemplateDef {
  const sections = resourceSections(spec, titles);
  const links = spec.links ?? [];
  checkLinks(spec.ref, links, sections);
  const serviceTypes = spec.serviceTypes ?? ALL;
  return {
    ref: spec.ref,
    title: spec.title,
    category: spec.category,
    docType: spec.docType,
    description: describe(spec.summary, serviceTypes),
    serviceTypes,
    reviewIntervalMonths: 12,
    sections,
    versions: [{ sections, changeSummary: "Demo history: initial issue.", reasonForChange: "New resource", publishedMonthsAgo: 3 + (i % 7) }],
    links: [
      ...links.map(([requirement, section]) => ({ requirement, section })),
      ...(spec.guidance ?? []).map((requirement) => ({ requirement, section: "framework" })),
      ...(spec.qs ?? []).map((code) => ({ requirement: `CQC-QS-${code}`, section: "framework" })),
    ],
    auditQuestions: spec.questions,
  };
}

export function buildTemplates(policies: PolicySpec[], resources: ResourceSpec[] = []): TemplateDef[] {
  const titles = new Map([...policies, ...resources].map((s) => [s.ref, s.title]));
  if (titles.size !== policies.length + resources.length) throw new Error("Duplicate reference in the starter library");
  return [...policies.map((p, i) => buildPolicy(p, i, titles)), ...resources.map((r, i) => buildResource(r, i, titles))];
}
