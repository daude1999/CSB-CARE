import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness and readiness: checks the database and reports worker heartbeat age honestly. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const beat = await db.backgroundJob.findFirst({ where: { type: "maintenance.tick", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
    const ageSeconds = beat?.finishedAt ? Math.round((Date.now() - beat.finishedAt.getTime()) / 1000) : null;
    return NextResponse.json({ status: "ok", database: "ok", workerHeartbeatAgeSeconds: ageSeconds, workerHealthy: ageSeconds !== null && ageSeconds < 1800 });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
