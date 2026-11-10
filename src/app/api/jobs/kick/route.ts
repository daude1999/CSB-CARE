import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { describeDbError, isTransientDbError } from "@/lib/db-retry";
import { assertSameOrigin, getCtx } from "@/server/auth/current";
import { inlineJobsEnabled, runJobsNow } from "@/server/jobs/inline";
import { withRequestLog } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by signed-in pages after they load when no worker runs. Kept out of
 * page renders and server actions so slow jobs never hold up navigation.
 *
 * Failures are answered and logged here rather than left to the framework, which turned every one into a bare 500
 * with nothing in the logs to say why: a refused origin is 403, a database that cannot be reached for the moment
 * (for example just after a deployment) is 503 with Retry-After, and anything else is logged with its class and code.
 * The next page load tries again, and jobs that were claimed but not finished are picked up after their lock expires.
 */
export const POST = withRequestLog(async function POST() {
  if (!inlineJobsEnabled()) return new NextResponse(null, { status: 204 });
  try {
    await assertSameOrigin();
    if (!(await getCtx())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    const outcomes = await runJobsNow(`inline:${process.pid}`, 5);
    if (outcomes.length) logger.info({ count: outcomes.length, outcomes }, "inline jobs processed");
    return NextResponse.json({ processed: outcomes.length });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    const detail = describeDbError(error);
    if (isTransientDbError(error)) {
      logger.warn({ err: detail }, "inline jobs skipped: database connection unavailable");
      return NextResponse.json({ error: "database busy, will retry on the next page load" }, { status: 503, headers: { "Retry-After": "30" } });
    }
    logger.error({ err: detail }, "inline jobs failed");
    return NextResponse.json({ error: "inline jobs failed" }, { status: 500 });
  }
});
