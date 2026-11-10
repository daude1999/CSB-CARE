import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ctxFromToken, SESSION_COOKIE } from "./session";
import { hasPlatformPermission, type Ctx } from "./rbac";
import { setRequestScopeResolver, type DbScope } from "@/server/tenancy/scope";
import { withSystemScope } from "@/server/tenancy/system";
import { PATH_HEADER } from "@/lib/request-headers";
import { ForbiddenError } from "@/lib/errors";

/**
 * One session lookup per request. React's `cache` covers a page render; the WeakMap (keyed by the request's cookie
 * store, which Next.js creates once per request) also covers server actions and route handlers, where the database
 * layer asks for the request's scope before every query.
 */
const perRequest = new WeakMap<object, Promise<Ctx | null>>();

async function ctxOfRequest(): Promise<Ctx | null> {
  const store = await cookies();
  let found = perRequest.get(store);
  if (!found) {
    found = ctxFromToken(store.get(SESSION_COOKIE)?.value);
    perRequest.set(store, found);
  }
  return found;
}

export const getCtx = cache(ctxOfRequest);

/**
 * Row-level security: the database scope of a signed-in request (see src/server/tenancy/scope.ts).
 *
 *  - Everyone works within their session's active organisation.
 *  - The Evantix Platform Admin Centre (/platform-admin and /api/platform) looks across organisations by design. A
 *    platform administrator's requests to those addresses, and only those, run in the audited system scope: one
 *    `rls.bypass` audit entry per request, naming the person and the address.
 *  - Outside a request (`cookies()` throws there) there is no request scope.
 */
const PLATFORM_PATHS = ["/platform-admin", "/api/platform"];
const scopeOfRequest = new WeakMap<object, Promise<DbScope | undefined>>();

async function resolveRequestScope(): Promise<DbScope | undefined> {
  const ctx = await ctxOfRequest();
  if (!ctx) return undefined;
  const path = (await headers()).get(PATH_HEADER) ?? "";
  if (PLATFORM_PATHS.some((p) => path === p || path.startsWith(`${p}/`)) && hasPlatformPermission(ctx, "platform.view")) {
    const reason = `platform admin: ${path}`;
    await withSystemScope(reason, () => undefined, { actorId: ctx.userId });
    return { kind: "SYSTEM", reason };
  }
  return ctx.organisationId ? { kind: "TENANT", organisationId: ctx.organisationId } : undefined;
}

setRequestScopeResolver(async () => {
  let store: object;
  try {
    store = await cookies();
  } catch {
    return undefined;
  }
  let scope = scopeOfRequest.get(store);
  if (!scope) {
    scope = resolveRequestScope();
    scopeOfRequest.set(store, scope);
  }
  return scope;
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** CSRF defence in depth for route handlers: require same-origin requests for state changes. */
export async function assertSameOrigin() {
  const h = await headers();
  if (!isSameOrigin(h.get("origin"), h.get("x-forwarded-host") ?? h.get("host"))) throw new ForbiddenError("Cross-origin request rejected");
}

/** True unless the request names an origin on another host. An unreadable origin (such as "null") counts as foreign. */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
