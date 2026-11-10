/**
 * The Node.js half of src/instrumentation.ts. Kept in its own file so that the middleware (edge) bundle, which also
 * loads the instrumentation file, does not carry the logger or the error-tracking SDK.
 */
let tracking = false;

export async function register() {
  const { trackingDsn } = await import("@/lib/error-tracking");
  const { logger } = await import("@/lib/logger");
  const { dsn, reason } = trackingDsn();
  if (!dsn) {
    if (process.env.SENTRY_DSN) logger.error({ reason }, "error tracking is off");
    return;
  }
  const Sentry = await import("@sentry/nextjs");
  const { trackingOptions } = await import("@/lib/error-report");
  Sentry.init(trackingOptions(dsn));
  tracking = true;
  logger.info("error tracking is on (EU region)");
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { logger } = await import("@/lib/logger");
  const header = request.headers["x-request-id"];
  const requestId = typeof header === "string" ? header : undefined;
  const e = err as { name?: string; message?: string; digest?: string };
  // One log line with the request id, so the error can be matched to the `x-request-id` the browser received. Only
  // the error's kind, message and Next's digest: never the request body, cookies or query string.
  logger.error({ requestId, method: request.method, route: context.routePath, routeType: context.routeType, kind: e?.name, digest: e?.digest, err: e?.message }, "request failed");
  if (!tracking) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.withScope((scope) => {
    // The route pattern (for example /rota/service-users/[id]), never the address with its ids.
    scope.setTags({ ...(requestId ? { requestId } : {}), route: context.routePath, routeType: context.routeType, method: request.method });
    scope.setTransactionName(`${request.method} ${context.routePath}`);
    Sentry.captureException(err);
  });
}
