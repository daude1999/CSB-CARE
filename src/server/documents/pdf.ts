import "server-only";
import PDFDocument from "pdfkit";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo";
import { fmtDocDate, type DocModel } from "./model";

const NAVY = "#16181c";
const GOLD = "#3ec1e0";
const GOLD_LIGHT = "#ecf9fd";
const GREY = "#5b6577";
const TEXT = "#1f2937";
const RULE = "#d6dae1";

const PAGE = { width: 595.28, height: 841.89 };
const M = { top: 78, bottom: 70, left: 60, right: 60 };
const W = PAGE.width - M.left - M.right;

type Doc = InstanceType<typeof PDFDocument>;

// The built-in PDF fonts only cover Windows-1252; map common characters outside it.
const sanitise = (s: string) =>
  s.replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[→]/g, "->").replace(/[✓✔]/g, "Yes").replace(/[‐-‒]/g, "-").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "");

const LOGO = Buffer.from(LOGO_PNG_BASE64, "base64");

function logo(doc: Doc, x: number, y: number, height: number) {
  doc.image(LOGO, x, y, { height, width: (height * LOGO_SIZE.width) / LOGO_SIZE.height });
}

function ensure(doc: Doc, height: number) {
  if (doc.y + height > PAGE.height - M.bottom) doc.addPage();
}

