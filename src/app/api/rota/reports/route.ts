import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { parseFilters, rotaReportCsv } from "@/server/rota/reports";

export const dynamic = "force-dynamic";

/** CSV of a rota report, after the same permission and area checks as the page. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { name, body } = await rotaReportCsv(ctx, parseFilters(Object.fromEntries(new URL(req.url).searchParams)));
    return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 400 : 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
