import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { assertSameOrigin, getCtx } from "@/server/auth/current";
import { inlineJobsEnabled, runJobsNow } from "@/server/jobs/inline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by signed-in pages after they load when no worker runs. Kept out of
 * page renders and server actions so slow jobs never hold up navigation.
 */
export async function POST() {
  if (!inlineJobsEnabled()) return new NextResponse(null, { status: 204 });
  await assertSameOrigin();
  if (!(await getCtx())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const outcomes = await runJobsNow(`inline:${process.pid}`, 5);
  if (outcomes.length) logger.info({ count: outcomes.length, outcomes }, "inline jobs processed");
  return NextResponse.json({ processed: outcomes.length });
}
