import { NextResponse } from "next/server";
import { PLATFORM_LINK_COOKIE } from "@/app/platform-link";

export const dynamic = "force-dynamic";

/**
 * Clears the cookie that carried a just-created one-time link, once the link is on screen.
 *
 * This is a Route Handler, not a Server Action, on purpose: a Server Action that changes a cookie makes Next.js
 * render the current page again, and the second render (cookie gone) could replace the link before the person had
 * read it. It only ever removes this one cookie, so it needs no input and no permission beyond the browser's own.
 */
export async function DELETE() {
  const res = new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  res.cookies.set(PLATFORM_LINK_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/platform-admin", maxAge: 0 });
  return res;
}
