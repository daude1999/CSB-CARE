import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { kpiCsv } from "@/server/reports/kpis";
import { toCsv } from "@/server/reports/tables";

export const dynamic = "force-dynamic";

/** The Analytics figures as a CSV, for the same branch and dates as the page. Needs report.export; audited. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { columns, rows } = await kpiCsv(ctx, Object.fromEntries(new URL(req.url).searchParams));
    return new NextResponse(toCsv(columns, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analytics-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
