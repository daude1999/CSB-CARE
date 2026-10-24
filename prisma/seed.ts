import { db } from "../src/lib/db";
import { seedBase } from "../src/server/seed/base";
import { DEMO_PASSWORD, seedDemo } from "../src/server/seed/demo";

async function main() {
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
