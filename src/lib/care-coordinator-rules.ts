import { z } from "zod";
import { hhmm, isIsoDate, parseHhmm, WEEKDAYS } from "@/lib/london";
import { FUNDED_BY, hoursToMinutes, weeklyTotals, type FundedBy } from "@/lib/su-import-rules";
import { findFrameworki, frameworkiReferences, issuerShort } from "@/lib/reference-numbers";

/**
 * AI Care Coordinator: pure rules shared by the server and the review screen (no database, no secrets).
 *
 * Every fact read from a document has a profile SECTION (the Service User profile area it belongs to) and an exact
 * DESTINATION (the field or record type it becomes). Values are validated per destination before anything is saved.
 */

export const INTAKE_SECTIONS = [
  { key: "PERSONAL", label: "Personal details", profile: "Personal Details", restricted: false },
  { key: "CONTACTS", label: "Contacts", profile: "Contacts → Contact", restricted: false },
  { key: "CARER_PREFERENCES", label: "Carer preferences", profile: "Contacts → Carer Preferences & Carers", restricted: false },
  { key: "CARE_PLAN", label: "Care plan", profile: "Care → Care Plans (draft)", restricted: false },
  { key: "RISKS", label: "Risk assessments", profile: "Care → Risk Assessments (drafts)", restricted: false },
  { key: "PACKAGE", label: "Care package", profile: "Care → Care Package", restricted: false },
  { key: "VISITS", label: "Visits and tasks", profile: "Visits → Template", restricted: false },
  { key: "MEDICATION", label: "Medication", profile: "Care → Medication (reconciliation)", restricted: true },
  { key: "INCIDENTS", label: "Incident history", profile: "Health and Safety → Incidents (history only)", restricted: true },
  { key: "BODY_MAP", label: "Skin and body map", profile: "Health and Safety → Body Map (review only)", restricted: true },
  { key: "CALL_NOTES", label: "Call Notes", profile: "Call Notes (general communication only)", restricted: false },
] as const;
export type IntakeSection = (typeof INTAKE_SECTIONS)[number]["key"];
export const SECTION_KEYS = INTAKE_SECTIONS.map((s) => s.key) as [IntakeSection, ...IntakeSection[]];
export const sectionLabel = (k: string) => INTAKE_SECTIONS.find((s) => s.key === k)?.label ?? k;
export const sectionInfo = (k: string) => INTAKE_SECTIONS.find((s) => s.key === k);
/** Sections whose facts can come from clinical documents: shown only to people allowed to see sensitive records. */
export const RESTRICTED_SECTIONS = new Set<string>(INTAKE_SECTIONS.filter((s) => s.restricted).map((s) => s.key));
/** Personal details that only people with serviceUser.sensitive may see or save (as on the ordinary form). */
export const RESTRICTED_PERSON_FIELDS = new Set(["dateOfBirth", "nhsNumber"]);

/** The order sections are applied in: the person first, then everything that hangs off them, the rota last. */
export const APPLY_ORDER: IntakeSection[] = ["PERSONAL", "CONTACTS", "CARER_PREFERENCES", "PACKAGE", "CARE_PLAN", "RISKS", "MEDICATION", "INCIDENTS", "BODY_MAP", "VISITS", "CALL_NOTES"];

export const DECISIONS = { PENDING: "To review", APPROVED: "Approved", EDITED: "Edited and approved", REJECTED: "Rejected", CLARIFY: "Needs clarification", DUPLICATE: "Duplicate" } as const;
export type Decision = keyof typeof DECISIONS;
/** Facts that will be saved when their section is applied. */
export const ACCEPTED = new Set<string>(["APPROVED", "EDITED"]);
/** Facts that still need the coordinator before the intake can go to a manager. */
export const OPEN_DECISIONS = new Set<string>(["PENDING", "CLARIFY"]);

export const SECTION_STATUS = { OPEN: "Waiting for manager", APPROVED: "Approved", RETURNED: "Returned for correction", REJECTED: "Rejected", INFO_REQUESTED: "More information requested", DRAFTED: "Saved as drafts by the AI CSB Coordinator" } as const;
export const APPLY_STATUS = { NOT_STARTED: "Not saved yet", DONE: "Saved to record", FAILED: "Failed, can be retried", BLOCKED: "Blocked" } as const;
export const INTAKE_STATUS = { DRAFT: "Coordinator review", SUBMITTED: "Waiting for manager", APPROVED: "Approved, ready to save", APPLYING: "Saving to record", COMPLETED: "Completed", CANCELLED: "Cancelled" } as const;

// ── Values per destination ────────────────────────────────────────────────

const s = (max: number) => z.string().trim().min(1, "Enter a value").max(max);
const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const isoDate = z.string().trim().refine((v) => realDate(v), "Use a real date (YYYY-MM-DD)");
const optDate = z.string().trim().nullish().transform((v) => v || null).refine((v) => v === null || realDate(v), "Use a real date (YYYY-MM-DD)");

export const PERSON_FIELDS = {
  firstName: { label: "First name", schema: s(100) },
  lastName: { label: "Last name", schema: s(100) },
  preferredName: { label: "Preferred name", schema: s(100) },
  dateOfBirth: { label: "Date of birth", schema: isoDate },
  gender: { label: "Gender", schema: s(40) },
  nhsNumber: { label: "NHS number", schema: z.string().trim().transform((v) => v.replace(/\s/g, "")).refine((v) => /^\d{10}$/.test(v), "An NHS number has 10 digits") },
  addressLine1: { label: "Address line 1", schema: s(200) },
  addressLine2: { label: "Address line 2", schema: s(200) },
  town: { label: "Town", schema: s(100) },
  postcode: { label: "Postcode", schema: s(10) },
  phone: { label: "Phone", schema: s(40) },
  altPhone: { label: "Second phone", schema: s(40) },
  email: { label: "Email", schema: z.string().trim().email("Enter a valid email").max(200) },
  firstLanguage: { label: "Preferred language", schema: s(80) },
  communicationNeeds: { label: "Communication needs", schema: s(2000) },
  accessNotes: { label: "Access instructions", schema: s(2000) },
  carePreferences: { label: "Personal preferences", schema: s(2000) },
} as const;
export type PersonField = keyof typeof PERSON_FIELDS;

export const EXTERNAL_REFERENCE_TYPES = ["NHS", "COUNCIL_CLIENT", "COUNCIL_FRAMEWORK", "COUNCIL_PACKAGE", "OTHER_EXTERNAL"] as const;
export const externalReferenceValue = z.object({
  type:z.enum(EXTERNAL_REFERENCE_TYPES),
  issuer:s(180),
  value:s(120),
  /** The council system or label printed with the number, e.g. "Frameworki". */
  system:opt(80).optional(),
  /** Set by a reader when the words around the number do not say what it identifies. Cleared when a person edits it. */
  typeUnclear:z.literal(true).optional(),
}).strict();
export const EXTERNAL_REFERENCE_LABEL: Record<(typeof EXTERNAL_REFERENCE_TYPES)[number], string> = { NHS: "NHS number", COUNCIL_CLIENT: "Council client number", COUNCIL_FRAMEWORK: "Council framework / contract ID", COUNCIL_PACKAGE: "Council package reference", OTHER_EXTERNAL: "Other reference" };
export const CONTACT_KINDS = ["NEXT_OF_KIN", "FAMILY", "GP", "PHARMACY", "SOCIAL_WORKER", "DISTRICT_NURSE", "OTHER"] as const;
export const CONTACT_KIND_LABEL: Record<(typeof CONTACT_KINDS)[number], string> = { NEXT_OF_KIN: "Next of kin", FAMILY: "Family", GP: "GP", PHARMACY: "Pharmacy", SOCIAL_WORKER: "Social worker", DISTRICT_NURSE: "District nurse", OTHER: "Other professional" };
export const contactValue = z.object({
  kind: z.enum(CONTACT_KINDS),
  name: s(200),
  relationship: opt(200),
  phone: opt(40),
  email: opt(200),
  address: opt(500),
  isEmergency: z.boolean().default(false),
  isKeyHolder: z.boolean().default(false),
  /** Documented authority, as written. Kept in notes for a manager to verify; never sets a legal authority. */
  authority: opt(300),
});

export const PLAN_SECTION_KEYS = ["about_me", "communication", "personal_care", "mobility", "nutrition", "medication", "health", "home", "outcomes"] as const;
export const PLAN_SECTION_LABEL: Record<(typeof PLAN_SECTION_KEYS)[number], string> = { about_me: "About me", communication: "Communication", personal_care: "Personal care", mobility: "Mobility and moving", nutrition: "Eating and drinking", medication: "Medication support", health: "Health and wellbeing", home: "Home and safety", outcomes: "Outcomes" };
/**
 * The care plan topics a support plan is read into (brief of 6 Nov 2026). Each lands in one of the nine sections of
 * the existing care plan, under its own heading, so the CRM's care plan screens stay as they are.
 */
