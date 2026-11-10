import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { visitDrawer } from "@/server/rota/board";

export const dynamic = "force-dynamic";

/**
 * JSON for the Daily Rota Board's visit drawer: the visit's care tasks and "Why this carer". The same scope as the
 * visit page (organisation, branches and areas, rota.view); anything the caller may not see is a plain 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasOrgPermission(ctx, "rota.view")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const data = await visitDrawer(ctx, id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
