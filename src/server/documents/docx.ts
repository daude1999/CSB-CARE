import "server-only";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
} from "docx";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo";
import { fmtDocDate, type Block, type DocModel } from "./model";

const INK = "16181C";
const BODY = "2B3036";
const MUTED = "6B7280";
const FAINT = "9CA3AF";
const CYAN = "3EC1E0";
const CYAN_DEEP = "178AA8";
const CYAN_WASH = "ECF9FD";
const HAIR = "E5E7EB";
const FONT = "Calibri";

const logo = (height: number) =>
  new ImageRun({ type: "png", data: Buffer.from(LOGO_PNG_BASE64, "base64"), transformation: { width: Math.round((height * LOGO_SIZE.width) / LOGO_SIZE.height), height } });

type RunOpts = { bold?: boolean; color?: string; size?: number; italics?: boolean; caps?: boolean };
const run = (text: string, o: RunOpts = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, color: o.color ?? BODY, italics: o.italics, allCaps: o.caps, characterSpacing: o.caps ? 30 : undefined });
const caps = (text: string, color = MUTED, size = 15) => run(text, { bold: true, color, size, caps: true });

const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const hair = { style: BorderStyle.SINGLE, size: 4, color: HAIR };
const NO_BORDERS = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

function cell(children: Paragraph[], o: { width?: number; fill?: string; bottom?: typeof hair; top?: typeof hair; margins?: number } = {}) {
  const m = o.margins ?? 110;
  return new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    borders: { top: o.top ?? none, bottom: o.bottom ?? hair, left: none, right: none },
    margins: { top: m, bottom: m, left: 140, right: 140 },
    verticalAlign: VerticalAlign.TOP,
    children,
  });
}

/** Rule-only table: caps header with a cyan underline and hairline row dividers. */
function grid(header: string[] | null, rows: string[][], widths: number[], o: { keyValue?: boolean; tall?: boolean } = {}) {
  const cyanRule = { style: BorderStyle.SINGLE, size: 10, color: CYAN };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      ...(header ? [new TableRow({ tableHeader: true, children: header.map((h, i) => cell([new Paragraph({ children: [caps(h, MUTED, 14)] })], { width: widths[i], bottom: cyanRule, margins: 70 })) })] : []),
      ...rows.map((r, ri) =>
        new TableRow({
          cantSplit: true,
          height: o.tall ? { value: 620, rule: "atLeast" } : undefined,
          children: r.map((t, i) => {
            const key = o.keyValue && i % 2 === 0;
            return cell([new Paragraph({ children: [run(t, { size: key ? 17 : 19, bold: key, color: key ? MUTED : INK })] })], { width: widths[i], top: !header && ri === 0 ? hair : undefined });
          }),
        }),
      ),
    ],
  });
}

const spacer = (after: number) => new Paragraph({ spacing: { after }, children: [] });

function sectionHeading(number: number | null, text: string) {
  return [
    ...(number !== null ? [new Paragraph({ spacing: { before: 440, after: 40 }, keepNext: true, children: [caps(String(number).padStart(2, "0"), CYAN_DEEP, 16)] })] : []),
    new Paragraph({
      spacing: { before: number === null ? 120 : 0, after: 220 },
      keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: CYAN, space: 6 } },
      children: [run(text, { bold: true, color: INK, size: 30 })],
    }),
  ];
}

const subHeading = (text: string) => new Paragraph({ spacing: { before: 360, after: 120 }, keepNext: true, children: [caps(text, INK, 16)] });

function blockParagraph(b: Block) {
  switch (b.kind) {
    case "bullet":
      return new Paragraph({ numbering: { reference: "csb-bullets", level: 0 }, spacing: { after: 80, line: 300 }, children: [run(b.text)] });
    case "numbered":
      return new Paragraph({ indent: { left: 440, hanging: 440 }, spacing: { after: 80, line: 300 }, tabStops: [{ type: TabStopType.LEFT, position: 440 }], children: [run(b.n, { bold: true, color: CYAN_DEEP }), run(`\t${b.text}`)] });
    case "local":
      return new Paragraph({
        spacing: { before: 120, after: 200, line: 290 },
        shading: { type: ShadingType.CLEAR, fill: CYAN_WASH, color: "auto" },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: CYAN, space: 10 } },
        indent: { left: 200, right: 120 },
        children: [caps("To complete locally", CYAN_DEEP, 14), run("   "), run(b.text, { italics: true, color: INK, size: 20 })],
      });
    default:
      return new Paragraph({ spacing: { after: 160, line: 300 }, children: [run(b.text)] });
  }
}

