import { hostname } from "node:os";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { drain, enqueue } from "@/server/jobs/queue";
import { handlers } from "./handlers";

/**
 * Background worker: runs independently of the web app. Every TICK_MS it
 * enqueues a maintenance tick (idempotent per time slot) which schedules due
 * source checks, scheduled publications and reminders, then drains the queue.
 */
const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 60_000);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

async function loop() {
  logger.info({ workerId, TICK_MS }, "worker started");
  let lastTick = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastTick >= TICK_MS) {
        const slot = Math.floor(Date.now() / TICK_MS);
        await enqueue("maintenance.tick", {}, { idempotencyKey: `tick:${slot}`, maxAttempts: 1 });
        await enqueue("rota.sweep", {}, { idempotencyKey: `sweep:${slot}`, maxAttempts: 1 });
        lastTick = Date.now();
      }
      const done = await drain(workerId, handlers, { max: 20 });
      if (done.length) logger.info({ count: done.length, outcomes: done }, "jobs processed");
    } catch (e) {
      logger.error({ err: (e as Error).message }, "worker loop error");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info({ sig }, "worker stopping after current job");
    stopping = true;
  });
}

void loop();
