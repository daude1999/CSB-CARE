import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/request-headers";

const PUBLIC = ["/login", "/account/", "/brand", "/hr/hr-hub.css", "/api/health", "/api/cron", "/_next", "/favicon", "/icon", "/csb-logo.png", "/csb-logo.svg"];

/** Passes the request on with its own path in a header the server can rely on (a client-sent value is replaced). */
function forward(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return forward(req);
  if (!req.cookies.get("evx_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return forward(req);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
