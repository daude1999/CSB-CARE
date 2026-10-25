import type { Prisma, RegulatorySource, RunTrigger, SourceDocument, SourceVersion } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sha256 } from "@/lib/text";
import { adapterFor } from "./adapters";
import type { AdapterContext, DiscoveredDocument, RetrievedContent } from "./adapters/types";
import { sectionsToText } from "./extract";
import { HttpClient, HttpError } from "./http";
import { recordChange } from "../changes/detect";
import { storage } from "../storage";
import { indexSourceVersion } from "../search/index-chunks";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { notifyPlatformAdmins } from "../notifications/notify";

export interface RunSummary {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  discovered: number;
  checked: number;
  newDocuments: number;
  changed: number;
  failed: number;
  changeIds: string[];
  baseline: boolean;
}

const FAILURE_ALERT_THRESHOLD = 3;

/**
 * Checks one regulatory source end to end: discover → retrieve → validate →
 * normalise → hash → compare → version → detect. Safe to re-run (idempotent).
 */
export async function checkSource(sourceId: string, opts: { trigger: RunTrigger; jobId?: string; http?: HttpClient; force?: boolean } = { trigger: "MANUAL" }): Promise<RunSummary> {
  const source = await db.regulatorySource.findUniqueOrThrow({ where: { id: sourceId } });
  const adapter = adapterFor(source.monitoringMethod);
  if (!adapter || source.coverage === "MANUAL_REVIEW_ONLY") {
    throw new PermanentJobError(`${source.name} is manual-review-only; it is not retrieved automatically`);
  }
  if (!source.active && !opts.force) throw new PermanentJobError(`${source.name} is inactive`);

  const http = opts.http ?? new HttpClient();
  const baseline = !source.lastSuccessAt;
  const run = await db.sourceRetrievalRun.create({ data: { sourceId, trigger: opts.trigger, jobId: opts.jobId } });
  await db.regulatorySource.update({ where: { id: sourceId }, data: { lastAttemptedAt: run.startedAt } });

  const log: AdapterContext["log"] = async (level, event, message, data = {}) => {
    logger[level]({ sourceId, runId: run.id, event, ...data }, message);
    await db.processingEvent.create({ data: { runId: run.id, sourceId, level, event, message, data: data as Prisma.InputJsonValue } });
  };
  const ctx: AdapterContext = { http, log };
  const summary: RunSummary = { runId: run.id, status: "SUCCEEDED", discovered: 0, checked: 0, newDocuments: 0, changed: 0, failed: 0, changeIds: [], baseline };
  let fatal: Error | null = null;

  try {
    await log("info", "run.started", `Checking ${source.name} via ${source.monitoringMethod}`, { trigger: opts.trigger, baseline });
    const docs = await adapter.discover(source, ctx);
    summary.discovered = docs.length;
    await log("info", "discover.completed", `Discovered ${docs.length} document(s)`);
    if (docs.length === 0) throw new HttpError("Discovery returned no documents; the source structure may have changed", null, false);

    for (const d of docs) {
      try {
        const content = await adapter.retrieve(source, d, ctx);
        const outcome = await processDocument(source, run.id, d, content, { baseline, log });
        summary.checked++;
        if (outcome.kind === "new") summary.newDocuments++;
        if (outcome.kind === "changed" || (outcome.kind === "new" && outcome.changeId)) summary.changed++;
        if (outcome.changeId) summary.changeIds.push(outcome.changeId);
      } catch (e) {
        summary.failed++;
        await log("error", "document.failed", `Failed to process ${d.url}: ${(e as Error).message}`, { url: d.url });
      }
    }
    if (summary.checked === 0) throw new HttpError(`All ${summary.failed} document retrievals failed`, null, true);
    summary.status = summary.failed ? "PARTIAL" : "SUCCEEDED";
  } catch (e) {
    fatal = e as Error;
    summary.status = "FAILED";
    await log("error", "run.failed", fatal.message);
  }

  const now = new Date();
  const finished = await db.sourceRetrievalRun.update({
    where: { id: run.id },
    data: {
      status: summary.status,
      finishedAt: now,
      documentsDiscovered: summary.discovered,
      documentsChecked: summary.checked,
      documentsNew: summary.newDocuments,
      documentsChanged: summary.changed,
      documentsFailed: summary.failed,
      contentChecked: summary.checked > 0 && adapter.retrievesFullContent,
      error: fatal?.message ?? (summary.failed ? `${summary.failed} document(s) failed` : null),
    },
  });

  if (summary.status === "FAILED") {
    const updated = await db.regulatorySource.update({
      where: { id: sourceId },
      data: {
        consecutiveFailures: { increment: 1 },
        lastError: fatal?.message ?? "Unknown error",
        retrievalStatus: isFresh(source, now) ? "DEGRADED" : "FAILING",
        nextCheckAt: new Date(now.getTime() + source.frequencyMinutes * 60_000),
      },
    });
    if (updated.consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
      await notifyPlatformAdmins({
        type: "source.failing",
        title: `Monitoring failing: ${source.name}`,
        body: `${updated.consecutiveFailures} consecutive failed checks. Last error: ${updated.lastError}`,
        reason: "You are a platform administrator responsible for source monitoring.",
        links: [{ label: "Source", url: `/admin/sources/${source.id}` }, { label: "Canonical URL", url: source.canonicalUrl }],
        actionUrl: `/admin/sources/${source.id}`,
        dedupeKey: `source-failing:${source.id}:${source.lastSuccessAt?.toISOString() ?? "never"}`,
      });
    }
    const transient = !(fatal instanceof HttpError) || fatal.transient;
    if (transient) throw new Error(`Source check failed (run ${finished.id}): ${fatal?.message}`);
    throw new PermanentJobError(`Source check failed permanently (run ${finished.id}): ${fatal?.message}`);
  }

  await db.regulatorySource.update({
    where: { id: sourceId },
    data: {
      lastSuccessAt: now,
      lastContentCheckedAt: adapter.retrievesFullContent ? now : source.lastContentCheckedAt,
      retrievalStatus: summary.status === "SUCCEEDED" ? "OK" : "DEGRADED",
      consecutiveFailures: 0,
      lastError: summary.status === "PARTIAL" ? finished.error : null,
      lastChangeDetectedAt: summary.changeIds.length ? now : undefined,
      nextCheckAt: new Date(now.getTime() + source.frequencyMinutes * 60_000),
    },
  });
  for (const changeId of summary.changeIds) {
    await enqueue("change.analyse", { changeId }, { idempotencyKey: `change.analyse:${changeId}` });
  }
  return summary;
}

