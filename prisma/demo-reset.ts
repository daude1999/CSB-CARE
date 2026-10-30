import { execSync } from "node:child_process";
import { db } from "../src/lib/db";

/**
 * One-off replacement of the hosted demo's data with the full-scale three-branch test data (the owner's "yes, reset the
 * live demo", 30 Oct 2026). Runs from `vercel-build` before the normal seed, and does nothing unless all of these hold:
 *   - this is the production build on Vercel;
 *   - every organisation in the database is a demo organisation (no customer's records can be touched);
 *   - this RESET_ID has not been applied before (recorded in the audit log, which is kept immutable).
 * If the load fails twice, the build carries on: the normal seed then fills the empty database with the standard
 * demo, and the next build tries the reset again.
 */
const RESET_ID = "2026-10-30-three-branch-rota";

function run(command: string) {
  execSync(command, { stdio: "inherit", env: { ...process.env, SEED_DEMO: "true" } });
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") return console.log("demo reset: not a production build, skipped");
  const done = await db.auditLog.findFirst({ where: { action: "demo.reset", entityId: RESET_ID } });
  if (done) return console.log(`demo reset: ${RESET_ID} already applied`);
  const customers = await db.organisation.count({ where: { isDemo: false } });
  if (customers > 0) return console.log(`demo reset: refused, ${customers} non-demo organisation(s) present`);
  await db.$disconnect();

  console.log(`demo reset: replacing demo data (${RESET_ID})`);
  // Two attempts, each from an empty database; if both fail, leave it empty so the standard demo seed fills it.
  for (let attempt = 1; ; attempt++) {
    run("npx prisma migrate reset --force --skip-seed --skip-generate");
    try {
      run("npx tsx prisma/seed-uat.ts");
      break;
    } catch (e) {
      console.error(`demo reset: the full-scale load failed (attempt ${attempt})`, e);
      if (attempt === 2) {
        run("npx prisma migrate reset --force --skip-seed --skip-generate");
        return;
      }
    }
  }
  await db.auditLog.create({ data: { action: "demo.reset", entityType: "Database", entityId: RESET_ID, data: { note: "Hosted demo replaced with the full-scale three-branch test data, as approved by the owner" } } });
  console.log("demo reset: done");
}

main()
  .catch((e) => {
    // Never fail the deployment over the demo data: the site still builds with whatever data is there.
    console.error("demo reset: error", e);
  })
  .finally(() => db.$disconnect());
