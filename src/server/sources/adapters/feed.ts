import { XMLParser } from "fast-xml-parser";
import { normaliseText } from "@/lib/text";
import * as cheerio from "cheerio";
import { parseDate, type DiscoveredDocument, type SourceAdapter } from "./types";

/**
 * RSS 2.0 / Atom feeds. Feeds usually carry titles and summaries only, so this
 * adapter is metadata-level monitoring (coverage PARTIAL) unless the entry
 * content is complete. Config: { feedUrl, maxEntries }
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

function stripHtml(s: string): string {
  return normaliseText(cheerio.load(`<div>${s}</div>`)("div").text());
}

export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  updated: Date | null;
  published: Date | null;
  summary: string;
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml);
  const toArr = <T,>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  if (doc.feed) {
    return toArr(doc.feed.entry).map((e: Record<string, unknown>) => {
      const links = toArr(e.link as Record<string, string> | Record<string, string>[]);
      const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
      return {
        id: textOf(e.id) || alt?.["@href"] || textOf(e.title),
        title: stripHtml(textOf(e.title)),
        link: alt?.["@href"] ?? "",
        updated: parseDate(textOf(e.updated)),
        published: parseDate(textOf(e.published)),
        summary: stripHtml(textOf(e.summary) || textOf(e.content)),
      };
    });
  }
  if (doc.rss?.channel) {
    return toArr(doc.rss.channel.item).map((i: Record<string, unknown>) => ({
      id: textOf(i.guid) || textOf(i.link) || textOf(i.title),
      title: stripHtml(textOf(i.title)),
      link: textOf(i.link),
      updated: parseDate(textOf(i.pubDate)),
      published: parseDate(textOf(i.pubDate)),
      summary: stripHtml(textOf(i.description)),
    }));
  }
  throw new Error("Unrecognised feed format (expected Atom or RSS 2.0)");
}

function feedAdapter(method: "ATOM_FEED" | "RSS_FEED"): SourceAdapter {
  return {
    method,
    retrievesFullContent: false,
    async discover(source, ctx) {
      const cfg = source.config as { feedUrl: string; maxEntries?: number };
      const res = await ctx.http.get(cfg.feedUrl, { Accept: "application/atom+xml, application/rss+xml, application/xml" });
      const entries = parseFeed(res.text()).slice(0, cfg.maxEntries ?? 30);
      return entries.map<DiscoveredDocument>((e) => ({
        externalId: e.id,
        url: e.link || cfg.feedUrl,
        title: e.title,
        documentType: "feed_entry",
        publishedAt: e.published,
        modifiedAt: e.updated,
        locator: { entry: { ...e, updated: e.updated?.toISOString() ?? null, published: e.published?.toISOString() ?? null } },
      }));
    },
    async retrieve(_source, doc) {
      const e = doc.locator.entry as { title: string; summary: string; link: string };
      return {
        title: e.title,
        url: e.link || doc.url,
        contentType: "application/json",
        raw: Buffer.from(JSON.stringify(e)),
        sections: [
          { ref: "title", heading: "Title", text: e.title },
          ...(e.summary ? [{ ref: "summary", heading: "Summary", text: e.summary }] : []),
        ],
        publishedAt: doc.publishedAt,
        modifiedAt: doc.modifiedAt,
        documentType: "feed_entry",
        metadata: { coverage: "feed-entry-metadata-only" },
      };
    },
  };
}

export const atomFeedAdapter = feedAdapter("ATOM_FEED");
export const rssFeedAdapter = feedAdapter("RSS_FEED");
