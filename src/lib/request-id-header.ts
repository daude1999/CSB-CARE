/**
 * The request id header and how an id is made and checked. No Node.js imports, so the middleware can use it.
 * See src/lib/request-context.ts for what the id is for.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const VALID = /^[A-Za-z0-9-]{8,64}$/;

/** A fresh id. Uses the Web Crypto API so it also works in the middleware runtime. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** The id from request headers, if it has the expected shape. */
export function requestIdFrom(headers: { get(name: string): string | null }): string | undefined {
  const id = headers.get(REQUEST_ID_HEADER);
  return id && VALID.test(id) ? id : undefined;
}
