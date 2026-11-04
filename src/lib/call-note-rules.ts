/**
 * Service user Call Notes: pure rules shared by the server and the screens (no database, no secrets).
 *
 * A Call Note is a record of a conversation, email or meeting. It keeps only general communication. Each piece of
 * information in it is classified (what kind of statement it is) and routed (where it belongs): anything that belongs
 * in a structured record goes to that record's own review queue, and the note keeps a short reference to it.
 *
 * The basic organiser here runs on CSB's own server and never sends anything anywhere. It only ever copies whole
 * clauses from the text it was given, so every bullet it produces is on the page; it never adds people, dates or facts.
 */

export const METHODS = { TELEPHONE: "Telephone", FACE_TO_FACE: "Face-to-face conversation", EMAIL: "Email", MEETING: "Meeting", VIDEO: "Video call", OTHER: "Other" } as const;
export type Method = keyof typeof METHODS;
export const METHOD_KEYS = Object.keys(METHODS) as [Method, ...Method[]];
/** "Telephone conversation", "Email" … for the card title. */
export const METHOD_TITLE: Record<Method, string> = { TELEPHONE: "Telephone conversation", FACE_TO_FACE: "Face-to-face conversation", EMAIL: "Email", MEETING: "Meeting", VIDEO: "Video call", OTHER: "Communication" };

export const KINDS = {
  CONFIRMED_FACT: "Confirmed fact",
  THIRD_PARTY_REPORT: "Reported by someone else",
  UNVERIFIED: "Unverified statement",
  PREFERENCE_REQUEST: "Preference or request",
  PROFESSIONAL_ADVICE: "Professional advice",
  AUTHORISED_INSTRUCTION: "Formal authorised instruction",
} as const;
export type Kind = keyof typeof KINDS;
export const KIND_KEYS = Object.keys(KINDS) as [Kind, ...Kind[]];

/**
 * Where a piece of information belongs. `perm` is who may close the review item it becomes; `restricted` items are
 * clinical or safeguarding and open only for people allowed to see sensitive records.
 */
export const DESTINATIONS = {
  CALL_NOTE: { label: "Call Notes", short: "Keep in this note", tab: null, category: null, restricted: false },
  CARE_PLAN: { label: "Care Plans", short: "Care plan review", tab: "care-plans", category: "CARE_PLAN", restricted: false },
  RISK: { label: "Risk Assessments", short: "Risk assessment review", tab: "risks", category: "RISK", restricted: false },
  MEDICATION: { label: "Medication reconciliation", short: "Medication: needs authorised verification", tab: "medication", category: "MEDICATION", restricted: true },
  ROTA: { label: "Care Package / Rota", short: "Rota or package request", tab: "rota", category: "ROTA", restricted: false },
  VISIT: { label: "Visits / Visit Notes", short: "Visit record", tab: "visits", category: "VISIT", restricted: false },
  INCIDENT: { label: "Incidents / Body Map", short: "Incident or injury", tab: "incidents", category: "INCIDENT", restricted: true },
  SAFEGUARDING: { label: "Safeguarding workflow", short: "Safeguarding concern", tab: "incidents", category: "SAFEGUARDING", restricted: true },
  CONTACTS: { label: "Contacts & Carers", short: "Contact details", tab: "people", category: "CONTACTS", restricted: false },
  PERSONAL: { label: "Personal Details", short: "Personal details", tab: "details", category: "PERSONAL", restricted: false },
  DOCUMENTS: { label: "Documents", short: "Document to file", tab: "documents", category: "DOCUMENTS", restricted: false },
} as const;
export type Destination = keyof typeof DESTINATIONS;
export const DESTINATION_KEYS = Object.keys(DESTINATIONS) as [Destination, ...Destination[]];
export const isDestination = (d: string | null | undefined): d is Destination => !!d && d in DESTINATIONS;

export const DUPLICATES = { NEW: "New information", EXACT: "Exact duplicate", POSSIBLE: "Possible duplicate", UPDATE: "Update to existing information", CONFLICT: "Conflict requiring review" } as const;
export type DuplicateKind = keyof typeof DUPLICATES;

