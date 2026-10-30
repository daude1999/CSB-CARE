import "server-only";
import { drain, enqueue } from "./queue";

/**
 * Hosts without a long-running worker (the Vercel demo) process the queue in
 * small batches when signed-in pages ping /api/jobs/kick after loading.
 * On by default on Vercel; INLINE_JOBS=true|false overrides.
 */
export function inlineJobsEnabled() {
  return process.env.INLINE_JOBS ? process.env.INLINE_JOBS === "true" : Boolean(process.env.VERCEL);
}

const TICK_MS = 60 * 60 * 1000;
/**
 * The call sweep marks missed and not-clocked-out visits, so the Monitor and the dashboards depend on it. It ran once
 * an hour here, which left a missed call unmarked for up to an hour on hosts without a worker; it now runs at most
 * every five minutes while someone is signed in (the worker runs it every minute).
 */
const SWEEP_MS = 5 * 60 * 1000;

export async function runJobsNow(workerId: string, max: number) {
  // Imported lazily: the handlers pull in most of the server code.
  const { handlers } = await import("@/worker/handlers");
  const now = Date.now();
  await enqueue("maintenance.tick", {}, { idempotencyKey: `tick:${Math.floor(now / TICK_MS)}`, maxAttempts: 1 });
  await enqueue("rota.sweep", {}, { idempotencyKey: `sweep:${Math.floor(now / SWEEP_MS)}`, maxAttempts: 1 });
  return drain(workerId, handlers, { max });
}
