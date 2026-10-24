import { htmlToSections, sniffContentType, pdfToText, docxToText, plainTextToSections } from "../extract";
import { isAllowedByRobots } from "../http";
import { parseDate, type SourceAdapter } from "./types";

/**
 * Permitted page retrieval for sources without an API or feed. Checks robots.txt,
 * extracts only the configured content region and supports PDF/DOCX documents.
 * Config: { pages: [{ url, title, selector? }], respectRobots?: boolean }
 */
export const htmlPageAdapter: SourceAdapter = {
  method: "HTML_PAGE",
  retrievesFullContent: true,
  async discover(source) {
    const cfg = source.config as { pages?: { url: string; title: string; selector?: string }[] };
    return (cfg.pages ?? []).map((p) => ({ externalId: p.url, url: p.url, title: p.title, locator: { selector: p.selector } }));
  },
  async retrieve(source, doc, ctx) {
    const cfg = source.config as { respectRobots?: boolean };
    if (cfg.respectRobots !== false && !(await isAllowedByRobots(ctx.http, doc.url))) {
      throw Object.assign(new Error(`robots.txt disallows ${doc.url}; not retrieved`), { permanent: true });
    }
    const res = await ctx.http.get(doc.url, { Accept: "text/html, application/pdf" });
    const kind = sniffContentType(res.body, res.headers["content-type"]);
    let sections;
    if (kind === "html") sections = htmlToSections(res.text(), { selector: (doc.locator.selector as string) || "main" });
    else if (kind === "pdf") sections = plainTextToSections(await pdfToText(res.body));
    else if (kind === "docx") sections = plainTextToSections(await docxToText(res.body));
    else throw Object.assign(new Error(`Unsupported content type for ${doc.url} (${res.headers["content-type"] ?? "unknown"})`), { permanent: true });
    return {
      title: doc.title,
      url: res.url,
      contentType: res.headers["content-type"] ?? kind,
      raw: res.body,
      sections,
      modifiedAt: parseDate(res.headers["last-modified"]),
      metadata: { etag: res.headers["etag"] ?? null, httpLastModified: res.headers["last-modified"] ?? null },
    };
  },
};
