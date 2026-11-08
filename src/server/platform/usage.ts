import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import { requireCustomerOrg, requirePlatform } from "./access";
import { getSetting } from "./settings";

/**
 * Tenant usage metering for the Admin Centre: stored files, records and AI requests. Platform-wide views show
 * counts, sizes and costs only, never the content of a document, a care record or an AI prompt.
 */
const STORAGE_SQL = `
  SELECT "organisationId" AS org, SUM("sizeBytes")::bigint AS bytes, COUNT(*)::bigint AS files FROM "EvidenceDocument" GROUP BY 1
  UNION ALL SELECT "organisationId", SUM("sizeBytes")::bigint, COUNT(*)::bigint FROM "ServiceUserDocumentVersion" GROUP BY 1
  UNION ALL SELECT "organisationId", SUM("sizeBytes")::bigint, COUNT(*)::bigint FROM "BodyMapPhoto" GROUP BY 1
  UNION ALL SELECT "organisationId", SUM("sizeBytes")::bigint, COUNT(*)::bigint FROM "CareIntakeDocument" GROUP BY 1
  UNION ALL SELECT "organisationId", SUM(octet_length("bytes"))::bigint, COUNT(*)::bigint FROM "HrFile" GROUP BY 1`;

/** Stored file bytes and counts per organisation, measured from the file records. */
export async function storageByOrg(): Promise<Map<string, { bytes: number; files: number }>> {
  const rows = await db.$queryRawUnsafe<{ org: string; bytes: bigint | null; files: bigint }[]>(`SELECT org, SUM(bytes)::bigint AS bytes, SUM(files)::bigint AS files FROM (${STORAGE_SQL}) s GROUP BY org`);
  return new Map(rows.map((r) => [r.org, { bytes: Number(r.bytes ?? 0), files: Number(r.files) }]));
}

export async function storageForOrg(organisationId: string) {
  return (await storageByOrg()).get(organisationId) ?? { bytes: 0, files: 0 };
}

/** File growth by month (last six months), measured from upload dates. */
export async function storageGrowth(organisationId?: string) {
  const since = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  const where = organisationId ? `WHERE "organisationId" = $2` : "";
  const sql = `SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, SUM(b)::bigint AS bytes FROM (
      SELECT "organisationId", "createdAt", "sizeBytes"::bigint AS b FROM "EvidenceDocument"
      UNION ALL SELECT "organisationId", "uploadedAt", "sizeBytes"::bigint FROM "ServiceUserDocumentVersion"
      UNION ALL SELECT "organisationId", "uploadedAt", "sizeBytes"::bigint FROM "BodyMapPhoto"
      UNION ALL SELECT "organisationId", "createdAt", "sizeBytes"::bigint FROM "CareIntakeDocument"
      UNION ALL SELECT "organisationId", "createdAt", octet_length("bytes")::bigint FROM "HrFile"
    ) f ${where ? where + ` AND "createdAt" >= $1` : `WHERE "createdAt" >= $1`} GROUP BY 1 ORDER BY 1`;
  const rows = organisationId ? await db.$queryRawUnsafe<{ month: string; bytes: bigint }[]>(sql, since, organisationId) : await db.$queryRawUnsafe<{ month: string; bytes: bigint }[]>(sql, since);
  const out: { month: string; bytes: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, bytes: Number(rows.find((r) => r.month === key)?.bytes ?? 0) });
  }
  return out;
}

/** The database's own size, measured by PostgreSQL. */
export async function databaseSize(): Promise<number | null> {
  try {
    const [r] = await db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    return r ? Number(r.size) : null;
  } catch {
    return null;
  }
}

export const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Records, users and AI use for one client (Client profile → Storage / AI Usage, and the client directory). */
export async function tenantUsage(organisationId: string) {
  const since = monthStart();
  const [storage, users, serviceUsers, visits, aiThisMonth, branches] = await Promise.all([
    storageForOrg(organisationId),
    db.membership.count({ where: { organisationId, deactivatedAt: null, user: { deactivatedAt: null } } }),
    db.serviceUser.count({ where: { organisationId } }),
    db.visit.count({ where: { organisationId } }),
    db.aiUsageEvent.count({ where: { organisationId, createdAt: { gte: since } } }),
    db.branch.count({ where: { organisationId } }),
  ]);
  return { storage, users, serviceUsers, visits, aiThisMonth, branches };
}

