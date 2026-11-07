import { Client } from "pg";

/**
 * One-off removal of the fictional test person made on the hosted site on 7 Nov 2026. A live check of the AI CSB
 * Coordinator uploaded an invented support plan ("Ada Fictional"), intake "TEST ONLY - fictional scanned plan (Claude
 * check, delete)". Preparing its records created the person (CSB-000001) with draft records and unpublished proposed
 * visits. The owner chose "Delete it completely" in the project thread on 7 Nov 2026.
 *
 * Runs from `vercel-build` after migrations. It does nothing unless all of these hold:
 *   - this is the production build on Vercel (or CSB_TEST_CLEANUP_LOCAL=true for a local test database);
 *   - Care Solution Bureau (slug csb-demo) has an intake with exactly TEST_INTAKE_TITLE;
 *   - this CLEANUP_ID has not been applied before (recorded in the audit log).
 *
 * Only that intake, and the person it created if that person is "Ada Fictional" and no other intake points at them,
 * are removed, together with every row that refers to them (found through the database's own foreign keys). Nothing
 * else is touched. The rows are copied into BACKUP_SCHEMA first, and everything runs in one transaction. The audit log
 * is immutable and keeps its entries.
 */
export const CLEANUP_ID = "2026-11-07-remove-test-person";
export const BACKUP_SCHEMA = "backup_20261107_test_person";
export const TEST_INTAKE_TITLE = "TEST ONLY - fictional scanned plan (Claude check, delete)";
const ORG_SLUG = "csb-demo";

type Q = Client;
const ident = (t: string) => `"${t.replace(/"/g, '""')}"`;

/** Foreign keys (single column) between public tables: child table and column, parent table and column. */
async function foreignKeys(c: Q) {
  return (
    await c.query<{ child: string; col: string; parent: string; pcol: string }>(`
      SELECT cc.relname AS child, ca.attname AS col, pc.relname AS parent, pa.attname AS pcol
      FROM pg_constraint k
      JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_class pc ON pc.oid = k.confrelid
      JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = k.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
      WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND cc.relnamespace = 'public'::regnamespace AND pc.relnamespace = 'public'::regnamespace`)
  ).rows;
}

