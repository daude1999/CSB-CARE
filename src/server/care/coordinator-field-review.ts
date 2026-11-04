import { z } from "zod";

/**
 * Source-provenance and field-by-field review of proposed Care Coordinator
 * entries. This module contains no PHI constants and no database access.
 */
export const DESTINATIONS = {
  "overview": "Overview",
  "personal": "Personal details",
  "care.plans": "Care → Care plans",
  "care.risks": "Care → Risk assessments",
  "care.package": "Care → Care package",
  "care.medication": "Care → Medication",
  "health.incidents": "Health and Safety → Incidents",
  "health.bodymap": "Health and Safety → Body map",
  "visits.visits": "Visits → Visits",
  "visits.templates": "Visits → Templates",
  "visits.rota": "Visits → Rota",
  "visits.notes": "Visits → Visit notes",
  "visits.missed": "Visits → Missed calls",
  "documents.council": "Documents → Council Documents",
  "documents.other": "Documents → Other Documents",
  "contacts.people": "Contacts → Contact",
  "contacts.preferences": "Contacts → Carer preferences & carers",
  "history": "History",
} as const;
export type Destination = keyof typeof DESTINATIONS;
export const DECISIONS = ["APPROVE","EDITED","REJECT","CLARIFY","DUPLICATE"] as const;

/** Only these paths can be automatically applied through the current import. */
const writable = [
  /^serviceUser\.(firstName|lastName|dateOfBirth|nhsNumber|gender|addressLine1|addressLine2|town|postcode|phone|altPhone|firstLanguage|communicationNeeds|carePreferences|carerGenderPreference|accessNotes|preferredContactMethod)$/,
  /^contacts\.\d+\.(name|kind|relationship|phone|altPhone|isEmergency|isPrimary|canReceiveUpdates)$/,
  /^carePlan\.(summary|reviewDue)$/,
  /^carePlan\.sections\.(about_me|communication|personal_care|mobility|nutrition|medication|health|home|outcomes)\.(body|outcomes)$/,
  /^package\.(startDate|endDate|commissionedMinutesPerWeek|requirements)$/,
  /^visits\.\d+\.(label|weekdays|startMinute|durationMin|carersRequired|notes|taskIds|medicationRequired|callTypeId)$/,
  /^riskDrafts\.\d+\.(type|title|hazards|controls|level|reviewDue|requiredActions|responsiblePerson)$/,
];

export const reviewFieldSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/),
  destination: z.enum(Object.keys(DESTINATIONS) as [Destination,...Destination[]]),
  fieldPath: z.string().min(1).max(180),
  label: z.string().min(1).max(160),
  sourceDocument: z.string().min(1).max(200),
  sourcePage: z.number().int().positive(),
  sourceDate: z.string().max(30).optional(),
  confidence: z.enum(["HIGH","MEDIUM","LOW","UNVERIFIED"]),
  proposedValue: z.string().max(12000),
  existingValue: z.string().max(12000).optional(),
  discrepancy: z.string().max(2000).optional(),
  decision: z.enum(DECISIONS),
  reason: z.string().max(2000).optional(),
  /** Human-reviewed, not system-supplied: do not represent this as automatic verification. */
  reviewedBy: z.string().max(160).optional(),
}).strict();
export type ReviewField = z.infer<typeof reviewFieldSchema>;

export function isWritableField(path: string) {
  return writable.some(rule => rule.test(path));
}

export function reviewFindings(items: ReviewField[]) {
  const ids = new Set<string>();
  const blockers: string[] = [];
  for (const item of items) {
    if (ids.has(item.id)) blockers.push("Duplicate review item: " + item.id);
    ids.add(item.id);
    if (item.decision === "APPROVE" || item.decision === "EDITED") {
      if (!isWritableField(item.fieldPath)) blockers.push(item.id + ": destination is review-only; no automatic CRM writer");
      if (item.confidence === "LOW" || item.confidence === "UNVERIFIED")
        blockers.push(item.id + ": low-confidence entry needs clarification");
      if (item.existingValue !== undefined && item.existingValue !== item.proposedValue && !item.reason?.trim())
        blockers.push(item.id + ": conflicting existing value needs reason for change");
      if (!item.reviewedBy?.trim()) blockers.push(item.id + ": reviewer attribution missing");
    }
    if ((item.decision === "REJECT" || item.decision === "CLARIFY" || item.decision === "DUPLICATE") && !item.reason?.trim())
      blockers.push(item.id + ": reviewer must give a reason");
  }
  return {
    blockers,
    approved: items.filter(x=>x.decision === "APPROVE" || x.decision === "EDITED").length,
    held: items.filter(x=>x.decision === "CLARIFY" || x.confidence === "LOW" || x.confidence === "UNVERIFIED").length,
    rejected: items.filter(x=>x.decision === "REJECT" || x.decision === "DUPLICATE").length,
  };
}

/**
 * Source metadata must never be interpreted as clinical approval. Only known
 * path/destination combinations are automatically routed to existing models.
 */
export function expectedDestination(path: string): Destination | null {
  if (path.startsWith("serviceUser.")) return "personal";
  if (path.startsWith("contacts.")) return "contacts.people";
  if (path.startsWith("carePlan.")) return "care.plans";
  if (path.startsWith("riskDrafts.")) return "care.risks";
  if (path.startsWith("package.")) return "care.package";
  if (path.startsWith("visits.")) return "visits.templates";
  return null;
}
