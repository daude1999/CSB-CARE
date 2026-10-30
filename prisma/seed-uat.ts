import { db } from "../src/lib/db";
import { seedBase } from "../src/server/seed/base";
import { DEMO_ORG_SLUG, seedDemo } from "../src/server/seed/demo";
import { seedUatBranchCoordinators, seedUatOperations } from "../src/server/seed/uat";

/**
 * Loads the full-scale synthetic test data. Run it through `npm run uat:data -- load`, which checks that the target is
 * a disposable local database first; it refuses to run on its own against anything that is not empty.
 */
async function main() {
  if ((await db.user.count()) > 0) throw new Error("The database is not empty. Use `npm run uat:data -- load`, which empties a local UAT database first.");
  const started = Date.now();
  const log = (s: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${s}`);
  const masters = await seedBase();
  log("master library");
  await seedDemo(masters, { care: false });
  log("demo organisation, people, policies and HR");
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
  const id = async (email: string) => (await db.user.findUniqueOrThrow({ where: { email } })).id;
  await seedUatOperations(org.id, { manager: await id("manager@care-solution.demo"), coordinator: await id("coordinator@care-solution.demo"), finance: await id("finance@care-solution.demo"), hrDecider: await id("jordan.ellis@care-solution.demo") }, log);
  const coordinators = await seedUatBranchCoordinators(org.id);
  log(`branch coordinators: ${coordinators.join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
