import { headers } from "next/headers";
import { requestIdFrom, withRequestId } from "@/lib/request-context";

/** The current web request's id (set by the middleware), or undefined outside a request. */
export async function requestIdOfRequest(): Promise<string | undefined> {
  try {
    return requestIdFrom(await headers());
  } catch {
    return undefined; // not in a request (worker, script, test)
  }
}

/** Runs `fn` with the current request's id on every log line. Used by the server-action wrappers and API routes. */
export async function inRequest<T>(fn: () => Promise<T> | T): Promise<T> {
  return withRequestId(await requestIdOfRequest(), fn);
}

/** Wraps an API route handler so its log lines carry the request id. */
export function withRequestLog<A extends unknown[], R>(handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => inRequest(() => handler(...args));
}
