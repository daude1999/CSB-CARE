import type { CareDocumentExtraction } from "@/server/ai/schemas";

/**
 * A realistic, entirely FICTIONAL council support plan of six pages, delivered as a SCAN: the PDF holds page images
 * only, with no text layer (tests/support/scanned-support-plan.pdf, made by make-scanned-plan.ts from the lines below).
 * Over 100 facts, with the repeats real plans have. Every name, address and number is invented.
 *
 * Used for the owner's brief of 7 Nov 2026 ("Remove redundant approval workflows"): CSB AI must set the person up from
 * a scanned plan with no fact-by-fact approval. Because the pages have no text, quotes cannot be checked against the
 * page; the facts are still saved, the original is filed, and nothing becomes an approval queue.
 *
 * What a person should be left with: the date of birth and NHS number for a registered manager (the coordinator may
 * not save them), the Frameworki number's type, the funder to link, the risk levels the plan does not state, the
 * DNACPR mention to verify against the form, and, for managers, the medication list to reconcile and the history.
 */

export const SCANNED_PLAN_PERSON = { firstName: "Winifred", lastName: "Sample", dob: "1941-02-09", postcode: "E1 0ZZ" };

export const SCANNED_PAGES: string[][] = [
  [
    "Sample Borough Council - Adult Social Care",
    "Care and Support Plan (scanned copy)",
    "Date of plan: 03/11/2026",
    "Full name: Winifred Sample",
    "Known as: Winnie",
    "Date of birth: 09/02/1941",
    "Gender: Female",
    "NHS number: 999 000 0077",
    "Address: Flat 12, Invented House",
    "Address line 2: Placeholder Road",
    "Town: London",
    "Postcode: E1 0ZZ",
    "Home telephone: 0200 000 0301",
    "Mobile: 07000 000302",
    "First language: English",
    "Communication: Winnie is hard of hearing on the left. Speak clearly on her right side.",
    "Access: Key safe to the right of the front door. Code held by the office. Ring first.",
    "Frameworki number: 3318820",
    "Council client number: CL-66231",
    "Package reference: PKG-88412",
  ],
  [
    "Contacts",
    "Next of kin: Nora Sample (Daughter) 0200 000 0303, key holder",
    "Son: Albert Sample 0200 000 0304",
    "Granddaughter: Lily Sample 0200 000 0305",
    "GP: Dr Invented, Placeholder Surgery, 0200 000 0306",
    "Pharmacy: Sample Pharmacy, 0200 000 0307, delivers blister packs on Mondays",
    "Social worker: Jo Example, Sample Borough Council, 0200 000 0308",
    "District nurse: Placeholder Community Nursing, 0200 000 0309",
    "Occupational therapist: Kim Example, 0200 000 0310",
    "Neighbour: Ray Neighbour 0200 000 0311, holds a spare key",
    "Dentist: Sample Dental Practice 0200 000 0312",
    "Carer preferences",
    "Winnie prefers female carers for personal care.",
    "Winnie would like carers who speak English clearly.",
    "Winnie would like the same small team of carers.",
    "Winnie does not want visits from carers who wear strong perfume.",
    "Winnie is Church of England and likes to watch the Sunday service on television.",
  ],
  [
    "About me: Winnie was a school cook for thirty years and loves crosswords and her cat, Pepper.",
    "Daily routine: Winnie gets up at about 07:30 and likes to be in bed by 21:30.",
    "Choice: Winnie likes to choose her own clothes each morning.",
    "Faith: Winnie likes to watch the Sunday service on television.",
    "Community: Winnie goes to a lunch club on Wednesdays, taken by Albert.",
    "Hearing: Winnie is hard of hearing on the left. Face her and speak clearly.",
    "Memory: Winnie forgets recent conversations. Leave a note of what was done.",
    "Washing: Winnie needs help with a full wash at the sink in the morning.",
    "Showering: Winnie has a shower with help on Wednesdays and Saturdays.",
    "Dressing: Winnie needs help with buttons and stockings.",
    "Continence: Winnie wears pads at night and needs help to change them in the morning.",
    "Toileting: Winnie uses a commode at night; empty and clean it each morning.",
    "Mobility: Winnie walks with a frame indoors and uses a wheelchair outdoors.",
    "Transfers: Winnie transfers with one carer and a perching stool.",
    "Meals: Winnie needs her meals prepared. She likes fish on Fridays.",
    "Drinks: Leave a flask of tea and a jug of squash within reach at every visit.",
    "Diet: Winnie has a soft diet after dental work.",
    "Medication: Carers assist with medication from the pharmacy blister pack.",
    "Creams: Carers apply the prescribed cream to her legs at the morning visit.",
  ],
  [
    "Name: Winifred Sample   Date of birth: 09/02/1941",
    "Health: Winnie has type 2 diabetes, high blood pressure and arthritis in her hands.",
    "Diabetes: Watch for signs of a low blood sugar: sweating, confusion, shakiness.",
    "Wellbeing: Winnie feels low in the evenings since her husband died.",
    "Sleep: Winnie sleeps poorly and sometimes gets up in the night.",
    "Night: Leave the hall light on and the commode by the bed.",
    "Home: Winnie needs help to keep the kitchen and bathroom clean.",
    "Cat: Make sure Pepper has food and water at the morning visit.",
    "Home safety: Check the cooker is off at every visit.",
    "Emergency: If Winnie does not answer, call Nora, then the office.",
    "Outcomes: To stay in her own flat, keep her cat and go to the lunch club.",
    "Outcome: To feel less lonely in the evenings.",
    "Home support: Winnie needs help to keep the kitchen and bathroom clean.",
    "Next of kin: Nora Sample (Daughter) 0200 000 0303",
  ],
  [
    "Risks",
    "Risk - Falls: Winnie fell twice this year when getting up at night. Level: High. Controls: Hall light on, commode by the bed, pendant alarm worn.",
    "Risk - Moving and handling: One carer with a perching stool for transfers. Level: Medium. Controls: Perching stool, frame within reach.",
    "Risk - Skin: Winnie sits for long periods and has dry, fragile skin on her shins.",
    "Risk - Diabetes: Winnie sometimes skips meals and may have a low blood sugar.",
    "Risk - Environment: Loose rugs in the living room are a trip hazard.",
    "Risk - Medication: Winnie has taken evening tablets in the morning before.",
    "Risk - Isolation: Winnie spends most evenings alone and feels low.",
    "Risk - Fire: Winnie sometimes leaves the cooker on.",
    "Resuscitation: Nora says a DNACPR form was signed in hospital. The form has not been seen.",
    "Medication",
    "Support: Assist from the blister pack at the morning and teatime visits.",
    "Medicine: Metformin 500mg, one tablet twice a day with food",
    "Medicine: Amlodipine 5mg, one tablet in the morning",
    "Medicine: Paracetamol 500mg, two tablets up to four times a day when needed",
    "Medicine: Emollient cream, apply to both shins in the morning",
    "Medicine: Sertraline 50mg, one tablet in the morning",
    "Allergy: Penicillin",
    "Allergy: Elastoplast",
    "Previous incident: 02/03/2026 fall at night, bruised hip, GP informed.",
    "Skin: Dry patch on the right shin noted by the district nurse.",
  ],
  [
    "Package",
    "Funder: Sample Borough Council",
    "Package start: 17/11/2026",
    "Package end: 17/05/2027",
    "Hours per week: 22",
    "Staffing: One carer for every visit.",
    "Purchase order: PO-55117",
    "Timetable",
    "Morning | 07:30-08:30 | Mon-Sun | 1 carer | Wash; Dress; Breakfast; Assist with medication; Feed Pepper",
    "Lunch | 12:30-13:00 | Mon-Sun | 1 carer | Prepare lunch; Drinks",
    "Tea | 17:00-17:30 | Mon-Sun | 1 carer | Prepare tea; Assist with medication",
    "Bed | 21:00-21:30 | Mon-Sun | 1 carer | Night clothes; Commode by the bed; Hall light on",
    "Shower | 10:00-10:45 | Wed, Sat | 1 carer | Shower; Change bedding",
    "Domestic | 10:00-11:00 | Fri | 1 carer | Clean kitchen and bathroom",
    "Sitting | 14:00-16:00 | Sun | 1 carer | Companionship; Crossword",
    "Shopping | 11:00-12:00 | Tue | family | Food shopping by Albert",
    "Morning | 07:30-08:30 | Mon-Sun | 1 carer | Wash; Dress; Breakfast; Assist with medication; Feed Pepper",
    "Notes of calls",
    "Call with Nora on 30/10/2026: Nora asked for female carers only.",
    "Call with Jo Example on 31/10/2026: the package was agreed at panel.",
    "Call with Sample Pharmacy on 01/11/2026: blister packs are delivered on Mondays.",
    "Call with Albert on 02/11/2026: Albert will keep taking Winnie to the lunch club.",
  ],
];

