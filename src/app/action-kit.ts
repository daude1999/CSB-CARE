import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { randomBytes } from "node:crypto";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/error-report";
import { currentRequestId, withRequestId } from "@/lib/request-context";
import { requestIdOfRequest } from "@/lib/request-id";
import { requireCtx } from "@/server/auth/current";
import type { Ctx } from "@/server/auth/rbac";
import { AiUnavailableError } from "@/server/ai/provider";
import { runForTenant } from "@/server/ai/metering";

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

/** A short reference shown to the user and written to the server log with the error, so the two can be matched. */
export function errorReference() {
  return `ERR-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Logs an unexpected error with its reference: the error's kind, message and database code only, never form data. */
function logUnexpected(e: unknown, ref: string, step?: string, requestId?: string) {
  const err = e as { message?: string; stack?: string; code?: unknown; name?: string };
  const id = requestId ?? currentRequestId();
  logger.error({ ref, requestId: id, step, kind: err?.name, code: typeof err?.code === "string" ? err.code : undefined, err: err?.message, stack: err?.stack }, "action failed");
  // Server actions catch their own errors to show a friendly message, so Next's error hook never sees them.
  void reportError(e, { errorRef: ref, ...(id ? { requestId: id } : {}) });
}

/**
 * Runs one step of an action. Our own errors pass through as they are; anything unexpected is logged with a reference
 * and replaced by `failure` (what did and did not happen, in plain words) plus that reference.
 */
export async function step<T>(name: string, failure: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isRedirectError(e) || e instanceof AppError || e instanceof AiUnavailableError) throw e;
    const ref = errorReference();
    logUnexpected(e, ref, name);
    throw new ValidationError(`${failure} Error reference: ${ref}.`);
  }
}

/** `fn` may return where to go next, or `{ to, ok }` when the confirmation depends on what happened (e.g. bulk results). */
export async function handle(fd: FormData, fn: (ctx: Ctx) => Promise<string | void | { to?: string; ok: string }>, ok: string) {
  const back = safeBack(fd.get("back"));
  let target: string;
  const requestId = await requestIdOfRequest();
  try {
    const ctx = await requireCtx();
    const next = await withRequestId(requestId, () => runForTenant(ctx.organisationId, () => fn(ctx)));
    target = typeof next === "object" ? withParam(next.to ?? back, "ok", next.ok) : withParam(next ?? back, "ok", ok);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    let msg: string;
    if (e instanceof AppError || e instanceof AiUnavailableError) msg = e.message;
    else {
      const ref = errorReference();
      logUnexpected(e, ref, undefined, requestId);
      msg = `Something went wrong. The error has been logged. Error reference: ${ref}.`;
    }
    if (e instanceof AiUnavailableError) logger.error({ err: e.message }, "action failed");
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
  const requestId = await requestIdOfRequest();
  try {
    const ctx = await requireCtx();
    const data = await withRequestId(requestId, () => runForTenant(ctx.organisationId, () => fn(ctx)));
    if (opts.revalidate) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof AppError || e instanceof AiUnavailableError) return { ok: false, error: e.message };
    const ref = errorReference();
    logUnexpected(e, ref, undefined, requestId);
    return { ok: false, error: `Something went wrong. The error has been logged. Error reference: ${ref}.` };
  }
}
