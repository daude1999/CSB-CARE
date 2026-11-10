/**
 * How CSB AI sorts what it read from a support plan (owner's brief of 7 Nov 2026, "Autonomous AI Care Coordinator").
 *
 * Pure rules, no database: given the facts of one intake, it decides for every fact still waiting whether CSB AI may
 * save it as routine information, consolidate it as a repeat of another fact, leave it unused (historical or
 * superseded), or leave it waiting with an exception for a person. Four kinds of exception:
 *
 *  - FOLLOW_UP  useful to clarify later, never blocks the person's record (shown as "Follow-up").
 *  - REVIEW     a material inconsistency or gap affecting identity, scheduling, commissioning or the record.
 *  - URGENT     safety-critical (safeguarding): escalated to managers at once, never left waiting in a list.
 *  - INFO       for information only.
 *
 * The aim is better decisions, not fewer warnings: nothing safety-related is dropped to make the list shorter, and a
 * document that is merely not perfectly detailed does not raise anything.
 */

export type Severity = "INFO" | "FOLLOW_UP" | "REVIEW" | "URGENT";
export const SEVERITY_LABEL: Record<Severity, string> = { URGENT: "Urgent", REVIEW: "Review required", FOLLOW_UP: "Follow-up", INFO: "Informational" };
export const SEVERITY_ORDER: Severity[] = ["URGENT", "REVIEW", "FOLLOW_UP", "INFO"];

export interface TriageFact {
  id: string;
  section: string;
  destination: string;
  label: string;
  value: unknown;
  position: number;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  quote: string | null;
  verification: string;
  temporal: string;
  origin: string;
  conflict: string | null;
  existingValue: unknown;
  decision: string;
  question?: string | null;
  appliedAt: Date | null;
}
export interface TriageDoc {
  id: string; name: string; documentDate: string | null; sensitive: boolean;
  /** A risk assessment (filed as one, or named so): its risks are saved even when it is a supporting document. */
  riskAssessment?: boolean;
}

export interface ExceptionSeed {
  severity: Severity;
  category: string;
  title: string;
  description: string;
  /** Profile tab where the record to correct lives. */
  recordTab: string | null;
  restricted: boolean;
}

export type Outcome =
  | { factId: string; kind: "ROUTINE"; note: string; exception?: ExceptionSeed }
  | { factId: string; kind: "DUPLICATE"; note: string; duplicateOf: string }
  | { factId: string; kind: "NOT_USED"; note: string }
  | { factId: string; kind: "WAIT"; note: string; exception: ExceptionSeed | null; identity: boolean };

/** Safety findings not tied to one fact (the reader's flags on a page). */
export interface FindingSeed { documentId: string; page: number | null; text: string }

const RESTRICTED = new Set(["MEDICATION", "INCIDENTS", "BODY_MAP"]);
const SINGLE = (d: string) => d.startsWith("person.") || d.startsWith("package.") || d === "preference.gender" || d === "careplan.summary" || d === "medication.arrangement";
/** Fields that say who the person is: a disagreement here stops a new person being created. */
export const IDENTITY_FIELDS = new Set(["person.firstName", "person.lastName", "person.dateOfBirth", "person.nhsNumber"]);
const TAB: Record<string, string> = { PERSONAL: "details", CONTACTS: "people", CARER_PREFERENCES: "details", PACKAGE: "package", CARE_PLAN: "care-plans", RISKS: "risks", MEDICATION: "medication", INCIDENTS: "incidents", BODY_MAP: "bodymap", VISITS: "template", CALL_NOTES: "call-notes" };
export const recordTabFor = (section: string, destination?: string) => (destination === "externalReference" ? "references" : (TAB[section] ?? null));

