import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo";
import { fmtDocDate, type Block, type DocModel } from "./model";

const INK = "#16181c";
const BODY = "#2b3036";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const CYAN = "#3ec1e0";
const CYAN_DEEP = "#178aa8";
const CYAN_WASH = "#ecf9fd";
const HAIR = "#e5e7eb";

const PAGE = { width: 595.28, height: 841.89 };
const M = { top: 96, bottom: 76, left: 64, right: 64 };
const W = PAGE.width - M.left - M.right;

type Doc = InstanceType<typeof PDFDocument>;

const FONT_DIR = join(process.cwd(), "src/server/documents/fonts");
const FONTS = {
  regular: "inter-latin-400-normal.woff",
  medium: "inter-latin-500-normal.woff",
  semibold: "inter-latin-600-normal.woff",
  bold: "inter-latin-700-normal.woff",
  italic: "inter-latin-400-italic.woff",
} as const;
type Face = keyof typeof FONTS;
let fontCache: Record<Face, Buffer> | null = null;
const fonts = () => (fontCache ??= Object.fromEntries(Object.entries(FONTS).map(([k, f]) => [k, readFileSync(join(FONT_DIR, f))])) as Record<Face, Buffer>);

const LOGO = Buffer.from(LOGO_PNG_BASE64, "base64");

// Inter's Latin subset has no maths arrows or ticks; map the common ones.
const sanitise = (s: string) =>
  s.replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/→/g, "->").replace(/[✓✔]/g, "Yes").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xffŒœŠšŸŽž‐-‧‰-›€™]/g, "");

function font(doc: Doc, face: Face, size: number, color = BODY) {
  return doc.font(face).fontSize(size).fillColor(color);
}

function logo(doc: Doc, x: number, y: number, height: number) {
  doc.image(LOGO, x, y, { height, width: (height * LOGO_SIZE.width) / LOGO_SIZE.height });
}

function ensure(doc: Doc, height: number) {
  if (doc.y + height > PAGE.height - M.bottom) doc.addPage();
}

const caps = (doc: Doc, text: string, x: number, y: number, opts: { color?: string; size?: number; width?: number; align?: "left" | "right" } = {}) =>
  font(doc, "semibold", opts.size ?? 7.5, opts.color ?? MUTED).text(text.toUpperCase(), x, y, { characterSpacing: 1.4, width: opts.width, align: opts.align, lineBreak: Boolean(opts.width) });

/** Clean, rule-only table: caps header with a cyan underline and hairline row dividers. */
function table(doc: Doc, header: string[] | null, rows: string[][], widths: number[], opts: { keyValue?: boolean; minRow?: number } = {}) {
  const cols = widths.map((w) => (w / 100) * W);
  const padX = 8;
  const padY = 7;
  const cellFace = (i: number): Face => (opts.keyValue && i % 2 === 0 ? "medium" : "regular");
  const drawHeader = () => {
    const y = doc.y;
    let x = M.left;
    header!.forEach((h, i) => {
      caps(doc, h, x + padX, y, { size: 7, width: cols[i] - padX * 2 });
      x += cols[i];
    });
    const bottom = y + 14;
    doc.moveTo(M.left, bottom).lineTo(M.left + W, bottom).lineWidth(1).strokeColor(CYAN).stroke();
    doc.y = bottom;
  };
  if (header) {
    ensure(doc, 60);
    drawHeader();
  } else {
    doc.moveTo(M.left, doc.y).lineTo(M.left + W, doc.y).lineWidth(0.6).strokeColor(HAIR).stroke();
  }
  for (const r of rows) {
    const heights = r.map((t, i) => font(doc, cellFace(i), 9).heightOfString(sanitise(t) || " ", { width: cols[i] - padX * 2, lineGap: 1.5 }));
    const h = Math.max(opts.minRow ?? 0, Math.max(...heights) + padY * 2);
    if (doc.y + h > PAGE.height - M.bottom) {
      doc.addPage();
      if (header) drawHeader();
    }
    const y = doc.y;
    let x = M.left;
    r.forEach((t, i) => {
      const key = opts.keyValue && i % 2 === 0;
      font(doc, cellFace(i), key ? 8.5 : 9, key ? MUTED : INK).text(sanitise(t), x + padX, y + padY, { width: cols[i] - padX * 2, lineGap: 1.5 });
      x += cols[i];
    });
    doc.moveTo(M.left, y + h).lineTo(M.left + W, y + h).lineWidth(0.6).strokeColor(HAIR).stroke();
    doc.x = M.left;
    doc.y = y + h;
  }
  doc.y += 18;
}

function sectionHeading(doc: Doc, number: number | null, text: string) {
  ensure(doc, 90);
  doc.y += 14;
  if (number !== null) {
    caps(doc, String(number).padStart(2, "0"), M.left, doc.y, { color: CYAN_DEEP, size: 8 });
    doc.y += 12;
  }
  font(doc, "bold", 15, INK).text(sanitise(text), M.left, doc.y, { width: W, characterSpacing: -0.2 });
  doc.y += 8;
  doc.rect(M.left, doc.y, 28, 2).fill(CYAN);
  doc.y += 12;
}

