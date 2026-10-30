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

export async function runJobsNow(workerId: string, max: number) {
  // Imported lazily: the handlers pull in most of the server code.
  const { handlers } = await import("@/worker/handlers");
  const slot = Math.floor(Date.now() / TICK_MS);
  await enqueue("maintenance.tick", {}, { idempotencyKey: `tick:${slot}`, maxAttempts: 1 });
  await enqueue("rota.sweep", {}, { idempotencyKey: `sweep:${slot}`, maxAttempts: 1 });
  return drain(workerId, handlers, { max });
}
