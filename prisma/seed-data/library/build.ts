import { ALL, type PolicySpec, type SpecSection } from "./types";
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
  description: string;
  serviceTypes: string[];
  reviewIntervalMonths: number;
  /** Current published content. */
  sections: TemplateSection[];
  /** Full demo version history, oldest first; the last entry equals `sections`. */
  versions: TemplateVersion[];
  links: { requirement: string; section: string }[];
}

const DEFAULT_SCOPE =
  "This policy applies to everyone who works for or on behalf of the organisation, including employees, bank and agency workers, volunteers and students, in every service the organisation registers or operates. Where a procedure applies only to some services, this is stated in the procedure.";

const SERVICE_NAMES: Record<string, string> = {
  RESIDENTIAL: "residential care homes",
  NURSING: "care homes with nursing",
  DOMICILIARY: "domiciliary (home) care",
  SUPPORTED_LIVING: "supported living",
};

function frameworkSection(spec: PolicySpec): SpecSection {
  const seen = new Set<string>();
  const legal = spec.links
    .map(([ref]) => REQUIREMENT_BY_REF[ref])
    .filter((r) => r && !r.ref.startsWith("CQC-QS-") && !seen.has(r.ref) && seen.add(r.ref))
    .map((r) => `• ${r!.exactReference}: ${r!.title}`);
  const qs = spec.qs.map((code) => {
    const q = QUALITY_STATEMENTS[code];
    if (!q) throw new Error(`${spec.ref}: unknown quality statement ${code}`);
    return `• ${q.keyQuestion}: ${q.title}`;
  });
  return {
    key: "framework",
    heading: "Legislation, regulations and CQC quality statements",
    body: [
      "This policy helps the organisation meet the following legal and regulatory requirements:",
      ...legal,
      "",
      "It supports these CQC quality statements:",
      ...qs,
      "",
      "These references are Evantix summaries for orientation. They are not quotations and must be checked against the current official text before the policy is approved.",
    ].join("\n"),
  };
}

function relatedSection(spec: PolicySpec, titles: Map<string, string>): SpecSection {
  return {
    key: "related",
    heading: "Related policies",
    body: spec.related
      .map((ref) => {
        const t = titles.get(ref);
        if (!t) throw new Error(`${spec.ref}: unknown related policy ${ref}`);
        return `• ${ref} ${t}`;
      })
      .join("\n"),
  };
}

function reviewBody(months: number) {
  return `This policy is reviewed at least every ${months} months, and sooner if legislation, regulator guidance or our own learning from incidents, complaints, audits or feedback shows a change is needed. The policy owner records each review, including when no change was required, and staff are told about any change that affects their practice.`;
}

function currentSections(spec: PolicySpec, titles: Map<string, string>): TemplateSection[] {
  const months = spec.reviewMonths ?? 12;
  const out: TemplateSection[] = [
    { key: "purpose", heading: "Purpose", body: spec.purpose },
    { key: "scope", heading: "Scope", body: spec.scope ?? DEFAULT_SCOPE },
  ];
  if (spec.definitions) out.push({ key: "definitions", heading: "Definitions", body: spec.definitions });
  out.push({ key: "responsibilities", heading: "Responsibilities", body: spec.responsibilities });
  out.push({ key: "statement", heading: "Policy statement", body: spec.statement });
  out.push(...spec.procedures);
  if (spec.escalation) out.push({ key: "escalation", heading: "Escalation and reporting", body: spec.escalation });
  out.push({
    key: "local.contacts",
    heading: "Local contacts and reporting routes",
    isLocal: true,
    body: `[Complete locally] List the names, roles and telephone numbers your staff should use for ${spec.localFor}, including out-of-hours arrangements. Evantix never changes this section automatically.`,
  });
  out.push({ key: "records", heading: "Record keeping", body: spec.records });
  out.push({ key: "training", heading: "Training requirements", body: spec.training });
  out.push({ key: "monitoring", heading: "Monitoring and audit", body: spec.monitoring });
  out.push(frameworkSection(spec));
  if (spec.related.length) out.push(relatedSection(spec, titles));
  out.push({ key: "review", heading: "Review arrangements", body: reviewBody(months) });
  return out;
}

/** Applies an `older` map to get the previous version's sections. */
function rollBack(sections: TemplateSection[], older: Record<string, string | null>): TemplateSection[] {
  for (const k of Object.keys(older)) if (!sections.some((s) => s.key === k)) throw new Error(`history references unknown section ${k}`);
  return sections.filter((s) => older[s.key] !== null).map((s) => (s.key in older ? { ...s, body: older[s.key]! } : s));
}

export function buildTemplates(specs: PolicySpec[]): TemplateDef[] {
  const titles = new Map(specs.map((s) => [s.ref, s.title]));
  if (titles.size !== specs.length) throw new Error("Duplicate policy reference in the starter library");
  return specs.map((spec, i) => {
    const sections = currentSections(spec, titles);
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
      changeSummary: "Demo history: scheduled review. Added the legislation, regulations and CQC quality statements this policy supports, and links to related policies.",
      reasonForChange: "Scheduled review",
      publishedMonthsAgo: reviewedAge,
    });
    const initial = rollBack(s, { framework: null, ...(spec.related.length ? { related: null } : {}), review: `This policy is reviewed at least every ${months} months, or sooner if legislation or guidance changes.` });
    versions.unshift({ sections: initial, changeSummary: "Demo history: initial issue.", reasonForChange: "New policy", publishedMonthsAgo: reviewedAge + months + 1 });
    for (const link of spec.links) if (!REQUIREMENT_BY_REF[link[0]]) throw new Error(`${spec.ref}: unknown requirement ${link[0]}`);
    for (const [, key] of spec.links) if (!sections.some((x) => x.key === key)) throw new Error(`${spec.ref}: link to unknown section ${key}`);
    const serviceTypes = spec.serviceTypes ?? ALL;
    const scopeNote = serviceTypes.length === ALL.length ? "" : ` For ${serviceTypes.map((t) => SERVICE_NAMES[t]).join(" and ")}.`;
    return {
      ref: spec.ref,
      title: spec.title,
      category: spec.category,
      description: `Starter template: ${spec.summary}${scopeNote} Not professionally reviewed; adapt before approval.`,
      serviceTypes,
      reviewIntervalMonths: months,
      sections,
      versions,
      links: [...spec.links.map(([requirement, section]) => ({ requirement, section })), ...spec.qs.map((code) => ({ requirement: `CQC-QS-${code}`, section: "framework" }))],
    };
  });
}