function subHeading(doc: Doc, text: string) {
  ensure(doc, 70);
  doc.y += 10;
  caps(doc, text, M.left, doc.y, { color: INK, size: 8 });
  doc.y += 18;
}

function para(doc: Doc, text: string, opts: { color?: string; size?: number } = {}) {
  font(doc, "regular", opts.size ?? 10, opts.color ?? BODY);
  const t = sanitise(text);
  ensure(doc, Math.min(doc.heightOfString(t, { width: W, lineGap: 3.5 }), 44));
  doc.text(t, M.left, doc.y, { width: W, lineGap: 3.5 });
  doc.y += 7;
}

function listItem(doc: Doc, marker: string | null, text: string) {
  const indent = 20;
  font(doc, "regular", 10, BODY);
  const t = sanitise(text);
  ensure(doc, Math.min(doc.heightOfString(t, { width: W - indent, lineGap: 3.5 }), 44));
  const y = doc.y;
  if (marker) font(doc, "semibold", 9.5, CYAN_DEEP).text(marker, M.left, y + 0.5, { width: indent - 4, lineBreak: false });
  else doc.circle(M.left + 6, y + 6.2, 1.9).fill(CYAN);
  font(doc, "regular", 10, BODY).text(t, M.left + indent, y, { width: W - indent, lineGap: 3.5 });
  doc.y += 4;
}

function localBox(doc: Doc, text: string) {
  const t = sanitise(text);
  font(doc, "italic", 9.5);
  const h = doc.heightOfString(t, { width: W - 34, lineGap: 3 }) + 34;
  ensure(doc, h);
  const y = doc.y + 2;
  doc.rect(M.left, y, W, h).fill(CYAN_WASH);
  doc.rect(M.left, y, 2.5, h).fill(CYAN);
  caps(doc, "To complete locally", M.left + 18, y + 11, { color: CYAN_DEEP, size: 7 });
  font(doc, "italic", 9.5, INK).text(t, M.left + 18, y + 23, { width: W - 34, lineGap: 3 });
  doc.x = M.left;
  doc.y = y + h + 10;
}

function block(doc: Doc, b: Block) {
  if (b.kind === "bullet") listItem(doc, null, b.text);
  else if (b.kind === "numbered") listItem(doc, b.n, b.text);
  else if (b.kind === "local") localBox(doc, b.text);
  else para(doc, b.text);
}

function cover(doc: Doc, m: DocModel) {
  logo(doc, M.left, 58, 50);
  caps(doc, "Controlled document", M.left, 76, { width: W, align: "right", color: FAINT, size: 7 });

  let y = 250;
  doc.rect(M.left, y, 36, 3).fill(CYAN);
  caps(doc, m.typeLabel, M.left, y + 14, { color: CYAN_DEEP, size: 9 });
  font(doc, "bold", 34, INK).text(sanitise(m.title), M.left, y + 34, { width: W, lineGap: -2, characterSpacing: -0.6 });
  y = doc.y + 16;
  font(doc, "regular", 12, MUTED).text(sanitise(m.description), M.left, y, { width: W * 0.88, lineGap: 4 });
  y = doc.y + 26;
  caps(doc, m.organisation ? "Prepared for" : "Issued by", M.left, y, { size: 7, color: FAINT });
  font(doc, "semibold", 12, INK).text(sanitise(m.organisation ?? "CSB · Care Solution Bureau"), M.left, y + 13, { width: W });

  // Charcoal key-facts panel across the foot of the cover.
  const top = PAGE.height - 232;
  doc.rect(0, top, PAGE.width, PAGE.height - top).fill(INK);
  doc.rect(0, top, PAGE.width, 4).fill(CYAN);
  const facts: [string, string][] = [
    ["Reference", m.ref],
    ["Version", m.version],
    ["Status", m.status],
    ["Effective", fmtDocDate(m.effectiveDate ?? m.publishedAt)],
    ["Next review", fmtDocDate(m.nextReviewDate)],
    ["Applies to", m.appliesTo],
  ];
  const colW = W / 3;
  facts.forEach(([label, value], i) => {
    const x = M.left + (i % 3) * colW;
    const fy = top + 40 + Math.floor(i / 3) * 58;
    caps(doc, label, x, fy, { color: CYAN, size: 7 });
    font(doc, "medium", 10.5, "#ffffff").text(sanitise(value), x, fy + 13, { width: colW - 16, lineGap: 1, height: 30, ellipsis: true });
  });
  // Drawn inside the bottom margin, so lift the margin to stop pdfkit adding a page.
  const margins = doc.page.margins;
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  font(doc, "regular", 7.5, "#9aa3ad").text("CSB · Care Solution Bureau", M.left, PAGE.height - 46, { lineBreak: false });
  font(doc, "regular", 7.5, "#9aa3ad").text("Printed copies are uncontrolled. Always check CSB for the current version.", M.left, PAGE.height - 46, { width: W, align: "right", lineBreak: false });
  doc.page.margins = margins;
}

