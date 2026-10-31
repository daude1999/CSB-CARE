import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getCtx } from "@/server/auth/current";
import { exportMissedCalls } from "@/server/rota/missed-calls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Excel or PDF of the Missed Calls register, after the same permission and area checks as the page. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const input: Record<string, string | string[]> = {};
  for (const [k, v] of sp) if (k !== "format") input[k] = k === "ids" ? [...(Array.isArray(input.ids) ? input.ids : []), v] : v;
  try {
    const { body, name, type } = await exportMissedCalls(ctx, input, format);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 400 : e.code === "FORBIDDEN" ? 403 : 404 });
    logger.error({ err: (e as Error).message }, "missed-call export failed");
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