export const CARE_PLAN_TOPICS = {
  ABOUT_ME: { label: "About me", section: "about_me" },
  DAILY_ROUTINE: { label: "Daily routine", section: "about_me" },
  INDEPENDENCE_CHOICE: { label: "Independence and personal choice", section: "about_me" },
  CULTURE_RELIGION: { label: "Cultural and religious preferences", section: "about_me" },
  COMMUNITY: { label: "Community activities", section: "about_me" },
  COMMUNICATION: { label: "Communication", section: "communication" },
  COGNITION_MEMORY: { label: "Cognition and memory", section: "communication" },
  PERSONAL_CARE: { label: "Personal care", section: "personal_care" },
  WASHING_DRESSING: { label: "Washing and dressing", section: "personal_care" },
  TOILETING_CONTINENCE: { label: "Toileting and continence", section: "personal_care" },
  MOBILITY_TRANSFERS: { label: "Mobility and transfers", section: "mobility" },
  EATING_DRINKING: { label: "Eating and drinking", section: "nutrition" },
  NUTRITION_HYDRATION: { label: "Nutrition and hydration", section: "nutrition" },
  MEDICATION_SUPPORT: { label: "Medication support arrangements", section: "medication" },
  HEALTH_CONDITIONS: { label: "Documented long-term conditions", section: "health" },
  EMOTIONAL_WELLBEING: { label: "Emotional wellbeing", section: "health" },
  SLEEP_NIGHT: { label: "Sleep and night support", section: "health" },
  HOUSEHOLD: { label: "Support with household tasks", section: "home" },
  HOME_SAFETY: { label: "Home and safety", section: "home" },
  EMERGENCY: { label: "Emergency considerations", section: "home" },
  OUTCOMES: { label: "Outcomes and goals", section: "outcomes" },
} as const satisfies Record<string, { label: string; section: (typeof PLAN_SECTION_KEYS)[number] }>;
export type CarePlanTopic = keyof typeof CARE_PLAN_TOPICS;
export const CARE_PLAN_TOPIC_KEYS = Object.keys(CARE_PLAN_TOPICS) as [CarePlanTopic, ...CarePlanTopic[]];

export const planValue = z.object({
  topic: z.enum(CARE_PLAN_TOPIC_KEYS).nullish().transform((v) => v ?? null),
  canDo: opt(4000),
  support: opt(4000),
  how: opt(4000),
  preferences: opt(2000),
  outcome: opt(2000),
  clarify: opt(2000),
}).refine((v) => !!(v.canDo || v.support || v.how || v.preferences || v.outcome || v.clarify), "Write at least one part of this care plan entry");

export const RISK_TYPES = ["ENVIRONMENT", "MOVING_HANDLING", "FALLS", "PRESSURE_SKIN", "MEDICATION_SUPPORT", "NUTRITION", "LONE_WORKING", "OTHER"] as const;
export const riskValue = z.object({
  type: z.enum(RISK_TYPES),
  title: z.string().trim().min(3, "Give the risk a title").max(160),
  hazard: z.string().trim().min(10, "Describe the hazard and possible harm (at least a sentence)").max(4000),
  whoAffected: opt(500),
  existingControls: opt(4000),
  recommendedActions: opt(4000),
  responsiblePerson: opt(160),
  /** Only what the document states, or a provisional level the coordinator chose and labelled as such. */
  level: z.enum(["LOW", "MEDIUM", "HIGH"]).nullish().transform((v) => v ?? null),
  levelIsProvisional: z.boolean().default(true),
  reviewDue: optDate,
  openQuestions: opt(2000),
});

/** Follow-up (review item) categories and how they read on screen. FUNDING and PACKAGE_HOURS belong to the care
 *  package; the rest stay on the intake and the person's restricted records. */
export const FOLLOW_UP_LABEL: Record<string, string> = {
  MEDICATION: "Medication to reconcile",
  INCIDENT_HISTORY: "Incident history",
  BODY_MAP: "Skin and body map history",
  MISSING_INFO: "Missing or informal",
  FUNDING: "Funding to verify",
  PACKAGE_HOURS: "Commissioned hours to check",
};

export const PACKAGE_FIELDS = {
  funder: { label: "Commissioning authority / funder", schema: s(160) },
  reference: { label: "Package or purchase order reference", schema: s(80) },
  startDate: { label: "Package start date", schema: isoDate },
  endDate: { label: "Package end date", schema: isoDate },
  minutesPerWeek: { label: "Authorised minutes per week", schema: z.coerce.number().int().min(0).max(20160) },
  /** Only how the commissioned care is staffed and delivered. Clinical, medication, family and funding notes go to
   *  their own sections or the document's flags, never into the package text. */
  requirements: { label: "Staffing and support instructions", schema: s(2000) },
} as const;
export type PackageField = keyof typeof PACKAGE_FIELDS;

export const visitValue = z.object({
  label: s(80),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Choose at least one day").transform((d) => [...new Set(d)].sort()),
  startTime: z.string().trim().refine((v) => parseHhmm(v) !== null, "Give the start time as HH:MM"),
  durationMin: z.coerce.number().int().min(5, "A visit lasts at least 5 minutes").max(1440),
  carers: z.coerce.number().int().min(1).max(20),
  tasks: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  fundedBy: z.enum(["COUNCIL", "CARERS_SERVICE", "OTHER"]).default("COUNCIL"),
  medicationPrompt: z.boolean().default(false),
  /** The kind of visit as written (e.g. personal care, sitting service, domestic). */
  visitType: opt(80),
  /** Special instructions for this visit, as written in the document. */
  instructions: opt(1000),
  /** The document says the visit is temporary. */
  temporary: z.boolean().default(false),
  effectiveFrom: optDate,
  effectiveTo: optDate,
  callTypeId: opt(40),
}).refine((v) => !v.effectiveFrom || !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, "The end date is before the start date");

export const MED_SUPPORT = { SELF: "Self-administers", PROMPT: "Prompting only", ASSIST: "Assistance", ADMINISTER: "Staff administer", UNKNOWN: "Not clear from the documents" } as const;
export const medArrangementValue = z.object({ support: z.enum(["SELF", "PROMPT", "ASSIST", "ADMINISTER", "UNKNOWN"]), detail: s(2000) });
export const medItemValue = z.object({
  name: s(200),
  strength: opt(80),
  dose: opt(200),
  route: opt(80),
  frequency: opt(200),
  times: z.array(z.string().trim().max(40)).max(8).default([]),
  asRequired: z.boolean().default(false),
  prnInstructions: opt(1000),
  status: z.enum(["CURRENT", "STOPPED", "WITHHELD", "TEMPORARY", "CHANGED"]).default("CURRENT"),
  note: opt(1000),
});
export const incidentValue = z.object({ date: optDate, type: s(120), description: s(4000), consequences: opt(2000), actions: opt(2000) });
export const skinValue = z.object({ date: optDate, area: opt(120), finding: s(120), description: s(4000) });
/** General communication found in a document or typed from a meeting: becomes an approved Call Note, nothing else. */
export const callNoteValue = z.object({
  summary: s(2000),
  contactName: opt(200),
  method: z.enum(["TELEPHONE", "FACE_TO_FACE", "EMAIL", "MEETING", "VIDEO", "OTHER"]).nullish().transform((v) => v ?? "OTHER"),
  date: optDate,
});

/** Every destination a fact may have. Anything else is refused. */
export function destinationSchema(destination: string): { section: IntakeSection; label: string; schema: z.ZodTypeAny } | null {
  const [head, key] = destination.split(".", 2) as [string, string | undefined];
  if (head === "person" && key && key in PERSON_FIELDS) return { section: "PERSONAL", label: PERSON_FIELDS[key as PersonField].label, schema: PERSON_FIELDS[key as PersonField].schema };
  if (destination === "externalReference") return { section: "PERSONAL", label: "External client reference", schema: externalReferenceValue };
  if (destination === "contact") return { section: "CONTACTS", label: "Contact", schema: contactValue };
  if (destination === "preference.gender") return { section: "CARER_PREFERENCES", label: "Care-worker gender preference", schema: z.enum(["ANY", "FEMALE", "MALE"]) };
  if (destination === "preference.note") return { section: "CARER_PREFERENCES", label: "Carer preference", schema: s(1000) };
  if (head === "careplan" && key === "summary") return { section: "CARE_PLAN", label: "Care plan summary", schema: s(2000) };
  if (head === "careplan" && key && (PLAN_SECTION_KEYS as readonly string[]).includes(key)) return { section: "CARE_PLAN", label: PLAN_SECTION_LABEL[key as keyof typeof PLAN_SECTION_LABEL], schema: planValue };
  if (destination === "risk") return { section: "RISKS", label: "Risk assessment draft", schema: riskValue };
  if (head === "package" && key && key in PACKAGE_FIELDS) return { section: "PACKAGE", label: PACKAGE_FIELDS[key as PackageField].label, schema: PACKAGE_FIELDS[key as PackageField].schema };
  if (destination === "visit") return { section: "VISITS", label: "Recurring visit", schema: visitValue };
  if (destination === "medication.arrangement") return { section: "MEDICATION", label: "Medication support arrangement", schema: medArrangementValue };
  if (destination === "medication.item") return { section: "MEDICATION", label: "Medicine", schema: medItemValue };
  if (destination === "medication.allergy") return { section: "MEDICATION", label: "Allergy", schema: s(300) };
  if (destination === "incident.history") return { section: "INCIDENTS", label: "Historical incident", schema: incidentValue };
  if (destination === "bodymap.history") return { section: "BODY_MAP", label: "Documented skin finding", schema: skinValue };
  if (destination === "callnote") return { section: "CALL_NOTES", label: "Call Note", schema: callNoteValue };
  return null;
}

