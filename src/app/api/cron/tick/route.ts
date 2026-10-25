import { NextResponse, type NextRequest } from "next/server";
import { runJobsNow } from "@/server/jobs/inline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scheduled maintenance for hosts without a worker (Vercel Cron sends the CRON_SECRET bearer token). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const outcomes = await runJobsNow("cron", 50);
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
