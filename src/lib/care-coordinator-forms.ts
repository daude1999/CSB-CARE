import { CONTACT_KIND_LABEL, CONTACT_KINDS, MED_SUPPORT, PACKAGE_FIELDS, PERSON_FIELDS, PLAN_SECTION_KEYS, RISK_TYPES, type PackageField, type PersonField } from "@/lib/care-coordinator-rules";
import { FUNDED_BY } from "@/lib/su-import-rules";
import { WEEKDAYS } from "@/lib/london";

/**
 * The edit form for each fact destination, as plain labelled fields (no JSON for the coordinator). The same spec
 * renders the inputs and turns the submitted form back into a value, which the server then validates with the
 * destination's schema before anything is stored.
 */

export type FieldKind = "text" | "textarea" | "date" | "time" | "number" | "select" | "checkbox" | "days" | "lines";
export interface FormField { name: string; label: string; kind: FieldKind; options?: [string, string][]; help?: string; required?: boolean }

const RISK_TYPE_LABEL: Record<(typeof RISK_TYPES)[number], string> = { ENVIRONMENT: "Home environment", MOVING_HANDLING: "Moving and handling", FALLS: "Falls", PRESSURE_SKIN: "Pressure areas and skin", MEDICATION_SUPPORT: "Medication support", NUTRITION: "Eating and drinking", LONE_WORKING: "Lone working", OTHER: "Other" };
const LONG_PERSON = new Set<string>(["communicationNeeds", "accessNotes", "carePreferences"]);

export const PREFIX = "v_";