/** The exact profile field or record a destination is saved to, as shown to the coordinator. */
export function destinationField(destination: string): string {
  const [head, key] = destination.split(".", 2);
  if (head === "person") return `ServiceUser.${key}`;
  if (destination === "externalReference") return "ServiceUserExternalReference (source-linked, unverified)";
  if (destination === "contact") return "ServiceUserContact (new contact)";
  if (destination === "preference.gender") return "ServiceUser.carerGenderPreference";
  if (destination === "preference.note") return "ServiceUser.carePreferences";
  if (head === "careplan") return key === "summary" ? "CarePlan.summary (draft)" : `CarePlanSection "${PLAN_SECTION_LABEL[key as keyof typeof PLAN_SECTION_LABEL] ?? key}" (draft)`;
  if (destination === "risk") return "RiskAssessment (status DRAFT)";
  if (head === "package") return { funder: "Funding check for finance (not linked)", reference: "CarePackage.reference", startDate: "CarePackage.startDate", endDate: "CarePackage.endDate", minutesPerWeek: "CarePackage.commissionedMinutesPerWeek", requirements: "CarePackage.requirements" }[key ?? ""] ?? destination;
  if (destination === "visit") return "VisitTemplate + care tasks";
  if (head === "medication") return "Medication reconciliation queue (DRAFT medicine only after checks)";
  if (destination === "incident.history") return "Incident history review item (no new incident)";
  if (destination === "bodymap.history") return "Body map review item (no new observation)";
  if (destination === "callnote") return "CallNote (approved, linked to this intake)";
  return destination;
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };
export function parseValue(destination: string, raw: unknown): ParsedValue {
  const d = destinationSchema(destination);
  if (!d) return { ok: false, error: "This destination is not part of the Service User profile" };
  const r = d.schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "Check the value" };
}

/** One line a person can read, for any destination's value. */
export function displayValue(destination: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const o = v as Record<string, unknown>;
  const join = (...parts: unknown[]) => parts.filter((p) => p !== null && p !== undefined && p !== "" && p !== false).join(" · ");
  switch (destination) {
    case "externalReference": return join(o.typeUnclear ? "Type to confirm" : (EXTERNAL_REFERENCE_LABEL[o.type as keyof typeof EXTERNAL_REFERENCE_LABEL] ?? o.type), o.system, o.value, o.issuer ? `issued by ${o.issuer}` : null, o.type === "COUNCIL_FRAMEWORK" && !o.typeUnclear ? "Shared contract ID, not proof of identity" : null);
    case "contact": return join(CONTACT_KIND_LABEL[o.kind as keyof typeof CONTACT_KIND_LABEL] ?? o.kind, o.name, o.relationship, o.phone, o.email, o.isEmergency ? "Emergency contact" : null, o.isKeyHolder ? "Key holder" : null, o.authority ? `Authority as written: ${o.authority}` : null);
    case "risk": return join(o.title, o.level ? `${o.level}${o.levelIsProvisional ? " (provisional)" : ""}` : "Level not set", o.hazard, o.existingControls ? `In place: ${o.existingControls}` : null, o.recommendedActions ? `Mitigation: ${o.recommendedActions}` : null, o.openQuestions ? String(o.openQuestions) : null);
    case "visit": {
      const st = parseHhmm(String(o.startTime ?? ""));
      const end = st === null ? "" : hhmm((st + Number(o.durationMin ?? 0)) % 1440);
      return join(o.label, o.visitType, `${o.startTime}–${end}`, `${o.durationMin} min`, dayList((o.weekdays as number[]) ?? []), `${o.carers} carer${Number(o.carers) > 1 ? "s" : ""}`, o.fundedBy !== "COUNCIL" ? FUNDED_BY[o.fundedBy as FundedBy] : null, o.temporary ? (o.effectiveTo ? `Temporary, until ${o.effectiveTo}` : "Temporary") : null, o.effectiveFrom ? `From ${o.effectiveFrom}` : null, ((o.tasks as string[]) ?? []).length ? `${(o.tasks as string[]).length} tasks` : null, o.instructions ? `Instructions: ${o.instructions}` : null);
    }
    case "medication.arrangement": return join(MED_SUPPORT[o.support as keyof typeof MED_SUPPORT], o.detail);
    case "medication.item": return join(o.name, o.strength, o.dose, o.route, o.frequency, o.asRequired ? "As required (PRN)" : null, o.status !== "CURRENT" ? String(o.status).toLowerCase() : null);
    case "incident.history": return join(o.date, o.type, o.description);
    case "bodymap.history": return join(o.date, o.area, o.finding, o.description);
    case "callnote": return join(o.date, o.contactName ? `With ${o.contactName}` : null, o.summary);
    default:
      if (destination.startsWith("careplan.")) return join(o.canDo ? `Can do: ${o.canDo}` : null, o.support ? `Needs: ${o.support}` : null, o.how ? `How: ${o.how}` : null, o.preferences ? `Preferences: ${o.preferences}` : null, o.outcome ? `Outcome: ${o.outcome}` : null, o.clarify ? `To clarify: ${o.clarify}` : null);
      return JSON.stringify(v);
  }
}

export function dayList(days: number[]) {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "Every day";
  if (d.join() === "1,2,3,4,5") return "Mon–Fri";
  return d.map((n) => WEEKDAYS[n - 1]?.slice(0, 3)).join(", ");
}

// ── Commissioned hours ─────────────────────────────────────────────────────

/** Weekly minutes of the approved visit rows against the authorised package. Differences are flagged, never adjusted. */
export function reconcileHours(visits: { weekdays: number[]; durationMin: number; carers: number; fundedBy: FundedBy }[], authorisedMinutes: number | null) {
  const t = weeklyTotals(visits);
  const gap = authorisedMinutes === null ? null : t.COUNCIL - authorisedMinutes;
  const message =
    authorisedMinutes === null ? "No authorised weekly hours have been approved yet, so the visits cannot be checked against the package."
    : gap === 0 ? `Commissioned visits add up to the authorised ${authorisedMinutes} minutes a week.`
    : `Commissioned visits add up to ${t.COUNCIL} minutes a week but the package authorises ${authorisedMinutes}: ${Math.abs(gap!)} minutes ${gap! > 0 ? "over" : "short"}. A manager must resolve this with the commissioner; funded hours are never changed automatically.`;
  return { ...t, authorised: authorisedMinutes, gap, matches: gap === 0, message };
}

// ── Checking quotes against the page ───────────────────────────────────────

const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
/** True when the quote appears on the page (ignoring case, spacing and curly quotes). Scanned pages have no text. */
export function quoteOnPage(pageText: string | undefined, quote: string | null | undefined) {
  if (!pageText || !quote || norm(quote).length < 4) return false;
  return norm(pageText).includes(norm(quote));
}

// ── Classification ─────────────────────────────────────────────────────────

export type DocKind = "SUPPORT_PLAN" | "CARE_PLAN" | "RISK_ASSESSMENT" | "NEEDS_ASSESSMENT" | "REFERRAL" | "DISCHARGE_LETTER" | "GP_LETTER" | "CONSULTANT_LETTER" | "MEDICATION_LIST" | "THERAPY_REPORT" | "APPOINTMENT_LETTER" | "SAFEGUARDING" | "FAMILY_LETTER" | "PURCHASE_ORDER" | "OTHER";
export type IssuerKind = "COUNCIL" | "NHS" | "GP" | "FAMILY" | "OTHER";

/** Where a document is filed. Council-issued documents go to Council Documents; NHS and GP documents go to the
 *  restricted medical categories in Other Documents. */
export function filingFor(kind: DocKind, issuer: IssuerKind): { section: "COUNCIL" | "OTHER"; category: string } {
  if (issuer === "COUNCIL") {
    const council: Partial<Record<DocKind, string>> = { SUPPORT_PLAN: "COUNCIL_SUPPORT_PLAN", CARE_PLAN: "COUNCIL_CARE_PLAN", RISK_ASSESSMENT: "COUNCIL_RISK_ASSESSMENT", NEEDS_ASSESSMENT: "COUNCIL_NEEDS_ASSESSMENT", REFERRAL: "REFERRAL_FORM", MEDICATION_LIST: "COUNCIL_MEDICATION_LIST", THERAPY_REPORT: "COUNCIL_PROFESSIONAL_REPORT", PURCHASE_ORDER: "PURCHASE_ORDER", DISCHARGE_LETTER: "HOSPITAL_DISCHARGE" };
    return { section: "COUNCIL", category: council[kind] ?? "COUNCIL_CORRESPONDENCE" };
  }
  const other: Partial<Record<DocKind, string>> = { DISCHARGE_LETTER: "DISCHARGE_INFORMATION", GP_LETTER: "GP_CORRESPONDENCE", CONSULTANT_LETTER: "MEDICAL_LETTER", APPOINTMENT_LETTER: "MEDICAL_LETTER", MEDICATION_LIST: "MEDICATION_LIST", THERAPY_REPORT: "PROFESSIONAL_REPORT", FAMILY_LETTER: "FAMILY_CORRESPONDENCE", SAFEGUARDING: "MEDICAL_LETTER" };
  return { section: "OTHER", category: other[kind] ?? (issuer === "NHS" || issuer === "GP" ? "MEDICAL_LETTER" : "OTHER_SUPPORTING") };
}

