import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { findServiceUsersToUpdate } from "@/server/care/service-users";

export const dynamic = "force-dynamic";

/**
 * JSON for the "Update Existing Service User" person picker. The search runs on the server with the member's own
 * permissions, branches and areas (findServiceUsersToUpdate); nothing is cached and the search text is never logged.
 */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json(await findServiceUsersToUpdate(ctx, q.slice(0, 120)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    logger.error({ event: "serviceUser.updatePicker.failed", errorName: e instanceof Error ? e.name : typeof e }, "Service user picker search failed");
    return NextResponse.json({ error: "The search could not be completed. Try again." }, { status: 500 });
  }
}
