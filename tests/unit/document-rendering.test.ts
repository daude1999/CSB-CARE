import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compareWithBaseline, inspectPdf, outside, overlaps, renderPages } from "../support/pdf-inspect";

vi.mock("server-only", () => ({}));

const { parseBody } = await import("@/server/documents/model");
const { renderPdf } = await import("@/server/documents/pdf");
const { renderDocx } = await import("@/server/documents/docx");
import type { DocModel } from "@/server/documents/model";

// Representative policies: what a provider's library really holds, plus the awkward cases that broke layouts before.
const UNUSUAL = "Zoë Łukasz-Brontë’s café: “quoted” text – en dash — em dash, €25, ≥ 2 hours, résumé, naïve, Ångström, Ωmega, Жанна ✓ done 😀 end";
const LONG_PARA =
  "Staff record every concern on the day it is raised, including the time, the people present, what was seen or said in the person's own words, and the immediate action taken to keep them safe. The record is factual, avoids opinion, and is signed by the person who made it. Where a concern involves a possible crime, staff do not investigate it themselves; they make sure the person is safe, preserve evidence where they can, and contact the police and the local authority safeguarding team without delay.";

function base(over: Partial<DocModel>): DocModel {
  return {
    ref: "CSB-SAF-001",
    title: "Safeguarding Adults",
    typeLabel: "Policy",
    description: "How staff recognise, respond to and report abuse and neglect.",
    category: "Safeguarding",
    organisation: "Care Solution Bureau",
    isTemplate: false,
    version: "3",
    status: "Published",
    publishedAt: new Date("2026-09-01T09:00:00Z"),
    effectiveDate: new Date("2026-09-01T09:00:00Z"),
    approvedAt: new Date("2026-08-28T09:00:00Z"),
    approval: "Approved",
    approvedBy: "Alex Morgan, Priya Shah",
    owner: "Alex Morgan",
    nextReviewDate: new Date("2027-09-01T09:00:00Z"),
    reviewIntervalMonths: 12,
    appliesTo: "Domiciliary care",
    history: [{ version: "3", status: "Published", date: new Date("2026-09-01T09:00:00Z"), summary: "Updated reporting timescales." }],
    requirements: [{ ref: "CQC-QS-S3", reference: "CQC quality statement, Safe: Safeguarding", title: "Safe: Safeguarding", type: "CQC quality statement" }],
    sections: [
      { number: 1, heading: "Purpose", isLocal: false, blocks: parseBody("This policy explains how we keep people safe from abuse.") },
      { number: 2, heading: "Scope", isLocal: false, blocks: parseBody("It applies to all staff.\n• Care workers\n• Coordinators\n• Office staff") },
    ],
    generatedAt: new Date("2026-10-30T09:00:00Z"),
    generatedBy: "Test",
    ...over,
  };
}

const FIXTURES: Record<string, DocModel> = {
  short: base({}),
  "long-title": base({
    ref: "CSB-MCA-014",
    title: "Mental Capacity, Deprivation of Liberty Safeguards and Best Interests Decision-Making for People Supported in Their Own Homes",
    description: "A long description that wraps over several lines on the cover page so that the control table must still sit clear of it and the footer note, without any overlap between the title block and the table beneath it.",
    approval: "Not yet approved (starter content)",
    approvedBy: "—",
    approvedAt: null,
  }),
  "multi-page": base({
    ref: "CSB-GOV-002",
    title: "Safe Staffing and Deployment",
    history: Array.from({ length: 9 }, (_, i) => ({ version: String(9 - i), status: i ? "Superseded" : "Published", date: new Date(Date.UTC(2026, 8 - i, 1)), summary: i % 3 ? "Minor wording changes." : LONG_PARA.slice(0, 180) })),
    requirements: Array.from({ length: 34 }, (_, i) => ({ ref: `REG-${i}`, reference: `SI 2014/2936, regulation ${i + 1}${i % 4 ? "" : " (including paragraphs 2(a) to 2(f) and Schedule 3)"}`, title: i % 5 ? "Staffing" : "Fit and proper persons employed, including recruitment checks and ongoing monitoring", type: i % 2 ? "Legislation" : "CQC quality statement" })),
    sections: Array.from({ length: 14 }, (_, i) => ({
      number: i + 1,
      heading: i === 4 ? "Local contacts, escalation routes and out-of-hours arrangements for coordinators" : `Section heading ${i + 1}`,
      isLocal: i === 6,
      blocks: parseBody(
        [
          LONG_PARA,
          ...Array.from({ length: i % 3 === 0 ? 12 : 3 }, (_, k) => `${k + 1}. Numbered step ${k + 1}: ${LONG_PARA.slice(0, 90 + k * 7)}`),
          "• A bullet point that is long enough to wrap onto a second line in the PDF so its hanging indent can be checked.",
          "• A short bullet",
          i === 6 ? "[Complete locally] Add the names and phone numbers of your safeguarding lead and deputy, and the local authority adult social care team." : "",
          i === 9 ? UNUSUAL : "",
        ].join("\n"),
      ),
    })),
  }),
};

