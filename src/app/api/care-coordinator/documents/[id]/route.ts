import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { openIntakeDocument } from "@/server/care/coordinator/intake";

export const dynamic = "force-dynamic";

const disposition = (name: string) => `inline; filename="${name.replace(/[^A-Za-z0-9._ ()-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * The original file uploaded to a Care Coordinator intake, unchanged, after the server checks organisation, area scope,
 * the coordinator permissions and (for restricted documents) the sensitive-records permission. Every opening is audited
 * in the intake history. Missing, out-of-scope and restricted files all answer "Not found".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const f = await openIntakeDocument(ctx, (await params).id);
    const pdf = f.contentType === "application/pdf";
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": pdf || f.contentType.startsWith("image/") ? f.contentType : "application/octet-stream",
        "Content-Disposition": pdf || f.contentType.startsWith("image/") ? disposition(f.filename) : disposition(f.filename).replace("inline", "attachment"),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
