/**
 * Business details an organisation records once in Settings. Policy text refers to them with
 * {{tags}}, which are filled in whenever a policy is shown or downloaded, so a change in
 * Settings shows up in every policy straight away.
 */
export const BUSINESS_FIELDS = [
  { tag: "company_name", label: "Company name", hint: "As registered with CQC" },
  { tag: "address", label: "Registered address", hint: "The address CQC holds for your registered location" },
  { tag: "phone", label: "Main telephone", hint: "Including out-of-hours number if different" },
  { tag: "email", label: "Contact email", hint: "Used on forms and letters" },
  { tag: "registered_manager", label: "Registered manager", hint: "Full name" },
  { tag: "nominated_individual", label: "Nominated individual", hint: "Full name" },
  { tag: "safeguarding_lead", label: "Safeguarding lead", hint: "Full name and role" },
  { tag: "service_type", label: "Service type", hint: "The kind of care you provide" },
  { tag: "local_authority", label: "Local authority", hint: "Where you make safeguarding referrals" },
  { tag: "cqc_provider_id", label: "CQC provider ID", hint: "For example 1-123456789" },
] as const;

export type BusinessTag = (typeof BUSINESS_FIELDS)[number]["tag"];
export type BusinessDetails = Record<BusinessTag, string>;

export const SERVICE_TYPES = ["Residential care home", "Care home with nursing", "Domiciliary (home) care", "Supported living", "Extra care housing", "Mixed services"];

const LABEL = new Map<string, string>(BUSINESS_FIELDS.map((f) => [f.tag, f.label]));
export const tagLabel = (tag: string) => LABEL.get(tag) ?? tag.replace(/_/g, " ");

/** The fields that must be filled for policies to be fully personalised. */
export const REQUIRED_TAGS: BusinessTag[] = ["company_name", "address", "phone", "registered_manager", "nominated_individual", "safeguarding_lead", "local_authority"];
export const missingDetails = (d: BusinessDetails) => REQUIRED_TAGS.filter((t) => !d[t]?.trim());

export type TagPart = { text: string } | { tag: string; value: string | null };

/** Splits text into plain runs and {{tag}} references, with each tag's current value. */
export function splitTags(text: string, details: Partial<BusinessDetails> | null): TagPart[] {
  const parts: TagPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    const value = details?.[m[1] as BusinessTag]?.trim();
    parts.push({ tag: m[1]!, value: value || null });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Replaces {{tags}} with their values, for Word and PDF output. Missing values become a visible prompt. */
export function fillTags(text: string, details: Partial<BusinessDetails> | null) {
  return splitTags(text, details)
    .map((p) => ("text" in p ? p.text : p.value ?? `[${tagLabel(p.tag)}: add in Settings]`))
    .join("");
}

const replaceFirst = (state: { done: Set<string> }, key: string, body: string, re: RegExp, to: (m: string) => string) => {
  if (state.done.has(key)) return body;
  const m = body.match(re);
  if (!m) return body;
  state.done.add(key);
  return body.slice(0, m.index) + to(m[0]) + body.slice(m.index! + m[0].length);
};

/**
 * Adds business-detail tags to CSB starter text at the points where an organisation's own
 * details belong: the scope, the first mention of each key role, and the local contacts
 * section while it still holds the "complete locally" prompt. Text that already uses
 * {{tags}} is left as written.
 */
export function personaliseSections<T extends { key: string; body: string }>(sections: T[], docType: string): T[] {
  const isPolicy = ["POLICY", "PROCEDURE", "GUIDANCE"].includes(docType);
  const state = { done: new Set<string>() };
  return sections.map((s) => {
    let body = s.body;
    if (s.key === "scope" && isPolicy && !body.includes("{{company_name}}")) {
      body = `${body}\nThis policy is adopted by {{company_name}} ({{service_type}}), registered at {{address}}.`;
    }
    if (s.key === "local.contacts" && isPolicy && body.startsWith("[Complete locally]")) {
      body = [
        "• Registered manager: {{registered_manager}}, telephone {{phone}}",
        "• Safeguarding lead: {{safeguarding_lead}}",
        "• Nominated individual: {{nominated_individual}}",
        "• Local authority: {{local_authority}}",
        "• General enquiries: {{email}}",
        "Out of hours, staff contact the on-call manager through {{phone}}. In an emergency always call 999.",
      ].join("\n");
      return { ...s, body };
    }
    if (isPolicy && !s.key.startsWith("framework") && s.key !== "related") {
      body = replaceFirst(state, "rm", body, /\b[Tt]he registered manager\b/, (m) => `${m} ({{registered_manager}})`);
      body = replaceFirst(state, "ni", body, /\b[Tt]he nominated individual\b/, (m) => `${m} ({{nominated_individual}})`);
      body = replaceFirst(state, "la", body, /\blocal authority safeguarding team\b/, (m) => `${m} at {{local_authority}}`);
    }
    return body === s.body ? s : { ...s, body };
  });
}
