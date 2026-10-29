import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { reportRows, toCsv } from "@/server/reports/tables";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { kind } = await params;
  // Exporting is a separate permission from viewing, as it is for rota reports.
  if (!hasOrgPermission(ctx, "report.export") && !hasPlatformPermission(ctx, "sources.manage")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  try {
    const { columns, rows } = await reportRows(ctx, kind);
    await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "report.exported", entityType: "Report", entityId: kind });
    return new NextResponse(toCsv(columns, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="csb-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
