import "server-only";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
} from "docx";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo";
import { fmtDocDate, type Block, type DocModel } from "./model";

const NAVY = "16181C";
const GOLD = "3EC1E0";
const GOLD_LIGHT = "ECF9FD";
const GREY = "5B6577";
const RULE = "D6DAE1";
const FONT = "Calibri";

const logo = (height: number) =>
  new ImageRun({ type: "png", data: Buffer.from(LOGO_PNG_BASE64, "base64"), transformation: { width: Math.round((height * LOGO_SIZE.width) / LOGO_SIZE.height), height } });

const run = (text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean; allCaps?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: opts.size ?? 21, bold: opts.bold, color: opts.color, italics: opts.italics, allCaps: opts.allCaps });

const thin = { style: BorderStyle.SINGLE, size: 4, color: RULE };

function cell(text: string, opts: { header?: boolean; label?: boolean; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, fill: NAVY, color: "auto" } : opts.label ? { type: ShadingType.CLEAR, fill: GOLD_LIGHT, color: "auto" } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [run(text, { bold: opts.header || opts.label, color: opts.header ? "FFFFFF" : opts.label ? NAVY : undefined, size: 19 })] })],
  });
}

function grid(header: string[] | null, rows: string[][], widths: number[], labelFirst = false) {
  const borders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      ...(header ? [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { header: true, width: widths[i] })) })] : []),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, { width: widths[i], label: labelFirst && i % 2 === 0 })) })),
    ],
  });
}

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
  new Paragraph({
    heading: level,
    spacing: { before: 320, after: 120 },
    border: level === HeadingLevel.HEADING_1 ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 4 } } : undefined,
    keepNext: true,
    children: [run(text, { bold: true, color: NAVY, size: level === HeadingLevel.HEADING_1 ? 28 : 24 })],
  });

function blockParagraph(b: Block) {
  switch (b.kind) {
    case "bullet":
      return new Paragraph({ numbering: { reference: "csb-bullets", level: 0 }, spacing: { after: 60 }, children: [run(b.text)] });
    case "numbered":
      return new Paragraph({ indent: { left: 480, hanging: 360 }, spacing: { after: 60 }, children: [run(`${b.n}\t${b.text}`)], tabStops: [{ type: TabStopType.LEFT, position: 480 }] });
    case "local":
      return new Paragraph({
        spacing: { before: 60, after: 120 },
        shading: { type: ShadingType.CLEAR, fill: GOLD_LIGHT, color: "auto" },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 8 } },
        children: [run("To complete locally: ", { bold: true, color: NAVY }), run(b.text, { italics: true })],
      });
    default:
      return new Paragraph({ spacing: { after: 120 }, children: [run(b.text)] });
  }
}

function cover(m: DocModel) {
  const owner = m.organisation ?? "CSB master template";
  return [
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 12 } }, children: [logo(90)] }),
    new Paragraph({ spacing: { before: 120 }, children: [run("Policies, procedures and regulatory compliance for adult social care", { color: GREY, size: 18 })] }),
    new Paragraph({ spacing: { before: 1400 }, children: [run(m.typeLabel.toUpperCase(), { bold: true, color: GOLD, size: 22 })] }),
    new Paragraph({ spacing: { before: 120, after: 120 }, children: [run(m.title, { bold: true, color: NAVY, size: 56 })] }),
    new Paragraph({ spacing: { after: 480 }, children: [run(m.description, { color: GREY, size: 22 })] }),
    grid(null, [
      ["Reference", m.ref, "Version", m.version],
      ["Organisation", owner, "Status", m.status],
      ["Category", m.category, "Applies to", m.appliesTo],
      ["Effective date", fmtDocDate(m.effectiveDate ?? m.publishedAt), "Next review", fmtDocDate(m.nextReviewDate)],
      ["Approval", m.approval, "Owner", m.owner],
    ], [18, 32, 18, 32], true),
    new Paragraph({ spacing: { before: 600 }, children: [run("Controlled document. Printed copies are uncontrolled; always check the CSB system for the current version.", { italics: true, color: GREY, size: 18 })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function control(m: DocModel) {
  return [
    heading("Document control"),
    grid(null, [
      ["Document owner", m.owner],
      ["Approval", m.approval],
      ["Approved by", m.approvedBy],
      ["Date approved", fmtDocDate(m.approvedAt)],
      ["Review interval", `${m.reviewIntervalMonths} months`],
      ["Next review due", fmtDocDate(m.nextReviewDate)],
    ], [30, 70], true),
    heading("Version history", HeadingLevel.HEADING_2),
    grid(["Version", "Date", "Status", "Summary of changes"], m.history.map((h) => [h.version, fmtDocDate(h.date), h.status, h.summary]), [12, 20, 16, 52]),
    heading("Local approval and sign-off", HeadingLevel.HEADING_2),
    grid(["Role", "Name", "Signature", "Date"], [["Registered Manager", "", "", ""], ["Nominated Individual / Director", "", "", ""]], [30, 25, 25, 20]),
    heading("Contents", HeadingLevel.HEADING_2),
    ...m.sections.map((s) => new Paragraph({ spacing: { after: 40 }, children: [run(`${s.number}.  ${s.heading}`)] })),
    ...(m.requirements.length ? [new Paragraph({ spacing: { after: 40 }, children: [run(`${m.sections.length + 1}.  Regulatory mapping`)] })] : []),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function body(m: DocModel) {
  const out: (Paragraph | Table)[] = [];
  for (const s of m.sections) {
    out.push(heading(`${s.number}. ${s.heading}`));
    out.push(...s.blocks.map(blockParagraph));
  }
  if (m.requirements.length) {
    out.push(heading(`${m.sections.length + 1}. Regulatory mapping`));
    out.push(new Paragraph({ spacing: { after: 160 }, children: [run("This document is mapped to the following regulations, CQC quality statements and guidance in the CSB requirements register.", { color: GREY })] }));
    out.push(grid(["Type", "Reference", "Requirement"], m.requirements.map((r) => [r.type, r.reference, r.title]), [22, 30, 48]));
  }
  return out;
}

export async function renderDocx(m: DocModel): Promise<Buffer> {
  const page = { margin: { top: 1300, bottom: 1100, left: 1100, right: 1100, header: 500, footer: 500 } };
  const header = new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: 9700 }],
        children: [logo(26), run(`\t${m.ref}  ${m.title}`, { color: GREY, size: 16 })],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9700 }],
        children: [
          run(`${m.organisation ?? "CSB master template"} · Version ${m.version} · ${m.status} · Uncontrolled when printed`, { color: GREY, size: 16 }),
          new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY }),
        ],
      }),
    ],
  });
  const doc = new Document({
    creator: "CSB Care Solution Bureau",
    title: `${m.ref} ${m.title}`,
    description: m.description,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [{ reference: "csb-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 280 } } } }] }],
    },
    sections: [
      { properties: { page }, children: cover(m) },
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: [...control(m), ...body(m)] },
    ],
  });
  return Packer.toBuffer(doc);
}
