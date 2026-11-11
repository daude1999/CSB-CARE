/**
 * Server start-up and the hook Next.js calls for every error that escapes a page, route handler or server action.
 *
 * Error tracking (Sentry, EU region) starts here, on the Node.js server only, and only when SENTRY_DSN is set to an
 * EU-region address. What is sent, and what is stripped first, is in src/lib/error-tracking.ts. The work is in
 * ./instrumentation-node.ts, loaded only on the Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).register();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).onRequestError(err, request, context);
}
