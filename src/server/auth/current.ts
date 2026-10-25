import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ctxFromToken, SESSION_COOKIE } from "./session";
import type { Ctx } from "./rbac";
import { runJobsAfterResponse } from "@/server/jobs/inline";

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return ctxFromToken(token);
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  runJobsAfterResponse();
  return ctx;
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** CSRF defence in depth for route handlers: require same-origin requests for state changes. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (origin && host && new URL(origin).host !== host) throw new Error("Cross-origin request rejected");
}
