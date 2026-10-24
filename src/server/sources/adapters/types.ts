import type { LegalStatus, MonitoringMethod, RegulatorySource } from "@prisma/client";
import type { HttpClient } from "../http";
import type { Section } from "../extract";

export interface DiscoveredDocument {
  externalId: string;
  url: string;
  title: string;
  documentType?: string;
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  /** Adapter-specific data needed by retrieve() */
  locator: Record<string, unknown>;
}

export interface RetrievedContent {
  title: string;
  url: string;
  contentType: string;
  raw: Buffer;
  sections: Section[];
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  legalStatus?: LegalStatus;
  documentType?: string;
  metadata: Record<string, unknown>;
}

export interface AdapterContext {
  http: HttpClient;
  log: (level: "info" | "warn" | "error", event: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}

/**
 * A monitoring adapter defines how documents are discovered for a source,
 * how their content is retrieved and how metadata is extracted.
 * Change detection itself is performed by the engine, so adapters stay small.
 */
export interface SourceAdapter {
  method: MonitoringMethod;
  /** true when the adapter retrieves the substantive content; false = metadata/feed only */
  retrievesFullContent: boolean;
  discover(source: RegulatorySource, ctx: AdapterContext): Promise<DiscoveredDocument[]>;
  retrieve(source: RegulatorySource, doc: DiscoveredDocument, ctx: AdapterContext): Promise<RetrievedContent>;
}

export function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
