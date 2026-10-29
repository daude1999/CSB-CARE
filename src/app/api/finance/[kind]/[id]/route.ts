import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { runCsv } from "@/server/finance/runs";

export const dynamic = "force-dynamic";

/** CSV export of an approved pay or invoice run, after a server-side permission check. Nothing is sent anywhere. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { kind, id } = await params;
  if (kind !== "pay" && kind !== "invoice") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { name, body } = await runCsv(ctx, kind, id);
    return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "VALIDATION" ? 400 : 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
