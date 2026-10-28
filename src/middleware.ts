import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/brand", "/hr/hr-hub.css", "/api/health", "/api/cron", "/_next", "/favicon", "/icon", "/csb-logo.png", "/csb-logo.svg"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("evx_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
