import PDFDocument from "pdfkit";

/**
 * Synthetic documents for the AI Care Coordinator tests. Every person, address and number here is made up; nothing comes
 * from a real support plan or discharge letter. The scheduling matches the shape of a real case: four daily commissioned
 * visits (195 minutes a day, 1,365 a week), two informal family rows, a timetable continuing onto the next page, and a
 * hospital letter with medicines, a previous fall and a pressure area that must stay historical.
 */

function pdf(pages: string[][]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  pages.forEach((lines, i) => {
    if (i) doc.addPage();
    doc.fontSize(8);
    for (const l of lines) doc.text(l, { width: 520 });
  });
  doc.end();
  return done;
}

export const FICTIONAL = { firstName: "Ada", lastName: "Fictional", dob: "1941-03-02", postcode: "E1 0ZZ" };

export function supportPlanPdf(opts: { endDate?: string } = {}) {
  return pdf([
    [
      "Example Borough Council - Adult Social Care",
      "Support Plan",
      "Date of plan: 15/09/2026",
      "Full name: Ada Fictional",
      "Preferred name: Ada",
      "Date of birth: 02/03/1941",
      "Gender: Female",
      "NHS number: 999 000 0001",
      "Address: Flat 1, Example House, Sample Road, London, E1 0ZZ",
      "Telephone: 0200 000 0101",
      "First language: Somali",
      "Communication: Speaks Somali and some English. Hearing aid in left ear.",
      "Access: Lift to the third floor. Ada can open the door herself.",
      "Key safe code: 1234",
      "Carer gender: Female carers only, for personal care",
      "Next of kin: Halima Fictional (Daughter) 0200 000 0102 key holder",
      "GP: Dr Example, Sample Health Centre, 0200 000 0103",
      "Social worker: Jo Sample, Example Borough Council, 0200 000 0104",
    ],
    [
      "Personal care: Ada washes her face and hands herself. She needs help with a full wash and dressing.",
      "Mobility: Walks indoors with a frame. Needs one carer nearby when getting up.",
      "Nutrition: Needs meals prepared. Likes soft food and sweet tea.",
      "Outcomes: To stay safely at home and keep in touch with her family.",
      "Risk - Falls: Ada fell at home in August and is unsteady when tired.",
      "Medication support: Prompting only. Ada takes her own tablets from a blister pack when reminded.",
      "Funder: Example Borough Council",
      "Package start: 30/09/2026",
      `Package end: ${opts.endDate ?? "30/12/2026"}`,
      "Hours per week: 22.75",
      "Staffing: All visits single handed",
    ],
    [
      "Timetable",
      "Morning | 09:00-10:00 | Mon-Sun | 1 carer | Tasks: Assist with full wash; Help to dress; Prepare breakfast; Prompt medication",
      "Lunch | 12:00-12:45 | Mon-Sun | 1 carer | Tasks: Prepare lunch; Prompt medication",
      "Shopping | 11:00-12:00 | Wednesday | 1 carer | family support | Tasks: Food shopping",
    ],
    [
      "Timetable (continued)",
      "Tea | 16:30-17:00 | Mon-Sun | 1 carer | Tasks: Prepare snack; Prompt medication",
      "Evening | 20:00-21:00 | Mon-Sun | 1 carer | Tasks: Help to undress; Bedtime routine",
      "Cleaning | 12:45-13:45 | Monday | 1 carer | informal carer | Tasks: Cleaning; Laundry",
    ],
  ]);
}

export function dischargeLetterPdf() {
  return pdf([
    [
      "Example Hospitals NHS Foundation Trust",
      "Hospital Discharge Summary",
      "Date of discharge: 20/08/2026",
      "Name: Ada Fictional",
      "Date of birth: 02/03/1941",
      "Previous fall: 12/08/2026 fall at home, admitted with a bruised hip, no fracture",
      "Pressure area: Grade 1 redness on the sacrum noted on the ward",
      "Allergies: Penicillin",
      "Medicine: Paracetamol 500mg | 1g | four times a day",
      "Medicine: Example-statin 20mg | one tablet | at night",
    ],
  ]);
}

