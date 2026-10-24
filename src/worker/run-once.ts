/**
 * Runs monitoring once from the command line, without the web app:
 *   npm run monitor:once -- <source-key>     check one source now
 *   npm run monitor:once                     schedule all due sources and drain the queue
 */
import { db } from "@/lib/db";
import { drain } from "@/server/jobs/queue";
import { checkSource, scheduleDueSources } from "@/server/sources/engine";
import { handlers } from "./handlers";

async function main() {
  const key = process.argv[2];
  if (key) {
    const source = await db.regulatorySource.findUniqueOrThrow({ where: { key } });
    const summary = await checkSource(source.id, { trigger: "MANUAL" });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const jobs = await scheduleDueSources();
    console.log(`Enqueued ${jobs.length} source check(s)`);
  }
  const out = await drain("cli", handlers, { max: 200 });
  console.log(JSON.stringify(out, null, 2));
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await db.$disconnect();
  process.exit(1);
});
