import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertSameOrigin, getCtx } from "@/server/auth/current";
import { coordinatorAccess } from "@/server/care/coordinator/intake";
import { runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { withRequestLog } from "@/lib/request-id";

export const dynamic = "force-dynamic";
/** Reading a long scanned plan with the AI can take a few minutes. */
export const maxDuration = 300;

/**
 * Runs one waiting document-reading job, for hosts without a worker (Vercel). The intake page calls it while one of its
 * documents waits; the job itself is saved in the queue, so a run that is cut off is carried on by the next call once
 * its lock lapses. Each job runs with the permissions of the person who asked for the reading, never the caller's.
 */
export const POST = withRequestLog(async function POST() {
  try {
    await assertSameOrigin();
    const ctx = await getCtx();
    if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    coordinatorAccess(ctx);
    const outcomes = await runQueuedReads(`page:${process.pid}`, 1);
    return NextResponse.json({ processed: outcomes.length, outcomes: outcomes.map((o) => o.outcome) });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error({ err: e instanceof Error ? e.name : "unknown" }, "coordinator reading run failed");
    return NextResponse.json({ error: "The reading could not be run just now; it will be tried again." }, { status: 500 });
  }
});
