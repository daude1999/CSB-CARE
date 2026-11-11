/**
 * Error tracking (Sentry, EU region). Approved by the owner on 10 Nov 2026 as a new supplier and dependency.
 *
 * What leaves the platform is deliberately small, because errors happen while care records are being handled:
 *
 *  - Only server-side errors are sent. The browser sends nothing to Sentry, so the Content Security Policy is unchanged.
 *  - It is off unless SENTRY_DSN is set, and it refuses to start unless that address is in Sentry's EU region
 *    (`*.de.sentry.io`, Frankfurt), so a mistyped US address cannot send data out of the EU.
 *  - `scrubEvent` runs on every event before it is sent. It removes the request body, cookies, headers, query string,
 *    user, breadcrumbs, local variables and extra data, and reduces each error message to its first line with emails,
 *    phone numbers, postcodes, NHS numbers, any number of four or more digits and quoted values masked. Database errors, whose messages can
 *    quote the record being written, are reduced to their kind and code.
 *  - What remains: the error's kind, the cleaned first line, the stack trace (file names and line numbers of our own
 *    code), the route pattern (never the address with its ids), the request id and the release.
 *
 * Nothing here is a reason to put personal data in an error message. This is the safety net.
 */

/** The parts of a Sentry event this module reads or clears. Kept structural so the scrubber can be tested alone. */
export interface TrackedEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown };
  exception?: { values?: { type?: string; value?: string; stacktrace?: { frames?: { vars?: unknown; [k: string]: unknown }[] }; [k: string]: unknown }[] };
  request?: Record<string, unknown>;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  server_name?: string;
  [k: string]: unknown;
}

const EU_HOST = /\.de\.sentry\.io$/i;

/** The DSN to use, or null with the reason error tracking stays off. */
export function trackingDsn(env: Record<string, string | undefined> = process.env): { dsn: string | null; reason?: string } {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return { dsn: null, reason: "SENTRY_DSN is not set" };
  let host: string;
  try {
    host = new URL(dsn).hostname;
  } catch {
    return { dsn: null, reason: "SENTRY_DSN is not a valid address" };
  }
  if (!EU_HOST.test(host)) return { dsn: null, reason: "SENTRY_DSN is not in Sentry's EU region (the address must end in .de.sentry.io)" };
  return { dsn };
}

const MASKS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/https?:\/\/\S+/gi, "[link]"],
  [/"[^"]*"|'[^']*'|`[^`]*`/g, "[value]"],
  [/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "[postcode]"],
  [/\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g, "[number]"],
  [/(?:\+44\s?|\b0)\d[\d ]{8,12}\d\b/g, "[phone]"],
  // Four digits or more: key-safe codes and door codes are short.
  [/\d{4,}/g, "[number]"],
];

const DATABASE_ERROR = /^Prisma|^PrismaClient|^DatabaseError$|^PostgresError$/;

/** One line, masked and short. */
export function scrubMessage(message: string | undefined, kind?: string): string | undefined {
  if (message === undefined) return undefined;
  if (kind && DATABASE_ERROR.test(kind)) {
    // Prisma messages can quote the query and its data. Keep only the code, when there is one.
    const code = /\bP\d{4}\b/.exec(message)?.[0];
    return code ? `Database error ${code}` : "Database error";
  }
  let line = message.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  for (const [pattern, mask] of MASKS) line = line.replace(pattern, mask);
  return line.slice(0, 200);
}

const SAFE_TAGS = new Set(["requestId", "route", "routeType", "method", "runtime", "errorRef"]);

/** Runs on every event before it is sent. Returns the event with everything personal removed. */
export function scrubEvent<E extends TrackedEvent>(event: E): E {
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.server_name;
  if (event.request) {
    const method = typeof event.request.method === "string" ? event.request.method : undefined;
    event.request = method ? { method } : {};
  }
  if (event.contexts) {
    const { runtime, os } = event.contexts;
    event.contexts = { ...(runtime ? { runtime } : {}), ...(os ? { os } : {}) };
  }
  if (event.tags) event.tags = Object.fromEntries(Object.entries(event.tags).filter(([k]) => SAFE_TAGS.has(k)));
  // The transaction is a route pattern such as "GET /rota/service-users/[id]" when Next supplies it. Anything that
  // looks like a real address (a query string, or a long id segment) is dropped rather than guessed at.
  if (typeof event.transaction === "string" && (event.transaction.includes("?") || /\/[A-Za-z0-9_-]{16,}(\/|$)/.test(event.transaction))) delete event.transaction;
  if (event.message !== undefined) event.message = scrubMessage(event.message);
  if (event.logentry) event.logentry = { message: scrubMessage(event.logentry.message) };
  for (const ex of event.exception?.values ?? []) {
    ex.value = scrubMessage(ex.value, ex.type);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}