export function formSpec(destination: string): FormField[] {
  const [head, key] = destination.split(".", 2) as [string, string | undefined];
  if (head === "person" && key && key in PERSON_FIELDS) {
    return [{ name: "value", label: PERSON_FIELDS[key as PersonField].label, kind: key === "dateOfBirth" ? "date" : LONG_PERSON.has(key) ? "textarea" : "text", required: true }];
  }
  if (head === "package" && key && key in PACKAGE_FIELDS) {
    return [{ name: "value", label: PACKAGE_FIELDS[key as PackageField].label, kind: key.endsWith("Date") ? "date" : key === "minutesPerWeek" ? "number" : key === "requirements" ? "textarea" : "text", required: true, help: key === "minutesPerWeek" ? "Minutes, not hours: 22.75 hours is 1365 minutes." : undefined }];
  }
  switch (destination) {
    case "externalReference":
      return [
        {name:"type",label:"Reference type",kind:"select",required:true,options:[
          ["NHS","NHS number"],["COUNCIL_CLIENT","Council client number"],["COUNCIL_FRAMEWORK","Council framework / contract ID"],
          ["COUNCIL_PACKAGE","Council package / placement reference"],["OTHER_EXTERNAL","Other issuer reference"],
        ]},
        {name:"issuer",label:"Issuing organisation",kind:"text",required:true},
        {name:"system",label:"System or label (optional)",kind:"text",help:"For example Frameworki for Tower Hamlets Council."},
        {name:"value",label:"Reference as printed",kind:"text",required:true,help:"Preserve leading zeroes. Framework IDs are shared contracts, never proof of identity."},
      ];
    case "contact":
      return [
        { name: "kind", label: "Contact type", kind: "select", options: CONTACT_KINDS.map((k) => [k, CONTACT_KIND_LABEL[k]]), required: true },
        { name: "name", label: "Name", kind: "text", required: true },
        { name: "relationship", label: "Relationship or role", kind: "text" },
        { name: "phone", label: "Phone", kind: "text" },
        { name: "email", label: "Email", kind: "text" },
        { name: "address", label: "Address", kind: "text" },
        { name: "isEmergency", label: "Emergency contact", kind: "checkbox" },
        { name: "isKeyHolder", label: "Key holder", kind: "checkbox" },
        { name: "authority", label: "Authority as written in the document", kind: "text", help: "For example a Lasting Power of Attorney. Saved in the contact's notes for a manager to verify; it does not record a legal authority." },
      ];
    case "preference.gender":
      return [{ name: "value", label: "Care-worker gender preference", kind: "select", options: [["ANY", "No preference"], ["FEMALE", "Female carers only"], ["MALE", "Male carers only"]], required: true }];
    case "preference.note":
    case "careplan.summary":
      return [{ name: "value", label: destination === "careplan.summary" ? "Care plan summary" : "Carer preference", kind: "textarea", required: true }];
    case "risk":
      return [
        { name: "type", label: "Risk type", kind: "select", options: RISK_TYPES.map((t) => [t, RISK_TYPE_LABEL[t]]), required: true },
        { name: "title", label: "Title", kind: "text", required: true },
        { name: "hazard", label: "Hazard and possible harm", kind: "textarea", required: true },
        { name: "whoAffected", label: "Who could be harmed", kind: "text" },
        { name: "existingControls", label: "Controls carers follow", kind: "textarea" },
        { name: "recommendedActions", label: "Actions still needed", kind: "textarea" },
        { name: "responsiblePerson", label: "Responsible person", kind: "text" },
        { name: "level", label: "Risk level", kind: "select", options: [["", "Not set"], ["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"]], help: "Only what the document states, or your provisional level. The assessor confirms it before the draft goes live." },
        { name: "levelIsProvisional", label: "This level is provisional (not stated in the document)", kind: "checkbox" },
        { name: "reviewDue", label: "Review by", kind: "date" },
        { name: "openQuestions", label: "Questions for the assessor", kind: "textarea" },
      ];
    case "visit":
      return [
        { name: "label", label: "Visit name", kind: "text", required: true },
        { name: "weekdays", label: "Days", kind: "days", required: true },
        { name: "startTime", label: "Start time", kind: "time", required: true },
        { name: "durationMin", label: "Length (minutes)", kind: "number", required: true },
        { name: "carers", label: "Carers needed", kind: "number", required: true },
        { name: "fundedBy", label: "Who provides it", kind: "select", options: Object.entries(FUNDED_BY), help: "Only visits the council commissions from the agency are scheduled. Family or other support is kept for information." },
        { name: "tasks", label: "Tasks, one per line", kind: "lines" },
        { name: "medicationPrompt", label: "Includes a medication prompt", kind: "checkbox" },
        { name: "effectiveFrom", label: "From", kind: "date" },
        { name: "effectiveTo", label: "Until", kind: "date" },
        { name: "callTypeId", label: "Call type", kind: "select", options: [["", "Choose from the visit name"]] },
      ];
    case "medication.arrangement":
      return [
        { name: "support", label: "Level of support", kind: "select", options: Object.entries(MED_SUPPORT), required: true },
        { name: "detail", label: "What the document says", kind: "textarea", required: true },
      ];
    case "medication.item":
      return [
        { name: "name", label: "Medicine", kind: "text", required: true },
        { name: "strength", label: "Strength", kind: "text" },
        { name: "dose", label: "Dose", kind: "text" },
        { name: "route", label: "Route", kind: "text" },
        { name: "frequency", label: "How often", kind: "text" },
        { name: "times", label: "Times, one per line", kind: "lines" },
        { name: "asRequired", label: "As required (PRN)", kind: "checkbox" },
        { name: "prnInstructions", label: "PRN instructions", kind: "textarea" },
        { name: "status", label: "Status in the document", kind: "select", options: [["CURRENT", "Current"], ["STOPPED", "Stopped"], ["WITHHELD", "Withheld"], ["TEMPORARY", "Temporary"], ["CHANGED", "Changed"]] },
        { name: "note", label: "Note", kind: "textarea" },
      ];
    case "medication.allergy":
      return [{ name: "value", label: "Allergy", kind: "text", required: true }];
    case "incident.history":
      return [
        { name: "date", label: "Date it happened", kind: "date" },
        { name: "type", label: "Type", kind: "text", required: true },
        { name: "description", label: "What the document says", kind: "textarea", required: true },
        { name: "consequences", label: "Consequences", kind: "textarea" },
        { name: "actions", label: "Actions recorded", kind: "textarea" },
      ];
    case "callnote":
      return [
        { name: "summary", label: "What was communicated", kind: "textarea", required: true, help: "General communication only. Anything for the care plan, risks, medication or rota belongs in its own section." },
        { name: "contactName", label: "Who it was with", kind: "text" },
        { name: "method", label: "How", kind: "select", options: [["TELEPHONE", "Telephone"], ["FACE_TO_FACE", "Face-to-face conversation"], ["EMAIL", "Email"], ["MEETING", "Meeting"], ["VIDEO", "Video call"], ["OTHER", "Other"]] },
        { name: "date", label: "Date", kind: "date" },
      ];
    case "bodymap.history":
      return [
        { name: "date", label: "Date noted", kind: "date" },
        { name: "area", label: "Body area", kind: "text" },
        { name: "finding", label: "Finding", kind: "text", required: true },
        { name: "description", label: "What the document says", kind: "textarea", required: true },
      ];
  }
  if (head === "careplan" && key && (PLAN_SECTION_KEYS as readonly string[]).includes(key)) {
    return [
      { name: "canDo", label: "What they can do themselves", kind: "textarea" },
      { name: "support", label: "Support needed", kind: "textarea" },
      { name: "how", label: "How carers should help", kind: "textarea" },
      { name: "outcome", label: "Outcome", kind: "textarea" },
      { name: "clarify", label: "Still to clarify", kind: "textarea" },
    ];
  }
  return [];
}

