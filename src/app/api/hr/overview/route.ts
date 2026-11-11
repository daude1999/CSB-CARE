import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getCtx } from "@/server/auth/current";
import { canUsePortal } from "@/server/auth/portals";
import { hrOverview } from "@/server/workforce/hr-overview";
import { withRequestLog } from "@/lib/request-id";

export const dynamic = "force-dynamic";

const query = z.object({ branch: z.string().trim().min(1).max(60).regex(/^[\w-]+$/).catch("all") });

/**
 * JSON for the HR overview (a client screen): today's interviews, upcoming interviews and leave requests waiting for
 * a decision, for the HR Hub branch scope in `?branch=`. Everything is scoped and permission-checked on the server.
 */
export const GET = withRequestLog(async function GET(request: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (!canUsePortal(ctx, "hr")) return NextResponse.json({ error: "You don't have access to HR & Workforce" }, { status: 403 });
  const { branch } = query.parse({ branch: new URL(request.url).searchParams.get("branch") ?? undefined });
  try {
    return NextResponse.json(await hrOverview(ctx, branch), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error({ err: e }, "hr overview failed");
    return NextResponse.json({ error: "Could not load interviews and leave requests" }, { status: 500 });
  }
});
