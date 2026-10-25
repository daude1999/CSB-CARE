import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { readEvidence } from "@/server/compliance/evidence";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { doc, bytes } = await readEvidence(ctx, (await params).id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `attachment; filename="${doc.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    // Not found and forbidden look the same so existence is not revealed across tenants.
    const status = e instanceof AppError && e.status === 403 && /malware/.test(e.message) ? 403 : 404;
    return NextResponse.json({ error: status === 403 ? (e as Error).message : "Not found" }, { status });
  }
}