export const DECISIONS = { KEEP: "Keep in this note", ROUTE: "Send to its record for review", LINK: "Link to the existing record", LEAVE_OUT: "Leave out" } as const;
export type ItemDecision = keyof typeof DECISIONS;

export const STATUS = {
  DRAFT: "Draft",
  AWAITING_REVIEW: "Awaiting Review",
  APPROVED: "Approved",
  CLARIFICATION_REQUESTED: "Clarification requested",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  WITHDRAWN: "Withdrawn",
} as const;
export type NoteStatus = keyof typeof STATUS;
/** Notes a person can still change (corrections keep the previous version). */
export const EDITABLE = new Set<string>(["DRAFT", "CLARIFICATION_REQUESTED", "AWAITING_REVIEW", "APPROVED"]);

/**
 * What the card shows: the workflow status, except that an approved note with open follow-up tasks reads "Follow-up
 * Required" and one whose tasks are all closed reads "Completed". The two are kept separate in the data.
 */
export function displayStatus(status: string, tasks: { status: string }[]): { label: string; tone: "slate" | "amber" | "green" | "blue" | "rose" | "violet" } {
  if (status === "APPROVED") {
    if (tasks.some((t) => t.status === "OPEN")) return { label: "Follow-up Required", tone: "amber" };
    if (tasks.length) return { label: "Completed", tone: "green" };
    return { label: STATUS.APPROVED, tone: "green" };
  }
  const tone = ({ DRAFT: "slate", AWAITING_REVIEW: "blue", CLARIFICATION_REQUESTED: "violet", REJECTED: "rose", SUPERSEDED: "slate", WITHDRAWN: "slate" } as const)[status as Exclude<NoteStatus, "APPROVED">] ?? "slate";
  return { label: STATUS[status as NoteStatus] ?? status, tone };
}

export const PRIORITIES = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" } as const;
export type Priority = keyof typeof PRIORITIES;

export const URGENT_KINDS = { SAFEGUARDING: "Safeguarding concern", MEDICATION: "Medication concern", SAFETY: "Safety concern" } as const;
export type UrgentKind = keyof typeof URGENT_KINDS;

/** CALL-2026-000001. */
export function formatReference(year: number, n: number) {
  return `CALL-${year}-${String(n).padStart(6, "0")}`;
}

// ── Text helpers ───────────────────────────────────────────────────────────

