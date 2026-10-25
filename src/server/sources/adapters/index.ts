import type { MonitoringMethod } from "@prisma/client";
import type { SourceAdapter } from "./types";
import { govUkContentAdapter, govUkSearchAdapter } from "./govuk";
import { atomFeedAdapter, rssFeedAdapter } from "./feed";
import { legislationAdapter } from "./legislation";
import { htmlPageAdapter } from "./html";

const registry = new Map<MonitoringMethod, SourceAdapter>([
  ["GOVUK_CONTENT_API", govUkContentAdapter],
  ["GOVUK_SEARCH_API", govUkSearchAdapter],
  ["ATOM_FEED", atomFeedAdapter],
  ["RSS_FEED", rssFeedAdapter],
  ["LEGISLATION_GOV_UK", legislationAdapter],
  ["HTML_PAGE", htmlPageAdapter],
]);

/** Returns null for MANUAL sources, which are never fetched automatically. */
export function adapterFor(method: MonitoringMethod): SourceAdapter | null {
  return registry.get(method) ?? null;
}

export function registerAdapter(adapter: SourceAdapter) {
  registry.set(adapter.method, adapter);
}
