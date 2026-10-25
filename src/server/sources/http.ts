/**
 * Polite HTTP retrieval for regulatory sources: timeouts, per-host rate limiting,
 * exponential backoff on transient failures, response size limits and an
 * identifying User-Agent. The fetch implementation is injectable for tests.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  text(): string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly transient: boolean,
  ) {
    super(message);
  }
}

export interface HttpClientOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  minIntervalMs?: number; // per host
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

const lastRequestAt = new Map<string, number>();

export class HttpClient {
  private readonly o: Required<HttpClientOptions>;
  requests = 0;

  constructor(opts: HttpClientOptions = {}) {
    this.o = {
      fetchImpl: opts.fetchImpl ?? ((u, i) => fetch(u, i)),
      timeoutMs: opts.timeoutMs ?? 20_000,
      maxBytes: opts.maxBytes ?? 15 * 1024 * 1024,
      retries: opts.retries ?? 3,
      minIntervalMs: opts.minIntervalMs ?? Number(process.env.SOURCE_MIN_INTERVAL_MS ?? 1000),
      baseBackoffMs: opts.baseBackoffMs ?? 1000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      userAgent:
        opts.userAgent ??
        process.env.SOURCE_USER_AGENT ??
        "EvantixCareMonitor/0.1 (+regulatory change monitoring; contact: compliance@evantix.example)",
    };
  }

  private async throttle(host: string) {
    const last = lastRequestAt.get(host) ?? 0;
    const wait = last + this.o.minIntervalMs - Date.now();
    if (wait > 0) await this.o.sleep(wait);
    lastRequestAt.set(host, Date.now());
  }

  async get(url: string, headers: Record<string, string> = {}): Promise<HttpResult> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new HttpError(`Unsupported protocol ${parsed.protocol}`, null, false);
    let lastErr: HttpError | null = null;
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      if (attempt > 0) {
        const retryAfter = lastErr && "retryAfterMs" in lastErr ? (lastErr as HttpError & { retryAfterMs?: number }).retryAfterMs : undefined;
        await this.o.sleep(retryAfter ?? this.o.baseBackoffMs * 2 ** (attempt - 1));
      }
      await this.throttle(parsed.host);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        this.requests++;
        const res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": this.o.userAgent, Accept: "*/*", ...headers },
          signal: ctrl.signal,
          redirect: "follow",
        });
        const hdrs: Record<string, string> = {};
        res.headers.forEach((v, k) => (hdrs[k] = v));
        if (res.status === 429 || res.status >= 500) {
          const err = new HttpError(`HTTP ${res.status} from ${parsed.host}`, res.status, true) as HttpError & { retryAfterMs?: number };
          const ra = Number(hdrs["retry-after"]);
          if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(ra * 1000, 120_000);
          lastErr = err;
          continue;
        }
        if (res.status === 304) {
          return { url: res.url || url, status: 304, headers: hdrs, body: Buffer.alloc(0), text: () => "" };
        }
        if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${url}`, res.status, false);
        const declared = Number(hdrs["content-length"]);
        if (Number.isFinite(declared) && declared > this.o.maxBytes) throw new HttpError(`Response too large (${declared} bytes)`, res.status, false);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > this.o.maxBytes) throw new HttpError(`Response too large (${buf.length} bytes)`, res.status, false);
        return { url: res.url || url, status: res.status, headers: hdrs, body: buf, text: () => buf.toString("utf8") };
      } catch (e) {
        if (e instanceof HttpError && !e.transient) throw e;
        if (e instanceof HttpError) {
          lastErr = e;
        } else {
          const aborted = (e as Error).name === "AbortError";
          lastErr = new HttpError(aborted ? `Timed out after ${this.o.timeoutMs}ms: ${url}` : `Network error: ${(e as Error).message}`, null, true);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new HttpError("Request failed", null, true);
  }

  async getJson<T = unknown>(url: string): Promise<T> {
    const res = await this.get(url, { Accept: "application/json" });
    try {
      return JSON.parse(res.text()) as T;
    } catch {
      throw new HttpError(`Invalid JSON from ${url}`, res.status, false);
    }
  }
}

/** Minimal robots.txt evaluation for the "*" user agent (Disallow prefixes only). */
export async function isAllowedByRobots(http: HttpClient, url: string): Promise<boolean> {
  const u = new URL(url);
  let txt = "";
  try {
    txt = (await http.get(`${u.origin}/robots.txt`)).text();
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return true;
    throw e;
  }
  let applies = false;
  const disallow: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k ?? "")) applies = v === "*" || /evantix/i.test(v);
    else if (applies && /^disallow$/i.test(k ?? "") && v) disallow.push(v);
  }
  return !disallow.some((p) => u.pathname.startsWith(p));
}