/** Every row that refers, directly or through other rows, to the starting rows. Keyed by table, values are ids. */
async function collect(c: Q, start: Record<string, string[]>) {
  const withId = new Set((await c.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id'`)).rows.map((r) => r.t));
  const fks = (await foreignKeys(c)).filter((f) => f.pcol === "id" && f.child !== "AuditLog");
  // A referring table without an id column cannot be listed row by row: its rows must go by cascade, otherwise the
  // delete fails and the whole clean-up rolls back.
  const missing = fks.filter((f) => !withId.has(f.child) && Object.keys(start).includes(f.parent));
  if (missing.length) console.log("test person clean-up: left to cascades:", missing.map((f) => f.child).join(", "));
  const found = new Map<string, Set<string>>(Object.entries(start).map(([t, ids]) => [t, new Set(ids)]));
  let queue = Object.entries(start).map(([t, ids]) => [t, ids] as const);
  while (queue.length) {
    const next: (readonly [string, string[]])[] = [];
    for (const [table, ids] of queue) {
      for (const f of fks.filter((x) => x.parent === table && withId.has(x.child))) {
        const rows = (await c.query<{ id: string }>(`SELECT id::text AS id FROM public.${ident(f.child)} WHERE ${ident(f.col)}::text = ANY($1)`, [ids])).rows;
        const have = found.get(f.child) ?? new Set<string>();
        const fresh = rows.map((r) => r.id).filter((id) => !have.has(id));
        if (!fresh.length) continue;
        fresh.forEach((id) => have.add(id));
        found.set(f.child, have);
        next.push([f.child, fresh]);
      }
    }
    queue = next;
  }
  return found;
}

/** Deletes the rows; foreign keys decide the order, so each pass retries what failed until all are gone. */
async function deleteAll(c: Q, rows: Map<string, Set<string>>) {
  const counts: Record<string, number> = {};
  let left = [...rows.entries()].map(([t, ids]) => [t, [...ids]] as const);
  while (left.length) {
    const failed: typeof left = [];
    let lastError: unknown;
    for (const [t, ids] of left) {
      await c.query("SAVEPOINT step");
      try {
        const r = await c.query(`DELETE FROM public.${ident(t)} WHERE id::text = ANY($1)`, [ids]);
        counts[t] = (counts[t] ?? 0) + (r.rowCount ?? 0);
        await c.query("RELEASE SAVEPOINT step");
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT step");
        failed.push([t, ids]);
        lastError = e;
      }
    }
    if (failed.length === left.length) throw new Error(`test person clean-up: cannot delete ${failed.map((f) => f[0]).join(", ")}: ${String(lastError)}`);
    left = failed;
  }
  return counts;
}

export async function cleanUpTestPerson(c: Q) {
  const org = (await c.query<{ id: string }>(`SELECT id FROM "Organisation" WHERE slug = $1`, [ORG_SLUG])).rows[0];
  if (!org) return { skipped: "no Care Solution Bureau organisation" };
  const done = (await c.query(`SELECT 1 FROM "AuditLog" WHERE action = 'test-person.cleanup' AND "entityId" = $1`, [CLEANUP_ID])).rowCount;
  if (done) return { skipped: `${CLEANUP_ID} already applied` };
  const intakes = (await c.query<{ id: string; serviceUserId: string | null }>(`SELECT id, "serviceUserId" FROM "CareIntake" WHERE "organisationId" = $1 AND title = $2`, [org.id, TEST_INTAKE_TITLE])).rows;
  if (!intakes.length) return { skipped: "no test intake" };

  const start: Record<string, string[]> = { CareIntake: intakes.map((i) => i.id) };
  const people: string[] = [];
  for (const suId of new Set(intakes.map((i) => i.serviceUserId).filter((x): x is string => !!x))) {
    const su = (await c.query<{ firstName: string; lastName: string }>(`SELECT "firstName", "lastName" FROM "ServiceUser" WHERE id = $1 AND "organisationId" = $2`, [suId, org.id])).rows[0];
    const others = (await c.query(`SELECT 1 FROM "CareIntake" WHERE "serviceUserId" = $1 AND title <> $2`, [suId, TEST_INTAKE_TITLE])).rowCount;
    if (su && su.firstName === "Ada" && su.lastName === "Fictional" && !others) people.push(suId);
  }
  if (people.length) start.ServiceUser = people;
  const rows = await collect(c, start);

  // The restore copy of exactly these rows, readable only by the database owner.
  await c.query(`CREATE SCHEMA ${ident(BACKUP_SCHEMA)}`);
  await c.query(`REVOKE ALL ON SCHEMA ${ident(BACKUP_SCHEMA)} FROM PUBLIC`);
  // CREATE TABLE AS takes no parameters, so the ids (read from the database above) are written in as quoted literals.
  const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;
  for (const [t, ids] of rows) await c.query(`CREATE TABLE ${ident(BACKUP_SCHEMA)}.${ident(t)} AS SELECT * FROM public.${ident(t)} WHERE id::text IN (${[...ids].map(literal).join(",")})`);

  // Immutability triggers (decisions, frozen versions) would refuse these deletes; foreign keys stay on.
  const tables = [...rows.keys()];
  await c.query(tables.map((t) => `ALTER TABLE public.${ident(t)} DISABLE TRIGGER USER`).join(";\n"));
  const counts = await deleteAll(c, rows);
  await c.query(tables.map((t) => `ALTER TABLE public.${ident(t)} ENABLE TRIGGER USER`).join(";\n"));

  // If the test person was the only one, the next real person gets the first reference again.
  const left = (await c.query(`SELECT 1 FROM "ServiceUser" WHERE "organisationId" = $1 LIMIT 1`, [org.id])).rowCount;
  if (people.length && !left) await c.query(`UPDATE "ServiceUserReferenceCounter" SET "nextNumber" = 1 WHERE "organisationId" = $1`, [org.id]);

  const deleted = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  await c.query(`INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "organisationId", data, "createdAt") VALUES (gen_random_uuid()::text, 'test-person.cleanup', 'Database', $1, $2, $3, now())`, [CLEANUP_ID, org.id, JSON.stringify({ note: "Fictional test person and test intake removed, as chosen by the owner on 7 Nov 2026", backupSchema: BACKUP_SCHEMA, deleted })]);
  return { deleted };
}

async function main() {
  const local = process.env.CSB_TEST_CLEANUP_LOCAL === "true";
  if (process.env.VERCEL_ENV !== "production" && !local) return console.log("test person clean-up: not a production build, skipped");
  const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await cleanUpTestPerson(client);
    await client.query("COMMIT");
    console.log("test person clean-up:", JSON.stringify(result));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // Never fail the deployment over this: nothing was changed, and the next build tries again.
    console.error("test person clean-up: failed, nothing was changed", e);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("test-record-cleanup.ts")) void main();
