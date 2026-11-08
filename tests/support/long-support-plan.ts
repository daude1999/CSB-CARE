import PDFDocument from "pdfkit";
import type { CareDocumentExtraction } from "@/server/ai/schemas";

/**
 * A long, realistic, entirely FICTIONAL council support plan for the automatic setup tests (owner's brief of 7 Nov
 * 2026): about 75 facts, with the repeats, gaps and problems real plans have. Every name, address and number is
 * invented. The scripted reading below plays the part of the AI: each quote is copied from a line of the PDF, so the
 * quotes are checked against the page exactly as a real reading is.
 *
 * What a person should be left with (and nothing else):
 *  - a possible safeguarding concern (urgent), a DNACPR mention with no form (review), the commissioned hours that
 *    differ from the timetable by 3 minutes a week (review), a Frameworki number of unknown type (follow-up), a
 *    temporary visit without an end date (follow-up), the funder to link (follow-up);
 *  - for managers: medication to reconcile, a historical fall and a skin finding to check.
 * Everything else (repeated contacts, a repeated care need, a repeated timetable row, the repeated name and date of
 * birth) is routine and must not reach a person.
 */

export const LONG_PLAN_PERSON = { firstName: "Charles", lastName: "Specimen", dob: "1938-05-14", postcode: "E3 0ZZ" };

const PAGES: string[][] = [
  [
    "Example Borough Council - Adult Social Care - Support Plan",
    "Date of plan: 01/11/2026",
    "Full name: Charles Specimen",
    "Preferred name: Charlie",
    "Date of birth: 14/05/1938",
    "Gender: Male",
    "NHS number: 999 000 0042",
    "Address: 5 Fiction Court, Sample Lane",
    "Town: London",
    "Postcode: E3 0ZZ",
    "Telephone: 0200 000 0201",
    "First language: English",
    "Communication: Use short sentences. Charles wears glasses for reading.",
    "Access: Ring the bell twice. Key safe by the door; the code is held by the office.",
    "Frameworki number: 2207714",
    "Council client number: CL-55120",
    "Package reference: PKG-77310",
    "Next of kin: Mary Specimen (Daughter) 0200 000 0202, key holder",
    "GP: Dr Sample, Example Health Centre, 0200 000 0203",
    "Social worker: Pat Example, Example Borough Council, 0200 000 0204",
    "District nurse: Example Community Nursing Team, 0200 000 0205",
    "Neighbour: Sam Neighbour 0200 000 0206, holds a spare key",
  ],
  [
    "About me: Charles was a postman for forty years and enjoys the radio and the football results.",
    "Daily routine: Charles likes to get up at about 08:00 and go to bed at about 21:00.",
    "Communication: Charles can become confused when rushed. Give him time to answer.",
    "Personal care: Charles needs help with a full wash and dressing in the morning.",
    "Continence: Charles uses pads at night and needs help to change them in the morning.",
    "Mobility: Charles walks with a frame indoors and needs two carers for the stand aid.",
    "Eating and drinking: Charles needs his meals prepared. He likes soft food and milky tea.",
    "Hydration: Encourage Charles to drink at every visit; he forgets to drink.",
    "Medication support: Carers assist with medication from the pharmacy blister pack.",
    "Health: Charles has heart failure and arthritis in both knees.",
    "Wellbeing: Charles feels lonely in the afternoons and enjoys a chat.",
    "Home: Charles requires support to declutter and organise items around his property.",
    "Emergency: If Charles cannot be found, contact Mary first, then the office.",
    "Outcomes: To stay safely at home, keep his flat tidy and see his daughter weekly.",
  ],
  [
    "Name: Charles Specimen   Date of birth: 14/05/1938",
    "Family contacts: Mary Specimen (Daughter) 0200 000 0202",
    "Emergency contact: Mary Specimen 0200 000 0202",
    "Home support: Charles requires support to declutter and organise items around his property.",
    "Carer preferences: Charles prefers male carers for personal care.",
    "Language: English only.",
    "Continuity: Charles would like the same small team of carers.",
    "Risk - Falls: Charles is unsteady when tired and fell in the hallway in June.",
    "Risk - Environment: Clutter in the hallway and living room is a trip hazard.",
    "Risk - Self-neglect: Charles does not always eat or drink when alone.",
    "Risk - Moving and handling: Stand aid with two carers for all transfers.",
    "Risk - Skin: Charles sits for long periods and has fragile skin on his heels.",
    "Risk - Medication: Charles has mixed up his tablets before.",
    "Concern: Charles said his nephew has been using his bank card without asking. Safeguarding referral to be considered.",
    "Resuscitation: Mary says there is a DNACPR in place. No form has been seen.",
  ],
  [
    "Funder: Example Borough Council",
    "Package start: 10/11/2026",
    "Package end: 10/05/2027",
    "Hours per week: 24.8",
    "Staffing: Two carers for the morning visit; all other visits single handed.",
    "Medication: Assist from blister pack, morning visit only.",
    "Medicine: Furosemide 40mg, one tablet in the morning",
    "Medicine: Ramipril 2.5mg, one capsule in the morning",
    "Medicine: Paracetamol 500mg, two tablets four times a day when needed for knee pain",
    "Medicine: Example-cream, apply to heels twice a day",
    "Allergy: Penicillin",
    "Previous incident: 15/06/2026 fall in the hallway, no injury, GP informed.",
    "Skin: Red area on the left heel noted by the district nurse in October.",
    "Call with Mary on 28/10/2026: Mary asked that visits start on 10 November.",
    "Call with Pat Example on 30/10/2026: the package was agreed at panel.",
  ],
  [
    "Timetable",
    "Morning | 08:00-09:00 | Mon-Sun | 2 carers | Personal care; Dress; Breakfast; Assist with medication",
    "Lunch | 12:30-13:00 | Mon-Sun | 1 carer | Prepare lunch; Encourage drinks",
    "Tea | 16:30-17:15 | Mon-Sun | 1 carer | Prepare tea; Encourage drinks",
    "Bed | 20:30-21:15 | Mon-Sun | 1 carer | Change pad; Help to bed",
    "Domestic | 11:00-12:00 | Mon, Thu | 1 carer | Declutter and tidy",
    "Wellbeing check | 15:00-15:45 | Tue | 1 carer | Chat; Drinks (temporary)",
    "Sitting | 14:00-15:00 | Sat | 1 carer | Companionship",
    "Shopping | 11:00-12:00 | Sun | family | Food shopping by Mary",
    "Timetable (continued)",
    "Morning | 08:00-09:00 | Mon-Sun | 2 carers | Personal care; Dress; Breakfast; Assist with medication",
  ],
];

