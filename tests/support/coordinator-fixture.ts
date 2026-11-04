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
