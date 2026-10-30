#!/usr/bin/env node
/**
 * Apply Prisma migrations as plain SQL with psql, recording them in `_prisma_migrations` exactly as `prisma migrate
 * deploy` would (same checksum), so the two can be used interchangeably on the same database.
 *
 * Why: in build environments that cannot download Prisma's native engines, `prisma migrate` cannot run. This script
 * needs only psql. On the Windows laptop keep using `npx prisma migrate deploy`.
 *
 *   node scripts/local-migrate.mjs            # apply pending migrations to DATABASE_URL
 *   node scripts/local-migrate.mjs --reset    # drop and recreate schema public first (LOCAL databases only)
 *
 * Refuses to run against anything that is not localhost/127.0.0.1, and refuses --reset unless the database name
 * contains "csb" and the host is local.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const u = new URL(url);
if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error(`Refusing to run against non-local host ${u.hostname}`);
const dbName = u.pathname.replace(/^\//, "");
const reset = process.argv.includes("--reset");
if (reset && !/csb/.test(dbName)) throw new Error(`Refusing to reset database "${dbName}"`);

const psqlUrl = `${u.protocol}//${u.username}:${u.password}@${u.hostname}:${u.port || 5432}/${dbName}`;
const psql = (sql, opts = {}) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t", psqlUrl, "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
const psqlFile = (file) => execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "--single-transaction", psqlUrl, "-f", file], { stdio: ["ignore", "inherit", "inherit"] });

if (reset) {
  console.log(`Resetting schema public on ${dbName}`);
  psql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
}

psql(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL,
  logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);

const applied = new Set(psql(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).split("\n").filter(Boolean));
const dir = join(process.cwd(), "prisma", "migrations");
const names = readdirSync(dir).filter((n) => existsSync(join(dir, n, "migration.sql"))).sort();
let count = 0;
for (const name of names) {
  if (applied.has(name)) continue;
  const file = join(dir, name, "migration.sql");
  const checksum = createHash("sha256").update(readFileSync(file)).digest("hex");
  console.log(`Applying ${name}`);
  psqlFile(file);
  psql(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ('${randomUUID()}', '${checksum}', '${name}', now(), 1)`);
  count++;
}
console.log(count ? `${count} migration(s) applied to ${dbName}` : `${dbName} is up to date`);
