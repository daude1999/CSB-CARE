import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { staffEvidenceRows } from "@/server/readiness";
import { toCsv } from "@/server/reports/tables";

export const dynamic = "force-dynamic";

/** One person's readiness evidence pack as CSV, after the same permission and branch checks as their page. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { staffId } = await params;
  try {
    const { columns, rows } = await staffEvidenceRows(ctx, staffId);
    return new NextResponse(toCsv(columns, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="readiness-evidence-${staffId}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
