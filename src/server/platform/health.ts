import { db } from "@/lib/db";
import { aiProviderProblem, aiProviderSetting } from "@/server/ai";
import type { Ctx } from "@/server/auth/rbac";
import { emailProvider } from "@/server/notifications/email";
import { requirePlatform } from "./access";
import { billingStatus } from "./billing";
import { databaseSize } from "./usage";
import { lastRestoreTest } from "./settings";

/**
 * Platform health and infrastructure, hosting-provider neutral. Each figure says whether it is measured, recorded by
 * a person, or not configured. Backups are never reported as successful: the platform can only show the last restore
 * test a person recorded.
 */
export type Measure = "measured" | "recorded" | "not configured";

export async function databaseCheck() {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

export async function jobStats() {
  const day = new Date(Date.now() - 86400_000);
  const [byStatus, failed24h, succeeded24h, oldestQueued] = await Promise.all([
    db.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.backgroundJob.count({ where: { status: { in: ["FAILED", "DEAD"] }, updatedAt: { gte: day } } }),
    db.backgroundJob.count({ where: { status: "SUCCEEDED", finishedAt: { gte: day } } }),
    db.backgroundJob.findFirst({ where: { status: "QUEUED", runAfter: { lte: new Date() } }, orderBy: { runAfter: "asc" }, select: { runAfter: true } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    queued: count("QUEUED"),
    running: count("RUNNING"),
    failed: count("FAILED"),
    dead: count("DEAD"),
    failed24h,
    succeeded24h,
    oldestQueuedMinutes: oldestQueued ? Math.round((Date.now() - oldestQueued.runAfter.getTime()) / 60000) : null,
  };
}

export function deploymentInfo() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null;
  return {
    commit: commit ? commit.slice(0, 7) : null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    host: process.env.VERCEL ? "Vercel" : "Self-hosted or local",
    region: process.env.VERCEL_REGION || null,
    nodeVersion: process.version,
  };
}

export async function platformHealth(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const [dbc, jobs, size, restore] = await Promise.all([databaseCheck(), jobStats(), databaseSize(), lastRestoreTest()]);
  const ai = { setting: aiProviderSetting(), problem: aiProviderProblem() };
  const checks = [
    { name: "Database", state: dbc.ok ? (dbc.latencyMs! > 1000 ? "warn" : "ok") : "fail", detail: dbc.ok ? `Responding in ${dbc.latencyMs} ms` : "Not responding", measure: "measured" as Measure },
    { name: "Background jobs", state: jobs.dead > 0 || jobs.failed24h > 0 ? "warn" : jobs.oldestQueuedMinutes !== null && jobs.oldestQueuedMinutes > 30 ? "warn" : "ok", detail: `${jobs.failed24h} failed in the last 24 hours, ${jobs.dead} given up, ${jobs.queued} waiting${jobs.oldestQueuedMinutes !== null ? ` (oldest ${jobs.oldestQueuedMinutes} min)` : ""}`, measure: "measured" as Measure },
    { name: "AI provider", state: ai.problem ? "warn" : "ok", detail: ai.problem ?? "Anthropic is configured", measure: (ai.problem ? "not configured" : "measured") as Measure },
    { name: "Email", state: emailProvider().name === "smtp" ? "ok" : "warn", detail: emailProvider().name === "smtp" ? "SMTP email is configured" : "No email provider: nothing is emailed; links are handed over in person", measure: (emailProvider().name === "smtp" ? "measured" : "not configured") as Measure },
    { name: "File storage", state: "ok", detail: ({ azure: "Azure Blob Storage", supabase: "Supabase Storage", database: "Stored in the platform database", local: "Local disk (development only)" } as Record<string, string>)[process.env.STORAGE_PROVIDER ?? ""] ?? "Default storage", measure: "measured" as Measure },
    { name: "Daily cron", state: process.env.CRON_SECRET ? "ok" : "warn", detail: process.env.CRON_SECRET ? "Cron secret is set" : "CRON_SECRET is not set, so the daily tick cannot be authorised", measure: (process.env.CRON_SECRET ? "measured" : "not configured") as Measure },
    { name: "Billing", state: billingStatus().connected ? "ok" : "warn", detail: billingStatus().message, measure: (billingStatus().connected ? "measured" : "not configured") as Measure },
    { name: "Backups", state: restore?.outcome === "PASSED" ? "ok" : "warn", detail: restore ? `Last restore test ${restore.outcome === "PASSED" ? "passed" : "FAILED"} on ${restore.testedOn.slice(0, 10)} (recorded by a person)` : "No restore test has been recorded. Backups are run by the database host and are not verified here.", measure: (restore ? "recorded" : "not configured") as Measure },
  ];
  const overall = checks.some((c) => c.state === "fail") ? "Down" : checks.filter((c) => c.name === "Database" || c.name === "Background jobs").some((c) => c.state === "warn") ? "Degraded" : "Healthy";
  return { overall, checks, jobs, database: { ...dbc, sizeBytes: size }, deployment: deploymentInfo(), restore };
}

/** Background jobs overview: counts by type and the latest failures, with the client each belonged to. */
export async function jobsOverview(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const [stats, byType, failures] = await Promise.all([
    jobStats(),
    db.backgroundJob.groupBy({ by: ["type", "status"], _count: { _all: true }, where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
    db.backgroundJob.findMany({ where: { status: { in: ["FAILED", "DEAD"] } }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, lastError: true, updatedAt: true, payload: true } }),
  ]);
  const orgIds = [...new Set(failures.map((f) => orgOf(f.payload)).filter((x): x is string => !!x))];
  const orgs = new Map((await db.organisation.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  const types = new Map<string, Record<string, number>>();
  for (const r of byType) types.set(r.type, { ...(types.get(r.type) ?? {}), [r.status]: r._count._all });
  return {
    stats,
    byType: [...types.entries()].map(([type, counts]) => ({ type, counts })).sort((a, b) => a.type.localeCompare(b.type)),
    failures: failures.map((f) => ({ id: f.id, type: f.type, status: f.status, attempts: f.attempts, maxAttempts: f.maxAttempts, error: (f.lastError ?? "").slice(0, 240), updatedAt: f.updatedAt, organisation: orgOf(f.payload) ? (orgs.get(orgOf(f.payload)!) ?? null) : null, organisationId: orgOf(f.payload) })),
  };
}

function orgOf(payload: unknown): string | null {
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).organisationId === "string" ? ((payload as Record<string, unknown>).organisationId as string) : null;
}
