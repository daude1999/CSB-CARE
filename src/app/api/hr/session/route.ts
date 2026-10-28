import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logout, SESSION_COOKIE } from "@/server/auth/session";
import { sameOrigin } from "@/hr/lib/auth";

/** Sign out from inside the HR Hub. There is one platform session, so this signs out of every portal. */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) await logout(token);
    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Request rejected" }, { status: 403 });
  }
}