const BASELINES = path.join(process.cwd(), "tests", "visual", "documents");

describe("policy PDF rendering (read back with PDF.js, the viewer's engine)", () => {
  for (const [name, model] of Object.entries(FIXTURES)) {
    describe(name, async () => {
      const pdf = await renderPdf(model);
      const pages = await inspectPdf(pdf);
      // DOC_QA_DIR keeps the generated files for a second renderer (e.g. poppler's pdftoppm) and Word to check by eye.
      if (process.env.DOC_QA_DIR) {
        mkdirSync(process.env.DOC_QA_DIR, { recursive: true });
        writeFileSync(path.join(process.env.DOC_QA_DIR, `${name}.pdf`), pdf);
        writeFileSync(path.join(process.env.DOC_QA_DIR, `${name}.docx`), await renderDocx(model));
      }

      it("embeds every font, so no device substitutes its own", () => {
        const raw = pdf.toString("latin1");
        expect(raw).toContain("/FontFile2");
        expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
      });

      it("has no text drawn over other text and nothing outside the page margins", () => {
        for (const [i, page] of pages.entries()) {
          expect(overlaps(page), `page ${i + 1}`).toEqual([]);
          expect(outside(page).map((t) => t.str), `page ${i + 1}`).toEqual([]);
        }
      });

      it("numbers pages as the viewer counts them and repeats the header and footer", () => {
        expect(pages.length).toBeGreaterThanOrEqual(3);
        pages.slice(1).forEach((page, i) => {
          expect(page.text).toContain(`Page ${i + 2} of ${pages.length}`);
          expect(page.text).toContain(model.ref);
        });
        expect(pages[0]!.text).not.toMatch(/Page \d+ of/);
      });

      it("states the version, status and approval truthfully", () => {
        const cover = pages[0]!.text;
        expect(cover).toContain(`Version ${model.version}`.replace("Version ", ""));
        expect(cover).toContain(model.status);
        expect(cover).toContain(model.approval);
        expect(pages[1]!.text).toContain(model.approvedBy);
      });

      it("never leaves a heading or table header alone at the foot of a page", () => {
        const headings = [...model.sections.map((s) => `${s.number}. ${s.heading}`), "Contents", "Version history", "Local approval and sign-off", "Requirement", "Summary of changes", "Date"];
        for (const [i, page] of pages.entries()) {
          // The contents list repeats the headings, so lines under "Contents" are list entries, not headings.
          const contentsAt = page.boxes.find((b) => b.str === "Contents")?.y ?? Infinity;
          if (page.boxes.some((b) => b.y > contentsAt + 2 && b.y < page.height - 60)) continue;
          const body = page.boxes.filter((b) => b.y < page.height - 60).sort((a, b) => a.y - b.y);
          const lastLine = body.filter((b) => Math.abs(b.y - body.at(-1)!.y) < 2).map((b) => b.str).join(" ");
          expect(headings.some((h) => h.startsWith(lastLine) || lastLine.endsWith(h)), `page ${i + 1} ends with "${lastLine}"`).toBe(false);
        }
      });

      it("matches its approved page images", async () => {
        const images = await renderPages(pdf, 1);
        for (const [i, png] of images.entries()) {
          const { diff } = await compareWithBaseline(png, path.join(BASELINES, `${name}-p${i + 1}.png`));
          expect(diff, `${name} page ${i + 1}`).toBeLessThan(0.002);
        }
      });
    });
  }

  it("keeps unusual characters the fonts can draw and drops the rest cleanly", async () => {
    const pages = await inspectPdf(await renderPdf(FIXTURES["multi-page"]!));
    const all = pages.map((p) => p.text).join(" ");
    for (const s of ["Zoë", "Łukasz-Brontë’s", "café", "“quoted”", "€25", "≥ 2 hours", "Ångström", "Ωmega", "Жанна", "Yes done"]) expect(all).toContain(s);
    expect(all).not.toContain("😀");
  });

  it("wraps long numbered items under their own text, with two-digit markers clear of it", async () => {
    const pages = await inspectPdf(await renderPdf(FIXTURES["multi-page"]!));
    const markers = pages.flatMap((p) => p.boxes.filter((b) => b.str === "12."));
    expect(markers.length).toBeGreaterThan(0);
    for (const page of pages) expect(overlaps(page)).toEqual([]);
  });

  it("produces a Word document with the same metadata", async () => {
    const buf = await renderDocx(FIXTURES["long-title"]!);
    const { default: JSZip } = await import("jszip");
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Not yet approved (starter content)");
    expect(xml).toContain("Mental Capacity, Deprivation of Liberty Safeguards");
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
  });
});

describe("the document checks themselves", () => {
  it("detect text drawn over other text and text running off the page", async () => {
    const { default: PDFDocument } = await import("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    doc.fontSize(12).text("First line of text", 100, 100).text("Second line on top", 104, 102).text("Off the edge of the page", 560, 300, { lineBreak: false });
    doc.end();
    const [page] = await inspectPdf(await done);
    expect(overlaps(page!).length).toBeGreaterThan(0);
    expect(outside(page!).length).toBeGreaterThan(0);
  });
});
