/**
 * Short retries for database connections that could not be opened.
 *
 * The hosted demo runs on Vercel with Supabase's session pooler, which allows a fixed number of client connections
 * (15 on the free plan) and gives each warm function instance one of them (connection_limit=1). Right after a
 * deployment the old and new instances, plus the build's own migration and seed scripts, can hold every slot for a
 * moment, so a cold instance's first query fails to connect. Without a retry that failure became a 500 from
 * /api/jobs/kick and, once, "Application error" on the Overview straight after sign-in.
 *
 * Only failures to obtain a connection are retried: the query never reached the database, so repeating it cannot
 * apply a write twice. Anything else is thrown at once.
 */

/** Prisma error codes for "could not get a connection" (the query was never sent). */
const CONNECT_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server was reached but timed out
  "P2024", // Timed out fetching a new connection from the pool
]);

/** Postgres and pooler messages for "no connection slot free" (the pooler names vary by host and version). */
const NO_SLOT = /max client connections|max clients reached|too many (clients|connections)|remaining connection slots|connection slots are reserved|can't reach database server|timed out fetching a new connection/i;

export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, errorCode, name, message } = error as { code?: unknown; errorCode?: unknown; name?: unknown; message?: unknown };
  if (typeof code === "string" && CONNECT_CODES.has(code)) return true;
  if (typeof errorCode === "string" && CONNECT_CODES.has(errorCode)) return true;
  const text = typeof message === "string" ? message : "";
  // A client that could not start at all fails every query with this error class.
  if (name === "PrismaClientInitializationError") return true;
  return NO_SLOT.test(text);
}

const DEFAULT_DELAYS_MS = [300, 900];

/**
 * Runs `fn`, and runs it again after a short pause if it failed only because no database connection could be opened.
 * Use it for reads, or for the first query of a request (which also warms the instance's connection).
 */
export async function withDbRetry<T>(fn: () => Promise<T>, delaysMs: readonly number[] = DEFAULT_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delaysMs.length || !isTransientDbError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/** A log-safe description of a database error: its class and code, and the start of its message. */
export function describeDbError(error: unknown): { name: string; code: string | null; message: string } {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; errorCode?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : typeof e.errorCode === "string" ? e.errorCode : null;
  // Connection strings never appear in Prisma's messages, but credentials in a URL are masked in case one does.
  const message = (typeof e.message === "string" ? e.message : String(error)).replace(/\/\/[^@\s/]+@/g, "//***@").slice(0, 300);
  return { name: typeof e.name === "string" ? e.name : "Error", code, message };
}
