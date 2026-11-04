import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { cqcReportFile } from "@/server/cqc/reports";

export const dynamic = "force-dynamic";

/** CQC Inspection & Evidence reports as PDF or CSV, after the same permission and branch checks as the screens. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const sp = new URL(req.url).searchParams;
    const format = sp.get("format") === "csv" ? "csv" : "pdf";
    const f = await cqcReportFile(ctx, (await params).kind, { id: sp.get("id") ?? undefined, status: sp.get("status") ?? undefined, source: sp.get("source") ?? undefined }, format);
    return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code === "FORBIDDEN" ? "Not allowed" : e.code === "VALIDATION" ? e.message : "Not found" }, { status: e.code === "VALIDATION" ? 400 : e.code === "FORBIDDEN" ? 403 : 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
