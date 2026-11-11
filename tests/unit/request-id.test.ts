import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, newRequestId, requestIdFrom } from "@/lib/request-context";
import { middleware } from "@/middleware";

const request = (path: string, init: { cookie?: string; requestId?: string } = {}) => {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.requestId) headers.set(REQUEST_ID_HEADER, init.requestId);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
};
/** Next.js passes request headers set by middleware to the server in `x-middleware-request-<name>` response headers. */
const forwarded = (res: Response) => res.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`);

describe("request id", () => {
  it("is a fresh, well-formed id each time", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newRequestId()).not.toBe(a);
    expect(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: a }))).toBe(a);
  });

  it("refuses ids that are missing or could inject text into a log line", () => {
    expect(requestIdFrom(new Headers())).toBeUndefined();
    for (const bad of ["short", "has spaces in it", 'quote"injection-attempt', "x".repeat(65), "new\\nline-attempt"]) expect(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: bad }))).toBeUndefined();
  });

  it("is on the response header and forwarded to the server for a signed-in request", () => {
    const res = middleware(request("/rota", { cookie: "evx_session=abc" }));
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(forwarded(res)).toBe(id);
  });

  it("is on public routes and on the redirect to sign-in", () => {
    const health = middleware(request("/api/health"));
    expect(health.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(forwarded(health)).toBe(health.headers.get(REQUEST_ID_HEADER));
    const redirect = middleware(request("/rota/service-users"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("http://localhost:3000/login");
    expect(redirect.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never trusts an id sent by the browser", () => {
    const res = middleware(request("/rota", { cookie: "evx_session=abc", requestId: "attacker-chosen-0001" }));
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBe("attacker-chosen-0001");
    expect(forwarded(res)).toBe(res.headers.get(REQUEST_ID_HEADER));
  });
});