function cover(m: DocModel) {
  const facts: [string, string][] = [
    ["Reference", m.ref],
    ["Version", m.version],
    ["Status", m.status],
    ["Effective", fmtDocDate(m.effectiveDate ?? m.publishedAt)],
    ["Next review", fmtDocDate(m.nextReviewDate)],
    ["Applies to", m.appliesTo],
  ];
  const factCell = ([label, value]: [string, string]) =>
    new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: INK, color: "auto" },
      borders: { top: none, bottom: none, left: none, right: none },
      margins: { top: 160, bottom: 160, left: 240, right: 160 },
      children: [new Paragraph({ children: [caps(label, CYAN, 14)] }), new Paragraph({ spacing: { before: 40 }, children: [run(value, { color: "FFFFFF", size: 21, bold: true })] })],
    });
  return [
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], children: [logo(64), run("\t"), caps("Controlled document", FAINT, 14)] }),
    spacer(2600),
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 24, color: CYAN, space: 10 } }, indent: { right: 8600 }, children: [] }),
    new Paragraph({ spacing: { after: 200 }, children: [caps(m.typeLabel, CYAN_DEEP, 18)] }),
    new Paragraph({ spacing: { before: 120, after: 280 }, children: [run(m.title, { bold: true, color: INK, size: 64 })] }),
    new Paragraph({ spacing: { after: 480, line: 320 }, indent: { right: 1200 }, children: [run(m.description, { color: MUTED, size: 24 })] }),
    new Paragraph({ children: [caps(m.organisation ? "Prepared for" : "Issued by", FAINT, 14)] }),
    new Paragraph({ spacing: { before: 40, after: 1400 }, children: [run(m.organisation ?? "CSB · Care Solution Bureau", { bold: true, color: INK, size: 24 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 24, color: CYAN } },
      rows: [new TableRow({ children: facts.slice(0, 3).map(factCell) }), new TableRow({ children: facts.slice(3).map(factCell) })],
    }),
    new Paragraph({ spacing: { before: 160 }, children: [run("Printed copies are uncontrolled. Always check CSB for the current version.", { color: FAINT, size: 15 })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function control(m: DocModel) {
  const items = [...m.sections.map((s) => s.heading), ...(m.requirements.length ? ["Regulatory mapping"] : [])];
  return [
    ...sectionHeading(null, "Document control"),
    grid(null, [
      ["Document owner", m.owner, "Approved by", m.approvedBy],
      ["Date approved", fmtDocDate(m.approvedAt), "Review interval", `${m.reviewIntervalMonths} months`],
      ["Category", m.category, "Next review due", fmtDocDate(m.nextReviewDate)],
    ], [18, 32, 18, 32], { keyValue: true }),
    subHeading("Version history"),
    grid(["Version", "Date", "Status", "Summary of changes"], m.history.map((h) => [h.version, fmtDocDate(h.date), h.status, h.summary]), [14, 20, 16, 50]),
    subHeading("Approval and sign-off"),
    grid(["Role", "Name", "Signature", "Date"], [["Registered Manager", "", "", ""], ["Nominated Individual / Director", "", "", ""]], [32, 24, 26, 18], { tall: true }),
    subHeading("Contents"),
    ...items.map((h, i) => new Paragraph({ spacing: { after: 70 }, tabStops: [{ type: TabStopType.LEFT, position: 520 }], children: [run(String(i + 1).padStart(2, "0"), { bold: true, color: CYAN_DEEP, size: 18 }), run(`\t${h}`, { color: INK, size: 20 })] })),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function body(m: DocModel) {
  const out: (Paragraph | Table)[] = [];
  for (const s of m.sections) {
    out.push(...sectionHeading(s.number, s.heading));
    out.push(...s.blocks.map(blockParagraph));
  }
  if (m.requirements.length) {
    out.push(...sectionHeading(m.sections.length + 1, "Regulatory mapping"));
    out.push(new Paragraph({ spacing: { after: 200 }, children: [run("This document is mapped to the regulations, CQC quality statements and guidance below in the CSB requirements register.", { color: MUTED, size: 19 })] }));
    out.push(grid(["Type", "Reference", "Requirement"], m.requirements.map((r) => [r.type, r.reference, r.title]), [22, 32, 46]));
  }
  out.push(new Paragraph({ spacing: { before: 400 }, children: [caps("End of document", FAINT, 14)] }));
  return out;
}

export async function renderDocx(m: DocModel): Promise<Buffer> {
  const page = { margin: { top: 1440, bottom: 1200, left: 1280, right: 1280, header: 560, footer: 560 } };
  const header = new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 8 } },
        tabStops: [{ type: TabStopType.RIGHT, position: 9340 }],
        children: [logo(24), run("\t"), run(m.ref, { bold: true, color: CYAN_DEEP, size: 15 }), run(`   ${m.title}`, { color: MUTED, size: 15 })],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 8 } },
        tabStops: [{ type: TabStopType.RIGHT, position: 9340 }],
        children: [
          run(`${m.organisation ?? "CSB master template"}  ·  Version ${m.version}  ·  Uncontrolled when printed`, { color: MUTED, size: 15 }),
          new TextRun({ children: ["\t", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: INK, bold: true }),
        ],
      }),
    ],
  });
  const doc = new Document({
    creator: "CSB Care Solution Bureau",
    title: `${m.ref} ${m.title}`,
    description: m.description,
    styles: { default: { document: { run: { font: FONT, size: 21, color: BODY } } } },
    numbering: {
      config: [{ reference: "csb-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { color: CYAN }, paragraph: { indent: { left: 440, hanging: 260 } } } }] }],
    },
    sections: [
      { properties: { page: { margin: { ...page.margin, top: 900 } } }, children: cover(m) },
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: [...control(m), ...body(m)] },
    ],
  });
  return Packer.toBuffer(doc);
}
