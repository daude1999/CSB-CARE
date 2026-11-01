import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * A fixed-window request counter shared by every server instance, kept in Postgres (RateLimitWindow).
 *
 * The HR Hub used to count in process memory, which on Vercel means one counter per function instance: a busy client
 * could spread its requests over several instances and never be limited, and a cold start reset the count. One atomic
 * upsert per request keeps a single count per key and minute instead.
 *
 * If the database cannot be reached the request falls back to a per-instance memory counter, so a brief database
 * problem neither blocks every user nor removes the limit entirely.
 */
const WINDOW_MS = 60_000;
const memory = new Map<string, { count: number; until: number }>();

function memoryHit(key: string, now: number) {
  const current = memory.get(key);
  if (!current || current.until < now) {
    memory.set(key, { count: 1, until: now + WINDOW_MS });
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.until < now) memory.delete(k);
    return 1;
  }
  return ++current.count;
}

/** Counts one request for `key` and returns how many it has made in the current minute. */
export async function countRequest(key: string, now = Date.now()): Promise<number> {
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitWindow" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitWindow"."count" + 1
      RETURNING "count"`;
    // Housekeeping on roughly one request in a hundred: old windows are never read again.
    if (Math.random() < 0.01) await db.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "windowStart" < ${new Date(now - 60 * WINDOW_MS)}`;
    return Number(rows[0]?.count ?? 1);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : "unknown" }, "shared rate limit unavailable; using the in-memory counter");
    return memoryHit(key, now);
  }
}

/** True when `key` has gone over `limit` requests this minute. */
export async function overLimit(key: string, limit: number, now = Date.now()) {
  return (await countRequest(key, now)) > limit;
}
