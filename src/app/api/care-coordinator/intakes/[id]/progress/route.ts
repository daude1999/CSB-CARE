import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getCtx } from "@/server/auth/current";
import { readProgress } from "@/server/care/coordinator/read-jobs";

export const dynamic = "force-dynamic";

/**
 * Where each document of an intake is in its background reading, for the intake page while it waits. Same checks as
 * the page (organisation, area scope, coordinator permissions); a missing or out-of-scope intake is "Not found".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = (await params).id;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await readProgress(ctx, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