/** Estimated cost in pence from measured tokens, or null when token prices are not set in Platform Settings. */
export async function estimateCostPence(inputTokens: number, outputTokens: number): Promise<number | null> {
  const [inP, outP] = await Promise.all([getSetting("ai.inputPencePerMillionTokens"), getSetting("ai.outputPencePerMillionTokens")]);
  if (inP === null || outP === null) return null;
  return Math.round((inputTokens * inP + outputTokens * outP) / 1_000_000);
}

/** AI usage across the platform (AI Management) or for one client. Metadata only. */
export async function aiUsage(ctx: Ctx, opts: { organisationId?: string; since?: Date } = {}) {
  requirePlatform(ctx, "platform.view");
  if (opts.organisationId) await requireCustomerOrg(opts.organisationId);
  const since = opts.since ?? monthStart();
  const where = { createdAt: { gte: since }, ...(opts.organisationId ? { organisationId: opts.organisationId } : {}) };
  const [totals, failed, byFeature, byOrg, recentFailures, intakes, docs] = await Promise.all([
    db.aiUsageEvent.aggregate({ where, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true }, _avg: { durationMs: true } }),
    db.aiUsageEvent.count({ where: { ...where, success: false } }),
    db.aiUsageEvent.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    opts.organisationId ? Promise.resolve([]) : db.aiUsageEvent.groupBy({ by: ["organisationId"], where, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    db.aiUsageEvent.findMany({ where: { ...where, success: false }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, organisationId: true, feature: true, errorReason: true, createdAt: true, durationMs: true } }),
    db.careIntake.count({ where: { createdAt: { gte: since }, ...(opts.organisationId ? { organisationId: opts.organisationId } : {}) } }),
    db.careIntakeDocument.count({ where: { createdAt: { gte: since }, ...(opts.organisationId ? { organisationId: opts.organisationId } : {}) } }),
  ]);
  const inTok = totals._sum.inputTokens ?? 0;
  const outTok = totals._sum.outputTokens ?? 0;
  const failedJobs = await db.backgroundJob.count({ where: { status: { in: ["FAILED", "DEAD"] }, type: { contains: "intake" }, updatedAt: { gte: since } } });
  const orgNames = byOrg.length ? new Map((await db.organisation.findMany({ where: { id: { in: byOrg.map((o) => o.organisationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name])) : new Map<string, string>();
  return {
    since,
    requests: totals._count._all,
    failed,
    inputTokens: inTok,
    outputTokens: outTok,
    tokensMetered: inTok + outTok > 0,
    avgDurationMs: totals._avg.durationMs === null ? null : Math.round(totals._avg.durationMs),
    estimatedCostPence: await estimateCostPence(inTok, outTok),
    supportPlansProcessed: intakes,
    documentsProcessed: docs,
    failedBackgroundJobs: failedJobs,
    byFeature: await Promise.all(byFeature.map(async (f) => ({ feature: f.feature, requests: f._count._all, tokens: (f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0), costPence: await estimateCostPence(f._sum.inputTokens ?? 0, f._sum.outputTokens ?? 0) }))).then((r) => r.sort((a, b) => b.requests - a.requests)),
    byOrg: await Promise.all(byOrg.map(async (o) => ({ organisationId: o.organisationId, name: o.organisationId ? (orgNames.get(o.organisationId) ?? "Removed organisation") : "Platform (no organisation)", requests: o._count._all, tokens: (o._sum.inputTokens ?? 0) + (o._sum.outputTokens ?? 0), costPence: await estimateCostPence(o._sum.inputTokens ?? 0, o._sum.outputTokens ?? 0) }))).then((r) => r.sort((a, b) => b.requests - a.requests)),
    recentFailures,
  };
}
