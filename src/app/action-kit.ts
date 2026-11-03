import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireCtx } from "@/server/auth/current";
import type { Ctx } from "@/server/auth/rbac";
import { AiUnavailableError } from "@/server/ai/provider";

/** Shared plumbing for Server Action files: read FormData, run one domain call with the session's ctx, redirect with ?ok= or ?error=. */
export function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

export function safeBack(v: FormDataEntryValue | null, fallback = "/") {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

export function withParam(url: string, key: string, value: string) {
  // Keep a #fragment after the query, or the message would land inside it and never reach the page.
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const [path, query = ""] = (hashAt >= 0 ? url.slice(0, hashAt) : url).split("?");
  const q = new URLSearchParams(query);
  q.delete("ok");
  q.delete("error");
  q.set(key, value);
  return `${path}?${q}${hash}`;
}

/** `fn` may return where to go next, or `{ to, ok }` when the confirmation depends on what happened (e.g. bulk results). */
export async function handle(fd: FormData, fn: (ctx: Ctx) => Promise<string | void | { to?: string; ok: string }>, ok: string) {
  const back = safeBack(fd.get("back"));
  let target: string;
  try {
    const ctx = await requireCtx();
    const next = await fn(ctx);
    target = typeof next === "object" ? withParam(next.to ?? back, "ok", next.ok) : withParam(next ?? back, "ok", ok);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = e instanceof AppError || e instanceof AiUnavailableError ? e.message : "Something went wrong. The error has been logged.";
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message, stack: (e as Error).stack }, "action failed");
    target = withParam(back, "error", msg);
  }
  revalidatePath("/", "layout");
  redirect(target);
}


/**
 * For server actions a client component calls and reads the answer of (no redirect): runs `fn` with the session's ctx
 * and returns `{ ok: true, data }`, or `{ ok: false, error }` with a message safe to show. Refreshes server-rendered pages.
 */
export async function handleData<T>(fn: (ctx: Ctx) => Promise<T>, opts: { revalidate?: boolean } = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const ctx = await requireCtx();
    const data = await fn(ctx);
    if (opts.revalidate) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message, stack: (e as Error).stack }, "action failed");
    return { ok: false, error: e instanceof AppError ? e.message : "Something went wrong. The error has been logged." };
  }
}