const SCANNED = /^Page \d+ is scanned, so the quote could not be checked\./;
const QUOTE_MISSING = /The quote was not found on page/;
const TEMPORARY = /temporary but gives no end date/;
const OTHER_PROFILE = /already on another person's profile/;
const ON_THIS_PROFILE = /Already on this person's Reference Numbers tab/;
const OTHER_TYPE = /recorded elsewhere as a different type or issuer/;

// ── Safety ────────────────────────────────────────────────────────────────

const NEGATED = /\b(no|nil|none|denies|without)\b[^.]{0,40}\b(safeguarding|abuse|concerns?)\b|\bno (known |current |active )?(safeguarding|concerns)\b/i;
const SAFEGUARDING = /\b(safeguarding (concern|alert|referral|enquiry|investigation)|section 42|abus(e|ed|ive)|exploit(ed|ation)|assault(ed)?|domestic (violence|abuse)|coercive|financial abuse|modern slavery|unexplained (bruis|injur))/i;
const DNACPR = /\b(DNACPR|DNAR|do not (attempt )?resuscitat|ReSPECT form)\b/i;

/** What a fact or a flag says about safety: URGENT safeguarding, a DNACPR mention to verify, or nothing. */
export function safetyOf(text: string, temporal: string): ExceptionSeed | null {
  if (!text.trim()) return null;
  if (SAFEGUARDING.test(text) && !NEGATED.test(text)) {
    const past = temporal === "HISTORICAL";
    return {
      severity: past ? "REVIEW" : "URGENT",
      category: "SAFEGUARDING",
      title: past ? "Past safeguarding matter in the documents" : "Possible safeguarding concern",
      description: past
        ? `The documents describe a past safeguarding matter: "${clip(text)}". CSB AI has not recorded that abuse occurred. A manager checks whether anything is still open.`
        : `The documents describe a possible safeguarding concern: "${clip(text)}". CSB AI has not recorded that abuse occurred and has not raised a safeguarding alert. A manager must decide the safeguarding action today.`,
      recordTab: "incidents",
      restricted: true,
    };
  }
  if (DNACPR.test(text)) {
    return { severity: "REVIEW", category: "DNACPR", title: "DNACPR mentioned, not verified", description: `The documents mention resuscitation wishes: "${clip(text)}". No DNACPR status has been recorded: it is recorded only after the official signed form is seen.`, recordTab: "care-plans", restricted: true };
  }
  return null;
}

// ── Duplicates ─────────────────────────────────────────────────────────────

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Two facts with the same key say the same thing; the later one is consolidated into the earlier one. */
export function factKey(f: Pick<TriageFact, "destination" | "value">): string {
  const v = (f.value ?? {}) as Record<string, unknown>;
  switch (f.destination) {
    case "contact": return `contact|${norm(v.name)}|${digits(v.phone) || norm(v.kind)}`;
    case "visit": return `visit|${[...((v.weekdays as number[]) ?? [])].sort().join(",")}|${String(v.startTime)}|${String(v.durationMin)}|${String(v.carers)}|${String(v.fundedBy)}`;
    case "externalReference": return `ref|${String(v.type)}|${norm(v.value).replace(/ /g, "")}`;
    case "risk": return `risk|${String(v.type)}|${norm(v.title)}`;
    case "medication.item": return `med|${norm(v.name)}|${norm(v.strength)}|${norm(v.dose)}`;
    case "callnote": return `call|${norm(v.summary)}`;
    default:
      if (f.destination.startsWith("careplan.") && f.destination !== "careplan.summary") return `${f.destination}|${norm([v.canDo, v.support, v.how, v.preferences, v.outcome].filter(Boolean).join(" "))}`;
      if (f.destination === "person.nhsNumber" || f.destination === "person.phone") return `${f.destination}|${digits(f.value)}`;
      return `${f.destination}|${norm(typeof f.value === "object" ? JSON.stringify(f.value) : f.value)}`;
  }
}

/**
 * How complete a risk fact is. A completed assessment (a stated level and controls, as a council risk assessment has)
 * outranks the same risk described in a plan's narrative, so the assessment is the one saved when both say it.
 */
