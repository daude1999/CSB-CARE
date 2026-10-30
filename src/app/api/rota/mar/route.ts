import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { marChartPdf } from "@/server/care/mar-pdf";

export const dynamic = "force-dynamic";

/** A month's MAR chart for one person as a PDF, after the same permission and scope checks as the page. Audited. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const { pdf, filename } = await marChartPdf(ctx, q.get("su") ?? "", q.get("month") ?? "");
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
