import type { LegalStatus, RegulatorySource } from "@prisma/client";
import { htmlToSections, pdfToText, plainTextToSections, type Section } from "../extract";
import { parseDate, type AdapterContext, type DiscoveredDocument, type RetrievedContent, type SourceAdapter } from "./types";

/**
 * GOV.UK Content API (https://content-api.publishing.service.gov.uk/).
 * Public, unauthenticated, JSON. Content is published under the Open Government Licence v3.0.
 * Endpoint: GET https://www.gov.uk/api/content/<base_path>
 *
 * Config:
 *  { basePaths: string[],            // pages to monitor, e.g. "/government/collections/adult-social-care-guidance"
 *    followLinkedDocuments?: boolean, // for document collections, monitor links.documents too
 *    maxDocuments?: number,
 *    includePdfAttachments?: boolean }
 */

const GOVUK = process.env.GOVUK_BASE_URL ?? "https://www.gov.uk";

interface GovUkLink {
  content_id: string;
  base_path?: string;
  title: string;
  document_type?: string;
  public_updated_at?: string;
  web_url?: string;
}

export interface GovUkContentItem {
  content_id: string;
  base_path: string;
  title: string;
  description?: string;
  document_type: string;
  schema_name?: string;
  first_published_at?: string;
  public_updated_at?: string;
  updated_at?: string;
  details?: {
    body?: string;
    parts?: { title: string; slug: string; body: string }[];
    documents?: string[];
    collection_groups?: { title: string; body?: string; documents: string[] }[];
    change_history?: { public_timestamp: string; note: string }[];
    attachments?: { title?: string; url?: string; content_type?: string; id?: string }[];
  };
  links?: { documents?: GovUkLink[]; organisations?: GovUkLink[] };
}

interface GovUkConfig {
  basePaths?: string[];
  followLinkedDocuments?: boolean;
  maxDocuments?: number;
  includePdfAttachments?: boolean;
}

const STATUTORY_TYPES = new Set(["statutory_guidance"]);

export function legalStatusFor(item: Pick<GovUkContentItem, "document_type">): LegalStatus {
  if (STATUTORY_TYPES.has(item.document_type)) return "STATUTORY_GUIDANCE";
  return "ADVISORY_GUIDANCE";
}

