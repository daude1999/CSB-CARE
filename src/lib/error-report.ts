import type { NodeOptions } from "@sentry/nextjs";
import { scrubEvent, trackingDsn, type TrackedEvent } from "@/lib/error-tracking";

/**
 * The one set of options error tracking starts with (src/instrumentation.ts), kept here so the test starts the real
 * SDK with exactly these and reads what it would send.
 */
export function trackingOptions(dsn: string, env: Record<string, string | undefined> = process.env): NodeOptions {
  return {
    dsn,
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    release: env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT,
    // Errors only: no performance traces, no logs, no session data, nothing personal by default.
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    includeLocalVariables: false,
    includeServerName: false,
    // Every category of collected data is switched off at the source; the scrubber below is the second guard.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false },
    // The scrubber's event type is structural, so it accepts Sentry's event and returns the same object.
    beforeSend: (event) => scrubEvent(event as typeof event & TrackedEvent),
    beforeSendTransaction: () => null,
  };
}

/**
 * Sends an error the application caught itself (and showed a friendly message for) to error tracking, with safe tags
 * only. Does nothing unless error tracking is on. Never throws: reporting an error must not cause another.
 */
export async function reportError(err: unknown, tags: { errorRef?: string; requestId?: string } = {}): Promise<void> {
  if (!trackingDsn().dsn) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      Sentry.captureException(err);
    });
  } catch {
    // Error tracking is unavailable; the error is already in the log with its reference.
  }
}
