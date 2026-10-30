// Reads a generated PDF the way a reader sees it: PDF.js (the same engine as the Policy Library viewer) extracts each
// line's position and font, and draws each page to a PNG for visual comparison. Used by document rendering tests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const FONT_DATA = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;

export interface TextBox {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageInfo {
  width: number;
  height: number;
  boxes: TextBox[];
  text: string;
}

async function open(pdf: Buffer) {
  const task = getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: FONT_DATA, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  return Object.assign(doc, { close: () => task.destroy() });
}

/** Every visible text run with its box in PDF points, measured from the top-left of the page. */
export async function inspectPdf(pdf: Buffer): Promise<PageInfo[]> {
  const doc = await open(pdf);
  const pages: PageInfo[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: TextBox[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , e, f] = item.transform as number[];
      const h = item.height || Math.abs((item.transform as number[])[3]!);
      // Glyphs sit from roughly 0.2 of the size below the baseline to 0.8 above it.
      boxes.push({ str: item.str, x: e!, y: height - f! - h * 0.8, w: item.width, h });
    }
    pages.push({ width, height, boxes, text: boxes.map((b) => b.str).join(" ").replace(/\s+/g, " ") });
  }
  await doc.close();
  return pages;
}

/** Pairs of text runs on a page whose boxes overlap: text drawn on top of other text. */
export function overlaps(page: PageInfo, tolerance = 0.6) {
  const found: [string, string][] = [];
  const b = page.boxes;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const p = b[i]!;
      const q = b[j]!;
      const dx = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const dy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (dx > tolerance && dy > tolerance) found.push([p.str, q.str]);
    }
  return found;
}

/** Text runs that reach outside the printable area (clipped or off the page). */
export function outside(page: PageInfo, margin = 30) {
  return page.boxes.filter((t) => t.x < margin || t.x + t.w > page.width - margin || t.y < margin - 10 || t.y + t.h > page.height - 20);
}

/** Draws every page to PNG at the given scale. */
export async function renderPages(pdf: Buffer, scale = 1): Promise<Buffer[]> {
  const doc = await open(pdf);
  const out: Buffer[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // PDF.js accepts the Node canvas; its types only describe the browser canvas.
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    out.push(canvas.toBuffer("image/png"));
  }
  await doc.close();
  return out;
}

/**
 * Compares a rendered page with its approved baseline image. A missing baseline (or UPDATE_DOC_BASELINES=1) writes it,
 * so the first run records what a person then checks by eye. Returns the share of pixels that differ.
 */
export async function compareWithBaseline(png: Buffer, file: string, opts: { allowShift?: boolean } = {}) {
  const shifts: [number, number][] = opts.allowShift ? [-1, 0, 1].flatMap((sx) => [-1, 0, 1].map((sy): [number, number] => [sx, sy])) : [[0, 0]];
  const { loadImage } = await import("@napi-rs/canvas");
  if (!existsSync(file) || process.env.UPDATE_DOC_BASELINES === "1") {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, png);
    return { diff: 0, written: true };
  }
  const [a, b] = await Promise.all([loadImage(png), loadImage(readFileSync(file))]);
  // A page's size in points is fractional, so browsers and renderers round its pixel size either way by one pixel.
  if (Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2) return { diff: 1, written: false };
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const pixels = (img: typeof a) => {
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const pa = pixels(a);
  const pb = pixels(b);
  // A page drawn in a scrolled browser panel can sit up to a pixel off the grid: take the best of the small shifts.
  let best = 1;
  for (const [sx, sy] of shifts) {
    let differ = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const j = ((y + sy) * w + (x + sx)) * 4;
        const d = Math.abs(pa[i]! - pb[j]!) + Math.abs(pa[i + 1]! - pb[j + 1]!) + Math.abs(pa[i + 2]! - pb[j + 2]!);
        if (d > 60) differ++;
      }
    best = Math.min(best, differ / ((w - 2) * (h - 2)));
  }
  return { diff: best, written: false };
}
