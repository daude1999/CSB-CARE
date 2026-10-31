import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { readCaseEvidence } from "@/server/rota/missed-calls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** An evidence file on a missed call, only for people who may see that case. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { doc, bytes } = await readCaseEvidence(ctx, (await params).id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": doc.contentType, "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
