import type { ChangeClassification, Urgency } from "@prisma/client";
import type { SectionChange } from "./diff";

/**
 * Deterministic first-pass classification. It is deliberately conservative:
 * anything that could plausibly alter an obligation is "potentially substantive",
 * and anything we cannot explain is "uncertain". A modified timestamp alone is
 * never treated as a change (the engine compares content hashes, not dates).
 */

const OBLIGATION = /\b(must|must not|shall|required?|requirements?|mandatory|duty|duties|legal(ly)?|regulations?|statutory|prohibit\w*|notify|notification|report(ing)?|within \d+|no later than|deadline|from \d{1,2} \w+ \d{4}|comes? into force|effective|should|ensure|responsib\w+|offence|penalt\w+|safeguard\w*)\b/i;
const EDITORIAL_LINE = /^(last updated|published|updated|contents|print this page|share this page|is this page useful|related content|page \d+)\b/i;
const URGENT = /\b(immediate(ly)?|urgent(ly)?|with immediate effect|safety alert|patient safety|national patient safety alert|recall|withdrawn)\b/i;
const NUMBER = /\d/;

export interface Classification {
  classification: ChangeClassification;
  urgency: Urgency;
  reasons: string[];
}

export function classifyChanges(changes: SectionChange[], opts: { isNewDocument: boolean; publisherChangeNote?: string | null }): Classification {
  if (opts.isNewDocument) {
    const text = changes.map((c) => c.after).join(" ");
    return { classification: "NEW_DOCUMENT", urgency: URGENT.test(text) ? "HIGH" : "MEDIUM", reasons: ["First version of this document seen by the monitor"] };
  }
  const reasons: string[] = [];
  const meaningful = changes.filter((c) => !c.editorialOnly);
  const sentences = meaningful.flatMap((c) => [...c.addedSentences, ...c.removedSentences]).filter((s) => !EDITORIAL_LINE.test(s));
  if (meaningful.length === 0 || sentences.length === 0) {
    reasons.push(meaningful.length === 0 ? "Only whitespace, punctuation or capitalisation changed" : "Only page furniture (dates, navigation) changed");
    return { classification: "EDITORIAL", urgency: "LOW", reasons };
  }
  const obligation = sentences.filter((s) => OBLIGATION.test(s));
  const numeric = sentences.filter((s) => NUMBER.test(s));
  const urgent = sentences.some((s) => URGENT.test(s));
  if (opts.publisherChangeNote) reasons.push(`Publisher change note: "${opts.publisherChangeNote}"`);
  if (obligation.length) reasons.push(`${obligation.length} changed sentence(s) use obligation or reporting language`);
  if (numeric.length) reasons.push(`${numeric.length} changed sentence(s) contain figures, dates or time limits`);
  if (meaningful.some((c) => c.kind === "removed")) reasons.push("A section was removed");
  if (obligation.length || numeric.length || opts.publisherChangeNote || meaningful.some((c) => c.kind === "removed")) {
    return { classification: "POTENTIALLY_SUBSTANTIVE", urgency: urgent ? "URGENT" : obligation.length && numeric.length ? "HIGH" : "MEDIUM", reasons };
  }
  reasons.push("Wording changed without obvious obligation language; needs a human decision");
  return { classification: "UNCERTAIN", urgency: urgent ? "HIGH" : "LOW", reasons };
}

/** Maps changed text to policy categories using keyword cues (proposal only, shown with reasons). */
const CATEGORY_CUES: Record<string, RegExp> = {
  SAFEGUARDING: /\bsafeguard\w*|abuse|neglect|exploitation\b/i,
  MEDICINES: /\bmedicines?|medication|prescri\w+|controlled drugs?|pharmac\w+\b/i,
  IPC: /\binfection|ipc|outbreak|ppe|hand hygiene|covid|influenza|isolation\b/i,
  COMPLAINTS: /\bcomplain\w*|ombudsman\b/i,
  INCIDENTS: /\bincident|notification|notify (the )?cqc|serious injury|riddor\b/i,
  CONSENT: /\bmental capacity|consent|best interests?|deprivation of liberty|dols|liberty protection\b/i,
  CANDOUR: /\bduty of candour|notifiable safety incident|apolog\w+\b/i,
  RECRUITMENT: /\brecruit\w*|dbs|disclosure and barring|right to work|fit and proper|employment history|references?\b/i,
  TRAINING: /\btraining|competen\w+|care certificate|induction|oliver mcgowan\b/i,
  HEALTH_SAFETY: /\bhealth and safety|risk assessment|fire|legionella|moving and handling|coshh|riddor\b/i,
  WHISTLEBLOWING: /\bwhistleblow\w*|speak(ing)? up|freedom to speak up\b/i,
  DATA_PROTECTION: /\bdata protection|gdpr|personal data|confidential\w*|subject access|data security|dspt\b/i,
  GOVERNANCE: /\bgovernance|quality assurance|audit|oversight|registered manager|nominated individual\b/i,
  RISK: /\brisk management|risk register|positive risk\b/i,
  RECORDS: /\brecord[- ]keeping|care records?|retention|documentation\b/i,
  EQUALITY: /\bequality|human rights|discriminat\w+|protected characteristic\w*|accessible information\b/i,
  FOOD: /\bfood|nutrition|hydration|allergen\w*|dysphagia|iddsi\b/i,
};

export function suggestCategories(text: string): string[] {
  return Object.entries(CATEGORY_CUES)
    .filter(([, re]) => re.test(text))
    .map(([code]) => code);
}

const SERVICE_CUES: Record<string, RegExp> = {
  RESIDENTIAL: /\bcare homes?|residential|nursing homes?\b/i,
  DOMICILIARY: /\bhome care|domiciliary|homecare\b/i,
  SUPPORTED_LIVING: /\bsupported living\b/i,
};

export function suggestServiceTypes(text: string, sourceServiceTypes: string[]): string[] {
  const hits = Object.entries(SERVICE_CUES)
    .filter(([, re]) => re.test(text))
    .map(([c]) => c);
  return hits.length ? hits : sourceServiceTypes;
}
