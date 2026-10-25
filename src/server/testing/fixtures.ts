import { HttpClient, type FetchLike } from "../sources/http";

/**
 * Fixture HTTP for simulated sources and tests: serves canned responses by URL
 * so monitoring can be exercised without live websites.
 */
export function fixtureFetch(routes: Record<string, { status?: number; body: string | object; headers?: Record<string, string> } | (() => { status?: number; body: string | object; headers?: Record<string, string> })>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const route = routes[url] ?? routes[new URL(url).pathname];
    if (!route) return new Response("Not found", { status: 404 });
    const r = typeof route === "function" ? route() : route;
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: { "content-type": typeof r.body === "string" ? "text/html" : "application/json", ...(r.headers ?? {}) } });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function fixtureHttp(fetchImpl: FetchLike) {
  return new HttpClient({ fetchImpl, minIntervalMs: 0, baseBackoffMs: 1, retries: 2, sleep: async () => {} });
}

export const SIMULATED_PATH = "/guidance/simulated-reporting-safeguarding-concerns";

/** A clearly simulated GOV.UK-style content item used by the demo and tests. */
export function simulatedGuidance(version: 1 | 2) {
  const hours = version === 1 ? "48 hours" : "24 hours";
  return {
    content_id: "00000000-0000-4000-8000-00000000demo",
    base_path: SIMULATED_PATH,
    title: "SIMULATED: Reporting safeguarding concerns in adult social care",
    description: "SIMULATED demonstration document. Not real guidance.",
    document_type: "detailed_guide",
    schema_name: "detailed_guide",
    first_published_at: "2026-01-15T09:00:00Z",
    public_updated_at: version === 1 ? "2026-01-15T09:00:00Z" : "2026-10-20T09:00:00Z",
    details: {
      body: `<h2>About this simulated guidance</h2><p>This document is a simulation created for the Evantix Care demonstration. It is not issued by any public body.</p>
<h2>Reporting concerns</h2><p>Providers must notify the local authority safeguarding team within ${hours} of becoming aware of a concern.</p><p>Where a person is in immediate danger, providers must contact the emergency services straight away.</p>
<h2>Record keeping</h2><p>Providers should keep a record of each referral, including the reference number given by the local authority.</p>`,
      change_history:
        version === 1
          ? [{ public_timestamp: "2026-01-15T09:00:00Z", note: "First published (simulated)." }]
          : [
              { public_timestamp: "2026-01-15T09:00:00Z", note: "First published (simulated)." },
              { public_timestamp: "2026-10-20T09:00:00Z", note: "Reporting timescale shortened (simulated)." },
            ],
    },
  };
}
