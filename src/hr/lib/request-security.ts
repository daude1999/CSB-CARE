import { HttpError } from "./auth";
const windows = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, limit = 120) {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.until < now) {
    windows.set(key, { count: 1, until: now + 60000 });
    if (windows.size > 10000)
      for (const [k, v] of windows) if (v.until < now) windows.delete(k);
    return;
  }
  if (++current.count > limit)
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
