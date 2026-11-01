import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getCtx } from "@/server/auth/current";
import { exportCoverage } from "@/server/rota/coverage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Excel or PDF of the Coverage History, after the same permission, branch and area checks as the page. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  try {
    const { body, name, type } = await exportCoverage(ctx, Object.fromEntries(sp), format);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 400 : e.code === "FORBIDDEN" ? 403 : 404 });
    logger.error({ err: (e as Error).message }, "coverage export failed");
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