const at = (page: number, quote: string, temporal: "CURRENT" | "HISTORICAL" | "UNKNOWN" = "CURRENT") => {
  if (!SCANNED_PAGES[page - 1]!.some((l) => l.includes(quote))) throw new Error(`Fixture quote not on page ${page}: ${quote}`);
  return { page, quote, temporal };
};
const ALL = [1, 2, 3, 4, 5, 6, 7];
type PlanRow = CareDocumentExtraction["carePlan"][number];
const plan = (section: PlanRow["section"], topic: PlanRow["topic"], support: string, page: number, quote: string, extra: Partial<PlanRow> = {}): PlanRow =>
  ({ section, topic, canDo: null, support, how: null, preferences: null, outcome: null, clarify: null, ...at(page, quote), ...extra });
const contact = (kind: CareDocumentExtraction["contacts"][number]["kind"], name: string, relationship: string | null, phone: string, page: number, quote: string, extra: Partial<CareDocumentExtraction["contacts"][number]> = {}) =>
  ({ kind, name, relationship, phone, email: null, address: null, isEmergency: false, isKeyHolder: false, authority: null, ...at(page, quote), ...extra });
const risk = (type: CareDocumentExtraction["risks"][number]["type"], title: string, hazard: string, page: number, quote: string, extra: Partial<CareDocumentExtraction["risks"][number]> = {}) =>
  ({ type, title, hazard, whoAffected: "Winnie", existingControls: null, mitigation: null, assessmentGaps: null, level: null, ...at(page, quote), ...extra });