export function riskCompleteness(value: unknown): number {
  const v = (value ?? {}) as { level?: unknown; levelIsProvisional?: unknown; existingControls?: unknown };
  return (v.level && v.levelIsProvisional === false ? 2 : 0) + (typeof v.existingControls === "string" && v.existingControls.trim() ? 1 : 0);
}

/** Values that disagree for a field that holds one value: same destination, different key. */
function rivals(f: TriageFact, live: TriageFact[]) {
  const k = factKey(f);
  return live.filter((o) => o.id !== f.id && o.destination === f.destination && factKey(o) !== k);
}

// ── The triage ─────────────────────────────────────────────────────────────

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const where = (f: TriageFact, docs: Map<string, TriageDoc>) => `${f.sourceDocumentId ? (docs.get(f.sourceDocumentId)?.name ?? "document") : "added by hand"}${f.sourcePage ? `, page ${f.sourcePage}` : ""}`;

/** A risk read from a document filed as a risk assessment. */
const riskSaved = (f: TriageFact, docs: Map<string, TriageDoc>) => f.section === "RISKS" && !!f.sourceDocumentId && !!docs.get(f.sourceDocumentId)?.riskAssessment;

export function display(f: Pick<TriageFact, "destination" | "value">): string {
  const v = f.value as Record<string, unknown> | null;
  if (v && typeof v === "object") {
    if (f.destination === "contact") return [v.name, v.phone].filter(Boolean).join(", ");
    if (f.destination === "visit") return `${String(v.startTime)} for ${String(v.durationMin)} min, ${String(v.carers)} carer${v.carers === 1 ? "" : "s"}`;
    if (f.destination === "externalReference") return String(v.value);
    if (typeof v.summary === "string") return v.summary;
    if (typeof v.title === "string") return v.title;
    if (typeof v.name === "string") return v.name;
    return JSON.stringify(v);
  }
  if (f.destination === "package.minutesPerWeek") return `${Math.round((Number(f.value) / 60) * 100) / 100} hours a week`;
  return String(f.value);
}

/** Every text in a fact worth checking for safety: its value and the words it was read from. */
const textOf = (f: TriageFact) => [typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? ""), f.quote ?? ""].join(" ");

/**
 * Sorts the facts of one intake. Only facts still waiting (PENDING, or CLARIFY with a person's question) and not yet
 * saved get an outcome; people's decisions are never changed.
 */