/** A first guess from the words on the pages, for the coordinator to confirm. */
export function classifyText(text: string): { kind: DocKind; issuerKind: IssuerKind; issuer: string | null; documentDate: string | null } {
  const t = text.toLowerCase();
  const kind: DocKind =
    /discharge (summary|letter|notification)|hospital discharge/.test(t) ? "DISCHARGE_LETTER"
    : /support plan/.test(t) ? "SUPPORT_PLAN"
    : /medication (list|chart)|repeat prescription/.test(t) ? "MEDICATION_LIST"
    : /risk assessment/.test(t) ? "RISK_ASSESSMENT"
    : /needs assessment|care act assessment/.test(t) ? "NEEDS_ASSESSMENT"
    : /referral/.test(t) ? "REFERRAL"
    : /occupational therap|physiotherap|speech and language/.test(t) ? "THERAPY_REPORT"
    : /purchase order/.test(t) ? "PURCHASE_ORDER"
    : /safeguarding/.test(t) ? "SAFEGUARDING"
    : /appointment/.test(t) ? "APPOINTMENT_LETTER"
    : /consultant/.test(t) ? "CONSULTANT_LETTER"
    : /\bgp\b|surgery|medical practice/.test(t) ? "GP_LETTER"
    : /care plan/.test(t) ? "CARE_PLAN"
    : "OTHER";
  // The letterhead decides first; "NHS number" in the body does not make a council plan an NHS document.
  const issuerOf = (x: string): IssuerKind | null => /council|borough|local authority|adult social care/.test(x) ? "COUNCIL" : /\bnhs\b(?! (number|no\b))|hospital|foundation trust|health trust/.test(x) ? "NHS" : /surgery|medical practice|\bgp\b/.test(x) ? "GP" : null;
  const issuerKind: IssuerKind = issuerOf(t.slice(0, 300)) ?? issuerOf(t) ?? "OTHER";
  const issuerLine = text.split(/\n/).map((l) => l.trim()).find((l) => /(council|nhs|hospital|trust|surgery|borough)/i.test(l) && l.length < 120) ?? null;
  const dm = /(?:date of (?:plan|letter|discharge|assessment)|letter date|date)\s*[:\-]\s*([0-9]{1,2}[\/.\-][0-9]{1,2}[\/.\-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(text);
  return { kind, issuerKind, issuer: issuerLine, documentDate: dm ? toIso(dm[1]!) : null };
}

/** dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy or ISO to ISO; null when it is not a real date. */
export function toIso(raw: string): string | null {
  const t = raw.trim();
  if (isIsoDate(t)) return realDate(t) ? t : null;
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return realDate(iso) ? iso : null;
}

/** A calendar date that exists: 31/02 is refused (the shared isIsoDate only checks the shape). */
export function realDate(iso: string) {
  if (!isIsoDate(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === iso;
}

/** Shown on a temporary visit whose end date the documents do not give. */
export const TEMPORARY_WITHOUT_END = "The document says this visit is temporary but gives no end date. Confirm the end date with the commissioner.";

/** Shown on a reference fact whose type a person must choose. */
export const UNCLEAR_REFERENCE = "Frameworki is the council's information system, so the label alone does not say what this number identifies. Edit it to choose client, package or framework before approving.";

// ── From a reading to facts ────────────────────────────────────────────────

export interface FactSeed {
  section: IntakeSection;
  destination: string;
  label: string;
  value: unknown;
  page: number | null;
  quote: string | null;
  temporal: "CURRENT" | "HISTORICAL" | "UNKNOWN";
  note?: string;
}

/** The shape both readers produce (the AI's schema, or the basic reader below). */
export interface Reading {
  document: { kind: DocKind; issuer: string | null; issuerKind: IssuerKind; documentDate: string | null; pageCount: number };
  person: { field: string; value: string; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  references: { type: (typeof EXTERNAL_REFERENCE_TYPES)[number]; issuer: string; value: string; page: number; quote: string; temporal: FactSeed["temporal"]; system?: string | null; typeClear?: boolean }[];
  contacts: { kind: (typeof CONTACT_KINDS)[number]; name: string; relationship: string | null; phone: string | null; email: string | null; address: string | null; isEmergency: boolean; isKeyHolder: boolean; authority: string | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  carerPreferences: { kind: string; value: string; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  carePlan: { section: string; topic?: CarePlanTopic | null; canDo: string | null; support: string | null; how: string | null; preferences?: string | null; outcome: string | null; clarify: string | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  risks: { type: (typeof RISK_TYPES)[number]; title: string; hazard: string; whoAffected: string | null; existingControls: string | null; mitigation?: string | null; assessmentGaps?: string | null; level: "LOW" | "MEDIUM" | "HIGH" | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  package: { field: string; value: string; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  visits: { label: string; weekdays: number[]; startTime: string; durationMinutes: number; carers: number; tasks: string[]; fundedBy: FundedBy; medicationPrompt: boolean; endDate: string | null; startDate?: string | null; visitType?: string | null; instructions?: string | null; temporary?: boolean; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  medication: {
    arrangement: { support: keyof typeof MED_SUPPORT; detail: string; page: number; quote: string; temporal: FactSeed["temporal"] } | null;
    items: { name: string; strength: string | null; dose: string | null; route: string | null; frequency: string | null; times: string[]; asRequired: boolean; prnInstructions: string | null; status: "CURRENT" | "STOPPED" | "WITHHELD" | "TEMPORARY" | "CHANGED"; note: string | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
    allergies: { value: string; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  };
  incidents: { date: string | null; type: string; description: string; consequences: string | null; actions: string | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  skin: { date: string | null; area: string | null; finding: string; description: string; page: number; quote: string; temporal: FactSeed["temporal"] }[];
  flags: { text: string; page: number }[];
  missing: string[];
  unreadable: { page: number; reason: string }[];
  /** General communication that belongs in Call Notes (optional: older readings do not have it). */
  communications?: { summary: string; contactName: string | null; method: "TELEPHONE" | "FACE_TO_FACE" | "EMAIL" | "MEETING" | "VIDEO" | "OTHER" | null; date: string | null; page: number; quote: string; temporal: FactSeed["temporal"] }[];
}

/** Turns one reading into individual facts. Bad shapes are dropped; nothing is invented to fill a gap. */
export function readingToFacts(r: Reading): FactSeed[] {
  const out: FactSeed[] = [];
  const add = (f: FactSeed) => {
    const p = parseValue(f.destination, f.value);
    if (p.ok) out.push({ ...f, value: p.value });
  };
  for (const p of r.person) {
    if (!(p.field in PERSON_FIELDS)) continue;
    let value: string = p.value.trim();
    if (p.field === "dateOfBirth") value = toIso(value) ?? "";
    if (!value) continue;
    add({ section: "PERSONAL", destination: `person.${p.field}`, label: PERSON_FIELDS[p.field as PersonField].label, value, page: p.page, quote: p.quote, temporal: p.temporal });
  }
  for(const ref of r.references ?? []){
    const unclear=ref.typeClear===false;
    add({section:"PERSONAL",destination:"externalReference",
      label:ref.system?`${issuerShort(ref.issuer)} – ${ref.system} (${unclear?"type to confirm":EXTERNAL_REFERENCE_LABEL[ref.type].toLowerCase()})`:`${EXTERNAL_REFERENCE_LABEL[ref.type]} (${ref.issuer})`,
      value:{type:ref.type,issuer:ref.issuer,value:ref.value,...(ref.system?{system:ref.system}:{}),...(unclear?{typeUnclear:true}:{})},
      page:ref.page,quote:ref.quote,temporal:ref.temporal,
      note:unclear?UNCLEAR_REFERENCE:undefined});
  }
  for (const c of r.contacts) add({ section: "CONTACTS", destination: "contact", label: `${CONTACT_KIND_LABEL[c.kind]}: ${c.name}`, value: { kind: c.kind, name: c.name, relationship: c.relationship, phone: c.phone, email: c.email, address: c.address, isEmergency: c.isEmergency, isKeyHolder: c.isKeyHolder, authority: c.authority }, page: c.page, quote: c.quote, temporal: c.temporal });
  for (const p of r.carerPreferences) {
    const g = /\b(female|woman|women|lady)\b/i.test(p.value) ? "FEMALE" : /\b(male|man|men)\b/i.test(p.value) ? "MALE" : null;
    if (p.kind === "GENDER" && g) add({ section: "CARER_PREFERENCES", destination: "preference.gender", label: "Care-worker gender preference", value: g, page: p.page, quote: p.quote, temporal: p.temporal });
    else add({ section: "CARER_PREFERENCES", destination: "preference.note", label: `Preference (${p.kind.toLowerCase().replace(/_/g, " ")})`, value: p.value, page: p.page, quote: p.quote, temporal: p.temporal });
  }
  for (const c of r.carePlan) {
    // The topic decides the care plan section, so a topic is never filed under the wrong heading.
    const topic = c.topic && c.topic in CARE_PLAN_TOPICS ? CARE_PLAN_TOPICS[c.topic] : null;
    const section = topic?.section ?? c.section;
    add({ section: "CARE_PLAN", destination: `careplan.${section}`, label: topic?.label ?? PLAN_SECTION_LABEL[section as keyof typeof PLAN_SECTION_LABEL] ?? section, value: { topic: c.topic ?? null, canDo: c.canDo, support: c.support, how: c.how, preferences: c.preferences ?? null, outcome: c.outcome, clarify: c.clarify }, page: c.page, quote: c.quote, temporal: c.temporal });
  }
  for (const k of r.risks) {
    const open = [k.assessmentGaps ? `For a qualified assessor: ${k.assessmentGaps.trim().replace(/[.\s]*$/, ".")}` : null, k.level === null ? "The documents do not state a risk level. The assessor must set one." : null].filter(Boolean).join(" ");
    add({ section: "RISKS", destination: "risk", label: k.title, value: { type: k.type, title: k.title, hazard: k.hazard, whoAffected: k.whoAffected, existingControls: k.existingControls, level: k.level, levelIsProvisional: k.level === null, recommendedActions: k.mitigation ?? null, responsiblePerson: null, reviewDue: null, openQuestions: open || null }, page: k.page, quote: k.quote, temporal: k.temporal });
  }
  for (const p of r.package) {
    let field = p.field;
    let value: unknown = p.value.trim();
    if (field === "hoursPerWeek") { field = "minutesPerWeek"; value = hoursToMinutes(String(value)); if (value === null) continue; }
    if (field === "startDate" || field === "endDate") { value = toIso(String(value)); if (!value) continue; }
    if (!(field in PACKAGE_FIELDS)) continue;
    add({ section: "PACKAGE", destination: `package.${field}`, label: PACKAGE_FIELDS[field as PackageField].label, value, page: p.page, quote: p.quote, temporal: p.temporal, note: p.field === "hoursPerWeek" ? `Document states ${p.value} hours a week` : undefined });
  }
  for (const v of r.visits) add({ section: "VISITS", destination: "visit", label: v.label, value: { label: v.label, weekdays: v.weekdays, startTime: v.startTime, durationMin: v.durationMinutes, carers: v.carers, tasks: v.tasks, fundedBy: v.fundedBy, medicationPrompt: v.medicationPrompt, visitType: v.visitType ?? null, instructions: v.instructions ?? null, temporary: !!v.temporary || !!v.endDate, effectiveFrom: v.startDate ? toIso(v.startDate) : null, effectiveTo: v.endDate ? toIso(v.endDate) : null, callTypeId: null }, page: v.page, quote: v.quote, temporal: v.temporal, note: v.temporary && !v.endDate ? TEMPORARY_WITHOUT_END : undefined });
  const m = r.medication;
  if (m.arrangement) add({ section: "MEDICATION", destination: "medication.arrangement", label: "Medication support arrangement", value: { support: m.arrangement.support, detail: m.arrangement.detail }, page: m.arrangement.page, quote: m.arrangement.quote, temporal: m.arrangement.temporal });
  for (const i of m.items) add({ section: "MEDICATION", destination: "medication.item", label: i.name, value: { name: i.name, strength: i.strength, dose: i.dose, route: i.route, frequency: i.frequency, times: i.times, asRequired: i.asRequired, prnInstructions: i.prnInstructions, status: i.status, note: i.note }, page: i.page, quote: i.quote, temporal: i.temporal });
  for (const a of m.allergies) add({ section: "MEDICATION", destination: "medication.allergy", label: "Allergy", value: a.value, page: a.page, quote: a.quote, temporal: a.temporal });
  for (const i of r.incidents) add({ section: "INCIDENTS", destination: "incident.history", label: i.type, value: { date: i.date ? toIso(i.date) : null, type: i.type, description: i.description, consequences: i.consequences, actions: i.actions }, page: i.page, quote: i.quote, temporal: "HISTORICAL" });
  for (const c of r.communications ?? []) add({ section: "CALL_NOTES", destination: "callnote", label: c.contactName ? `Communication with ${c.contactName}` : "Communication", value: { summary: c.summary, contactName: c.contactName, method: c.method, date: c.date ? toIso(c.date) : null }, page: c.page, quote: c.quote, temporal: c.temporal });
  for (const k of r.skin) add({ section: "BODY_MAP", destination: "bodymap.history", label: k.finding, value: { date: k.date ? toIso(k.date) : null, area: k.area, finding: k.finding, description: k.description }, page: k.page, quote: k.quote, temporal: k.temporal === "CURRENT" ? "UNKNOWN" : k.temporal });
  return out;
}

// ── The basic reader (no AI) ───────────────────────────────────────────────

/**
 * Reads documents that are written as labelled lines ("Date of birth: 02/03/1941", timetable rows
 * "Morning | 09:00-10:00 | Mon-Sun | 1 carer | Tasks: ..."). It runs on our own server, sends nothing anywhere and
 * only ever copies whole lines from the page, so every fact it finds is on the page. Anything it does not recognise
 * is left for the coordinator; it never guesses.
 */
export function basicRead(pages: string[]): Reading {
  const r: Reading = { document: { ...classifyText(pages.join("\n")), pageCount: pages.length }, person: [], references: [], contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [], medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [], communications: [] };
  const historicalDoc = r.document.kind === "DISCHARGE_LETTER";
  pages.forEach((text, i) => {
    const page = i + 1;
    if (!text.trim()) { r.unreadable.push({ page, reason: "No text on this page (it may be a scan). Read it and add the facts by hand." }); return; }
    for (const line of logicalLines(text)) {
      if (line.length < 4) continue;
      const lv = /^([A-Za-z][A-Za-z ()'\/-]{1,40}?)\s*:\s*(.+)$/.exec(line);
      const visit = parseVisitLine(line);
      if (visit) { r.visits.push({ ...visit, page, quote: line, temporal: "CURRENT" }); continue; }
      if (!lv) continue;
      const label = lv[1]!.toLowerCase().trim();
      const value = lv[2]!.trim();
      const base = { page, quote: line, temporal: (historicalDoc ? "UNKNOWN" : "CURRENT") as FactSeed["temporal"] };
      if (/key ?safe|alarm code|door code|pin\b/.test(label)) { r.flags.push({ text: "A key safe or door code appears in the document. It was not copied; record it through Key Safe if needed.", page }); continue; }
      const comm = /^(call note|phone call|telephone call|telephone conversation|conversation with|spoke (to|with)|email from|meeting note|communication with)(?: with)?\s*(.*)$/.exec(label);
      if (comm) {
        const method = /mail/.test(label) ? "EMAIL" : /meeting/.test(label) ? "MEETING" : /phone|call/.test(label) ? "TELEPHONE" : "OTHER";
        r.communications!.push({ summary: value, contactName: comm[3]?.trim() ? comm[3].trim().replace(/^\w/, (ch) => ch.toUpperCase()) : null, method, date: null, ...base });
        continue;
      }
      const person = PERSON_LABELS.find(([re]) => re.test(label));
      if (person) {
        if (person[1] === "fullName") {
          const parts = value.replace(/\(.*?\)/g, "").trim().split(/\s+/);
          if (parts.length >= 2) { r.person.push({ field: "firstName", value: parts.slice(0, -1).join(" "), ...base }); r.person.push({ field: "lastName", value: parts.at(-1)!, ...base }); }
        } else if (person[1] === "address") {
          const pc = /([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s*$/i.exec(value);
          const rest = (pc ? value.slice(0, pc.index) : value).replace(/,\s*$/, "").split(",").map((x) => x.trim()).filter(Boolean);
          if (rest[0]) r.person.push({ field: "addressLine1", value: rest[0], ...base });
          if (rest.length > 2) r.person.push({ field: "addressLine2", value: rest.slice(1, -1).join(", "), ...base });
          if (rest.length > 1) r.person.push({ field: "town", value: rest.at(-1)!, ...base });
          if (pc) r.person.push({ field: "postcode", value: pc[1]!.toUpperCase(), ...base });
        } else r.person.push({ field: person[1], value, ...base });
        continue;
      }
      const contact = CONTACT_LABELS.find(([re]) => re.test(label));
      if (contact) { r.contacts.push({ ...parseContact(contact[1], value, /emergency/.test(label)), ...base }); continue; }
      if (/carer gender|gender of carer|care worker gender|carer preference|preferences? for carers?/.test(label)) { r.carerPreferences.push({ kind: /gender/.test(label) ? "GENDER" : "OTHER", value, ...base }); continue; }
      const pkg = PACKAGE_LABELS.find(([re]) => re.test(label));
      if (pkg && findFrameworki(line).length) continue; // a Frameworki number is never proposed as the care package reference
      if (pkg) { r.package.push({ field: pkg[1], value: pkg[1] === "hoursPerWeek" ? (/(\d+(?:\.\d+)?)/.exec(value)?.[1] ?? value) : value, ...base }); continue; }
      const plan = PLAN_LABELS.find(([re]) => re.test(label));
      if (plan) { r.carePlan.push({ section: plan[1], topic: plan[2] ?? null, canDo: null, support: plan[1] === "outcomes" ? null : value, how: null, outcome: plan[1] === "outcomes" ? value : null, clarify: null, ...base }); continue; }
      const risk = /^risk(?: assessment)?\s*[-–]?\s*(.+)$/.exec(label);
      if (risk) { const t = riskType(risk[1]!); r.risks.push({ type: t, title: `${risk[1]!.replace(/^\w/, (c) => c.toUpperCase())} risk`, hazard: value, whoAffected: null, existingControls: null, level: null, ...base }); continue; }
      if (/^medication support|^support with medication/.test(label)) { r.medication.arrangement = { support: medSupport(value), detail: value, ...base }; continue; }
      if (/^(medicine|medication item|drug)$/.test(label)) { r.medication.items.push({ ...parseMedicine(value), ...base }); continue; }
      if (/^allerg/.test(label)) { if (!/^(none|nkda|no known)/i.test(value)) r.medication.allergies.push({ value, ...base }); continue; }
      if (/^(previous|past|history of) (fall|incident)|^incident history/.test(label)) { r.incidents.push({ date: /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/.exec(value)?.[1] ?? null, type: /fall/.test(label) ? "Fall" : "Incident", description: value, consequences: null, actions: null, ...base, temporal: "HISTORICAL" }); continue; }
      if (/^(pressure area|wound|skin|bruis)/.test(label)) { r.skin.push({ date: null, area: null, finding: lv[1]!.trim(), description: value, ...base, temporal: historicalDoc ? "HISTORICAL" : "UNKNOWN" }); continue; }
    }
  });
  augmentCouncilSupportPlan(pages,r);
  r.references.push(...frameworkiReferences(pages, r.document.issuer).map((f) => ({ type: f.type, typeClear: f.typeClear, issuer: f.issuer, system: f.system, value: f.value, page: f.page, quote: f.quote, temporal: "CURRENT" as const })));
  if (!r.person.some((p) => p.field === "dateOfBirth") && r.document.kind === "SUPPORT_PLAN") r.missing.push("Date of birth");
  if (r.document.kind === "SUPPORT_PLAN" && !r.visits.length) r.missing.push("No timetable rows were recognised. Add the visits by hand.");
  return r;
}


/**
 * No-API reader for a second common council layout: subsection headings and
 * visit cards with one field per line. Only source-backed text becomes a fact.
 * Each page is handled separately, so a split or ambiguous table is flagged
 * rather than silently combined into a possibly incorrect commissioned visit.
 */
export function augmentCouncilSupportPlan(pages: string[], r: Reading): Reading {
  if (r.document.kind !== "SUPPORT_PLAN" && r.document.kind !== "CARE_PLAN" && r.document.kind !== "NEEDS_ASSESSMENT") return r;

  const planHeads: [RegExp, (typeof PLAN_SECTION_KEYS)[number]][] = [
    [/^(?:about me|my background|what matters to me|life history)$/i, "about_me"],
    [/^(?:communication|communication needs|how i communicate)$/i, "communication"],
    [/^(?:personal care|washing and dressing|continence and toileting|oral care)$/i, "personal_care"],
    [/^(?:mobility|moving and handling|transfers and mobility)$/i, "mobility"],
    [/^(?:nutrition|nutrition and hydration|eating and drinking)$/i, "nutrition"],
    [/^(?:medication support|medicines support)$/i, "medication"],
    [/^(?:health and wellbeing|medical conditions|health needs)$/i, "health"],
    [/^(?:home environment|home and safety|living environment)$/i, "home"],
    [/^(?:outcomes|my outcomes|desired outcomes|goals)$/i, "outcomes"],
  ];
  const visitHead = /^(morning|breakfast|lunch(?:time)?|midday|tea(?:time)?|afternoon|evening|bedtime|night|overnight|night sit(?:ting)?|sleep[- ]in|waking night|shopping|cleaning)(?:\s+(?:call|visit))?$/i;
  const structured = /^(start(?:\s+time)?|time|duration|length|frequency|days|day(?:s)? of (?:the )?week|number of carers|carers|staff required|tasks?|support required|funded by|provided by|funding|status|end date|ends|until)\s*[:=]\s*(.*)$/i;

  // Lines that belong to a visit card ("Funded by:", "End date:", "Number of carers:") describe that visit only. The
  // labelled-line reader above may also have taken them as package or personal facts; those copies are removed below.
  const cardLines = new Set<string>();
  for (const [index, pageText] of pages.entries()) {
    if (!pageText.trim()) continue;
    const lines = pageText.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    let section: (typeof PLAN_SECTION_KEYS)[number] | null = null;
    let sectionLines: string[] = [];
    let sectionHeading = "";
    let visitLabel: string | null = null;
    let visitFields: string[] = [];

    const flushPlan = () => {
      if (!section || !sectionLines.length) return;
      // Avoid creating a second proposed section from text already read in
      // the conventional "Personal care: ..." layout.
      const content = sectionLines.join(" ").trim();
      if (content.length >= 12 && content.length <= 4000 &&
          !r.carePlan.some(p => p.section === section && p.page === index + 1 && p.support === content)) {
        r.carePlan.push({
          section, canDo: null, support: section === "outcomes" ? null : content,
          how: null, outcome: section === "outcomes" ? content : null,
          clarify: null, page: index + 1,
          quote: [sectionHeading, ...sectionLines].join("\n"), temporal: "CURRENT",
        });
      }
      section = null; sectionLines = []; sectionHeading = "";
    };
    const flushVisit = () => {
      if (!visitLabel) return;
      const fields = Object.fromEntries(visitFields.map(line => {
        const m = structured.exec(line);
        return m ? [m[1]!.toLowerCase(),m[2]!.trim()] : ["", ""];
      }).filter(([key]) => key)) as Record<string,string>;
      const time = fields["start"] || fields["start time"] || fields["time"] || "";
      const duration = fields["duration"] || fields["length"] || "";
      const days = fields["frequency"] || fields["days"] || fields["day of week"] || fields["days of the week"] || "";
      const carers = fields["number of carers"] || fields["carers"] || fields["staff required"] || "";
      const tasks = fields["tasks"] || fields["task"] || fields["support required"] || "";
      const funding = fields["funded by"] || fields["funding"] || fields["provided by"] || "";
      const fundingIsProvider = !fields["funded by"] && !fields["funding"] && !!fields["provided by"];
      const status = fields["status"] || "";
      const endRaw = fields["end date"] || fields["ends"] || fields["until"] || "";
      const page = index + 1;
      // A missing frequency, duration or staff count is NOT a valid rota row.
      // Fail closed rather than assume every day or a single-handed visit.
      const hasEvidence = !!time && !!duration && !!days && !!carers;
      // The exact lines of the visit card, so the coordinator sees the words on the page.
      const source = [visitLabel, ...visitFields].join("\n");
      if (!hasEvidence) {
        if (time || duration || days || carers) r.flags.push({ text: `Incomplete visit details on page ${page} for ${visitLabel}. Coordinator must check the original timetable.`, page });
      } else {
        const singleTime = /^(\d{1,2}[:.]\d{2})$/.exec(time)?.[1];
        const line = [visitLabel, singleTime ? singleTime + " " + duration : time, days,
          carers + (/^\d+$/.test(carers) ? " carers" : ""),
          "Tasks: " + tasks].join(" | ");
        const parsed = parseVisitLine(line);
        if (!parsed) r.flags.push({ text: `Visit timetable not fully recognised on page ${page} for ${visitLabel}. Check manually.`, page });
        else {
          const label = visitLabel.replace(/\s+(?:call|visit)$/i, "").slice(0, 80);
          const fund = visitFunding(funding, fundingIsProvider);
          if (fund.flag) r.flags.push({ text: `${label} visit on page ${page}: ${fund.flag}`, page });
          const staff = Number(/^(\d+)/.exec(carers)?.[1] ?? NaN);
          if (Number.isFinite(staff) && staff > 20) r.flags.push({ text: `${label} visit on page ${page} asks for ${staff} carers. CSB books at most 20 carers per visit, so this needs a manager's decision before the rota.`, page });
          if (Number.isFinite(staff) && staff < 1) { r.flags.push({ text: `${label} visit on page ${page} states ${carers} carers. Check the original.`, page }); visitLabel = null; visitFields = []; return; }
          const ended = /\b(discontinued|ceased|cancelled|canceled|ended|stopped|no longer (?:required|needed|provided)|suspended)\b/i.test(status);
          if (ended) r.flags.push({ text: `${label} visit on page ${page} is marked "${status}". It is kept as history and is not scheduled.`, page });
          else if (status && !/^(current|active|ongoing|new|continuing|agreed|commissioned)$/i.test(status)) r.flags.push({ text: `${label} visit on page ${page} has status "${status}". Confirm with the commissioner whether it is current.`, page });
          if (/\btemporary\b/i.test(status + " " + funding) && !endRaw) r.flags.push({ text: `${label} visit on page ${page} is temporary but no end date is written. Confirm the end date with the commissioner.`, page });
          const endDate = endRaw ? (/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}|\d{4}-\d{2}-\d{2})/.exec(endRaw)?.[1] ?? null) : parsed.endDate;
          if (endRaw && !endDate) r.flags.push({ text: `${label} visit on page ${page}: end "${endRaw}" is not a date. Check the original.`, page });
          const visit = { ...parsed, label, fundedBy: fund.fundedBy, endDate, quote: source, page, temporal: (ended ? "HISTORICAL" : "CURRENT") as FactSeed["temporal"] };
          if (!r.visits.some(v => v.page === page && v.startTime === visit.startTime && v.durationMinutes === visit.durationMinutes && v.fundedBy === visit.fundedBy)) r.visits.push(visit);
        }
      }
      visitLabel = null; visitFields = [];
    };

    for (const line of lines) {
      const plan = planHeads.find(([pattern]) => pattern.test(line));
      const call = visitHead.exec(line);
      if (plan || call || /^(?:timetable|care visits|care package|support plan|risk assessments?|section \d+|page \d+)/i.test(line)) {
        flushPlan(); flushVisit();
        if (plan) {section = plan[1];sectionHeading = line;}
        if (call) visitLabel = line;
        continue;
      }
      if (visitLabel) {
        if (structured.test(line)) { visitFields.push(line); cardLines.add(`${index + 1}\u0000${line}`); continue; }
        // Unlabelled continuation is not used for a rota instruction.
        flushVisit();
      }
      if (section) {
        // Do not absorb later labelled demographic, financial, medicine,
        // or risk material into an unrelated care-plan section.
        if (/^[A-Za-z][A-Za-z ()'-]{1,42}\s*:\s*\S/.test(line) && !/^(?:support|assistance|needs|preferences|outcome|goal|how to help)\s*:/i.test(line)) {
          flushPlan();
        } else sectionLines.push(line);
      }
    }
    flushPlan();flushVisit();
  }
  if (cardLines.size) {
    const outside = <T extends { page: number; quote: string }>(xs: T[]) => xs.filter((x) => !cardLines.has(`${x.page}\u0000${x.quote}`));
    r.package = outside(r.package); r.person = outside(r.person); r.contacts = outside(r.contacts); r.carerPreferences = outside(r.carerPreferences); r.risks = outside(r.risks);
  }
  // The same visit written differently on two pages is a contradiction for a person to settle, never a guess.
  for (const [i, v] of r.visits.entries()) {
    for (const w of r.visits.slice(i + 1)) {
      if (v.page === w.page || v.temporal === "HISTORICAL" || w.temporal === "HISTORICAL") continue;
      const sameVisit = v.label.toLowerCase() === w.label.toLowerCase() || v.startTime === w.startTime;
      if (!sameVisit) continue;
      if (v.startTime !== w.startTime || v.durationMinutes !== w.durationMinutes || v.carers !== w.carers || v.weekdays.join() !== w.weekdays.join())
        r.flags.push({ text: `Pages ${v.page} and ${w.page} describe the ${v.label} visit differently (${v.startTime}, ${v.durationMinutes} min, ${v.carers} carer(s) against ${w.startTime}, ${w.durationMinutes} min, ${w.carers} carer(s)). Decide which is current before approving either.`, page: w.page });
    }
  }
  const found = new Set(r.carePlan.map(c => c.section));
  for (const name of PLAN_SECTION_KEYS) {
    if (!found.has(name)) r.missing.push("Care plan section " + PLAN_SECTION_LABEL[name] + ": not found in source; coordinator must review and complete");
  }
  if(r.document.kind === "SUPPORT_PLAN"){
    const councilVisits=r.visits.filter(v=>v.fundedBy==="COUNCIL"&&v.temporal!=="HISTORICAL");
    const total=councilVisits.reduce((n,v)=>n+v.durationMinutes*v.weekdays.length,0);
    const authorised=r.package.find(p=>p.field==="hoursPerWeek");
    const parsed=authorised ? hoursToMinutes(authorised.value) : null;
    if(parsed !== null && parsed !== total)
      r.flags.push({text:"Council visit pattern totals "+total+" minutes per week, but source states "+parsed+" commissioned minutes. Do not activate rota until reconciled.",page:authorised?.page??1});
  }
  return r;
}

/**
 * Who pays for a visit, from the words in a visit card's "Funded by" / "Provided by" line. No line means the council
 * plan's own commissioned visit; a "Provided by" line naming an agency does not change who pays. Anything not clearly the council or an informal carer is kept out of the council total
 * and flagged, so a funding question is never settled by the reader.
 */
export function visitFunding(text: string, providerOnly = false): { fundedBy: FundedBy; flag: string | null } {
  const t = text.trim().toLowerCase();
  if (!t) return { fundedBy: "COUNCIL", flag: null };
  const informal = /\b(informal|family|friend|neighbour|daughter|son|wife|husband|partner|unpaid|carers service)\b/.test(t);
  const council = /\b(council|borough|local authority|adult social care|la funded|commissioned)\b/.test(t);
  const other = /\b(nhs|chc|continuing healthcare|health funded|icb|private|self[- ]?fund(?:ed|er)?|direct payment|other provider|another provider|agency)\b/.test(t);
  const unclear = /\b(tbc|to be confirmed|unknown|unclear|pending|joint|split|shared)\b|\?|\bor\b|\//.test(t);
  if (unclear || [informal, council, other].filter(Boolean).length > 1) return { fundedBy: "OTHER", flag: `funding is unclear ("${text.trim()}"). It is not counted as council-commissioned until a manager confirms who pays.` };
  if (informal) return { fundedBy: "CARERS_SERVICE", flag: null };
  if (council) return { fundedBy: "COUNCIL", flag: null };
  if (other) return { fundedBy: "OTHER", flag: `funded or provided by "${text.trim()}", not the council. It is kept out of the commissioned total.` };
  // "Provided by" names who delivers the visit (often the care agency itself), not who pays for it.
  if (providerOnly) return { fundedBy: "COUNCIL", flag: null };
  return { fundedBy: "OTHER", flag: `funding "${text.trim()}" is not recognised. It is not counted as council-commissioned until a manager confirms who pays.` };
}

/** Joins lines the PDF wrapped: a line that does not start a new label or timetable row continues the one before. */
export function logicalLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) { out.push(""); continue; }
    const starts = /^[A-Za-z][A-Za-z ()'\/-]{1,40}?\s*:/.test(line) || (/\d{1,2}[:.]\d{2}/.test(line) && parseDays(line).length > 0) || /^[A-Z][A-Za-z ]{0,40}\s*\|/.test(line);
    const prev = out.length ? out[out.length - 1]! : "";
    if (!starts && prev && /[:|]/.test(prev) && !/[.!?]$/.test(prev)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.filter(Boolean);
}

const PERSON_LABELS: [RegExp, string][] = [
  [/^(full name|name of person|service user name|person's name|name)$/, "fullName"],
  [/^first names?$|^forenames?$/, "firstName"],
  [/^(surname|last name|family name)$/, "lastName"],
  [/^(preferred name|known as)$/, "preferredName"],
  [/^(date of birth|dob|d\.o\.b\.?)$/, "dateOfBirth"],
  [/^(gender|sex)$/, "gender"],
  [/^nhs (number|no\.?)$/, "nhsNumber"],
  [/^(address|home address|current address)$/, "address"],
  [/^post ?code$/, "postcode"],
  [/^(telephone|phone|home phone|landline|tel)$/, "phone"],
  [/^(mobile|mobile phone)$/, "altPhone"],
  [/^e-?mail$/, "email"],
  [/^(first language|preferred language|main language|language)$/, "firstLanguage"],
  [/^(communication|communication needs|sensory)$/, "communicationNeeds"],
  [/^(access|access instructions|access to property|entry)$/, "accessNotes"],
  [/^(likes and dislikes|preferences|personal preferences|religion|culture|faith)$/, "carePreferences"],
];
const CONTACT_LABELS: [RegExp, (typeof CONTACT_KINDS)[number]][] = [
  [/^next of kin|^nok$/, "NEXT_OF_KIN"],
  [/^(emergency contact|family contact|daughter|son|wife|husband|family)$/, "FAMILY"],
  [/^(gp|general practitioner|gp surgery|doctor)$/, "GP"],
  [/^pharmacy$|^chemist$/, "PHARMACY"],
  [/^social worker$|^care manager$|^allocated worker$/, "SOCIAL_WORKER"],
  [/^district nurse$|^community nurse$/, "DISTRICT_NURSE"],
  [/^(occupational therapist|ot|physiotherapist|consultant|other professional)$/, "OTHER"],
];
const PACKAGE_LABELS: [RegExp, string][] = [
  [/^(funder|funded by|commissioned by|commissioning authority|local authority)$/, "funder"],
  [/^(package start|start date|service start|package start date)$/, "startDate"],
  [/^(package end|end date|package end date|review end date)$/, "endDate"],
  [/^(hours per week|weekly hours|total hours|commissioned hours)$/, "hoursPerWeek"],
  [/^(purchase order|po number|package reference|reference)$/, "reference"],
  [/^(staffing|staffing requirements|requirements|number of carers)$/, "requirements"],
];
const PLAN_LABELS: [RegExp, string, CarePlanTopic?][] = [
  [/^(about me|background|what matters to me|life history)$/, "about_me", "ABOUT_ME"],
  [/^(daily routine|my routine|routines?)$/, "about_me", "DAILY_ROUTINE"],
  [/^(independence|choice|choice and control|independence and choice)$/, "about_me", "INDEPENDENCE_CHOICE"],
  [/^(cultural (and|&) religious (needs|preferences)|cultural needs|religious needs)$/, "about_me", "CULTURE_RELIGION"],
  [/^(community|community activities|social activities|hobbies|activities)$/, "about_me", "COMMUNITY"],
  [/^communication support$/, "communication", "COMMUNICATION"],
  [/^(cognition|memory|cognition and memory|memory and cognition)$/, "communication", "COGNITION_MEMORY"],
  [/^(personal care|oral care)$/, "personal_care", "PERSONAL_CARE"],
  [/^(washing|dressing|washing and dressing|bathing)$/, "personal_care", "WASHING_DRESSING"],
  [/^(continence|toileting|toileting and continence|continence and toileting)$/, "personal_care", "TOILETING_CONTINENCE"],
  [/^(mobility|transfers|moving and handling|equipment)$/, "mobility", "MOBILITY_TRANSFERS"],
  [/^(eating and drinking|meals)$/, "nutrition", "EATING_DRINKING"],
  [/^(nutrition|hydration|diet|nutrition and hydration)$/, "nutrition", "NUTRITION_HYDRATION"],
  [/^(health|medical conditions|diagnosis|conditions|long[- ]term conditions)$/, "health", "HEALTH_CONDITIONS"],
  [/^(wellbeing|emotional wellbeing|mental health|mood)$/, "health", "EMOTIONAL_WELLBEING"],
  [/^(sleep|night|night support|sleep and night support)$/, "health", "SLEEP_NIGHT"],
  [/^(household|household tasks|domestic|domestic tasks|shopping and cleaning)$/, "home", "HOUSEHOLD"],
  [/^(home|home environment|environment|safety)$/, "home", "HOME_SAFETY"],
  [/^(emergency|in an emergency|emergency plan|emergency considerations)$/, "home", "EMERGENCY"],
  [/^(outcomes|desired outcomes|goals)$/, "outcomes", "OUTCOMES"],
];

function riskType(t: string): (typeof RISK_TYPES)[number] {
  const l = t.toLowerCase();
  if (/fall/.test(l)) return "FALLS";
  if (/moving|handling|transfer|mobility/.test(l)) return "MOVING_HANDLING";
  if (/pressure|skin/.test(l)) return "PRESSURE_SKIN";
  if (/medic/.test(l)) return "MEDICATION_SUPPORT";
  if (/nutrition|dehydrat|eating|swallow/.test(l)) return "NUTRITION";
  if (/environment|home|fire|trip/.test(l)) return "ENVIRONMENT";
  if (/lone/.test(l)) return "LONE_WORKING";
  return "OTHER";
}
function medSupport(v: string): keyof typeof MED_SUPPORT {
  const l = v.toLowerCase();
  if (/self[- ]?administ|manages own|independent/.test(l)) return "SELF";
  if (/administ/.test(l)) return "ADMINISTER";
  if (/assist/.test(l)) return "ASSIST";
  if (/prompt|remind/.test(l)) return "PROMPT";
  return "UNKNOWN";
}
function parseMedicine(v: string) {
  const parts = v.split(/\s*[|;]\s*/);
  const head = parts[0] ?? v;
  const strength = /(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|micrograms?|units?))/i.exec(head)?.[1] ?? null;
  const name = (strength ? head.slice(0, head.indexOf(strength)) : head).trim() || head;
  const asRequired = /\b(prn|as required|when required)\b/i.test(v);
  const status = /\bstopped\b|\bdiscontinued\b/i.test(v) ? "STOPPED" : /\bwithheld\b|\bwithhold\b/i.test(v) ? "WITHHELD" : /\btemporary\b|\bfor \d+ days\b/i.test(v) ? "TEMPORARY" : /\bchanged\b|\bincreased\b|\breduced\b/i.test(v) ? "CHANGED" : "CURRENT";
  return { name: name.slice(0, 200), strength, dose: parts[1] ?? null, route: null, frequency: parts[2] ?? null, times: [], asRequired, prnInstructions: asRequired ? (parts.slice(1).join("; ") || null) : null, status: status as "CURRENT", note: null };
}
function parseContact(kind: (typeof CONTACT_KINDS)[number], v: string, emergency: boolean) {
  const phone = /(\+?\d[\d ]{8,}\d)/.exec(v)?.[1]?.trim() ?? null;
  const email = /([\w.+-]+@[\w-]+\.[\w.]+)/.exec(v)?.[1] ?? null;
  const rel = /\(([^)]+)\)/.exec(v)?.[1]?.trim() ?? null;
  const name = v.split(/[,(|]/)[0]!.replace(phone ?? "\u0000", "").trim() || v.slice(0, 80);
  return { kind, name, relationship: rel, phone, email, address: null, isEmergency: emergency, isKeyHolder: /key ?holder/i.test(v), authority: /\b(lpa|lasting power|deputy)\b/i.test(v) ? v.match(/(lasting power of attorney[^,;]*|lpa[^,;]*|deputy[^,;]*)/i)?.[1] ?? null : null };
}

const DAY_WORDS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
/** "Mon-Sun", "Monday to Friday", "Mon, Wed, Fri", "Daily", "Wednesday" to ISO weekdays. */
export function parseDays(t: string): number[] {
  const l = t.toLowerCase();
  if (/daily|every day|7 days|seven days|mon(day)?\s*(-|–|to)\s*sun(day)?/.test(l)) return [1, 2, 3, 4, 5, 6, 7];
  const range = /(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|–|to)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/.exec(l);
  if (range) { const a = DAY_WORDS[range[1]!]!, b = DAY_WORDS[range[2]!]!; const out: number[] = []; for (let d = a; ; d = (d % 7) + 1) { out.push(d); if (d === b) break; } return out.sort(); }
  return [...new Set([...l.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/g)].map((m) => DAY_WORDS[m[1]!]!))].sort();
}

/** A timetable row: a name, a time range or start + duration, days, carers and tasks. */
export function parseVisitLine(line: string): Omit<Reading["visits"][number], "page" | "quote" | "temporal"> | null {
  const t = /(\d{1,2})[:.](\d{2})\s*(?:-|–|to)\s*(\d{1,2})[:.](\d{2})/.exec(line);
  const dur = /(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?)\b/i.exec(line);
  if (!t && !(dur && /(\d{1,2})[:.](\d{2})/.test(line))) return null;
  const days = parseDays(line);
  if (!days.length) return null;
  const st = t ? Number(t[1]) * 60 + Number(t[2]) : Number(/(\d{1,2})[:.](\d{2})/.exec(line)![1]) * 60 + Number(/(\d{1,2})[:.](\d{2})/.exec(line)![2]);
  let duration = t ? (Number(t[3]) * 60 + Number(t[4]) - st + 1440) % 1440 : 0;
  if (!t && dur) duration = /hour|hr/i.test(dur[2]!) ? Math.round(Number(dur[1]) * 60) : Number(dur[1]);
  if (duration < 5 || st > 1439) return null;
  const label = line.split(/[|:]|\s\d{1,2}[:.]\d{2}/)[0]!.replace(/\b(visit|call)\b/gi, "").trim() || "Visit";
  const carers = Number(/(\d+)\s*(?:carers?|staff|care workers?)\b/i.exec(line)?.[1] ?? (/double[- ]?up|two carers/i.test(line) ? 2 : 1));
  const tasksText = /tasks?\s*:\s*(.+)$/i.exec(line)?.[1] ?? "";
  const tasks = tasksText.split(/\s*[;•]\s*|\s*,\s*(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 30);
  const fundedBy: FundedBy = /\b(informal|family|carers service|unpaid)\b/i.test(line) ? "CARERS_SERVICE" : "COUNCIL";
  const end = /\b(?:until|ends?)\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i.exec(line)?.[1] ?? null;
  return { label: label.slice(0, 80), weekdays: days, startTime: hhmm(st), durationMinutes: duration, carers: Math.min(Math.max(carers, 1), 20), tasks, fundedBy, medicationPrompt: /medicat|tablet|prompt.*med/i.test(line), endDate: end };
}
