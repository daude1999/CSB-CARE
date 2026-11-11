import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/request-id-header";

const PUBLIC = ["/login", "/account/", "/brand", "/hr/hr-hub.css", "/api/health", "/api/cron", "/_next", "/favicon", "/icon", "/csb-logo.png", "/csb-logo.svg"];

/**
 * Lets the request through with a fresh request id: the server code reads it from the request headers (for its log
 * lines) and the browser gets it back in the `x-request-id` response header. Anything the browser sent is replaced.
 */
function forward(req: NextRequest, requestId: string) {
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = newRequestId();
  if (PUBLIC.some((p) => pathname.startsWith(p))) return forward(req, requestId);
  if (!req.cookies.get("evx_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }
  return forward(req, requestId);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
