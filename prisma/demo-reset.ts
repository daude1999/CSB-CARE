import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Client } from "pg";
import { db } from "../src/lib/db";
import { seedAttendanceHistory } from "../src/server/seed/care";
import { DEMO_ORG_SLUG } from "../src/server/seed/demo";

/**
 * One-off replacement of the hosted demo's data with the full-scale three-branch test data (the owner's "yes, reset the
 * live demo", 30 Oct 2026). Runs from `vercel-build` before the normal seed, and does nothing unless all of these hold:
 *   - this is the production build on Vercel;
 *   - every organisation in the database is a demo organisation (no customer's records can be touched);
 *   - this RESET_ID has not been applied before (recorded in the audit log, which is kept immutable).
 *
 * Vercel builds run far from the London database (about 80 ms a round trip), so running the seed there (tens of thousands
 * of small queries) took too long: the first attempt failed the deployment. Instead the data is generated locally by
 * `prisma/seed-uat.ts` through the real services, dumped with pg_dump (`prisma/demo-data/three-branch.sql.gz`) and
 * loaded here in a handful of large statements inside one transaction. Calls that ended between the dump and the load
 * are then given their attendance, so the rota does not show them as missed.
 * If the load fails, the database is emptied again and the normal seed fills it with the standard demo, so the site
 * always deploys; the next build tries the reset again.
 */
const RESET_ID = "2026-10-31-three-branch-rota";
const DATA = path.join(process.cwd(), "prisma", "demo-data");
const CHUNK = 4_000_000;

function run(command: string) {
  execSync(command, { stdio: "inherit", env: { ...process.env, SEED_DEMO: "true" } });
}

/** Statement batches of about CHUNK characters, split only where an INSERT starts. */
function batches(sql: string) {
  const out: string[] = [];
  let at = 0;
  while (at < sql.length) {
    let end = Math.min(at + CHUNK, sql.length);
    if (end < sql.length) {
      const next = sql.indexOf("\nINSERT INTO ", end);
      end = next < 0 ? sql.length : next + 1;
    }
    out.push(sql.slice(at, end));
    at = end;
  }
  return out;
}

/** Loads the dump into the freshly migrated, empty database in one transaction. */
async function load() {
  // pg_dump's psql-only lines (\restrict and \unrestrict) are not SQL, so they are dropped.
  const sql = gunzipSync(readFileSync(path.join(DATA, "three-branch.sql.gz"))).toString("utf8").replace(/^\\.*$/gm, "");
  const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const tables = (await client.query<{ t: string }>(`SELECT format('%I.%I', n.nspname, c.relname) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`)).rows.map((r) => r.t);
    const fks = (await client.query<{ t: string; name: string; def: string }>(`SELECT format('%I.%I', n.nspname, c.relname) AS t, quote_ident(k.conname) AS name, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE k.contype = 'f' AND n.nspname = 'public'`)).rows;
    // The dump holds finished records (published versions, completed visits, immutable logs), and some foreign keys
    // are circular, so checks and triggers are paused for the load and the foreign keys are re-validated afterwards.
    await client.query([...fks.map((f) => `ALTER TABLE ${f.t} DROP CONSTRAINT ${f.name}`), ...tables.map((t) => `ALTER TABLE ${t} DISABLE TRIGGER USER`)].join(";\n"));
    const parts = batches(sql);
    for (const [i, part] of parts.entries()) {
      await client.query(part);
      console.log(`demo reset: loaded part ${i + 1} of ${parts.length}`);
    }
    // The dump empties search_path; the saved foreign key definitions name tables as seen from public.
    await client.query("SELECT pg_catalog.set_config('search_path', 'public', false)");
    await client.query([...tables.map((t) => `ALTER TABLE ${t} ENABLE TRIGGER USER`), ...fks.map((f) => `ALTER TABLE ${f.t} ADD CONSTRAINT ${f.name} ${f.def}`)].join(";\n"));
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  // CSB_DEMO_RESET_LOCAL=true is for testing on a local database the caller has already emptied and migrated.
  const local = process.env.CSB_DEMO_RESET_LOCAL === "true";
  if (process.env.VERCEL_ENV !== "production" && !local) return console.log("demo reset: not a production build, skipped");
  const done = await db.auditLog.findFirst({ where: { action: "demo.reset", entityId: RESET_ID } });
  if (done) return console.log(`demo reset: ${RESET_ID} already applied`);
  const customers = await db.organisation.count({ where: { isDemo: false } });
  if (customers > 0) return console.log(`demo reset: refused, ${customers} non-demo organisation(s) present`);
  await db.$disconnect();

  console.log(`demo reset: replacing demo data (${RESET_ID})`);
  if (!local) run("npx prisma migrate reset --force --skip-seed --skip-generate");
  try {
    await load();
  } catch (e) {
    console.error("demo reset: the load failed; emptying the database so the standard demo is seeded", e);
    if (!local) run("npx prisma migrate reset --force --skip-seed --skip-generate");
    return;
  }
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
  const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
  const { generatedAt } = JSON.parse(readFileSync(path.join(DATA, "three-branch.json"), "utf8")) as { generatedAt: string };
  await seedAttendanceHistory(org.id, manager.id, new Date(generatedAt));
  await db.auditLog.create({ data: { action: "demo.reset", entityType: "Database", entityId: RESET_ID, data: { note: "Hosted demo replaced with the full-scale three-branch test data, as approved by the owner" } } });
  console.log("demo reset: done");
}

main()
  .catch((e) => {
    // Never fail the deployment over the demo data: the site still builds with whatever data is there.
    console.error("demo reset: error", e);
  })
  .finally(() => db.$disconnect());
