import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ctxFromToken, SESSION_COOKIE } from "./session";
import type { Ctx } from "./rbac";
import { ForbiddenError } from "@/lib/errors";

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return ctxFromToken(token);
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
