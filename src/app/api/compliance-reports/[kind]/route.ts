import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { complianceReportFile, parseReportFilters } from "@/server/compliance/reports";

export const dynamic = "force-dynamic";

/** A Policy & Compliance report as CSV, Excel or PDF, after the same permission and branch checks as the page. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const format = sp.format === "xlsx" || sp.format === "pdf" ? sp.format : "csv";
    const f = await complianceReportFile(ctx, (await params).kind, parseReportFilters(sp), format);
    return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 400 : e.code === "FORBIDDEN" ? 403 : 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
