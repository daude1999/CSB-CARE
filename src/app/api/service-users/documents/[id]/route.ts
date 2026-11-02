import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { readDocumentFile } from "@/server/care/su-documents";

export const dynamic = "force-dynamic";

const disposition = (kind: "inline" | "attachment", name: string) => `${kind}; filename="${name.replace(/[^A-Za-z0-9._ ()-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * A service user document's file, streamed only after the server checks the caller's organisation, scope and (for
 * sensitive documents) permission. ?mode=preview shows PDFs and images in the browser; anything else downloads.
 * ?v=N picks an earlier version. Every preview and download is audited. There is never a public link.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(req.url);
  const v = url.searchParams.get("v");
  const version = v && /^\d{1,4}$/.test(v) ? Number(v) : undefined;
  try {
    const f = await readDocumentFile(ctx, (await params).id, { version, mode: url.searchParams.get("mode") === "preview" ? "preview" : "download" });
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": disposition(f.inline ? "inline" : "attachment", f.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    // A restricted document says so; anything missing or outside the caller's organisation is simply not found.
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