const visit = (label: string, weekdays: number[], startTime: string, durationMinutes: number, tasks: string[], quote: string, extra: Partial<CareDocumentExtraction["visits"][number]> = {}) =>
  ({ label, weekdays, startTime, durationMinutes, carers: 1, tasks, fundedBy: "COUNCIL" as const, medicationPrompt: false, endDate: null, ...at(6, quote), ...extra });
const medicine = (name: string, strength: string | null, dose: string, route: string, frequency: string, quote: string, asRequired = false) =>
  ({ name, strength, dose, route, frequency, times: [], asRequired, prnInstructions: asRequired ? "when needed for pain" : null, status: "CURRENT" as const, note: null, ...at(5, quote) });

/** What the AI would return for the scanned plan (it reads the page images). */
export function scannedPlanReading(): CareDocumentExtraction {
  return {
    document: { kind: "SUPPORT_PLAN", issuer: "Sample Borough Council", issuerKind: "COUNCIL", documentDate: "2026-11-03", pageCount: 6 },
    person: [
      { field: "firstName", value: "Winifred", ...at(1, "Full name: Winifred Sample") },
      { field: "lastName", value: "Sample", ...at(1, "Full name: Winifred Sample") },
      { field: "preferredName", value: "Winnie", ...at(1, "Known as: Winnie") },
      { field: "dateOfBirth", value: "09/02/1941", ...at(1, "Date of birth: 09/02/1941") },
      { field: "gender", value: "Female", ...at(1, "Gender: Female") },
      { field: "nhsNumber", value: "999 000 0077", ...at(1, "NHS number: 999 000 0077") },
      { field: "addressLine1", value: "Flat 12, Invented House", ...at(1, "Address: Flat 12, Invented House") },
      { field: "addressLine2", value: "Placeholder Road", ...at(1, "Address line 2: Placeholder Road") },
      { field: "town", value: "London", ...at(1, "Town: London") },
      { field: "postcode", value: "E1 0ZZ", ...at(1, "Postcode: E1 0ZZ") },
      { field: "phone", value: "0200 000 0301", ...at(1, "Home telephone: 0200 000 0301") },
      { field: "altPhone", value: "07000 000302", ...at(1, "Mobile: 07000 000302") },
      { field: "firstLanguage", value: "English", ...at(1, "First language: English") },
      { field: "communicationNeeds", value: "Hard of hearing on the left. Speak clearly on her right side.", ...at(1, "Winnie is hard of hearing on the left.") },
      { field: "accessNotes", value: "Key safe to the right of the front door. Code held by the office. Ring first.", ...at(1, "Key safe to the right of the front door.") },
      // The header repeated on page 4.
      { field: "firstName", value: "Winifred", ...at(4, "Name: Winifred Sample") },
      { field: "lastName", value: "Sample", ...at(4, "Name: Winifred Sample") },
    ],
    references: [
      { type: "COUNCIL_CLIENT", issuer: "Sample Borough Council", value: "3318820", system: "Frameworki", typeClear: false, ...at(1, "Frameworki number: 3318820") },
      { type: "COUNCIL_CLIENT", issuer: "Sample Borough Council", value: "CL-66231", system: null, typeClear: true, ...at(1, "Council client number: CL-66231") },
      { type: "COUNCIL_PACKAGE", issuer: "Sample Borough Council", value: "PKG-88412", system: null, typeClear: true, ...at(1, "Package reference: PKG-88412") },
    ],
    contacts: [
      contact("NEXT_OF_KIN", "Nora Sample", "Daughter", "0200 000 0303", 2, "Next of kin: Nora Sample (Daughter) 0200 000 0303", { isEmergency: true, isKeyHolder: true }),
      contact("FAMILY", "Albert Sample", "Son", "0200 000 0304", 2, "Son: Albert Sample 0200 000 0304"),
      contact("FAMILY", "Lily Sample", "Granddaughter", "0200 000 0305", 2, "Granddaughter: Lily Sample 0200 000 0305"),
      contact("GP", "Dr Invented", null, "0200 000 0306", 2, "GP: Dr Invented, Placeholder Surgery", { address: "Placeholder Surgery" }),
      contact("PHARMACY", "Sample Pharmacy", null, "0200 000 0307", 2, "Pharmacy: Sample Pharmacy, 0200 000 0307"),
      contact("SOCIAL_WORKER", "Jo Example", null, "0200 000 0308", 2, "Social worker: Jo Example"),
      contact("DISTRICT_NURSE", "Placeholder Community Nursing", null, "0200 000 0309", 2, "District nurse: Placeholder Community Nursing"),
      contact("OTHER", "Kim Example", "Occupational therapist", "0200 000 0310", 2, "Occupational therapist: Kim Example"),
      contact("OTHER", "Ray Neighbour", "Neighbour", "0200 000 0311", 2, "Neighbour: Ray Neighbour 0200 000 0311", { isKeyHolder: true }),
      contact("OTHER", "Sample Dental Practice", "Dentist", "0200 000 0312", 2, "Dentist: Sample Dental Practice"),
      // Nora again on page 4: one contact, never a warning.
      contact("NEXT_OF_KIN", "Nora Sample", "Daughter", "0200 000 0303", 4, "Next of kin: Nora Sample (Daughter) 0200 000 0303", { isEmergency: true }),
    ],
    carerPreferences: [
      { kind: "GENDER", value: "Prefers female carers for personal care", ...at(2, "Winnie prefers female carers for personal care.") },
      { kind: "LANGUAGE", value: "Carers who speak English clearly", ...at(2, "carers who speak English clearly") },
      { kind: "CONTINUITY", value: "The same small team of carers", ...at(2, "the same small team of carers") },
      { kind: "NOT_WANTED", value: "No carers wearing strong perfume", ...at(2, "strong perfume") },
      { kind: "CULTURE", value: "Church of England; watches the Sunday service on television", ...at(2, "Winnie is Church of England") },
    ],
    carePlan: [
      plan("about_me", "ABOUT_ME", "Was a school cook for thirty years; loves crosswords and her cat, Pepper.", 3, "Winnie was a school cook for thirty years"),
      plan("about_me", "DAILY_ROUTINE", "Gets up at about 07:30; likes to be in bed by 21:30.", 3, "Winnie gets up at about 07:30"),
      plan("about_me", "INDEPENDENCE_CHOICE", "Chooses her own clothes each morning.", 3, "Winnie likes to choose her own clothes each morning."),
      plan("about_me", "CULTURE_RELIGION", "Likes to watch the Sunday service on television.", 3, "Faith: Winnie likes to watch the Sunday service"),
      plan("about_me", "COMMUNITY", "Goes to a lunch club on Wednesdays, taken by Albert.", 3, "Winnie goes to a lunch club on Wednesdays"),
      plan("communication", "COMMUNICATION", "Hard of hearing on the left.", 3, "Hearing: Winnie is hard of hearing on the left.", { how: "Face her and speak clearly." }),
      plan("communication", "COGNITION_MEMORY", "Forgets recent conversations.", 3, "Winnie forgets recent conversations.", { how: "Leave a note of what was done." }),
      plan("personal_care", "WASHING_DRESSING", "Help with a full wash at the sink in the morning.", 3, "Winnie needs help with a full wash at the sink"),
      plan("personal_care", "PERSONAL_CARE", "Shower with help on Wednesdays and Saturdays.", 3, "Winnie has a shower with help on Wednesdays and Saturdays."),
      plan("personal_care", "WASHING_DRESSING", "Help with buttons and stockings.", 3, "Winnie needs help with buttons and stockings."),
      plan("personal_care", "TOILETING_CONTINENCE", "Wears pads at night; help to change them in the morning.", 3, "Winnie wears pads at night"),
      plan("personal_care", "TOILETING_CONTINENCE", "Uses a commode at night; empty and clean it each morning.", 3, "Winnie uses a commode at night"),
      plan("mobility", "MOBILITY_TRANSFERS", "Walks with a frame indoors; wheelchair outdoors.", 3, "Winnie walks with a frame indoors"),
      plan("mobility", "MOBILITY_TRANSFERS", "Transfers with one carer and a perching stool.", 3, "Winnie transfers with one carer and a perching stool."),
      plan("nutrition", "EATING_DRINKING", "Meals prepared; likes fish on Fridays.", 3, "Winnie needs her meals prepared."),
      plan("nutrition", "NUTRITION_HYDRATION", "Leave a flask of tea and a jug of squash within reach at every visit.", 3, "Leave a flask of tea and a jug of squash"),
      plan("nutrition", "EATING_DRINKING", "Soft diet after dental work.", 3, "Winnie has a soft diet after dental work."),
      plan("medication", "MEDICATION_SUPPORT", "Carers assist with medication from the pharmacy blister pack.", 3, "Carers assist with medication from the pharmacy blister pack."),
      plan("medication", "MEDICATION_SUPPORT", "Apply the prescribed cream to her legs at the morning visit.", 3, "Carers apply the prescribed cream to her legs"),
      plan("health", "HEALTH_CONDITIONS", "Type 2 diabetes, high blood pressure and arthritis in her hands.", 4, "Winnie has type 2 diabetes"),
      plan("health", "HEALTH_CONDITIONS", "Watch for signs of a low blood sugar: sweating, confusion, shakiness.", 4, "Watch for signs of a low blood sugar"),
      plan("health", "EMOTIONAL_WELLBEING", "Feels low in the evenings since her husband died.", 4, "Winnie feels low in the evenings"),
      plan("health", "SLEEP_NIGHT", "Sleeps poorly and sometimes gets up in the night.", 4, "Winnie sleeps poorly"),
      plan("home", "HOME_SAFETY", "Leave the hall light on and the commode by the bed.", 4, "Leave the hall light on and the commode by the bed."),
      plan("home", "HOUSEHOLD", "Help to keep the kitchen and bathroom clean.", 4, "Home: Winnie needs help to keep the kitchen and bathroom clean."),
      plan("home", "HOUSEHOLD", "Make sure Pepper has food and water at the morning visit.", 4, "Make sure Pepper has food and water"),
      plan("home", "HOME_SAFETY", "Check the cooker is off at every visit.", 4, "Check the cooker is off at every visit."),
      plan("home", "EMERGENCY", "If Winnie does not answer, call Nora, then the office.", 4, "If Winnie does not answer, call Nora"),
      plan("outcomes", "OUTCOMES", "Stay in her own flat, keep her cat and go to the lunch club.", 4, "To stay in her own flat", { outcome: "To stay in her own flat, keep her cat and go to the lunch club." }),
      plan("outcomes", "OUTCOMES", "Feel less lonely in the evenings.", 4, "To feel less lonely in the evenings.", { outcome: "To feel less lonely in the evenings." }),
      // The same household need again on page 4: consolidated, never a warning.
      plan("home", "HOUSEHOLD", "Help to keep the kitchen and bathroom clean.", 4, "Home support: Winnie needs help to keep the kitchen and bathroom clean."),
    ],
    risks: [
      // Two completed assessments in the plan (a level and controls): saved as the council's assessment.
      risk("FALLS", "Falls at night", "Fell twice this year when getting up at night.", 5, "Winnie fell twice this year when getting up at night.", { level: "HIGH", existingControls: "Hall light on, commode by the bed, pendant alarm worn." }),
      risk("MOVING_HANDLING", "Transfers with a perching stool", "One carer with a perching stool for transfers.", 5, "One carer with a perching stool for transfers.", { level: "MEDIUM", existingControls: "Perching stool, frame within reach." }),
      // Narrative only: saved as AI-generated assessment information.
      risk("PRESSURE_SKIN", "Fragile skin on the shins", "Sits for long periods; dry, fragile skin on her shins.", 5, "dry, fragile skin on her shins"),
      risk("NUTRITION", "Low blood sugar", "Sometimes skips meals and may have a low blood sugar.", 5, "Winnie sometimes skips meals"),
      risk("ENVIRONMENT", "Loose rugs", "Loose rugs in the living room are a trip hazard.", 5, "Loose rugs in the living room are a trip hazard."),
      risk("MEDICATION_SUPPORT", "Taking tablets at the wrong time", "Has taken evening tablets in the morning before.", 5, "Winnie has taken evening tablets in the morning before."),
      risk("OTHER", "Isolation in the evenings", "Spends most evenings alone and feels low.", 5, "Winnie spends most evenings alone"),
      risk("ENVIRONMENT", "Cooker left on", "Sometimes leaves the cooker on.", 5, "Winnie sometimes leaves the cooker on."),
    ],
    package: [
      { field: "funder", value: "Sample Borough Council", ...at(6, "Funder: Sample Borough Council") },
      { field: "startDate", value: "2026-11-17", ...at(6, "Package start: 17/11/2026") },
      { field: "endDate", value: "2027-05-17", ...at(6, "Package end: 17/05/2027") },
      { field: "hoursPerWeek", value: "22", ...at(6, "Hours per week: 22") },
      { field: "requirements", value: "One carer for every visit.", ...at(6, "Staffing: One carer for every visit.") },
      { field: "reference", value: "PO-55117", ...at(6, "Purchase order: PO-55117") },
    ],
    visits: [
      visit("Morning", ALL, "07:30", 60, ["Wash", "Dress", "Breakfast", "Assist with medication", "Feed Pepper"], "Morning | 07:30-08:30 | Mon-Sun", { medicationPrompt: true }),
      visit("Lunch", ALL, "12:30", 30, ["Prepare lunch", "Drinks"], "Lunch | 12:30-13:00"),
      visit("Tea", ALL, "17:00", 30, ["Prepare tea", "Assist with medication"], "Tea | 17:00-17:30", { medicationPrompt: true }),
      visit("Bed", ALL, "21:00", 30, ["Night clothes", "Commode by the bed", "Hall light on"], "Bed | 21:00-21:30"),
      visit("Shower", [3, 6], "10:00", 45, ["Shower", "Change bedding"], "Shower | 10:00-10:45 | Wed, Sat"),
      visit("Domestic", [5], "10:00", 60, ["Clean kitchen and bathroom"], "Domestic | 10:00-11:00 | Fri"),
      visit("Sitting", [7], "14:00", 120, ["Companionship", "Crossword"], "Sitting | 14:00-16:00 | Sun"),
      visit("Shopping", [2], "11:00", 60, ["Food shopping by Albert"], "Shopping | 11:00-12:00 | Tue | family", { fundedBy: "CARERS_SERVICE" }),
      // The morning row repeated further down the page.
      visit("Morning", ALL, "07:30", 60, ["Wash", "Dress", "Breakfast", "Assist with medication", "Feed Pepper"], "Morning | 07:30-08:30 | Mon-Sun", { medicationPrompt: true }),
    ],
    medication: {
      arrangement: { support: "ASSIST", detail: "Assist from the blister pack at the morning and teatime visits.", ...at(5, "Support: Assist from the blister pack") },
      items: [
        medicine("Metformin", "500mg", "one tablet", "oral", "twice a day with food", "Medicine: Metformin 500mg"),
        medicine("Amlodipine", "5mg", "one tablet", "oral", "in the morning", "Medicine: Amlodipine 5mg"),
        medicine("Paracetamol", "500mg", "two tablets", "oral", "up to four times a day when needed", "Medicine: Paracetamol 500mg", true),
        medicine("Emollient cream", null, "apply", "topical", "in the morning", "Medicine: Emollient cream"),
        medicine("Sertraline", "50mg", "one tablet", "oral", "in the morning", "Medicine: Sertraline 50mg"),
      ],
      allergies: [{ value: "Penicillin", ...at(5, "Allergy: Penicillin") }, { value: "Elastoplast", ...at(5, "Allergy: Elastoplast") }],
    },
    incidents: [{ date: "2026-03-02", type: "Fall", description: "Fall at night, bruised hip, GP informed.", consequences: "Bruised hip", actions: "GP informed", ...at(5, "Previous incident: 02/03/2026 fall at night", "HISTORICAL") }],
    skin: [{ date: null, area: "Right shin", finding: "Dry patch", description: "Dry patch on the right shin noted by the district nurse.", ...at(5, "Skin: Dry patch on the right shin") }],
    flags: [{ text: "Nora says a DNACPR form was signed in hospital. The form has not been seen.", page: 5 }],
    missing: [],
    unreadable: [],
    communications: [
      { summary: "Nora asked for female carers only.", contactName: "Nora Sample", method: "TELEPHONE", date: "2026-10-30", ...at(6, "Call with Nora on 30/10/2026") },
      { summary: "The package was agreed at panel.", contactName: "Jo Example", method: "TELEPHONE", date: "2026-10-31", ...at(6, "Call with Jo Example on 31/10/2026") },
      { summary: "Blister packs are delivered on Mondays.", contactName: "Sample Pharmacy", method: "TELEPHONE", date: "2026-11-01", ...at(6, "Call with Sample Pharmacy on 01/11/2026") },
      { summary: "Albert will keep taking Winnie to the lunch club.", contactName: "Albert Sample", method: "TELEPHONE", date: "2026-11-02", ...at(6, "Call with Albert on 02/11/2026") },
    ],
  };
}
