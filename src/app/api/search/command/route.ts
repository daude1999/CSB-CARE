import { NextResponse } from "next/server";
import { z } from "zod";
import { getCtx } from "@/server/auth/current";
import { commandSearch } from "@/server/search/command";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().max(100) });

/**
 * JSON for the Ctrl+K command bar: service users, staff and today's visits matching `q`. The organisation, branches,
 * areas and permissions all come from the session inside `commandSearch`; nothing but the search text is read from
 * the request.
 */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Query.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Search text is too long" }, { status: 400 });
  return NextResponse.json(await commandSearch(ctx, parsed.data.q), { headers: { "Cache-Control": "private, no-store" } });
}
