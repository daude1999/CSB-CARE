import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { platformSearch } from "@/server/platform/command-centre";
import { withRequestLog } from "@/lib/request-id";

export const dynamic = "force-dynamic";

/**
 * JSON for the Admin Centre's quick search in the header. platformSearch checks the platform permission itself, so an
 * organisation administrator gets 403. The search text is never logged and nothing is cached.
 */
export const GET = withRequestLog(async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ hits: await platformSearch(ctx, q.slice(0, 100)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Not found" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    logger.error({ event: "platform.search.failed", errorName: e instanceof Error ? e.name : typeof e }, "Admin Centre search failed");
    return NextResponse.json({ error: "The search could not be completed. Try again." }, { status: 500 });
  }
});
