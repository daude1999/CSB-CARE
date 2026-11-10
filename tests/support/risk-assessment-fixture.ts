import PDFDocument from "pdfkit";
import type { CareDocumentExtraction } from "@/server/ai/schemas";

/**
 * A FICTIONAL council risk assessment for Charles Specimen (the person in long-support-plan.ts), laid out the way
 * council risk assessment forms usually are: one short row per hazard with a level and the control measures. Every
 * name and detail is invented.
 */
const PAGES: string[][] = [
  [
    "Example Borough Council - Adult Social Care",
    "Risk Assessment",
    "Date of assessment: 03/11/2026",
    "Name: Charles Specimen   Date of birth: 14/05/1938",
    "Hazard: Falls | Risk level: High | Who: Charles | Controls: Walking frame within reach at all times; carer stays beside Charles when he stands.",
    "Hazard: Stairs | Risk level: Medium | Who: Charles | Controls: Rail",
    "Hazard: Fire | Risk level: High | Who: Charles and carers | Controls: Smoke alarm fitted; carers check the cooker is off before leaving.",
    "Hazard: Moving and handling - transfers with a stand aid | Risk level: Medium | Who: Charles and carers | Controls: Two trained carers for every transfer; stand aid serviced every six months.",
    "Review date: 03/02/2027",
  ],
];

export function riskAssessmentPdf(): Promise<Buffer> {
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

const at = (quote: string) => {
  if (!PAGES[0]!.some((l) => l.includes(quote))) throw new Error(`Fixture quote not on the page: ${quote}`);
  return { page: 1, quote, temporal: "CURRENT" as const };
};

/** What the AI returns for riskAssessmentPdf(): short hazard cells, short controls, levels stated. */
export function riskAssessmentReading(): CareDocumentExtraction {
  return {
    document: { kind: "RISK_ASSESSMENT", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: "2026-11-03", pageCount: 1 },
    person: [],
    references: [],
    contacts: [],
    carerPreferences: [],
    carePlan: [],
    risks: [
      { type: "FALLS", title: "Falls", hazard: "Falls", whoAffected: "Charles", existingControls: "Walking frame within reach at all times; carer stays beside Charles when he stands.", mitigation: null, assessmentGaps: null, level: "HIGH", ...at("Hazard: Falls | Risk level: High") },
      { type: "ENVIRONMENT", title: "Stairs", hazard: "Stairs", whoAffected: "Charles", existingControls: "Rail", mitigation: null, assessmentGaps: null, level: "MEDIUM", ...at("Hazard: Stairs | Risk level: Medium") },
      { type: "OTHER", title: "Fire", hazard: "Fire", whoAffected: "Charles and carers", existingControls: "Smoke alarm fitted; carers check the cooker is off before leaving.", mitigation: null, assessmentGaps: null, level: "HIGH", ...at("Hazard: Fire | Risk level: High") },
      { type: "MOVING_HANDLING", title: "Transfers with a stand aid", hazard: "Moving and handling - transfers with a stand aid", whoAffected: "Charles and carers", existingControls: "Two trained carers for every transfer; stand aid serviced every six months.", mitigation: null, assessmentGaps: null, level: "MEDIUM", ...at("Hazard: Moving and handling - transfers with a stand aid") },
    ],
    package: [],
    visits: [],
    medication: { arrangement: null, items: [], allergies: [] },
    incidents: [],
    skin: [],
    flags: [],
    missing: [],
    unreadable: [],
    communications: [],
  };
}