function contents(doc: Doc, items: string[]) {
  const half = Math.ceil(items.length / 2);
  const colW = W / 2 - 12;
  ensure(doc, half * 17);
  const top = doc.y;
  let bottom = top;
  [items.slice(0, half), items.slice(half)].forEach((col, c) => {
    let y = top;
    col.forEach((item, i) => {
      const n = c * half + i + 1;
      const x = M.left + c * (colW + 24);
      font(doc, "semibold", 8.5, CYAN_DEEP).text(String(n).padStart(2, "0"), x, y, { width: 20, lineBreak: false });
      font(doc, "regular", 9.5, INK).text(sanitise(item), x + 22, y, { width: colW - 22, lineGap: 2 });
      y = doc.y + 6;
    });
    bottom = Math.max(bottom, y);
  });
  doc.x = M.left;
  doc.y = bottom + 8;
}

function decorate(doc: Doc, m: DocModel) {
  const range = doc.bufferedPageRange();
  const total = range.count - 1;
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const margins = doc.page.margins;
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    logo(doc, M.left, 32, 20);
    font(doc, "semibold", 7.5, CYAN_DEEP).text(m.ref, M.left + 150, 40, { width: W - 150, align: "right", lineBreak: false });
    const refW = doc.widthOfString(m.ref);
    font(doc, "regular", 7.5, MUTED).text(sanitise(m.title), M.left + 150, 40, { width: W - 160 - refW, align: "right", lineBreak: false, height: 10, ellipsis: true });
    doc.moveTo(M.left, 64).lineTo(M.left + W, 64).lineWidth(0.6).strokeColor(HAIR).stroke();
    const fy = PAGE.height - 44;
    doc.moveTo(M.left, fy - 10).lineTo(M.left + W, fy - 10).lineWidth(0.6).strokeColor(HAIR).stroke();
    font(doc, "regular", 7.5, MUTED).text(sanitise(`${m.organisation ?? "CSB master template"}  ·  Version ${m.version}  ·  Uncontrolled when printed`), M.left, fy, { width: W - 80, lineBreak: false });
    font(doc, "medium", 7.5, INK).text(`${i} / ${total}`, M.left + W - 80, fy, { width: 80, align: "right", lineBreak: false });
    doc.page.margins = margins;
  }
}

export async function renderPdf(m: DocModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: M, bufferPages: true, info: { Title: `${m.ref} ${m.title}`, Author: "CSB Care Solution Bureau", Subject: m.description } });
  for (const [face, data] of Object.entries(fonts())) doc.registerFont(face, data);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  cover(doc, m);

  doc.addPage();
  sectionHeading(doc, null, "Document control");
  table(doc, null, [
    ["Document owner", m.owner, "Approved by", m.approvedBy],
    ["Date approved", fmtDocDate(m.approvedAt), "Review interval", `${m.reviewIntervalMonths} months`],
    ["Category", m.category, "Next review due", fmtDocDate(m.nextReviewDate)],
  ], [18, 32, 18, 32], { keyValue: true });
  subHeading(doc, "Version history");
  table(doc, ["Version", "Date", "Status", "Summary of changes"], m.history.map((h) => [h.version, fmtDocDate(h.date), h.status, h.summary]), [14, 20, 16, 50]);
  subHeading(doc, "Approval and sign-off");
  table(doc, ["Role", "Name", "Signature", "Date"], [["Registered Manager", "", "", ""], ["Nominated Individual / Director", "", "", ""]], [32, 24, 26, 18], { minRow: 34 });
  subHeading(doc, "Contents");
  contents(doc, [...m.sections.map((s) => s.heading), ...(m.requirements.length ? ["Regulatory mapping"] : [])]);

  doc.addPage();
  m.sections.forEach((s, i) => {
    if (i === 0) doc.y -= 14;
    sectionHeading(doc, s.number, s.heading);
    for (const b of s.blocks) block(doc, b);
  });
  if (m.requirements.length) {
    sectionHeading(doc, m.sections.length + 1, "Regulatory mapping");
    para(doc, "This document is mapped to the regulations, CQC quality statements and guidance below in the CSB requirements register.", { color: MUTED, size: 9.5 });
    doc.y += 4;
    table(doc, ["Type", "Reference", "Requirement"], m.requirements.map((r) => [r.type, r.reference, r.title]), [22, 32, 46]);
  }
  ensure(doc, 40);
  doc.y += 10;
  caps(doc, "End of document", M.left, doc.y, { width: W, align: "left", color: FAINT, size: 7 });

  decorate(doc, m);
  doc.end();
  return done;
}
