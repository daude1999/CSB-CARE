import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { auditCsv } from "@/server/admin/audit-viewer";

export const dynamic = "force-dynamic";

/** CSV of the organisation's audit log, filtered like the page. Admins only; the export is itself audited. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const csv = await auditCsv(ctx, Object.fromEntries(new URL(req.url).searchParams));
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