export function longPlanPdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  PAGES.forEach((lines, i) => {
    if (i) doc.addPage();
    doc.fontSize(8);
    for (const l of lines) doc.text(l, { width: 520 });
  });
  doc.end();
  return done;
}

const at = (page: number, quote: string, temporal: "CURRENT" | "HISTORICAL" | "UNKNOWN" = "CURRENT") => {
  if (!PAGES[page - 1]!.some((l) => l.includes(quote))) throw new Error(`Fixture quote not on page ${page}: ${quote}`);
  return { page, quote, temporal };
};
const ALL = [1, 2, 3, 4, 5, 6, 7];
const plan = (section: CareDocumentExtraction["carePlan"][number]["section"], topic: CareDocumentExtraction["carePlan"][number]["topic"], support: string, page: number, quote: string, extra: Partial<CareDocumentExtraction["carePlan"][number]> = {}) =>
  ({ section, topic, canDo: null, support, how: null, preferences: null, outcome: null, clarify: null, ...at(page, quote), ...extra });

/** What the AI would return for longPlanPdf(). Options make the variants the other tests need. */
export function longPlanReading(opts: { secondDob?: string; hours?: string } = {}): CareDocumentExtraction {
  return {
    document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: "2026-11-01", pageCount: 5 },
    person: [
      { field: "firstName", value: "Charles", ...at(1, "Full name: Charles Specimen") },
      { field: "lastName", value: "Specimen", ...at(1, "Full name: Charles Specimen") },
      { field: "preferredName", value: "Charlie", ...at(1, "Preferred name: Charlie") },
      { field: "dateOfBirth", value: "14/05/1938", ...at(1, "Date of birth: 14/05/1938") },
      { field: "gender", value: "Male", ...at(1, "Gender: Male") },
      { field: "nhsNumber", value: "999 000 0042", ...at(1, "NHS number: 999 000 0042") },
      { field: "addressLine1", value: "5 Fiction Court, Sample Lane", ...at(1, "Address: 5 Fiction Court, Sample Lane") },
      { field: "town", value: "London", ...at(1, "Town: London") },
      { field: "postcode", value: "E3 0ZZ", ...at(1, "Postcode: E3 0ZZ") },
      { field: "phone", value: "0200 000 0201", ...at(1, "Telephone: 0200 000 0201") },
      { field: "firstLanguage", value: "English", ...at(1, "First language: English") },
      { field: "communicationNeeds", value: "Use short sentences. Charles wears glasses for reading.", ...at(1, "Use short sentences. Charles wears glasses for reading.") },
      { field: "accessNotes", value: "Ring the bell twice. Key safe by the door; the code is held by the office.", ...at(1, "Ring the bell twice.") },
      // The header repeated on page 3: the same name and date of birth again (or a different date, for the conflict test).
      { field: "firstName", value: "Charles", ...at(3, "Name: Charles Specimen") },
      { field: "lastName", value: "Specimen", ...at(3, "Name: Charles Specimen") },
      { field: "dateOfBirth", value: opts.secondDob ?? "14/05/1938", ...at(3, "Date of birth: 14/05/1938") },
    ],
    references: [
      { type: "COUNCIL_CLIENT", issuer: "Example Borough Council", value: "2207714", system: "Frameworki", typeClear: false, ...at(1, "Frameworki number: 2207714") },
      { type: "COUNCIL_CLIENT", issuer: "Example Borough Council", value: "CL-55120", system: null, typeClear: true, ...at(1, "Council client number: CL-55120") },
      { type: "COUNCIL_PACKAGE", issuer: "Example Borough Council", value: "PKG-77310", system: null, typeClear: true, ...at(1, "Package reference: PKG-77310") },
    ],
    contacts: [
      { kind: "NEXT_OF_KIN", name: "Mary Specimen", relationship: "Daughter", phone: "0200 000 0202", email: null, address: null, isEmergency: true, isKeyHolder: true, authority: null, ...at(1, "Next of kin: Mary Specimen (Daughter) 0200 000 0202") },
      { kind: "GP", name: "Dr Sample", relationship: null, phone: "0200 000 0203", email: null, address: "Example Health Centre", isEmergency: false, isKeyHolder: false, authority: null, ...at(1, "GP: Dr Sample, Example Health Centre, 0200 000 0203") },
      { kind: "SOCIAL_WORKER", name: "Pat Example", relationship: null, phone: "0200 000 0204", email: null, address: null, isEmergency: false, isKeyHolder: false, authority: null, ...at(1, "Social worker: Pat Example") },
      { kind: "DISTRICT_NURSE", name: "Example Community Nursing Team", relationship: null, phone: "0200 000 0205", email: null, address: null, isEmergency: false, isKeyHolder: false, authority: null, ...at(1, "District nurse: Example Community Nursing Team") },
      { kind: "OTHER", name: "Sam Neighbour", relationship: "Neighbour", phone: "0200 000 0206", email: null, address: null, isEmergency: false, isKeyHolder: true, authority: null, ...at(1, "Neighbour: Sam Neighbour 0200 000 0206") },
      { kind: "FAMILY", name: "Mary Specimen", relationship: "Daughter", phone: "0200 000 0202", email: null, address: null, isEmergency: false, isKeyHolder: false, authority: null, ...at(3, "Family contacts: Mary Specimen (Daughter) 0200 000 0202") },
      { kind: "NEXT_OF_KIN", name: "Mary Specimen", relationship: null, phone: "0200 000 0202", email: null, address: null, isEmergency: true, isKeyHolder: false, authority: null, ...at(3, "Emergency contact: Mary Specimen 0200 000 0202") },
    ],
    carerPreferences: [
      { kind: "GENDER", value: "Prefers male carers for personal care", ...at(3, "Charles prefers male carers for personal care.") },
      { kind: "LANGUAGE", value: "English only", ...at(3, "Language: English only.") },
      { kind: "CONTINUITY", value: "The same small team of carers", ...at(3, "Charles would like the same small team of carers.") },
    ],
    carePlan: [
      plan("about_me", "ABOUT_ME", "Was a postman for forty years; enjoys the radio and the football results.", 2, "Charles was a postman for forty years"),
      plan("about_me", "DAILY_ROUTINE", "Gets up at about 08:00 and goes to bed at about 21:00.", 2, "Charles likes to get up at about 08:00"),
      plan("communication", "COGNITION_MEMORY", "Can become confused when rushed.", 2, "Charles can become confused when rushed.", { how: "Give him time to answer." }),
      plan("personal_care", "WASHING_DRESSING", "Help with a full wash and dressing in the morning.", 2, "Charles needs help with a full wash and dressing in the morning."),
      plan("personal_care", "TOILETING_CONTINENCE", "Uses pads at night; help to change them in the morning.", 2, "Charles uses pads at night"),
      plan("mobility", "MOBILITY_TRANSFERS", "Walks with a frame indoors; two carers for the stand aid.", 2, "Charles walks with a frame indoors"),
      plan("nutrition", "EATING_DRINKING", "Meals prepared; likes soft food and milky tea.", 2, "Charles needs his meals prepared."),
      plan("nutrition", "NUTRITION_HYDRATION", "Encourage drinks at every visit; he forgets to drink.", 2, "Encourage Charles to drink at every visit"),
      plan("medication", "MEDICATION_SUPPORT", "Carers assist with medication from the pharmacy blister pack.", 2, "Carers assist with medication from the pharmacy blister pack."),
      plan("health", "HEALTH_CONDITIONS", "Heart failure and arthritis in both knees.", 2, "Charles has heart failure and arthritis in both knees."),
      plan("health", "EMOTIONAL_WELLBEING", "Feels lonely in the afternoons and enjoys a chat.", 2, "Charles feels lonely in the afternoons"),
      plan("home", "HOUSEHOLD", "Charles requires support to declutter and organise items around his property.", 2, "Charles requires support to declutter and organise items around his property."),
      plan("home", "EMERGENCY", "If Charles cannot be found, contact Mary first, then the office.", 2, "If Charles cannot be found, contact Mary first"),
      plan("outcomes", "OUTCOMES", "Stay safely at home, keep his flat tidy and see his daughter weekly.", 2, "To stay safely at home, keep his flat tidy", { outcome: "To stay safely at home, keep his flat tidy and see his daughter weekly." }),
      // The same need again on page 3, without a day for the decluttering: routine, consolidated, never a warning.
      plan("home", "HOUSEHOLD", "Charles requires support to declutter and organise items around his property.", 3, "Home support: Charles requires support to declutter"),
    ],
    risks: [
      { type: "FALLS", title: "Falls", hazard: "Unsteady when tired; fell in the hallway in June.", whoAffected: "Charles", existingControls: "Walking frame", mitigation: null, assessmentGaps: null, level: null, ...at(3, "Risk - Falls: Charles is unsteady when tired") },
      { type: "ENVIRONMENT", title: "Clutter and trip hazards", hazard: "Clutter in the hallway and living room is a trip hazard.", whoAffected: "Charles and carers", existingControls: null, mitigation: null, assessmentGaps: null, level: null, ...at(3, "Clutter in the hallway and living room is a trip hazard.") },
      { type: "NUTRITION", title: "Self-neglect: eating and drinking", hazard: "Does not always eat or drink when alone.", whoAffected: "Charles", existingControls: null, mitigation: null, assessmentGaps: null, level: null, ...at(3, "Charles does not always eat or drink when alone.") },
      { type: "MOVING_HANDLING", title: "Transfers with a stand aid", hazard: "Stand aid with two carers for all transfers.", whoAffected: "Charles and carers", existingControls: "Two carers", mitigation: null, assessmentGaps: null, level: null, ...at(3, "Stand aid with two carers for all transfers.") },
      { type: "PRESSURE_SKIN", title: "Fragile skin on heels", hazard: "Sits for long periods; fragile skin on heels.", whoAffected: "Charles", existingControls: null, mitigation: null, assessmentGaps: null, level: null, ...at(3, "has fragile skin on his heels") },
      { type: "MEDICATION_SUPPORT", title: "Mixing up tablets", hazard: "Has mixed up his tablets before.", whoAffected: "Charles", existingControls: "Blister pack", mitigation: null, assessmentGaps: null, level: null, ...at(3, "Charles has mixed up his tablets before.") },
    ],
    package: [
      { field: "funder", value: "Example Borough Council", ...at(4, "Funder: Example Borough Council") },
      { field: "startDate", value: "2026-11-10", ...at(4, "Package start: 10/11/2026") },
      { field: "endDate", value: "2027-05-10", ...at(4, "Package end: 10/05/2027") },
      { field: "hoursPerWeek", value: opts.hours ?? "24.8", ...at(4, "Hours per week: 24.8") },
      { field: "requirements", value: "Two carers for the morning visit; all other visits single handed.", ...at(4, "Staffing: Two carers for the morning visit") },
    ],
    visits: [
      { label: "Morning", weekdays: ALL, startTime: "08:00", durationMinutes: 60, carers: 2, tasks: ["Personal care", "Dress", "Breakfast", "Assist with medication"], fundedBy: "COUNCIL", medicationPrompt: true, endDate: null, ...at(5, "Morning | 08:00-09:00 | Mon-Sun | 2 carers") },
      { label: "Lunch", weekdays: ALL, startTime: "12:30", durationMinutes: 30, carers: 1, tasks: ["Prepare lunch", "Encourage drinks"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(5, "Lunch | 12:30-13:00") },
      { label: "Tea", weekdays: ALL, startTime: "16:30", durationMinutes: 45, carers: 1, tasks: ["Prepare tea", "Encourage drinks"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(5, "Tea | 16:30-17:15") },
      { label: "Bed", weekdays: ALL, startTime: "20:30", durationMinutes: 45, carers: 1, tasks: ["Change pad", "Help to bed"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(5, "Bed | 20:30-21:15") },
      { label: "Domestic", weekdays: [1, 4], startTime: "11:00", durationMinutes: 60, carers: 1, tasks: ["Declutter and tidy"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(5, "Domestic | 11:00-12:00 | Mon, Thu") },
      { label: "Wellbeing check", weekdays: [2], startTime: "15:00", durationMinutes: 45, carers: 1, tasks: ["Chat", "Drinks"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, temporary: true, ...at(5, "Wellbeing check | 15:00-15:45 | Tue") },
      { label: "Sitting", weekdays: [6], startTime: "14:00", durationMinutes: 60, carers: 1, tasks: ["Companionship"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, ...at(5, "Sitting | 14:00-15:00 | Sat") },
      { label: "Shopping", weekdays: [7], startTime: "11:00", durationMinutes: 60, carers: 1, tasks: ["Food shopping by Mary"], fundedBy: "CARERS_SERVICE", medicationPrompt: false, endDate: null, ...at(5, "Shopping | 11:00-12:00 | Sun | family") },
      // The morning row repeated on the continuation page.
      { label: "Morning", weekdays: ALL, startTime: "08:00", durationMinutes: 60, carers: 2, tasks: ["Personal care", "Dress", "Breakfast", "Assist with medication"], fundedBy: "COUNCIL", medicationPrompt: true, endDate: null, ...at(5, "Timetable (continued)") },
    ],
    medication: {
      arrangement: { support: "ASSIST", detail: "Assist from blister pack, morning visit only.", ...at(4, "Medication: Assist from blister pack, morning visit only.") },
      items: [
        { name: "Furosemide", strength: "40mg", dose: "one tablet", route: "oral", frequency: "in the morning", times: ["morning"], asRequired: false, prnInstructions: null, status: "CURRENT", note: null, ...at(4, "Medicine: Furosemide 40mg") },
        { name: "Ramipril", strength: "2.5mg", dose: "one capsule", route: "oral", frequency: "in the morning", times: ["morning"], asRequired: false, prnInstructions: null, status: "CURRENT", note: null, ...at(4, "Medicine: Ramipril 2.5mg") },
        { name: "Paracetamol", strength: "500mg", dose: "two tablets", route: "oral", frequency: "four times a day when needed", times: [], asRequired: true, prnInstructions: "for knee pain", status: "CURRENT", note: null, ...at(4, "Medicine: Paracetamol 500mg") },
        { name: "Example-cream", strength: null, dose: "apply", route: "topical", frequency: "twice a day", times: [], asRequired: false, prnInstructions: null, status: "CURRENT", note: null, ...at(4, "Medicine: Example-cream") },
      ],
      allergies: [{ value: "Penicillin", ...at(4, "Allergy: Penicillin") }],
    },
    incidents: [{ date: "2026-06-15", type: "Fall", description: "Fall in the hallway, no injury, GP informed.", consequences: "No injury", actions: "GP informed", ...at(4, "Previous incident: 15/06/2026 fall in the hallway", "HISTORICAL") }],
    skin: [{ date: null, area: "Left heel", finding: "Red area", description: "Red area on the left heel noted by the district nurse in October.", ...at(4, "Skin: Red area on the left heel") }],
    flags: [
      { text: "Charles said his nephew has been using his bank card without asking. Safeguarding referral to be considered.", page: 3 },
      { text: "Mary says there is a DNACPR in place. No form has been seen.", page: 3 },
    ],
    missing: [],
    unreadable: [],
    communications: [
      { summary: "Mary asked that visits start on 10 November.", contactName: "Mary Specimen", method: "TELEPHONE", date: "2026-10-28", ...at(4, "Call with Mary on 28/10/2026") },
      { summary: "The package was agreed at panel.", contactName: "Pat Example", method: "TELEPHONE", date: "2026-10-30", ...at(4, "Call with Pat Example on 30/10/2026") },
    ],
  };
}

/** Facts in the reading above, counted the way readingToFacts counts them. */
export const LONG_PLAN_FACTS = 16 + 3 + 7 + 3 + 15 + 6 + 5 + 9 + 6 + 1 + 1 + 2;
