import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { printableRota } from "@/server/rota/print";

export const dynamic = "force-dynamic";

/** The printable rota PDF. Scope, permissions (key safe codes too) and the audit entry are handled in the service. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const flag = (k: string) => q.get(k) === "1";
  try {
    const { pdf, filename } = await printableRota(ctx, {
      kind: q.get("kind") === "SERVICE_USER" ? "SERVICE_USER" : "CARER",
      ids: q.getAll("ids"),
      from: q.get("from") ?? "",
      to: q.get("to") ?? "",
      fontSize: Number(q.get("fontSize") ?? "10"),
      includeCancelled: flag("includeCancelled"),
      includeShadow: flag("includeShadow"),
      address: flag("address"),
      medication: flag("medication"),
      keySafe: flag("keySafe"),
      excludeSurname: flag("excludeSurname"),
      separatePages: flag("separatePages"),
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError && (e.code === "VALIDATION" || e.code === "FORBIDDEN")) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
