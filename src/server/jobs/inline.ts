import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { logger } from "@/lib/logger";
import { drain, enqueue } from "./queue";

/**
 * Hosts without a long-running worker (the Vercel demo) process the queue in
 * small batches after responses instead. On by default on Vercel;
 * INLINE_JOBS=true|false overrides.
 */
export function inlineJobsEnabled() {
  return process.env.INLINE_JOBS ? process.env.INLINE_JOBS === "true" : Boolean(process.env.VERCEL);
}

const TICK_MS = 60 * 60 * 1000;

export async function runJobsNow(workerId: string, max: number) {
  // Imported lazily: the handlers pull in most of the server code, which itself uses auth.
  const { handlers } = await import("@/worker/handlers");
  const slot = Math.floor(Date.now() / TICK_MS);
  await enqueue("maintenance.tick", {}, { idempotencyKey: `tick:${slot}`, maxAttempts: 1 });
  return drain(workerId, handlers, { max });
}

/** Schedules a short queue drain after the current response (once per render). */
export const runJobsAfterResponse = cache(() => {
  if (!inlineJobsEnabled()) return;
  after(async () => {
    try {
      const done = await runJobsNow(`inline:${process.pid}`, 5);
      if (done.length) logger.info({ count: done.length, outcomes: done }, "inline jobs processed");
    } catch (e) {
      logger.error({ err: (e as Error).message }, "inline job run failed");
    }
  });
});
