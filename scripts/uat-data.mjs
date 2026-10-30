#!/usr/bin/env node
/**
 * Full-scale synthetic test data in a DISPOSABLE LOCAL database (V1 operational readiness, phase 7).
 *
 *   npm run uat:data -- load       # empty the UAT database, apply migrations, load the test data, save a baseline copy
 *   npm run uat:data -- restore    # put the UAT database back exactly as the baseline copy (seconds)
 *   npm run uat:data -- snapshot   # replace the baseline copy with the database as it is now
 *
 * The address comes from UAT_DATABASE_URL (default postgresql://postgres:postgres@localhost:5432/csb_uat). It refuses
 * to run unless the host is this computer and the database name contains "uat", so it can never touch the live demo,
 * a hosted database, or a local database holding records anyone wants to keep. The baseline copy is a second local
 * database named <name>_baseline.
 */
import { execSync } from "node:child_process";
import "dotenv/config";

const fail = (m) => {
  console.error(`\n${m}\n`);
  process.exit(1);
};
const cmd = process.argv[2];
if (!["load", "restore", "snapshot"].includes(cmd ?? "")) fail("Usage: npm run uat:data -- load | restore | snapshot");

const url = process.env.UAT_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_uat";
let u;
try {
  u = new URL(url);
} catch {
  fail("UAT_DATABASE_URL is not a valid address.");
}
const host = u.hostname.replace(/^\[|\]$/g, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host)) fail(`Refusing: the UAT database must be on this computer, not "${host}".`);
const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
if (!/^[a-z0-9_]+$/.test(name) || !/uat/.test(name)) fail(`Refusing: "${name}" is not a UAT database (its name must contain "uat" and use only a-z, 0-9 and _).`);
const baseline = `${name}_baseline`;
const admin = new URL(url);
admin.pathname = "/postgres";

// One statement per call: DROP and CREATE DATABASE cannot run inside the transaction a multi-statement script gets.
const sql = (target, ...statements) => {
  for (const statement of statements) execSync(`npx prisma db execute --stdin --url "${target}"`, { input: statement, stdio: ["pipe", "ignore", "inherit"] });
};
const run = (c, env = {}) => {
  console.log(`\n> ${c}`);
  execSync(c, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, ...env } });
};
const copy = (from, to) => sql(admin.href, `DROP DATABASE IF EXISTS "${to}" WITH (FORCE)`, `CREATE DATABASE "${to}" TEMPLATE "${from}"`);

if (cmd === "load") {
  console.log(`\nLoading synthetic UAT data into "${name}" on ${host} (everything already in it is deleted).`);
  sql(admin.href, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`, `CREATE DATABASE "${name}"`);
  run("npx prisma migrate deploy");
  run("npx tsx prisma/seed-uat.ts", { SEED_DEMO: "true" });
  copy(name, baseline);
  console.log(`\nDone. Baseline saved as "${baseline}". Restore it at any time with: npm run uat:data -- restore`);
} else if (cmd === "restore") {
  copy(baseline, name);
  console.log(`\n"${name}" is back to the baseline.`);
} else {
  copy(name, baseline);
  console.log(`\nBaseline "${baseline}" replaced with the current "${name}".`);
}