export function triage(input: { mode: string; facts: TriageFact[]; docs: TriageDoc[] }): Outcome[] {
  const docs = new Map(input.docs.map((d) => [d.id, d]));
  const settled = (f: TriageFact) => f.decision === "REJECTED" || f.decision === "DUPLICATE";
  const live = input.facts.filter((f) => !settled(f)).sort((a, b) => a.position - b.position);
  const out: Outcome[] = [];
  const consolidated = new Set<string>();
  const groupsRaised = new Set<string>();
  const dated = (f: TriageFact) => (f.sourceDocumentId ? (docs.get(f.sourceDocumentId)?.documentDate ?? null) : null);

  for (const f of live) {
    if (f.appliedAt || !(f.decision === "PENDING" || f.decision === "CLARIFY")) continue;
    const tab = recordTabFor(f.section, f.destination);
    const restricted = RESTRICTED.has(f.section) || !!(f.sourceDocumentId && docs.get(f.sourceDocumentId)?.sensitive);
    const conflict = f.conflict ?? "";
    const safety = safetyOf(textOf(f), f.temporal);

    // A person's open question stays theirs.
    if (f.decision === "CLARIFY") {
      out.push({ factId: f.id, kind: "WAIT", identity: false, note: "A question was asked about this fact.", exception: { severity: "FOLLOW_UP", category: "QUESTION", title: `Question on ${f.label}`, description: `${f.question ? `Question asked: "${clip(f.question, 300)}". ` : ""}The fact (${clip(display(f))}) is not saved until it is answered.`, recordTab: tab, restricted } });
      continue;
    }

    // 1. The same information again: one record, linked to every source.
    const key = factKey(f);
    let earlier = live.find((o) => o.position < f.position && !consolidated.has(o.id) && factKey(o) === key && o.destination === f.destination);
    if (f.destination === "risk") {
      // The same risk in the plan and in a risk assessment: the most complete one is kept (the earliest of equals), so
      // a completed assessment is never consolidated into a narrative mention uploaded before it.
      const same = live.filter((o) => o.destination === "risk" && !consolidated.has(o.id) && factKey(o) === key && !(input.mode === "DOCUMENT" && !riskSaved(o, docs)));
      const best = same.reduce<TriageFact | undefined>((a, o) => (!a || riskCompleteness(o.value) > riskCompleteness(a.value) ? o : a), undefined);
      earlier = best && best.id !== f.id ? best : undefined;
    }
    if (earlier || ON_THIS_PROFILE.test(conflict)) {
      consolidated.add(f.id);
      out.push(earlier
        ? { factId: f.id, kind: "DUPLICATE", duplicateOf: earlier.id, note: `Consolidated by CSB AI: the same as ${where(earlier, docs)}. Kept once; both sources stay linked.` }
        : { factId: f.id, kind: "NOT_USED", note: "Not saved again by CSB AI: already on this person's Reference Numbers tab." });
      continue;
    }

    // 2. Supporting documents change nothing by themselves; only safety matters are raised. The exception is a risk
    //    assessment: its risks are what it is for, so they are saved like a plan's.
    if (input.mode === "DOCUMENT" && !riskSaved(f, docs)) {
      if (safety) out.push({ factId: f.id, kind: "WAIT", identity: false, note: "Supporting document: not applied automatically.", exception: safety });
      continue;
    }

    // 3. Historical details are kept on the intake, never saved as current.
    if (f.temporal === "HISTORICAL" && (f.destination.startsWith("person.") || f.destination.startsWith("package.") || f.destination === "visit")) {
      out.push({ factId: f.id, kind: "NOT_USED", note: "Not saved by CSB AI: the documents describe this as historical, so it is kept with the intake for reference and not recorded as current." });
      continue;
    }

    // 4. Words that cannot be found on a page that has text: a possible misreading.
    if (f.origin === "AI" && f.verification !== "VERIFIED" && QUOTE_MISSING.test(conflict)) {
      out.push({ factId: f.id, kind: "WAIT", identity: IDENTITY_FIELDS.has(f.destination), note: "The words were not found on the page.", exception: { severity: IDENTITY_FIELDS.has(f.destination) ? "REVIEW" : "FOLLOW_UP", category: "SOURCE_CHECK", title: `${f.label}: words not found on the page`, description: `CSB AI read "${clip(display(f))}" but could not find those words on ${where(f, docs)}. It was not saved. Compare with the original, then save it or leave it out.`, recordTab: tab, restricted } });
      continue;
    }

    // 5. A number already on someone else's profile, or recorded as another kind of number.
    if (f.destination === "externalReference" && (OTHER_PROFILE.test(conflict) || OTHER_TYPE.test(conflict))) {
      out.push({ factId: f.id, kind: "WAIT", identity: true, note: "Reference clash.", exception: { severity: "REVIEW", category: "REFERENCE", title: "Reference number already used elsewhere", description: `${f.label} (${display(f)}) is ${OTHER_PROFILE.test(conflict) ? "already on another person's profile" : "recorded elsewhere as a different kind of number"}. It was not linked. Check the identity before linking it.`, recordTab: "references", restricted } });
      continue;
    }
    if (f.destination === "externalReference" && (f.value as { typeUnclear?: boolean }).typeUnclear) {
      out.push({ factId: f.id, kind: "WAIT", identity: false, note: "Reference type unclear.", exception: { severity: "FOLLOW_UP", category: "REFERENCE", title: "Say what this Frameworki number is", description: `${display(f)} is labelled only as a Frameworki number (${where(f, docs)}). Choose whether it is the council client number, the package reference or the framework ID, and CSB AI saves it.`, recordTab: "references", restricted } });
      continue;
    }

    // 6. One field, different values.
    if (SINGLE(f.destination)) {
      const others = rivals(f, live);
      const chosen = others.find((o) => o.decision === "APPROVED" || o.decision === "EDITED");
      if (chosen) {
        out.push({ factId: f.id, kind: "NOT_USED", note: `Not saved by CSB AI: a person already chose "${clip(display(chosen), 60)}" for this field.` });
        continue;
      }
      if (others.length) {
        const mine = dated(f);
        const theirs = others.map(dated);
        const newestOther = theirs.every((d) => !!d) ? theirs.reduce((a, b) => (a! > b! ? a : b)) : null;
        const allDated = !!mine && theirs.every((d) => !!d);
        if (!IDENTITY_FIELDS.has(f.destination) && allDated && newestOther && mine! < newestOther) {
          out.push({ factId: f.id, kind: "NOT_USED", note: `Not saved by CSB AI: a newer document (${newestOther}) gives a different value, so this older one is kept for reference only.` });
          continue;
        }
        if (!IDENTITY_FIELDS.has(f.destination) && allDated && newestOther && mine! > newestOther) {
          out.push({ factId: f.id, kind: "ROUTINE", note: `Saved by CSB AI from the newest document (${mine}); an older document gave a different value, which is kept for reference.` });
          continue;
        }
        const group = `single|${f.destination}`;
        const first = !groupsRaised.has(group);
        groupsRaised.add(group);
        const identity = IDENTITY_FIELDS.has(f.destination);
        const values = [f, ...others].map((o) => `"${clip(display(o), 60)}" (${where(o, docs)})`).join(", ");
        out.push({
          factId: f.id, kind: "WAIT", identity, note: "Different values in the documents.",
          exception: first ? { severity: "REVIEW", category: identity ? "IDENTITY" : "CONFLICT", title: identity ? `Two different values for ${f.label.toLowerCase()}` : `${f.label} differs between documents`, description: `The documents disagree: ${values}. ${identity ? "The person's identity must be settled before CSB AI saves this." : "Nothing was saved for this field."} Choose the right value.`, recordTab: tab, restricted } : null,
        });
        continue;
      }
    }

    // 7. Updating someone already on record.
    if (input.mode === "EXISTING") {
      if ((f.section === "PACKAGE" || f.section === "VISITS")) {
        const group = `existing|${f.section}`;
        const first = !groupsRaised.has(group);
        groupsRaised.add(group);
        out.push({ factId: f.id, kind: "WAIT", identity: false, note: "Proposed change to care already arranged.", exception: first ? { severity: "REVIEW", category: "PROPOSED_CHANGE", title: f.section === "PACKAGE" ? "Proposed change to the care package" : "Proposed change to the visits", description: `The revised document proposes changes to ${f.section === "PACKAGE" ? "the care package" : "the repeating visits"}. CSB AI does not change care already arranged or published visits by itself. Review the proposed changes, then save the ones that are right.`, recordTab: tab, restricted: false } : null });
        continue;
      }
      const existing = f.existingValue;
      if (existing !== null && existing !== undefined && existing !== "" && IDENTITY_FIELDS.has(f.destination)) {
        out.push({ factId: f.id, kind: "WAIT", identity: true, note: "Differs from the record.", exception: { severity: "REVIEW", category: "IDENTITY", title: `${f.label} differs from the record`, description: `The record says "${clip(String(existing), 60)}"; ${where(f, docs)} says "${clip(display(f), 60)}". Identity details are never changed automatically.`, recordTab: tab, restricted } });
        continue;
      }
    }

    // 8. Two visit rows at the same time that are not the same visit.
    if (f.destination === "visit" && /Another visit row starts at the same time/.test(conflict)) {
      const group = `visit-clash|${(f.value as { startTime: string }).startTime}`;
      const first = !groupsRaised.has(group);
      groupsRaised.add(group);
      out.push({ factId: f.id, kind: "WAIT", identity: false, note: "Two different visits at the same time.", exception: first ? { severity: "REVIEW", category: "SCHEDULE", title: `Two different visits at ${(f.value as { startTime: string }).startTime}`, description: `Two timetable rows start at the same time on the same day but differ (${clip(display(f))}). CSB AI did not schedule either. Choose the right one.`, recordTab: "template", restricted: false } : null });
      continue;
    }

    // 9. Routine: saved by CSB AI, with a follow-up when there is something genuinely worth confirming.
    let follow: ExceptionSeed | undefined;
    if (f.destination === "visit" && TEMPORARY.test(conflict)) follow = { severity: "FOLLOW_UP", category: "SCHEDULE", title: "Temporary visit without an end date", description: `${f.label} at ${(f.value as { startTime: string }).startTime} is temporary in the documents but has no end date (${where(f, docs)}). It was set up as a repeating visit; confirm the end date with the commissioner.`, recordTab: "template", restricted: false };
    const note = RESTRICTED.has(f.section)
      ? `Routed by CSB AI to the ${f.section === "MEDICATION" ? "medication reconciliation list" : "history to check"}: nothing is given to carers or recorded as current until an authorised person checks it.`
      : SCANNED.test(conflict)
        ? "Saved by CSB AI from a scanned page: the words could not be matched to text automatically. The original is filed with the record."
        : "Saved by CSB AI: the words were found on the page and nothing contradicts them.";
    out.push({ factId: f.id, kind: "ROUTINE", note, exception: safety ?? follow });
  }
  return out;
}

