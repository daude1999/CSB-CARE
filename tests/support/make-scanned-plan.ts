/**
 * Makes tests/support/scanned-support-plan.pdf: each page of the fictional plan is rendered, photographed as an image
 * and placed in a PDF with no text layer, like a scanned document. Run once with `npx tsx tests/support/make-scanned-plan.ts`;
 * the PDF is committed so the tests do not need a browser.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { chromium } from "playwright";
import { SCANNED_PAGES } from "./scanned-support-plan";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  const shots: Buffer[] = [];
  for (const [i, lines] of SCANNED_PAGES.entries()) {
    const body = lines.map((l) => (l.includes("|") ? `<p class="row">${esc(l)}</p>` : `<p>${esc(l)}</p>`)).join("");
    await page.setContent(`<html><body style="margin:0;background:#f4f2ec;font-family:'Times New Roman',serif;color:#222">
      <div style="transform:rotate(-0.4deg);padding:56px 60px;font-size:14px;line-height:1.5">
      ${body}<p style="margin-top:40px;font-size:11px;color:#555">Page ${i + 1} of ${SCANNED_PAGES.length} - FICTIONAL TEST DOCUMENT</p></div>
      <style>p{margin:0 0 6px}.row{font-family:monospace;font-size:12.5px}</style></body></html>`);
    shots.push(await page.screenshot({ type: "jpeg", quality: 70, fullPage: false }));
  }
  await browser.close();
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  for (const s of shots) {
    doc.addPage({ size: "A4", margin: 0 });
    doc.image(s, 0, 0, { width: doc.page.width, height: doc.page.height });
  }
  doc.end();
  const out = join(process.cwd(), "tests/support/scanned-support-plan.pdf");
  writeFileSync(out, await done);
  console.log(`Wrote ${out}`);
}
void main();
