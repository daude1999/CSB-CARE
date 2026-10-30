import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type PDFDocument from "pdfkit";
import { FONT_COVERAGE } from "./fonts/coverage";

/**
 * Every CSB PDF embeds its own fonts (Liberation Sans, SIL Open Font License, metric-compatible with Helvetica).
 * PDFs that only name a standard font such as Helvetica are drawn with whatever font the reader's device has under
 * that name, which on some Windows machines produced squashed, overlapping text in the Policy Library preview.
 */
export const FONT = { regular: "CSB-Sans", bold: "CSB-Sans-Bold", italic: "CSB-Sans-Italic", boldItalic: "CSB-Sans-BoldItalic" } as const;

const FILES: Record<keyof typeof FONT, string> = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
  italic: "LiberationSans-Italic.ttf",
  boldItalic: "LiberationSans-BoldItalic.ttf",
};

// Read from the source tree at runtime; next.config.ts traces this folder into every server bundle.
const FOLDER = path.join(process.cwd(), "src", "server", "documents", "fonts");

let cache: Record<keyof typeof FONT, Buffer> | null = null;
function buffers() {
  cache ??= {
    regular: readFileSync(path.join(FOLDER, FILES.regular)),
    bold: readFileSync(path.join(FOLDER, FILES.bold)),
    italic: readFileSync(path.join(FOLDER, FILES.italic)),
    boldItalic: readFileSync(path.join(FOLDER, FILES.boldItalic)),
  };
  return cache;
}

type Doc = InstanceType<typeof PDFDocument>;

/** Options for `new PDFDocument()` so its default font is embedded too (no standard-font reference is written). */
export function embeddedDefaultFont() {
  return { font: path.join(FOLDER, FILES.regular) };
}

/** Registers the embedded fonts under the FONT names and selects the regular face. */
export function applyEmbeddedFonts(doc: Doc) {
  const b = buffers();
  for (const key of Object.keys(FONT) as (keyof typeof FONT)[]) doc.registerFont(FONT[key], b[key]);
  doc.font(FONT.regular);
  return doc;
}

const covered = (code: number) => {
  let lo = 0;
  let hi = FONT_COVERAGE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, z] = FONT_COVERAGE[mid]!;
    if (code < a) hi = mid - 1;
    else if (code > z) lo = mid + 1;
    else return true;
  }
  return false;
};

const SWAPS: Record<string, string> = { "✓": "Yes", "✔": "Yes", "✗": "No", "✘": "No", "‑": "-", " ": " ", " ": " " };

/** Keeps text the embedded fonts can draw: common symbols get a readable stand-in and anything else is dropped. */
export function pdfText(s: string) {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t") out += ch;
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    else if (covered(code)) out += ch;
    else if (SWAPS[ch]) out += SWAPS[ch];
  }
  return out;
}
