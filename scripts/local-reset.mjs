#!/usr/bin/env node
/**
 * Start the LOCAL database again from nothing, on Windows, macOS or Linux (needs only Node and npm, not psql).
 *
 *   npm run db:reset:local              # empty it, apply every migration, load the demo data
 *   npm run db:reset:local -- --clean   # empty it and apply migrations only: no demo organisations or people,
 *                                       # ready for `npm run org:create` and real data
 *   add --yes to skip the "type RESET" question (for scripts)
 *
 * It refuses to run unless DATABASE_URL points at this computer (localhost, 127.0.0.1 or ::1) and the database
 * name contains "csb". It never touches a hosted database (Supabase, Neon, Azure, Vercel).
 */
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import "dotenv/config";

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const yes = args.includes("--yes");

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set. Copy .env.example to .env first.");
let u;
try {
  u = new URL(url);
} catch {
  fail("DATABASE_URL is not a valid address.");
}
const host = u.hostname.replace(/^\[|\]$/g, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host)) fail(`Refusing: DATABASE_URL points at "${host}", which is not this computer.`);
const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
if (!/csb/i.test(dbName)) fail(`Refusing: the database "${dbName}" does not look like a CSB database (its name must contain "csb").`);

console.log(`\nThis deletes EVERYTHING in the local database "${dbName}" on ${host} and starts again${clean ? " with no demo data" : " with the demo data"}.`);
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type RESET to continue: ');
  rl.close();
  if (answer.trim() !== "RESET") fail("Nothing was changed.");
}

const run = (cmd, env = {}) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
};

// Emptying the schema (rather than `prisma migrate reset`) works the same on every operating system.
console.log("\n> emptying the database");
execSync("npx prisma db execute --stdin --schema prisma/schema.prisma", { input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", stdio: ["pipe", "inherit", "inherit"], env: process.env });
run("npx prisma migrate deploy");
if (clean) {
  run("npx tsx prisma/seed.ts", { SEED_DEMO: "false" });
  console.log("\nDone. The database is empty apart from the CSB master library.");
  console.log('Next: npm run org:create -- --name "Your organisation" --branches "Branch one,Branch two" --admin-email you@example.com --admin-name "Your Name"');
} else {
  run("npx tsx prisma/seed.ts", { SEED_DEMO: "true" });
  run("npx tsx prisma/seed-hr.ts", { SEED_DEMO: "true" });
  console.log("\nDone. Sign in at http://localhost:3000 with manager@care-solution.demo and the demo password in README.md.");
}

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}