/** Every destination the coordinator can add a fact to by hand, grouped by profile section. */
export const MANUAL_DESTINATIONS: [string, string][] = [
  ...Object.entries(PERSON_FIELDS).map(([k, f]) => [`person.${k}`, `Personal details: ${f.label}`] as [string, string]),
  ["externalReference", "Personal details: council, package or NHS reference"],
  ["contact", "Contacts: new contact"],
  ["preference.gender", "Carer preferences: gender"],
  ["preference.note", "Carer preferences: other"],
  ["careplan.summary", "Care plan: summary"],
  ...PLAN_SECTION_KEYS.map((k) => [`careplan.${k}`, `Care plan: ${k.replace(/_/g, " ")}`] as [string, string]),
  ["risk", "Risk assessments: new draft"],
  ...Object.entries(PACKAGE_FIELDS).map(([k, f]) => [`package.${k}`, `Care package: ${f.label}`] as [string, string]),
  ["visit", "Visits: recurring visit"],
  ["medication.arrangement", "Medication: support arrangement"],
  ["medication.item", "Medication: medicine"],
  ["medication.allergy", "Medication: allergy"],
  ["incident.history", "Incident history"],
  ["bodymap.history", "Skin and body map history"],
  ["callnote", "Call Notes: meeting or conversation note"],
];

/** The current value as strings for the inputs' default values. */
export function formDefaults(destination: string, value: unknown): Record<string, string | boolean | string[]> {
  const spec = formSpec(destination);
  if (spec.length === 1 && spec[0]!.name === "value") return { value: value === null || value === undefined ? "" : String(value) };
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: Record<string, string | boolean | string[]> = {};
  for (const f of spec) {
    const v = o[f.name];
    if (f.kind === "checkbox") out[f.name] = v === true;
    else if (f.kind === "days") out[f.name] = Array.isArray(v) ? v.map(String) : [];
    else if (f.kind === "lines") out[f.name] = Array.isArray(v) ? v.map(String) : [];
    else out[f.name] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/** Reads the submitted inputs (named with PREFIX) back into a value for the server to validate. */
export function valueFromForm(destination: string, fd: { get(k: string): FormDataEntryValue | null; getAll(k: string): FormDataEntryValue[] }): unknown {
  const spec = formSpec(destination);
  const text = (k: string) => {
    const v = fd.get(PREFIX + k);
    return typeof v === "string" ? v.trim() : "";
  };
  if (spec.length === 1 && spec[0]!.name === "value") {
    const v = text("value");
    return spec[0]!.kind === "number" && v !== "" ? Number(v) : v;
  }
  const out: Record<string, unknown> = {};
  for (const f of spec) {
    if (f.kind === "checkbox") out[f.name] = fd.get(PREFIX + f.name) === "on";
    else if (f.kind === "days") out[f.name] = fd.getAll(PREFIX + f.name).map((d) => Number(d)).filter((d) => Number.isInteger(d));
    else if (f.kind === "lines") out[f.name] = text(f.name).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    else if (f.kind === "number") out[f.name] = text(f.name) === "" ? undefined : Number(text(f.name));
    else out[f.name] = text(f.name) || null;
  }
  return out;
}

export const DAY_OPTIONS: [string, string][] = WEEKDAYS.map((d, i) => [String(i + 1), d.slice(0, 3)]);
