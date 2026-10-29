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
  const [path, query = ""] = url.split("?");
  const q = new URLSearchParams(query);
  q.delete("ok");
  q.delete("error");
  q.set(key, value);
  return `${path}?${q}`;
}

export async function handle(fd: FormData, fn: (ctx: Ctx) => Promise<string | void>, ok: string) {
  const back = safeBack(fd.get("back"));
  let target: string;
  try {
    const ctx = await requireCtx();
    const next = await fn(ctx);
    target = withParam(next ?? back, "ok", ok);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = e instanceof AppError || e instanceof AiUnavailableError ? e.message : "Something went wrong. The error has been logged.";
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message, stack: (e as Error).stack }, "action failed");
    target = withParam(back, "error", msg);
  }
  revalidatePath("/", "layout");
  redirect(target);
}