/** Lower case, letters and digits only, single spaces: for comparing text, never for showing it. */
export function normalise(s: string) {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when `quote` appears in `text`, ignoring case, punctuation and spacing. */
export function quoteInText(text: string, quote: string | null | undefined) {
  if (!quote) return false;
  const q = normalise(quote);
  return q.length > 0 && normalise(text).includes(q);
}

const STOP = new Set("a an and are as at be been but by did do for from had has have he her his i in is it its me my of on or our she so that the their them they this to us was we were will with you your not said says told today rang called spoke mother father daughter son would like also very".split(" "));

function words(s: string) {
  return new Set(normalise(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Word overlap of two texts (0 to 1), on meaningful words only. */
export function similarity(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  // One shared word is never enough to call two statements the same subject.
  if (both < 2 && Math.min(x.size, y.size) > 1) return 0;
  // Overlap against the shorter text: a short new statement fully inside a longer existing record still counts.
  return both / Math.min(x.size, y.size);
}

const NEGATION = /\b(not|no longer|never|stopped|refuses?|refused|cannot|can't|doesn't|does not|isn't|won't)\b/i;
const CHANGE = /\b(now|changed?|new|no longer|instead|from now|increase[ds]?|decrease[ds]?|earlier|later|moved|updated?|different)\b/i;

export interface Candidate {
  /** "RiskAssessment:<id>" and so on. */
  ref: string;
  /** What the person sees, e.g. "Risk assessment: Falls". */
  label: string;
  text: string;
  destination: Destination | "ANY";
}

const FAMILY: Partial<Record<Destination, Destination>> = { SAFEGUARDING: "INCIDENT", INCIDENT: "SAFEGUARDING", ROTA: "VISIT", VISIT: "ROTA" };
/** General notes are compared with everything; structured items with their own kind of record and with notes. */
function comparable(item: Destination, record: Destination | "ANY") {
  return record === "ANY" || item === "CALL_NOTE" || record === item || FAMILY[item] === record;
}

export interface DuplicateFinding { kind: DuplicateKind; ref: string | null; label: string | null; score: number }

/**
 * Compares one piece of information with existing records the viewer may see. This is help for the coordinator, not a
 * decision: nothing is merged, overwritten or deleted because of it.
 *  - EXACT: the same words (or nearly) are already recorded.
 *  - CONFLICT: the same subject, but one says the opposite (a negation on one side only).
 *  - UPDATE: the same subject, and the new text says something changed.
 *  - POSSIBLE: a strong overlap worth a look.
 */
export function findDuplicate(text: string, destination: Destination, candidates: Candidate[]): DuplicateFinding {
  let best: { c: Candidate; score: number } | null = null;
  for (const c of candidates) {
    if (!comparable(destination, c.destination)) continue;
    const score = normalise(c.text) === normalise(text) ? 1 : similarity(text, c.text);
    if (!best || score > best.score) best = { c, score };
  }
  if (!best || best.score < 0.4) return { kind: "NEW", ref: null, label: null, score: best?.score ?? 0 };
  const { c, score } = best;
  if (score >= 0.85 && NEGATION.test(text) === NEGATION.test(c.text)) return { kind: "EXACT", ref: c.ref, label: c.label, score };
  if (NEGATION.test(text) !== NEGATION.test(c.text)) return { kind: "CONFLICT", ref: c.ref, label: c.label, score };
  if (CHANGE.test(text)) return { kind: "UPDATE", ref: c.ref, label: c.label, score };
  if (score >= 0.5) return { kind: "POSSIBLE", ref: c.ref, label: c.label, score };
  return { kind: "NEW", ref: null, label: null, score };
}

/** The decision a duplicate finding suggests: an exact duplicate is linked, never copied again. */
export function suggestedDecision(destination: Destination, dup: DuplicateKind, quoteFound: boolean): ItemDecision {
  if (!quoteFound) return "LEAVE_OUT";
  if (dup === "EXACT") return "LINK";
  return destination === "CALL_NOTE" ? "KEEP" : "ROUTE";
}

// ── Organising text into bullet points ─────────────────────────────────────

export interface OrganisedItem {
  text: string;
  kind: Kind;
  destination: Destination;
  /** The exact words in the original text. */
  quote: string;
  urgent: UrgentKind | null;
}

export interface Organised {
  summary: string;
  items: OrganisedItem[];
  followUps: string[];
  clarifications: string[];
  urgent: { kind: UrgentKind; text: string }[];
}

const ROUTES: [Destination, RegExp][] = [
  ["SAFEGUARDING", /\b(abus\w*|neglect\w*|hit (her|him|them)|hits? (her|him|them)|slapp\w*|pushed (her|him|them)|took (her|his|their) money|money (has gone|missing|taken)|stole|stolen|frightened of|scared of|threaten\w*|bruis\w+ (on|to) (her|his) (arm|wrist|face)|unsafe at home|safeguarding)\b/i],
  ["INCIDENT", /\b(fell|fall|fallen|fainted|injur\w*|hurt (her|him|them)self|cut (her|his|their)|wound|bleed\w*|bruis\w*|burn(ed|t)?|skin tear|pressure sore|ambulance|a&e|taken to hospital)\b/i],
  ["MEDICATION", /\b(medicat\w*|medicine\w*|tablets?|pills?|dose\w*|prescri\w*|pharmac\w*|inhaler|insulin|blister pack|dosette|antibiotic\w*|cream|patch(es)?)\b/i],
  ["ROTA", /\b(visits? (time|times)|earlier|later in the|later visit|(arrive|come|start|visit) (slightly |a (bit|little) |much )?(earlier|later)|(earlier|later) in the (morning|afternoon|evening)|change the (visit|time|call)|extra (visit|call)|cancel\w* (the )?(visit|call)|(morning|lunch|tea|evening|bed) (visit|call)|rota|time of (the|her|his) (visit|call)|package of care|more hours|fewer hours|hours a week)\b/i],
  ["VISIT", /\b(carer (did not|didn't|never) (turn up|arrive|come)|missed (visit|call)|no one came|visit was missed|carers? (came|arrived|left) (late|early))\b/i],
  ["CONTACTS", /\b(new (phone|mobile|number|email|address)|(phone|mobile) number (is|has changed)|call (her|him) on|e-?mail (is|address)|next of kin|power of attorney|lpa|social worker is|new gp|gp (is|has changed))\b/i],
  ["PERSONAL", /\b(moved (house|address|home)|new address|changed (her|his|their) name|prefers? to be called|preferred name|first language|interpreter)\b/i],
  ["DOCUMENTS", /\b(support plan|purchase order|discharge (letter|summary)|attached|letter from|sent (us|me) (a|the) (letter|document|form)|assessment (document|report))\b/i],
  ["RISK", /\b(risk|trip(ping)? hazard|unsteady|wander\w*|smok\w*|hoarding|stairs|lone working|aggress\w*|dog in the house)\b/i],
  ["CARE_PLAN", /\b(needs? (help|support|more help|assistance)|can no longer|struggl\w*|unable to|support with|help with (washing|dressing|meals|eating|toileting|showering)|mobility|continen\w*|(eating|drinking) (less|more)|(not|isn't) eating|dietary|diet)\b/i],
];

const KIND_RULES: [Kind, RegExp][] = [
  // What the person recording did themselves ("Spoke to the daughter", "Emailed the social worker").
  ["CONFIRMED_FACT", /^(i |we )?(spoke|called|rang|phoned|e-?mailed|met|visited|sent|left a (message|voicemail)|attended)\b/i],
  ["AUTHORISED_INSTRUCTION", /\b(prescriber|prescribed by|gp has (authorised|prescribed|instructed)|signed (instruction|authorisation)|authorised by)\b/i],
  ["PROFESSIONAL_ADVICE", /\b((gp|doctor|nurse|district nurse|pharmacist|physio\w*|occupational therapist|ot|social worker|consultant) (said|advised|recommended|suggested|told))\b/i],
  ["PREFERENCE_REQUEST", /\b(would (like|prefer)|prefers?|wants?|wanted|asked (for|if|whether|that)|requested|request|wishes)\b/i],
  ["UNVERIFIED", /\b(thinks?|believes?|might|may have|maybe|perhaps|not sure|unsure|possibly|waiting (for|on)|awaiting|apparently|seems?)\b/i],
  ["THIRD_PARTY_REPORT", /\b(said|says|reported|told (me|us)|mentioned|explained|informed|complained)\b/i],
];

const URGENT_RULES: [UrgentKind, RegExp][] = [
  ["SAFEGUARDING", ROUTES[0]![1]],
  ["MEDICATION", /\b(wrong (medicine|medication|tablets?|dose)|too many tablets|overdose|double dose\w*|missed (her|his|their) (medication|tablets) for|ran out of (her|his|their) (medication|tablets)|no (medication|tablets) left)\b/i],
  ["SAFETY", /\b(fell|fall(en)?|on the floor|could not get up|chest pain|breathless\w*|unconscious|not responding|gas (leak|smell)|fire|no heating|no food in the house|locked out)\b/i],
];

/** Splits text into short clauses, keeping each one's exact words so it can be quoted. */
export function clauses(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.replace(/\r?\n+/g, ". ").split(/(?<=[.!?;])\s+|\s*[••]\s*|\s+-\s+/)) {
    const parts = sentence.split(/,\s*(?:and\s+)?(?=(?:she|he|they|her|his|their|the gp|the doctor|the nurse|we|i)\b)|\s+and\s+(?=(?:she|he|they|we|i)\s+(?:is|was|said|would|wants|asked|has|had|will|needs|reported|told|mentioned)\b)/i);
    for (const p of parts) {
      const t = p.replace(/^[\s,;:.-]+|[\s,;:]+$/g, "").trim();
      if (t.length >= 6) out.push(t);
    }
  }
  return out;
}

function sentenceCase(s: string) {
  const t = s.replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : t;
}

export function routeOf(clause: string): Destination {
  return ROUTES.find(([, re]) => re.test(clause))?.[0] ?? "CALL_NOTE";
}

export function kindOf(clause: string, fromServiceUser: boolean): Kind {
  const k = KIND_RULES.find(([, re]) => re.test(clause))?.[0];
  if (k) return k;
  // A statement made by someone other than the person is a third-party report until someone checks it.
  return fromServiceUser ? "UNVERIFIED" : "THIRD_PARTY_REPORT";
}

export function urgentOf(clause: string): UrgentKind | null {
  return URGENT_RULES.find(([, re]) => re.test(clause))?.[0] ?? null;
}

const FOLLOW_UP: Partial<Record<Destination, string>> = {
  ROTA: "Confirm the requested change with the family and review it against the current rota before anything is changed.",
  MEDICATION: "Await confirmation of any medication change from an authorised professional; no medication change is authorised by this note.",
  CARE_PLAN: "Ask the care plan owner to review whether the care plan needs updating.",
  RISK: "Ask the assessor to review the relevant risk assessment.",
  INCIDENT: "Check whether an incident or body map record is needed, through the incident workflow.",
  SAFEGUARDING: "A manager should consider the safeguarding procedure now. The concern is reported, not proven.",
  CONTACTS: "Check the contact details with the person before updating Contacts & carers.",
  PERSONAL: "Check the change with the person before updating Personal details.",
  DOCUMENTS: "File the document in Council or Other Documents when it is received.",
  VISIT: "Check the visit record for the visit mentioned.",
};

/**
 * The basic organiser (no AI): splits the text into clauses, copies each one as a bullet, and sorts it by keyword
 * rules. The summary is built only from the fields the person filled in. Unknowns stay unknown.
 */
export function basicOrganise(input: { text: string; method: Method; contactName: string; contactRole: string | null; fromServiceUser?: boolean }): Organised {
  const items: OrganisedItem[] = [];
  const seen = new Set<string>();
  for (const c of clauses(input.text)) {
    const key = normalise(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const urgent = urgentOf(c);
    const destination = urgent === "SAFEGUARDING" ? "SAFEGUARDING" : routeOf(c);
    items.push({ text: sentenceCase(c), kind: kindOf(c, !!input.fromServiceUser), destination, quote: c, urgent });
  }
  const who = input.contactRole ? `${input.contactName} (${input.contactRole})` : input.contactName;
  const summary = `${METHOD_TITLE[input.method]} with ${who}.`;
  const followUps = [...new Set(items.flatMap((i) => (FOLLOW_UP[i.destination] ? [FOLLOW_UP[i.destination]!] : [])))];
  const clarifications = items.filter((i) => i.kind === "UNVERIFIED").map((i) => `Clarify: ${i.text}`);
  const urgent = items.filter((i) => i.urgent).map((i) => ({ kind: i.urgent!, text: i.text }));
  return { summary, items, followUps, clarifications, urgent };
}

/**
 * Checks an AI proposal against the original text. Every item must quote the original word for word: an item whose
 * quote is not in the text is kept for the coordinator to see but marked, and it is left out unless they choose it.
 * Urgent concerns are also looked for by the server's own rules, so a missed flag from the AI is still raised.
 */
export function verifyProposal(text: string, p: Organised): { items: (OrganisedItem & { quoteFound: boolean })[]; urgent: Organised["urgent"] } {
  const items = p.items.map((i) => {
    const found = quoteInText(text, i.quote);
    const ruleUrgent = urgentOf(i.quote || i.text);
    const urgent = i.urgent ?? (found ? ruleUrgent : null);
    return { ...i, urgent, destination: urgent === "SAFEGUARDING" ? ("SAFEGUARDING" as const) : i.destination, quoteFound: found };
  });
  const urgent = [...p.urgent];
  for (const i of items) if (i.urgent && i.quoteFound && !urgent.some((u) => u.kind === i.urgent && u.text === i.text)) urgent.push({ kind: i.urgent, text: i.text });
  return { items, urgent: urgent.filter((u, n, all) => all.findIndex((x) => x.kind === u.kind && x.text === u.text) === n) };
}

/** Kinds of statement that must never be treated as clinically verified or authorised. */
export const NOT_VERIFIED = new Set<Kind>(["THIRD_PARTY_REPORT", "UNVERIFIED", "PREFERENCE_REQUEST"]);
