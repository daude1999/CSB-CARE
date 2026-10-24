import * as cheerio from "cheerio";
import { normaliseText } from "@/lib/text";

export interface Section {
  ref: string;
  heading: string;
  text: string;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "section"
  );
}

/** Splits HTML into heading-delimited sections (h2/h3), keeping a stable ref per heading. */
export function htmlToSections(html: string, opts: { selector?: string; refPrefix?: string } = {}): Section[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, form, iframe, svg, .govuk-skip-link").remove();
  const root = opts.selector ? $(opts.selector).first() : $("body").length ? $("body") : $.root();
  const sections: Section[] = [];
  const used = new Map<string, number>();
  let current: Section = { ref: `${opts.refPrefix ?? ""}intro`, heading: "Introduction", text: "" };
  const push = () => {
    current.text = normaliseText(current.text);
    if (current.text || current.heading !== "Introduction") sections.push(current);
  };
  const walk = (el: cheerio.Cheerio<never>) => {
    el.contents().each((_, node) => {
      const n = $(node as never);
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();
      if (tag === "h2" || tag === "h3") {
        push();
        const heading = normaliseText(n.text());
        let ref = `${opts.refPrefix ?? ""}${slug(heading)}`;
        const count = used.get(ref) ?? 0;
        used.set(ref, count + 1);
        if (count) ref = `${ref}-${count + 1}`;
        current = { ref, heading, text: "" };
      } else if (tag && ["p", "li", "td", "th", "h4", "h5", "h6", "blockquote", "pre", "dt", "dd"].includes(tag)) {
        current.text += `${n.text()}\n`;
      } else if (tag) {
        walk(n as never);
      } else if ((node as { type?: string }).type === "text") {
        const t = n.text().trim();
        if (t) current.text += `${t}\n`;
      }
    });
  };
  walk(root as never);
  push();
  return sections.filter((s) => s.text.length > 0);
}

export function sectionsToText(sections: Section[]): string {
  return normaliseText(sections.map((s) => `## ${s.heading}\n${s.text}`).join("\n\n"));
}

export function plainTextToSections(text: string, refPrefix = ""): Section[] {
  const norm = normaliseText(text);
  if (!norm) return [];
  // Treat short lines without terminal punctuation as headings.
  const lines = norm.split("\n");
  const sections: Section[] = [];
  let cur: Section = { ref: `${refPrefix}intro`, heading: "Introduction", text: "" };
  for (const line of lines) {
    if (line.length > 3 && line.length < 90 && !/[.,;:]$/.test(line) && /^[A-Z0-9]/.test(line) && cur.text) {
      sections.push({ ...cur, text: normaliseText(cur.text) });
      cur = { ref: `${refPrefix}${slug(line)}`, heading: line, text: "" };
    } else cur.text += `${line}\n`;
  }
  sections.push({ ...cur, text: normaliseText(cur.text) });
  const seen = new Map<string, number>();
  return sections
    .filter((s) => s.text)
    .map((s) => {
      const c = seen.get(s.ref) ?? 0;
      seen.set(s.ref, c + 1);
      return c ? { ...s, ref: `${s.ref}-${c + 1}` } : s;
    });
}

export async function pdfToText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t, i) => `Page ${i + 1}\n${t}`).join("\n\n");
}

export async function docxToText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

/** Content sniffing: never trust the declared type alone. */
export function sniffContentType(buf: Buffer, declared?: string): "pdf" | "docx" | "html" | "xml" | "json" | "text" | "unknown" {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return declared?.includes("wordprocessingml") ? "docx" : "unknown";
  const head = buf.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("<?xml") || head.startsWith("<feed") || head.startsWith("<rss") || head.startsWith("<legislation")) return "xml";
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<body")) return "html";
  if (declared?.startsWith("text/")) return "text";
  return "unknown";
}