function table(doc: Doc, header: string[] | null, rows: string[][], widths: number[], opts: { labelCols?: boolean } = {}) {
  const cols = widths.map((w) => (w / 100) * W);
  const pad = 6;
  const size = 9;
  const drawRow = (cells: string[], kind: "header" | "body") => {
    doc.font(kind === "header" ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const heights = cells.map((t, i) => {
      doc.font(kind === "header" || (opts.labelCols && i % 2 === 0) ? "Helvetica-Bold" : "Helvetica");
      return doc.heightOfString(sanitise(t) || " ", { width: cols[i] - pad * 2 });
    });
    const h = Math.max(...heights) + pad * 2;
    if (doc.y + h > PAGE.height - M.bottom) {
      doc.addPage();
      if (kind === "body" && header) drawRow(header, "header");
    }
    const y = doc.y;
    let x = M.left;
    cells.forEach((t, i) => {
      const label = opts.labelCols && i % 2 === 0;
      if (kind === "header") doc.rect(x, y, cols[i], h).fill(NAVY);
      else if (label) doc.rect(x, y, cols[i], h).fill(GOLD_LIGHT);
      doc.rect(x, y, cols[i], h).lineWidth(0.5).stroke(RULE);
      doc.font(kind === "header" || label ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(kind === "header" ? "#ffffff" : label ? NAVY : TEXT);
      doc.text(sanitise(t), x + pad, y + pad, { width: cols[i] - pad * 2 });
      x += cols[i];
    });
    doc.x = M.left;
    doc.y = y + h;
  };
  if (header) drawRow(header, "header");
  for (const r of rows) drawRow(r, "body");
  doc.moveDown(0.8);
}

function heading(doc: Doc, text: string, level: 1 | 2 = 1) {
  ensure(doc, 60);
  doc.moveDown(level === 1 ? 0.9 : 0.6);
  doc.font("Helvetica-Bold").fontSize(level === 1 ? 14 : 11.5).fillColor(NAVY).text(sanitise(text), M.left, doc.y, { width: W });
  if (level === 1) {
    const y = doc.y + 3;
    doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(1.2).stroke(GOLD);
    doc.y = y + 8;
  } else doc.moveDown(0.3);
}

function para(doc: Doc, text: string, opts: { indent?: number; marker?: string; color?: string } = {}) {
  const indent = opts.indent ?? 0;
  doc.font("Helvetica").fontSize(10).fillColor(opts.color ?? TEXT);
  const h = doc.heightOfString(sanitise(text), { width: W - indent, lineGap: 2 });
  ensure(doc, Math.min(h, 40));
  const y = doc.y;
  if (opts.marker) doc.text(opts.marker, M.left + indent - 16, y, { width: 14, lineBreak: false });
  doc.text(sanitise(text), M.left + indent, y, { width: W - indent, lineGap: 2 });
  doc.moveDown(0.35);
}

/** Two-column contents list so it fits on the document control page. */
function contents(doc: Doc, items: string[]) {
  const half = Math.ceil(items.length / 2);
  const colW = W / 2 - 10;
  doc.font("Helvetica").fontSize(9.5).fillColor(TEXT);
  ensure(doc, half * 15);
  const top = doc.y;
  let bottom = top;
  [items.slice(0, half), items.slice(half)].forEach((col, c) => {
    doc.y = top;
    for (const item of col) doc.text(sanitise(item), M.left + c * (colW + 20), doc.y, { width: colW, lineGap: 3.5 });
    bottom = Math.max(bottom, doc.y);
  });
  doc.x = M.left;
  doc.y = bottom;
}

function cover(doc: Doc, m: DocModel) {
  doc.rect(0, 0, PAGE.width, 10).fill(GOLD);
  logo(doc, M.left, 60, 70);
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text("Policies, procedures and regulatory compliance for adult social care", M.left, 150, { width: W });
  doc.moveTo(M.left, 175).lineTo(M.left + W, 175).lineWidth(0.8).stroke(RULE);

  doc.font("Helvetica-Bold").fontSize(11).fillColor(GOLD).text(m.typeLabel.toUpperCase(), M.left, 250, { characterSpacing: 1.5 });
  doc.font("Helvetica-Bold").fontSize(28).fillColor(NAVY).text(sanitise(m.title), M.left, 272, { width: W });
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(11.5).fillColor(GREY).text(sanitise(m.description), { width: W, lineGap: 2 });
  doc.y = Math.max(doc.y + 30, 430);
  table(doc, null, [
    ["Reference", m.ref, "Version", m.version],
    ["Organisation", m.organisation ?? "CSB master template", "Status", m.status],
    ["Category", m.category, "Applies to", m.appliesTo],
    ["Effective date", fmtDocDate(m.effectiveDate ?? m.publishedAt), "Next review", fmtDocDate(m.nextReviewDate)],
  ], [18, 32, 18, 32], { labelCols: true });
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(GREY).text("Controlled document. Printed copies are uncontrolled; always check the CSB system for the current version.", M.left, PAGE.height - 110, { width: W });
}

function decorate(doc: Doc, m: DocModel) {
  const range = doc.bufferedPageRange();
  const total = range.count - 1;
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const margins = doc.page.margins;
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    logo(doc, M.left, 28, 22);
    doc.font("Helvetica").fontSize(8).fillColor(GREY);
    doc.text(sanitise(`${m.ref}  ${m.title}`), M.left + 160, 38, { width: W - 160, align: "right", lineBreak: false, ellipsis: true, height: 10 });
    doc.moveTo(M.left, 56).lineTo(M.left + W, 56).lineWidth(0.8).stroke(GOLD);
    const fy = PAGE.height - 42;
    doc.moveTo(M.left, fy - 8).lineTo(M.left + W, fy - 8).lineWidth(0.5).stroke(RULE);
    doc.font("Helvetica").fontSize(8).fillColor(GREY).text(sanitise(`${m.organisation ?? "CSB master template"} · Version ${m.version} · Uncontrolled when printed`), M.left, fy, { width: W - 90, lineBreak: false });
    doc.text(`Page ${i} of ${total}`, M.left + W - 90, fy, { width: 90, align: "right", lineBreak: false });
    doc.page.margins = margins;
  }
}

export async function renderPdf(m: DocModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: M, bufferPages: true, info: { Title: `${m.ref} ${m.title}`, Author: "CSB Care Solution Bureau", Subject: m.description } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  cover(doc, m);
  doc.addPage();
  heading(doc, "Document control");
  table(doc, null, [
    ["Document owner", m.owner],
    ["Approved by", m.approvedBy],
    ["Date approved", fmtDocDate(m.approvedAt)],
    ["Review interval", `${m.reviewIntervalMonths} months`],
    ["Next review due", fmtDocDate(m.nextReviewDate)],
  ], [30, 70], { labelCols: true });
  heading(doc, "Version history", 2);
  table(doc, ["Version", "Date", "Status", "Summary of changes"], m.history.map((h) => [h.version, fmtDocDate(h.date), h.status, h.summary]), [12, 20, 16, 52]);
  heading(doc, "Local approval and sign-off", 2);
  table(doc, ["Role", "Name", "Signature", "Date"], [["Registered Manager", "", "", ""], ["Nominated Individual / Director", "", "", ""]], [30, 25, 25, 20]);
  heading(doc, "Contents", 2);
  contents(doc, [...m.sections.map((s) => `${s.number}.  ${s.heading}`), ...(m.requirements.length ? [`${m.sections.length + 1}.  Regulatory mapping`] : [])]);

  doc.addPage();
  for (const s of m.sections) {
    heading(doc, `${s.number}. ${s.heading}`);
    for (const b of s.blocks) {
      if (b.kind === "bullet") para(doc, b.text, { indent: 18, marker: "•" });
      else if (b.kind === "numbered") para(doc, b.text, { indent: 22, marker: b.n });
      else if (b.kind === "local") {
        doc.font("Helvetica-Oblique").fontSize(10);
        const text = sanitise(`To complete locally: ${b.text}`);
        const h = doc.heightOfString(text, { width: W - 24, lineGap: 2 }) + 14;
        ensure(doc, h);
        const y = doc.y;
        doc.rect(M.left, y, W, h).fill(GOLD_LIGHT);
        doc.rect(M.left, y, 3, h).fill(GOLD);
        doc.fillColor(NAVY).text(text, M.left + 14, y + 7, { width: W - 24, lineGap: 2 });
        doc.y = y + h + 6;
        doc.x = M.left;
      } else para(doc, b.text);
    }
  }
  if (m.requirements.length) {
    heading(doc, `${m.sections.length + 1}. Regulatory mapping`);
    para(doc, "This document is mapped to the following regulations, CQC quality statements and guidance in the CSB requirements register.", { color: GREY });
    table(doc, ["Type", "Reference", "Requirement"], m.requirements.map((r) => [r.type, r.reference, r.title]), [22, 30, 48]);
  }

  decorate(doc, m);
  doc.end();
  return done;
}
