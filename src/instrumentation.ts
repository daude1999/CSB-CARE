/**
 * Next.js calls `onRequestError` for every error that escapes a page, route handler or server action. One log line is
 * written with the request id, so the error can be matched to the `x-request-id` the browser received. Only the
 * error's kind, message and Next's digest are logged, never the request body, cookies or query string.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/logger");
  const header = request.headers["x-request-id"];
  const e = err as { name?: string; message?: string; digest?: string };
  logger.error(
    { requestId: typeof header === "string" ? header : undefined, method: request.method, route: context.routePath, routeType: context.routeType, kind: e?.name, digest: e?.digest, err: e?.message },
    "request failed",
  );
}