export function contentItemToSections(item: GovUkContentItem): Section[] {
  const d = item.details ?? {};
  const out: Section[] = [];
  if (item.description) out.push({ ref: "summary", heading: "Summary", text: item.description });
  if (d.body) out.push(...htmlToSections(d.body));
  for (const part of d.parts ?? []) out.push(...htmlToSections(part.body, { refPrefix: `${part.slug}/` }).map((s) => ({ ...s, heading: `${part.title}: ${s.heading}` })));
  for (const group of d.collection_groups ?? []) {
    const body = group.body ? htmlToSections(group.body).map((s) => s.text).join("\n") : "";
    out.push({ ref: `group/${group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, heading: group.title, text: [body, `${group.documents.length} linked documents`].filter(Boolean).join("\n") });
  }
  if (d.documents?.length) out.push(...htmlToSections(d.documents.join("\n"), { refPrefix: "documents/" }));
  return out;
}

export const govUkContentAdapter: SourceAdapter = {
  method: "GOVUK_CONTENT_API",
  retrievesFullContent: true,

  async discover(source: RegulatorySource, ctx: AdapterContext) {
    const cfg = source.config as GovUkConfig;
    const docs: DiscoveredDocument[] = [];
    for (const basePath of cfg.basePaths ?? []) {
      const item = await ctx.http.getJson<GovUkContentItem>(`${GOVUK}/api/content${basePath}`);
      docs.push({
        externalId: item.content_id,
        url: `${GOVUK}${item.base_path}`,
        title: item.title,
        documentType: item.document_type,
        publishedAt: parseDate(item.first_published_at),
        modifiedAt: parseDate(item.public_updated_at),
        locator: { basePath: item.base_path, prefetched: item },
      });
      if (cfg.followLinkedDocuments) {
        for (const link of item.links?.documents ?? []) {
          if (!link.base_path) continue;
          docs.push({
            externalId: link.content_id,
            url: `${GOVUK}${link.base_path}`,
            title: link.title,
            documentType: link.document_type,
            modifiedAt: parseDate(link.public_updated_at),
            locator: { basePath: link.base_path },
          });
        }
      }
    }
    const unique = [...new Map(docs.map((d) => [d.externalId, d])).values()];
    const max = cfg.maxDocuments ?? 50;
    if (unique.length > max) await ctx.log("warn", "discover.truncated", `Discovered ${unique.length} documents; monitoring the first ${max} (maxDocuments)`);
    return unique.slice(0, max);
  },

  async retrieve(source: RegulatorySource, doc: DiscoveredDocument, ctx: AdapterContext): Promise<RetrievedContent> {
    const cfg = source.config as GovUkConfig;
    const item = (doc.locator.prefetched as GovUkContentItem | undefined) ?? (await ctx.http.getJson<GovUkContentItem>(`${GOVUK}/api/content${doc.locator.basePath as string}`));
    const sections = contentItemToSections(item);
    if (cfg.includePdfAttachments) {
      for (const att of (item.details?.attachments ?? []).filter((a) => a.content_type === "application/pdf" && a.url).slice(0, 5)) {
        try {
          const res = await ctx.http.get(att.url as string);
          const text = await pdfToText(res.body);
          sections.push(...plainTextToSections(text, `attachment/${att.id ?? "pdf"}/`));
        } catch (e) {
          await ctx.log("warn", "attachment.failed", `Could not extract PDF attachment ${att.url}: ${(e as Error).message}`);
        }
      }
    }
    return {
      title: item.title,
      url: `${GOVUK}${item.base_path}`,
      contentType: "application/json",
      raw: Buffer.from(JSON.stringify(item)),
      sections,
      publishedAt: parseDate(item.first_published_at),
      modifiedAt: parseDate(item.public_updated_at),
      legalStatus: legalStatusFor(item),
      documentType: item.document_type,
      metadata: {
        contentId: item.content_id,
        schemaName: item.schema_name,
        latestChangeNote: item.details?.change_history?.slice().sort((a, b) => b.public_timestamp.localeCompare(a.public_timestamp))[0] ?? null,
        changeHistoryCount: item.details?.change_history?.length ?? 0,
        licence: "Open Government Licence v3.0",
      },
    };
  },
};

/**
 * GOV.UK Search API (https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html)
 * used for discovery of recent publications, followed by Content API retrieval.
 * Config: { params: { filter_organisations: "...", order: "-public_timestamp", count: "20" }, maxDocuments }
 */
export const govUkSearchAdapter: SourceAdapter = {
  method: "GOVUK_SEARCH_API",
  retrievesFullContent: true,
  async discover(source, ctx) {
    const cfg = source.config as { params?: Record<string, string>; maxDocuments?: number };
    const params = new URLSearchParams({ order: "-public_timestamp", count: "20", fields: "title,link,public_timestamp,content_id,format", ...(cfg.params ?? {}) });
    const res = await ctx.http.getJson<{ results: { title: string; link: string; public_timestamp?: string; content_id?: string; format?: string }[] }>(
      `${GOVUK}/api/search.json?${params}`,
    );
    return res.results
      .filter((r) => r.link?.startsWith("/"))
      .slice(0, cfg.maxDocuments ?? 20)
      .map((r) => ({
        externalId: r.content_id ?? r.link,
        url: `${GOVUK}${r.link}`,
        title: r.title,
        documentType: r.format,
        modifiedAt: parseDate(r.public_timestamp),
        locator: { basePath: r.link },
      }));
  },
  retrieve: (source, doc, ctx) => govUkContentAdapter.retrieve({ ...source, config: {} }, doc, ctx),
};
