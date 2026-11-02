import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { readObservationPhoto } from "@/server/care/body-map";

export const dynamic = "force-dynamic";

/** A body map photograph, only for people allowed to see them, inside their own organisation and scope. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const p = await readObservationPhoto(ctx, (await params).id);
    const inline = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(p.contentType);
    return new NextResponse(new Uint8Array(p.bytes), {
      headers: {
        "Content-Type": p.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${p.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