/** The severity of an exception, for items made before severities existed too. */
export function exceptionSeverity(item: { severity: string | null; category: string }): Severity {
  if (item.severity && (SEVERITY_ORDER as string[]).includes(item.severity)) return item.severity as Severity;
  switch (item.category) {
    case "SAFEGUARDING": return "URGENT";
    case "PACKAGE_HOURS": case "MEDICATION": case "IDENTITY": case "CONFLICT": return "REVIEW";
    default: return "FOLLOW_UP";
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  FUNDING: "Funding to verify", PACKAGE_HOURS: "Commissioned hours", MEDICATION: "Medication reconciliation", INCIDENT_HISTORY: "Incident history", BODY_MAP: "Skin finding to check",
  MISSING_INFO: "Missing information", VISIT_TASKS: "Visit tasks", SAFEGUARDING: "Safeguarding", DNACPR: "Resuscitation wishes", IDENTITY: "Identity", CONFLICT: "Conflicting information",
  SOURCE_CHECK: "Check against the original", REFERENCE: "Reference number", PROPOSED_CHANGE: "Proposed change", SCHEDULE: "Visit schedule", QUESTION: "Question", SETUP: "Setup problem", MANAGER_FIELD: "Needs a registered manager", RISK_LEVEL: "Risk level to set",
};

/** Safety flags the reader raised on a page (not tied to a fact). */
export function safetyFromFindings(findings: FindingSeed[]): (ExceptionSeed & { documentId: string; page: number | null })[] {
  const out: (ExceptionSeed & { documentId: string; page: number | null })[] = [];
  for (const f of findings) {
    const s = safetyOf(f.text, /\b(previous|historic|in \d{4}|years? ago|past)\b/i.test(f.text) ? "HISTORICAL" : "CURRENT");
    if (s) out.push({ ...s, documentId: f.documentId, page: f.page });
  }
  return out;
}