export const FICTIONAL_CARDS = { firstName: "Bea", lastName: "Example", postcode: "E2 0ZZ" };

/**
 * The second council layout the no-AI reader supports: care-plan headings with a paragraph under each, and visit
 * "cards" with one field per line, the timetable continuing onto page 4. Invented person and numbers only. Four daily
 * commissioned visits (09:00 60 min, 12:00 45 min, 16:30 30 min, 20:00 60 min = 1,365 minutes a week) and one weekly
 * family shopping visit that must not count towards the commissioned total.
 */
export function supportPlanCardsPdf(opts: { hoursPerWeek?: string; name?: string } = {}) {
  return pdf([
    [
      "Sample Borough Council - Adult Social Care",
      "Support Plan",
      "Date of plan: 20/10/2026",
      `Full name: ${opts.name ?? "Bea Example"}`,
      "Date of birth: 01/02/1945",
      "Address: 10 Test Street, Exampleton, E2 0ZZ",
      "Frameworki client reference: 1088676",
      "Funder: Sample Borough Council",
      "Package start: 01/11/2026",
      `Hours per week: ${opts.hoursPerWeek ?? "22.75"}`,
      "Staffing: Single-handed visits",
      "Risk - Falls: Bea uses a walking frame and is unsteady when tired.",
    ],
    [
      "About me",
      "Bea wishes to stay in her own home.",
      "Communication",
      "Prefers clear spoken information.",
      "Personal care",
      "Needs help with washing and dressing.",
      "Mobility",
      "Uses a walking frame and needs support standing.",
      "Nutrition and hydration",
      "Needs assistance preparing meals.",
      "Medication support",
      "Prompting is documented, but staff must check the current medicines.",
      "Health and wellbeing",
      "Needs monitoring by authorised care professionals.",
      "Home environment",
      "Prefers familiar surroundings.",
      "Outcomes",
      "Remain as independent as possible.",
    ],
    [
      "Timetable",
      "Morning call", "Start time: 09:00", "Duration: 1 hour", "Frequency: Daily", "Carers: 1", "Tasks: Assist with washing; Help with dressing",
      "Lunchtime visit", "Start time: 12:00", "Duration: 45 minutes", "Days: Mon-Sun", "Staff required: 1", "Tasks: Prepare lunch",
      "Shopping visit", "Start time: 11:00", "Duration: 60 minutes", "Days: Wednesday", "Carers: 1", "Provided by: Family", "Tasks: Shopping",
    ],
    [
      "Timetable continued",
      "Teatime call", "Start time: 16:30", "Duration: 30 minutes", "Days: Every day", "Carers: 1", "Tasks: Prepare tea",
      "Evening visit", "Start time: 20:00", "Duration: 1 hour", "Days: Daily", "Number of carers: 1", "Tasks: Help with bedtime",
    ],
  ]);
}

/** A short fictional plan whose wording the AI-reading tests quote: care plan topics, a risk with mitigation and a temporary two-carer visit. */
export function topicsPlanPdf() {
  return pdf([
    [
      "Example Borough Council - Adult Social Care",
      "Support Plan",
      "Full name: Bea Specimen",
      "Postcode: E2 0ZZ",
    ],
    [
      "Toileting: Bea uses the toilet with her frame but needs help at night. Leave the commode within reach. She prefers a female carer.",
      "Washing and dressing: Bea needs a full strip wash at the sink. She likes to choose her own clothes.",
      "Risk - Falls at night: Bea has fallen twice getting up to the toilet. A sensor light on the landing is recommended.",
      "Morning | 08:00-08:45 | Mon-Fri | 2 carers | Tasks: Hoist transfer; Strip wash. Temporary until the OT review. Two carers for the hoist.",
    ],
  ]);
}
