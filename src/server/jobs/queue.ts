import type { BackgroundJob, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * A small PostgreSQL-backed job queue (SELECT … FOR UPDATE SKIP LOCKED).
 * - Idempotent enqueue via a unique idempotency key.
 * - Exponential backoff with jitter between attempts.
 * - Jobs whose worker died (lock expired) are recovered automatically.
 * - Jobs that exhaust their attempts move to DEAD (the dead-letter state) and can be retried manually.
 */

export type JobHandler = (payload: Record<string, unknown>, job: BackgroundJob) => Promise<Prisma.InputJsonValue | void>;

const LOCK_MS = 10 * 60 * 1000;

export function backoffMs(attempt: number, baseMs = 30_000, maxMs = 6 * 60 * 60 * 1000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.8 + random() * 0.4));
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { idempotencyKey: string; runAfter?: Date; maxAttempts?: number },
): Promise<{ job: BackgroundJob; created: boolean }> {
  const existing = await db.backgroundJob.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
  if (existing) return { job: existing, created: false };
  try {
    const job = await db.backgroundJob.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        idempotencyKey: opts.idempotencyKey,
        runAfter: opts.runAfter ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 4,
      },
    });
    return { job, created: true };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const job = await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: opts.idempotencyKey } });
      return { job, created: false };
    }
    throw e;
  }
}

export async function claimNext(workerId: string, types?: string[]): Promise<BackgroundJob | null> {
  const typeFilter = types?.length ? types : null;
  const rows = await db.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob" SET
      status = 'RUNNING', "lockedBy" = ${workerId},
      "lockedUntil" = now() + (${LOCK_MS}::int * interval '1 millisecond'),
      attempts = attempts + 1, "startedAt" = now(), "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "BackgroundJob"
      WHERE ((status IN ('QUEUED', 'FAILED') AND "runAfter" <= now())
          OR (status = 'RUNNING' AND "lockedUntil" < now()))
        AND (${typeFilter}::text[] IS NULL OR type = ANY(${typeFilter}::text[]))
      ORDER BY "runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function completeJob(id: string, result?: Prisma.InputJsonValue | void) {
  await db.backgroundJob.update({
    where: { id },
    data: { status: "SUCCEEDED", result: result ?? undefined, finishedAt: new Date(), lockedBy: null, lockedUntil: null, lastError: null },
  });
}

export async function failJob(job: BackgroundJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.maxAttempts || (error as { permanent?: boolean })?.permanent === true;
  await db.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: dead ? "DEAD" : "FAILED",
      lastError: message.slice(0, 2000),
      runAfter: dead ? job.runAfter : new Date(Date.now() + backoffMs(job.attempts)),
      finishedAt: dead ? new Date() : null,
      lockedBy: null,
      lockedUntil: null,
    },
  });
  logger.warn({ jobId: job.id, type: job.type, attempts: job.attempts, dead, err: message }, "job failed");
  return dead;
}

/** Manual retry of a failed or dead job (administrator action). */
export async function retryJob(id: string) {
  const job = await db.backgroundJob.findUniqueOrThrow({ where: { id } });
  if (!["FAILED", "DEAD", "CANCELLED"].includes(job.status)) throw new Error(`Job is ${job.status}; only failed or dead jobs can be retried`);
  return db.backgroundJob.update({
    where: { id },
    data: { status: "QUEUED", runAfter: new Date(), maxAttempts: Math.max(job.maxAttempts, job.attempts + 1), finishedAt: null },
  });
}

export async function cancelJob(id: string) {
  return db.backgroundJob.updateMany({ where: { id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
}

/** Runs one claimed job through its handler, recording success or failure. */
export async function runClaimed(job: BackgroundJob, handlers: Record<string, JobHandler>): Promise<"succeeded" | "failed" | "dead"> {
  const handler = handlers[job.type];
  if (!handler) {
    await failJob({ ...job, attempts: job.maxAttempts }, new Error(`No handler for job type ${job.type}`));
    return "dead";
  }
  try {
    const result = await handler(job.payload as Record<string, unknown>, job);
    await completeJob(job.id, result);
    return "succeeded";
  } catch (e) {
    const dead = await failJob(job, e);
    return dead ? "dead" : "failed";
  }
}

/** Drains currently runnable jobs (used by the worker loop, CLI and tests). */
export async function drain(workerId: string, handlers: Record<string, JobHandler>, opts: { max?: number; types?: string[] } = {}) {
  const outcomes: { id: string; type: string; outcome: string }[] = [];
  for (let i = 0; i < (opts.max ?? 100); i++) {
    const job = await claimNext(workerId, opts.types);
    if (!job) break;
    const outcome = await runClaimed(job, handlers);
    outcomes.push({ id: job.id, type: job.type, outcome });
  }
  return outcomes;
}

export class PermanentJobError extends Error {
  permanent = true;
}
