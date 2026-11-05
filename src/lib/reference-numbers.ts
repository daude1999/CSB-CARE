/**
 * Pure helpers for service-user reference numbers (no database, no secrets): the labels shown on the Reference
 * Numbers tab, recognising Tower Hamlets "Frameworki" identifiers in document text, and turning a search box entry
 * into the exact values the encrypted register can be looked up by.
 *
 * Reference values are always strings. Nothing here parses a reference as a number, so leading zeroes survive.
 */

export const REFERENCE_TYPES = ["COUNCIL_CLIENT", "COUNCIL_FRAMEWORK", "COUNCIL_PACKAGE", "OTHER_EXTERNAL", "NHS"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const REFERENCE_TYPE_LABEL: Record<ReferenceType, string> = {
  COUNCIL_CLIENT: "Council client number",
  COUNCIL_PACKAGE: "Council package reference",
  COUNCIL_FRAMEWORK: "Council framework / contract ID",
  OTHER_EXTERNAL: "Other reference",
  NHS: "NHS number",
};

/** Short help for each type, shown in the Add Reference form. */
export const REFERENCE_TYPE_HELP: Record<ReferenceType, string> = {
  COUNCIL_CLIENT: "Identifies this person in the council's system. Can belong to one person only.",
  COUNCIL_PACKAGE: "Identifies one package of care or placement. Can belong to one person only.",
  COUNCIL_FRAMEWORK: "A contract or framework number shared by many people. Never proof of identity.",
  OTHER_EXTERNAL: "Any other organisation's reference for this person.",
  NHS: "Restricted. Registered managers only.",
};

export const TOWER_HAMLETS_COUNCIL = "Tower Hamlets Council";
export const FRAMEWORKI = "Frameworki";
/** Issuers offered in the Add Reference form. Staff may type any other. */
export const COMMON_ISSUERS = [TOWER_HAMLETS_COUNCIL, "NHS England"] as const;
export const COMMON_SYSTEMS = [FRAMEWORKI] as const;

/** Only a framework ID may be shared by several people; every other type identifies one person. */
export const isPersonSpecific = (type: string) => type !== "COUNCIL_FRAMEWORK";

/** "Tower Hamlets Council" → "Tower Hamlets", for compact titles. */
export function issuerShort(issuer: string) {
  return issuer.replace(/\s+(london borough )?(borough )?council$/i, "").replace(/^london borough of\s+/i, "").trim() || issuer;
}

/** The row title: "Tower Hamlets – Frameworki" when a system is named, otherwise the type label. */
export function referenceTitle(r: { type: string; issuer: string; systemLabel: string | null }) {
  if (r.systemLabel) return `${issuerShort(r.issuer)} – ${r.systemLabel}`;
  return REFERENCE_TYPE_LABEL[r.type as ReferenceType] ?? r.type;
}

/** NHS numbers are compared without spaces; every other reference exactly as printed (trimmed). */
export function normaliseReference(type: string, value: string) {
  const v = value.trim();
  return type === "NHS" ? v.replace(/\s+/g, "") : v;
}

/** Every stored spelling a value may have been saved under (older NHS rows kept the spaces as typed). */
export function storedSpellings(type: string, value: string): string[] {
  const v = value.trim();
  if (type !== "NHS") return [v];
  const digits = v.replace(/\s+/g, "");
  const spaced = /^\d{10}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits;
  return [...new Set([digits, spaced, v])];
}

// ── Frameworki ────────────────────────────────────────────────────────────────

/**
 * "Frameworki 1088676", "LBTH Frameworki 1088676", "Frameworki: 1088676", "frameworki ID 0012345", with any spacing
 * or capitalisation. The value must contain a digit and is kept exactly as printed.
 */
const FRAMEWORKI_RE = /\b(LBTH\s+)?frameworki\b(?:\s+(?:client|person|service user|package|case|contract|framework))?(?:\s*(?:id|ref(?:erence)?|no\.?|number|#))?\s*[:#.\-–]?\s*([A-Z0-9][A-Z0-9\/-]*)/gi;

export interface FrameworkiMatch {
  value: string;
  /** The whole line the number was found on: the source wording kept with the reference. */
  quote: string;
  lbth: boolean;
}

export function findFrameworki(text: string): FrameworkiMatch[] {
  const out: FrameworkiMatch[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!/frameworki/i.test(line)) continue;
    for (const m of line.matchAll(FRAMEWORKI_RE)) {
      const value = m[2]!.replace(/[\/-]+$/, "");
      if (!/\d/.test(value)) continue;
      if (!out.some((o) => o.value === value)) out.push({ value, quote: line.slice(0, 500), lbth: !!m[1] });
    }
  }
  return out;
}

/**
 * What a Frameworki number identifies, from the words around it. Frameworki is the council's information system, so
 * the label alone says nothing about whether the number is the person, their package or a shared framework. When the
 * words do not settle it (or point two ways), the result is unclear and a person must choose.
 */
export function classifyReferenceContext(context: string): { type: ReferenceType; clear: boolean } {
  const t = context.toLowerCase().replace(/frameworki/g, " ");
  const hits: ReferenceType[] = [];
  if (/\b(care )?package\b|\bplacement\b|service agreement|purchase order|\bpo\b|commissioned service/.test(t)) hits.push("COUNCIL_PACKAGE");
  if (/\bframework\b|\bcontract\b|\blot\b|provider (id|number|ref)/.test(t)) hits.push("COUNCIL_FRAMEWORK");
  if (/\b(client|person|service user|resident|customer|individual|citizen)\b|\bperson id\b|\bclient id\b/.test(t)) hits.push("COUNCIL_CLIENT");
  if (hits.length === 1) return { type: hits[0]!, clear: true };
  // Provisional: treated as person-specific (the stricter conflict rules) until someone decides.
  return { type: "COUNCIL_CLIENT", clear: false };
}

export interface DetectedReference {
  type: ReferenceType;
  typeClear: boolean;
  issuer: string;
  system: string;
  value: string;
  page: number;
  quote: string;
}

/** Every Frameworki number in a document's pages, with its page, wording and a proposed (possibly unclear) type. */
export function frameworkiReferences(pages: string[], documentIssuer: string | null): DetectedReference[] {
  const whole = pages.join("\n");
  const towerHamlets = /tower hamlets|\blbth\b/i.test(whole);
  const issuer = towerHamlets ? TOWER_HAMLETS_COUNCIL : documentIssuer && /council|borough/i.test(documentIssuer) ? documentIssuer.slice(0, 180) : "Council (check the issuer)";
  const out: DetectedReference[] = [];
  pages.forEach((text, i) => {
    for (const m of findFrameworki(text)) {
      if (out.some((o) => o.value === m.value)) continue;
      const c = classifyReferenceContext(m.quote);
      out.push({ type: c.type, typeClear: c.clear, issuer: m.lbth ? TOWER_HAMLETS_COUNCIL : issuer, system: FRAMEWORKI, value: m.value, page: i + 1, quote: m.quote });
    }
  });
  return out;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * The exact values to look a search entry up by. "Frameworki 1088676", "LBTH Frameworki: 1088676" or
 * "NHS 943 476 5919" also try the number on its own. The register only answers exact matches.
 */
export function referenceSearchValues(q: string): string[] {
  const t = q.trim().replace(/\s+/g, " ");
  if (!t) return [];
  const out = new Set<string>([t]);
  const label = /^(?:lbth\s+)?(?:frameworki|tower hamlets(?: council)?(?: frameworki)?|council|client|package|nhs)(?:\s*(?:id|ref(?:erence)?|no\.?|number|#))?\s*[:#\-–]?\s*(.+)$/i.exec(t);
  if (label?.[1]) out.add(label[1].trim());
  for (const v of [...out]) {
    const digits = v.replace(/\s+/g, "");
    if (/^\d{10}$/.test(digits)) for (const s of storedSpellings("NHS", digits)) out.add(s);
  }
  return [...out].filter((v) => v.length >= 2).slice(0, 8);
}
