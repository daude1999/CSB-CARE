import { HttpError } from "./auth";
import { overLimit } from "@/server/security/rate-limit";

/**
 * At most `limit` requests a minute per key (the HR user). Counted in the shared database table, so the limit holds
 * across every server instance; see src/server/security/rate-limit.ts.
 */
export async function rateLimit(key: string, limit = 120) {
  if (await overLimit(`hr:${key}`, limit))
    throw new HttpError(429, "Too many requests. Please wait a minute.");
}
/** Enforce actual streamed byte length, even with a missing or forged Content-Length. */
export async function limitedRequest(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) return request;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}