function isFresh(source: Pick<RegulatorySource, "lastSuccessAt" | "freshnessWindowHours">, now = new Date()) {
  return Boolean(source.lastSuccessAt && now.getTime() - source.lastSuccessAt.getTime() <= source.freshnessWindowHours * 3600_000);
}

export function freshness(source: Pick<RegulatorySource, "lastSuccessAt" | "freshnessWindowHours" | "coverage" | "active">, now = new Date()) {
  if (!source.active) return { state: "inactive" as const, label: "Inactive" };
  if (source.coverage === "MANUAL_REVIEW_ONLY") return { state: "manual" as const, label: "Manual review only (not automatically monitored)" };
  if (!source.lastSuccessAt) return { state: "never" as const, label: "Never successfully checked" };
  return isFresh(source, now)
    ? { state: "fresh" as const, label: "Checked within freshness window" }
    : { state: "stale" as const, label: `Not successfully checked within ${source.freshnessWindowHours}h` };
}

type Outcome = { kind: "unchanged" | "new" | "changed"; changeId?: string };

async function processDocument(
  source: RegulatorySource,
  runId: string,
  d: DiscoveredDocument,
  content: RetrievedContent,
  opts: { baseline: boolean; log: AdapterContext["log"] },
): Promise<Outcome> {
  const sections = content.sections.filter((s) => s.text.trim());
  if (sections.length === 0) {
    throw new Error("Validation failed: no text extracted. Not recording a new version (page structure may have changed).");
  }
  const normalisedText = sectionsToText(sections);
  const contentHash = sha256(normalisedText);
  const retrievedAt = new Date();

  const document = await db.sourceDocument.upsert({
    where: { sourceId_externalId: { sourceId: source.id, externalId: d.externalId } },
    create: {
      sourceId: source.id,
      externalId: d.externalId,
      url: content.url || d.url,
      title: content.title || d.title,
      documentType: content.documentType ?? d.documentType,
      legalStatus: content.legalStatus ?? "ADVISORY_GUIDANCE",
      isSimulated: source.isSimulated,
    },
    update: { lastSeenAt: retrievedAt, title: content.title || d.title, url: content.url || d.url, legalStatus: content.legalStatus ?? undefined },
    include: { currentVersion: true },
  });

  // Attach requirements that reference this document's section refs before it existed.
  await db.regulatoryRequirement.updateMany({
    where: { sourceId: source.id, sourceDocumentId: null, sourceSectionRef: { in: sections.map((s) => s.ref) } },
    data: { sourceDocumentId: document.id },
  });

  if (document.currentVersion?.contentHash === contentHash) {
    const officialChanged = (content.modifiedAt?.getTime() ?? null) !== (document.currentVersion.modifiedAt?.getTime() ?? null);
    if (officialChanged) {
      await opts.log("info", "document.metadata_only", `Official modified date changed for "${document.title}" but the content is identical; not treated as a change`, {
        previousModified: document.currentVersion.modifiedAt,
        newModified: content.modifiedAt,
      });
    }
    return { kind: "unchanged" };
  }

  const storageKey = `sources/${source.id}/${document.id}/${contentHash}`;
  await storage().put(storageKey, content.raw, content.contentType);

  const result = await db.$transaction(async (tx) => {
    // Serialise concurrent runs on the same document.
    await tx.$queryRaw`SELECT id FROM "SourceDocument" WHERE id = ${document.id} FOR UPDATE`;
    const fresh = await tx.sourceDocument.findUniqueOrThrow({ where: { id: document.id }, include: { currentVersion: true } });
    if (fresh.currentVersion?.contentHash === contentHash) return { version: null as SourceVersion | null, changeId: undefined, prev: fresh.currentVersion };
    const max = await tx.sourceVersion.aggregate({ where: { documentId: document.id }, _max: { versionNumber: true } });
    const version = await tx.sourceVersion.create({
      data: {
        documentId: document.id,
        versionNumber: (max._max.versionNumber ?? 0) + 1,
        contentHash,
        normalisedText,
        sections: sections as unknown as Prisma.InputJsonValue,
        rawStorageKey: storageKey,
        contentType: content.contentType,
        retrievedAt,
        publishedAt: content.publishedAt ?? d.publishedAt ?? null,
        modifiedAt: content.modifiedAt ?? d.modifiedAt ?? null,
        metadata: content.metadata as Prisma.InputJsonValue,
        runId,
        isSimulated: source.isSimulated,
      },
    });
    await tx.sourceDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    let changeId: string | undefined;
    const isBaseline = opts.baseline && !fresh.currentVersion;
    if (!isBaseline) {
      const change = await recordChange(tx, { source, document: fresh as SourceDocument, previous: fresh.currentVersion, next: version });
      changeId = change.id;
    }
    return { version, changeId, prev: fresh.currentVersion };
  });

  if (!result.version) return { kind: "unchanged" };
  await indexSourceVersion(result.version.id);
  await opts.log(
    "info",
    result.prev ? "document.changed" : "document.new",
    result.prev
      ? `New version ${result.version.versionNumber} of "${document.title}" (content hash changed)`
      : `${opts.baseline ? "Baseline captured" : "New document discovered"}: "${document.title}"`,
    { documentId: document.id, versionId: result.version.id, changeId: result.changeId },
  );
  return { kind: result.prev ? "changed" : "new", changeId: result.changeId };
}

/** Enqueues scheduled checks for every due, automatically monitored source. */
export async function scheduleDueSources(now = new Date()) {
  const due = await db.regulatorySource.findMany({
    where: { active: true, coverage: { not: "MANUAL_REVIEW_ONLY" }, monitoringMethod: { not: "MANUAL" }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
  });
  const created: string[] = [];
  for (const s of due) {
    const slot = Math.floor(now.getTime() / (s.frequencyMinutes * 60_000));
    const { created: isNew, job } = await enqueue("source.check", { sourceId: s.id, trigger: "SCHEDULED" }, { idempotencyKey: `source.check:${s.id}:${slot}` });
    if (isNew) created.push(job.id);
  }
  return created;
}

export async function requestManualCheck(sourceId: string, actorId: string) {
  const { job } = await enqueue("source.check", { sourceId, trigger: "MANUAL", requestedBy: actorId }, { idempotencyKey: `source.check:${sourceId}:manual:${Date.now()}`, maxAttempts: 2 });
  return job;
}
