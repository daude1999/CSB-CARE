import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobStats } from "@/server/platform/health";

export const dynamic = "force-dynamic";

/** A queued job that has been due for longer than this means the queue is not being worked. */
const QUEUE_STALE_MINUTES = 30;

/**
 * Liveness and readiness for uptime monitors. Checks the database, reports the worker heartbeat age honestly, and
 * reports the background job backlog: how many jobs wait, how long the oldest due job has waited, and how many have
 * failed or been given up on. Counts only: no job content, organisation or personal data.
 *
 * `status` is "ok" when the database answers. `queueHealthy` turns false when a due job has waited more than
 * 30 minutes or a job has been given up on, so a monitor can alert on it without the site being reported as down.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const [beat, jobs] = await Promise.all([
      db.backgroundJob.findFirst({ where: { type: "maintenance.tick", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
      jobStats(),
    ]);
    const ageSeconds = beat?.finishedAt ? Math.round((Date.now() - beat.finishedAt.getTime()) / 1000) : null;
    const queueHealthy = jobs.dead === 0 && (jobs.oldestQueuedMinutes === null || jobs.oldestQueuedMinutes <= QUEUE_STALE_MINUTES);
    return NextResponse.json({
      status: "ok",
      database: "ok",
      workerHeartbeatAgeSeconds: ageSeconds,
      workerHealthy: ageSeconds !== null && ageSeconds < 1800,
      queue: { waiting: jobs.queued, running: jobs.running, oldestWaitingMinutes: jobs.oldestQueuedMinutes, failedLast24Hours: jobs.failed24h, givenUp: jobs.dead },
      queueHealthy,
    });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
