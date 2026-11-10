import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The request ID: one random id per web request, set by src/middleware.ts. It is sent back to the browser in the
 * `x-request-id` response header and added to every log line written while the request is handled, so a person
 * reporting a problem (or an uptime alert) can be matched to the exact log lines.
 *
 * It is an opaque random value. It never contains or derives from personal data, and a value sent by the browser is
 * never trusted: the middleware always makes its own.
 */
export { REQUEST_ID_HEADER, newRequestId, requestIdFrom } from "@/lib/request-id-header";

/** Kept on globalThis because Next.js can load a module once per server bundle (same reason as the tenancy scope). */
const globalForRequest = globalThis as typeof globalThis & { csbRequestContext?: AsyncLocalStorage<{ requestId: string }> };
const storage = (globalForRequest.csbRequestContext ??= new AsyncLocalStorage<{ requestId: string }>());

/** The id of the request being handled, when the caller ran inside `withRequestId`. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Runs `fn` so that every log line it writes carries the request id. Awaited inside, so lazy promises are covered. */
export function withRequestId<T>(requestId: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  if (!requestId) return Promise.resolve().then(fn);
  return storage.run({ requestId }, async () => await fn());
}
