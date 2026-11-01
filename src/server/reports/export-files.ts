import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { applyEmbeddedFonts, embeddedDefaultFont, FONT, pdfText } from "@/server/documents/fonts";

/**
 * Real .xlsx and .pdf files for tabular reports. Both carry the title, the period and the filters that produced them,
 * so a printed or emailed copy explains itself. Cells are written as values, never as formulas.
 */

export type ExportCell = string | number | null;
export interface ExportTable {
  title: string;
  subtitle: string;
  columns: string[];
  rows: ExportCell[][];
  /** Label/value pairs shown above the table (the management figures). */
  summary?: [string, ExportCell][];
  /** Relative column widths for the PDF; defaults to equal. */
  widths?: number[];
  /** The header colour (the module's colour); defaults to the Rostering purple. */
  accent?: string;
}

/** Spreadsheet cells that start with these characters would run as formulas in Excel; they are written as text. */
const FORMULA_START = /^[=+\-@\t\r]/;
const safeCell = (v: ExportCell) => (typeof v === "string" && FORMULA_START.test(v) ? `'${v}` : v ?? "");

export async function toXlsx(t: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CSB All In One Platform";
  wb.created = new Date();
  writeSheet(wb, t, t.title);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function writeSheet(wb: ExcelJS.Workbook, t: ExportTable, name: string) {
  const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: 0 }] });
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([t.subtitle]).font = { color: { argb: "FF55606E" } };
  if (t.summary?.length) {
    ws.addRow([]);
    for (const [k, v] of t.summary) {
      const r = ws.addRow([k, safeCell(v)]);
      r.getCell(1).font = { bold: true };
    }
  }
  ws.addRow([]);
  const header = ws.addRow(t.columns);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${(t.accent ?? "#4b2d9c").replace("#", "").toUpperCase()}` } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  for (const row of t.rows) ws.addRow(row.map(safeCell));
  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: t.columns.length } };
  t.columns.forEach((name, i) => {
    const longest = Math.max(name.length, ...t.rows.map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
    ws.getColumn(i + 1).alignment = { vertical: "top", wrapText: longest > 60 };
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function newDoc(title: string) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, ...embeddedDefaultFont(), info: { Title: title, Author: "CSB All In One Platform" } });
  applyEmbeddedFonts(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

const geometry = (doc: Doc) => ({ left: doc.page.margins.left, width: doc.page.width - doc.page.margins.left - doc.page.margins.right, bottom: doc.page.height - doc.page.margins.bottom - 14 });

/** Up to six label/value figures in a row. */
function drawSummary(doc: Doc, summary: [string, ExportCell][]) {
  const { left, width } = geometry(doc);
  const colW = width / Math.min(6, summary.length);
  const y = doc.y;
  summary.slice(0, 6).forEach(([k, v], i) => {
    doc.font(FONT.bold).fontSize(13).fillColor("#22324a").text(pdfText(String(v ?? "")), left + i * colW, y, { width: colW - 6 });
    doc.font(FONT.regular).fontSize(8).fillColor("#55606e").text(pdfText(k), left + i * colW, y + 17, { width: colW - 6 });
  });
  doc.y = y + 40;
}

/** A table that wraps cell text, repeats its header on each new page and never overlaps columns. */
function drawTable(doc: Doc, t: Pick<ExportTable, "columns" | "rows" | "widths" | "accent">, empty = "Nothing matches these filters.") {
  const { left, width, bottom } = geometry(doc);
  const weights = t.widths ?? t.columns.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((w) => (w / total) * width);
  const pad = 3;
  const drawRow = (cells: ExportCell[], headerRow: boolean) => {
    doc.font(headerRow ? FONT.bold : FONT.regular).fontSize(7.5);
    const texts = cells.map((c) => pdfText(String(c ?? "")));
    const h = Math.max(...texts.map((s, i) => doc.heightOfString(s, { width: cols[i]! - pad * 2 }))) + pad * 2;
    if (doc.y + h > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      if (!headerRow) drawRow(t.columns, true);
    }
    const y = doc.y;
    if (headerRow) doc.rect(left, y, width, h).fill(t.accent ?? "#4b2d9c");
    let x = left;
    texts.forEach((s, i) => {
      doc.fillColor(headerRow ? "#ffffff" : "#22324a").text(s, x + pad, y + pad, { width: cols[i]! - pad * 2 });
      x += cols[i]!;
    });
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.4).strokeColor("#d4d8de").stroke();
    doc.y = y + h;
  };
  drawRow(t.columns, true);
  if (!t.rows.length) doc.font(FONT.regular).fontSize(9).fillColor("#55606e").text(pdfText(empty), left, doc.y + 6);
  for (const r of t.rows) drawRow(r, false);
}

function footer(doc: Doc, title: string) {
  const { left, width } = geometry(doc);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(FONT.regular).fontSize(7).fillColor("#8a95a3").text(pdfText(`CSB All In One Platform · ${title} · page ${i + 1} of ${range.count} · confidential`), left, doc.page.height - doc.page.margins.bottom - 8, { width, align: "right", lineBreak: false });
  }
}

export async function toPdf(t: ExportTable): Promise<Buffer> {
  const { doc, done } = newDoc(t.title);
  const { left } = geometry(doc);
  doc.font(FONT.bold).fontSize(15).fillColor("#22324a").text(pdfText(t.title), left, doc.page.margins.top);
  doc.font(FONT.regular).fontSize(9).fillColor("#55606e").text(pdfText(t.subtitle));
  doc.moveDown(0.5);
  if (t.summary?.length) drawSummary(doc, t.summary);
  drawTable(doc, t);
  footer(doc, t.title);
  doc.end();
  return done;
}

/** A workbook with one sheet per table (each laid out like toXlsx). */
export async function toXlsxBook(tables: (ExportTable & { sheet: string })[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CSB All In One Platform";
  wb.created = new Date();
  for (const t of tables) writeSheet(wb, t, t.sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface PdfSection {
  heading: string;
  note?: string;
  summary?: [string, ExportCell][];
  table?: Pick<ExportTable, "columns" | "rows" | "widths">;
  empty?: string;
  /** Term/definition pairs, printed as a short glossary. */
  definitions?: [string, string][];
}

/** A management report: title block, then headed sections (figures, tables, definitions), paginated with footers. */
export async function toPdfReport(r: { title: string; subtitle: string; sections: PdfSection[] }): Promise<Buffer> {
  const { doc, done } = newDoc(r.title);
  const { left, width, bottom } = geometry(doc);
  doc.font(FONT.bold).fontSize(15).fillColor("#22324a").text(pdfText(r.title), left, doc.page.margins.top);
  doc.font(FONT.regular).fontSize(9).fillColor("#55606e").text(pdfText(r.subtitle), { width });
  for (const s of r.sections) {
    if (doc.y + 70 > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    } else doc.moveDown(0.8);
    doc.font(FONT.bold).fontSize(11).fillColor("#4b2d9c").text(pdfText(s.heading), left, doc.y, { width });
    if (s.note) doc.font(FONT.regular).fontSize(8).fillColor("#55606e").text(pdfText(s.note), { width });
    doc.moveDown(0.3);
    if (s.summary?.length) drawSummary(doc, s.summary);
    if (s.table) drawTable(doc, s.table, s.empty);
    for (const [term, def] of s.definitions ?? []) {
      if (doc.y + 24 > bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
      doc.font(FONT.bold).fontSize(8).fillColor("#22324a").text(pdfText(term), left, doc.y, { width, continued: false });
      doc.font(FONT.regular).fontSize(8).fillColor("#55606e").text(pdfText(def), { width });
      doc.moveDown(0.2);
    }
  }
  footer(doc, r.title);
  doc.end();
  return done;
}
