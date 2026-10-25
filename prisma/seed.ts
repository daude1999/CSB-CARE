import { db } from "../src/lib/db";
import { seedBase } from "../src/server/seed/base";
import { DEMO_PASSWORD, seedDemo } from "../src/server/seed/demo";

async function main() {
  // Hosted builds (see "vercel-build") seed only a brand-new database, so redeploys keep demo changes.
  if (process.argv.includes("--if-empty") && (await db.user.count()) > 0) {
    console.log("Database already has users; skipping seed.");
    return;
  }
  const masters = await seedBase();
  if (process.env.SEED_DEMO !== "false") {
    await seedDemo(masters);
    console.log(`Demo data seeded. Sign in with e.g. manager@brookfield.demo / ${DEMO_PASSWORD}`);
  }
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
