import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { withNoScope, withTenantScope } from "@/server/tenancy/scope";
import { withSystemScope } from "@/server/tenancy/system";
import { describeToken, inviteMemberIn, redeemToken } from "@/server/admin/users";
import { resetDb } from "../helpers";

/**
 * Row-level security, table by table, against the real database.
 *
 * Every table with an organisationId column gets one synthetic row for organisation A and one for organisation B.
 * Then, as the application (the csb_app role with organisation A's scope) and with the application's own
 * organisation filter deliberately left out:
 *   - an unfiltered read returns none of B's rows;
 *   - updates and deletes aimed at B's rows touch nothing;
 *   - inserting a row for B, or moving one of A's rows to B, is refused;
 *   - with no scope at all, nothing is visible and nothing can be written.
 *
 * The rows are generated from the database's own column list (text, numbers, enums and so on get a harmless value),
 * so a table added later is covered without editing this file. If a new table has a rule the generator cannot guess
 * (a CHECK between two columns, say), the "has a row for both organisations" test fails and names it: add the
 * needed values to OVERRIDES below. All data here is synthetic.
 */
const A = "rls-test-org-a";
const B = "rls-test-org-b";

/** The table owner's connection: sets the scene and checks the truth from outside row-level security. */
const owner = new PrismaClient();

interface Column {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_generated: string;
}

/** Column values the generic generator cannot guess, as SQL expressions. `n` is 1 for A and 2 for B. */
const OVERRIDES: Record<string, (n: number) => Record<string, string>> = {
  Policy: () => ({ kind: `'CUSTOMER'` }),
  StaffAbsence: () => ({ startsAt: "now()", endsAt: "now() + interval '1 day'" }),
  StaffAvailability: () => ({ weekday: "1", startMinute: "0", endMinute: "60" }),
  Visit: () => ({ scheduledStart: "now()", scheduledEnd: "now() + interval '1 hour'", carersRequired: "1" }),
  VisitTemplate: () => ({ startMinute: "480", durationMin: "30", carersRequired: "1" }),
  RateBand: () => ({ fromMinute: "0", toMinute: "60", ratePence: "100" }),
  CandidateInterview: () => ({ durationMin: "30" }),
  ComplianceRisk: () => ({ likelihood: "1", impact: "1", residualLikelihood: "1", residualImpact: "1" }),
  Medication: () => ({ asRequired: "true" }),
  CareSummary: () => ({ fromDate: "current_date", toDate: "current_date" }),
  Acknowledgement: (n) => ({ userId: `'rls-user-${n}'` }),
  FormRecordLink: (n) => ({ entityType: `'SERVICE_USER'`, serviceUserId: `'rls-su-${n}'` }),
  PolicyResourceLink: (n) => ({ policyId: `'rls-policy-${n}'`, resourceId: `'rls-resource-${n}'` }),
};

let columns: Column[] = [];
let tenantTables: string[] = [];
const nullable = new Set<string>();
const seeded = new Map<string, { a: boolean; b: boolean; error?: string }>();

const q = (name: string) => `"${name}"`;
const count = async (client: Pick<PrismaClient, "$queryRawUnsafe">, sql: string, ...params: string[]) => Number((await client.$queryRawUnsafe<{ n: bigint }[]>(sql, ...params))[0]?.n ?? 0);
const ownerCount = (table: string, org: string | null) => (org === null ? count(owner, `SELECT count(*) AS n FROM ${q(table)} WHERE "organisationId" IS NULL`) : count(owner, `SELECT count(*) AS n FROM ${q(table)} WHERE "organisationId" = $1`, org));

async function loadCatalogue() {
  columns = await owner.$queryRaw<Column[]>`
    SELECT table_name::text, column_name::text, data_type::text, udt_name::text, is_nullable::text, column_default::text, is_generated::text
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
  const orgColumns = columns.filter((c) => c.column_name === "organisationId");
  tenantTables = orgColumns.map((c) => c.table_name).sort();
  for (const c of orgColumns) if (c.is_nullable === "YES") nullable.add(c.table_name);
}

/** One minimal row per organisation in every tenant table. Foreign keys and triggers are off for these inserts only. */
async function seedSyntheticRows() {
  const enums = await owner.$queryRaw<{ typname: string; label: string }[]>`
    SELECT t.typname::text, (array_agg(e.enumlabel ORDER BY e.enumsortorder))[1]::text AS label FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`;
  const firstLabel = new Map(enums.map((e) => [e.typname, e.label]));
  // `"status" = ANY (ARRAY['OPEN'::text, ...])` style checks: the first allowed value.
  const checks = await owner.$queryRaw<{ table_name: string; def: string }[]>`
    SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
  const allowed = new Map<string, string>();
  for (const c of checks) {
    for (const m of c.def.matchAll(/\(?"?(\w+)"? = ANY \(ARRAY\['([^']+)'::text/g)) allowed.set(`${c.table_name.replace(/"/g, "")}.${m[1]}`, m[2]!);
  }
  for (const table of tenantTables) {
    const state = { a: false, b: false, error: undefined as string | undefined };
    for (const [n, org] of [[1, A], [2, B]] as const) {
      const override = OVERRIDES[table]?.(n) ?? {};
      const names: string[] = [];
      const values: string[] = [];
      for (const c of columns.filter((x) => x.table_name === table)) {
        if (c.is_generated === "ALWAYS") continue;
        let value: string | undefined;
        if (c.column_name === "organisationId") value = `'${org}'`;
        else if (override[c.column_name]) value = override[c.column_name];
        else if (allowed.has(`${table}.${c.column_name}`)) value = `'${allowed.get(`${table}.${c.column_name}`)}'`;
        else if (c.is_nullable === "YES" || c.column_default !== null) continue;
        else if (c.data_type === "ARRAY") value = `'{}'`;
        else if (c.udt_name === "text" || c.udt_name === "varchar") value = `'rls-${n}-' || gen_random_uuid()::text`;
        else if (["int2", "int4", "int8", "float4", "float8", "numeric"].includes(c.udt_name)) value = String(n);
        else if (c.udt_name === "bool") value = "false";
        else if (c.udt_name === "timestamp" || c.udt_name === "timestamptz") value = "now()";
        else if (c.udt_name === "date") value = "current_date";
        else if (c.udt_name === "json" || c.udt_name === "jsonb") value = `'{}'`;
        else if (c.udt_name === "bytea") value = `''::bytea`;
        else if (firstLabel.has(c.udt_name)) value = `'${firstLabel.get(c.udt_name)}'::${q(c.udt_name)}`;
        else value = "NULL";
        names.push(q(c.column_name));
        values.push(value!);
      }
      try {
        await owner.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
          await tx.$executeRawUnsafe(`INSERT INTO ${q(table)} (${names.join(", ")}) VALUES (${values.join(", ")})`);
        });
        if (org === A) state.a = true;
        else state.b = true;
      } catch (e) {
        state.error = (e as Error).message.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
      }
    }
    seeded.set(table, state);
  }
}

/** A copy of one of A's rows with a new id, addressed to `org`: the generic "write into another tenant" attempt. */
function copyRowInto(table: string, org: string) {
  const cols = columns.filter((c) => c.table_name === table && c.is_generated !== "ALWAYS").map((c) => q(c.column_name));
  const hasId = columns.some((c) => c.table_name === table && c.column_name === "id");
  const patch = hasId ? `jsonb_build_object('id', 'rls-copy-' || gen_random_uuid()::text, 'organisationId', '${org}')` : `jsonb_build_object('organisationId', '${org}')`;
  return `INSERT INTO ${q(table)} (${cols.join(", ")}) SELECT ${cols.map((c) => `(r).${c}`).join(", ")} FROM (SELECT jsonb_populate_record(NULL::${q(table)}, to_jsonb(t) || ${patch}) AS r FROM ${q(table)} t WHERE t."organisationId" = '${A}' LIMIT 1) s`;
}

beforeAll(async () => {
  await resetDb();
  await loadCatalogue();
  await seedSyntheticRows();
}, 240_000);

describe("what is protected", () => {
  it("every table with an organisationId column has row-level security enabled, forced, and one tenant policy", async () => {
    const rows = await owner.$queryRaw<{ table_name: string; enabled: boolean; forced: boolean; policies: bigint }[]>`
      SELECT c.relname::text AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`;
    const state = new Map(rows.map((r) => [r.table_name, r]));
    expect(tenantTables.length).toBeGreaterThan(100);
    const unprotected = tenantTables.filter((t) => !state.get(t)?.enabled || !state.get(t)?.forced || Number(state.get(t)?.policies) !== 1);
    expect(unprotected, "tables with an organisationId column but no forced tenant policy: add them in a new migration").toEqual([]);
  });

  it("includes the three pilot tables", () => {
    expect(tenantTables).toEqual(expect.arrayContaining(["ServiceUser", "CareIntakeDocument", "ServiceUserExternalReference"]));
  });

  it("the application role cannot switch row-level security off for itself", async () => {
    const [role] = await owner.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole FROM pg_roles WHERE rolname = 'csb_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreaterole: false });
    const owned = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'csb_app'`;
    expect(Number(owned[0]?.n)).toBe(0);
  });

  it("the application's queries really run as that role", async () => {
    const [who] = await withTenantScope(A, () => db.$queryRaw<{ u: string; org: string; bypass: string }[]>`SELECT current_user::text AS u, current_setting('app.organisation_id', true) AS org, current_setting('app.rls_bypass', true) AS bypass`);
    expect(who).toEqual({ u: "csb_app", org: A, bypass: "off" });
  });

  it("has a synthetic row for both organisations in every protected table", () => {
    const missing = [...seeded].filter(([, s]) => !s.a || !s.b).map(([t, s]) => `${t}: ${s.error}`);
    expect(missing, "add the values these tables need to OVERRIDES in this file").toEqual([]);
  });
});

describe("one organisation cannot read or write another's rows, with the organisation filter left out", () => {
  // The table list is only known once the database has been read, so the cases are generated inside one test per
  // behaviour and every failing table is reported together.
  it("an unfiltered read as organisation A returns A's rows (and shared rows) and none of B's", async () => {
    const wrong: string[] = [];
    for (const table of tenantTables) {
      const [mine, shared, theirs] = await Promise.all([ownerCount(table, A), nullable.has(table) ? ownerCount(table, null) : 0, ownerCount(table, B)]);
      expect(theirs, `${table} has no row for B to protect`).toBeGreaterThan(0);
      const seen = await withTenantScope(A, () => count(db, `SELECT count(*) AS n FROM ${q(table)}`));
      const seenOfB = await withTenantScope(A, () => count(db, `SELECT count(*) AS n FROM ${q(table)} WHERE "organisationId" = $1`, B));
      if (seen !== mine + shared || seenOfB !== 0) wrong.push(`${table}: saw ${seen} (expected ${mine + shared}), of which B's: ${seenOfB}`);
    }
    expect(wrong).toEqual([]);
  });

  it("updates and deletes aimed at B's rows change nothing", async () => {
    const wrong: string[] = [];
    for (const table of tenantTables) {
      const before = await ownerCount(table, B);
      const updated = await withTenantScope(A, () => db.$executeRawUnsafe(`UPDATE ${q(table)} SET "organisationId" = "organisationId" WHERE "organisationId" = $1`, B));
      const deleted = await withTenantScope(A, () => db.$executeRawUnsafe(`DELETE FROM ${q(table)} WHERE "organisationId" = $1`, B));
      const after = await ownerCount(table, B);
      if (updated !== 0 || deleted !== 0 || after !== before) wrong.push(`${table}: updated ${updated}, deleted ${deleted}, rows ${before} -> ${after}`);
    }
    expect(wrong).toEqual([]);
  });

  it("inserting a row for B is refused", async () => {
    // These tables also have an older integrity trigger that checks a row's organisation against its parent. A
    // BEFORE trigger runs ahead of the row-level security check, so there the trigger is what answers. Both refuse.
    const TRIGGER_ANSWERS_FIRST = ["CoverContactAttempt", "FormRecord", "FormRecordLink", "MissedCallCarerResponse", "PolicyResourceLink", "PolicyVersion", "ServiceUserDocumentVersion", "ServiceUserDocumentVersionStatus", "Visit", "VisitAssignment", "VisitMedicationLead", "VisitTemplate"];
    const wrong: string[] = [];
    const byTrigger: string[] = [];
    for (const table of tenantTables) {
      const before = await ownerCount(table, B);
      const outcome = await withTenantScope(A, () => db.$executeRawUnsafe(copyRowInto(table, B))).then(
        (n) => `inserted ${n} row(s)`,
        (e: Error) => (/row-level security/.test(e.message) ? "refused" : /Code: `P0001`/.test(e.message) ? "refused by trigger" : `failed for another reason: ${e.message.split("\n").filter(Boolean).pop()}`),
      );
      const after = await ownerCount(table, B);
      if (outcome === "refused by trigger") byTrigger.push(table);
      else if (outcome !== "refused") wrong.push(`${table}: ${outcome}`);
      if (after !== before) wrong.push(`${table}: B's rows ${before} -> ${after}`);
    }
    expect(wrong).toEqual([]);
    expect(byTrigger).toEqual(TRIGGER_ANSWERS_FIRST);
  });

  it("moving one of A's rows to B is refused", async () => {
    const wrong: string[] = [];
    for (const table of tenantTables) {
      const before = await ownerCount(table, B);
      const outcome = await withTenantScope(A, () => db.$executeRawUnsafe(`UPDATE ${q(table)} SET "organisationId" = $1 WHERE "organisationId" = $2`, B, A)).then(
        (n) => `moved ${n} row(s)`,
        () => "refused",
      );
      const after = await ownerCount(table, B);
      if (outcome !== "refused" || after !== before) wrong.push(`${table}: ${outcome}; B's rows ${before} -> ${after}`);
    }
    expect(wrong).toEqual([]);
  });

  it("with no scope at all, organisation-owned rows are invisible and cannot be written (default deny)", async () => {
    const wrong: string[] = [];
    for (const table of tenantTables) {
      const shared = nullable.has(table) ? await ownerCount(table, null) : 0;
      const seen = await withNoScope(() => count(db, `SELECT count(*) AS n FROM ${q(table)}`));
      const insert = await withNoScope(() => db.$executeRawUnsafe(copyRowInto(table, A))).then(
        (n) => (n === 0 ? "nothing to copy" : `inserted ${n}`),
        (e: Error) => (/row-level security/.test(e.message) ? "refused" : `failed: ${e.message.split("\n").filter(Boolean).pop()}`),
      );
      // With no scope the row to copy is invisible too, so the insert finds nothing to copy; either way nothing is written.
      if (seen !== shared || !["refused", "nothing to copy"].includes(insert)) wrong.push(`${table}: saw ${seen} (expected ${shared}), insert ${insert}`);
    }
    expect(wrong).toEqual([]);
  });

  it("the system scope sees every organisation", async () => {
    for (const table of ["ServiceUser", "CareIntakeDocument", "ServiceUserExternalReference", "Visit", "AuditLog"]) {
      // The bypass writes its own audit entry first, so the truth is counted afterwards.
      const seen = await withSystemScope("rls test: read everything", () => count(db, `SELECT count(*) AS n FROM ${q(table)}`));
      expect(seen, table).toBe(await count(owner, `SELECT count(*) AS n FROM ${q(table)}`));
    }
  });
});

describe("through Prisma, as application code would write it", () => {
  it("findMany with no where clause returns only the caller's organisation (pilot tables)", async () => {
    const [su, docs, refs] = await withTenantScope(A, () => Promise.all([db.serviceUser.findMany({ select: { organisationId: true } }), db.careIntakeDocument.findMany({ select: { organisationId: true } }), db.serviceUserExternalReference.findMany({ select: { organisationId: true } })]));
    for (const rows of [su, docs, refs]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.organisationId))).toEqual(new Set([A]));
    }
  });

  it("another organisation's record cannot be found, updated or deleted by id", async () => {
    const theirs = (await owner.serviceUser.findFirstOrThrow({ where: { organisationId: B } })).id;
    await withTenantScope(A, async () => {
      expect(await db.serviceUser.findUnique({ where: { id: theirs } })).toBeNull();
      await expect(db.serviceUser.update({ where: { id: theirs }, data: { firstName: "Changed" } })).rejects.toMatchObject({ code: "P2025" });
      await expect(db.serviceUser.delete({ where: { id: theirs } })).rejects.toMatchObject({ code: "P2025" });
      expect((await db.serviceUser.updateMany({ where: { organisationId: B }, data: { firstName: "Changed" } })).count).toBe(0);
    });
    expect((await owner.serviceUser.findUniqueOrThrow({ where: { id: theirs } })).firstName).not.toBe("Changed");
  });

  it("a row cannot be created for another organisation", async () => {
    const template = await owner.serviceUser.findFirstOrThrow({ where: { organisationId: A } });
    const before = await owner.serviceUser.count({ where: { organisationId: B } });
    await expect(withTenantScope(A, () => db.serviceUser.create({ data: { ...template, id: "rls-create-attempt", organisationId: B, reference: "RLS-ATTEMPT", csbReference: null } as Prisma.ServiceUserUncheckedCreateInput }))).rejects.toThrow(/row-level security/);
    expect(await owner.serviceUser.count({ where: { organisationId: B } })).toBe(before);
  });

  it("an interactive transaction keeps the caller's scope for all its queries", async () => {
    const seen = await withTenantScope(B, () =>
      db.$transaction(async (tx) => {
        const who = await tx.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`;
        const first = await tx.serviceUser.findMany({ select: { organisationId: true } });
        const second = await tx.visit.findMany({ select: { organisationId: true } });
        return { who: who[0]?.u, orgs: [...new Set([...first, ...second].map((r) => r.organisationId))] };
      }),
    );
    expect(seen).toEqual({ who: "csb_app", orgs: [B] });
  });

  it("a batch transaction keeps the caller's scope and returns its own results in order", async () => {
    const [su, visits] = await withTenantScope(A, () => db.$transaction([db.serviceUser.count(), db.visit.findMany({ select: { organisationId: true } })]));
    expect(su).toBe(await owner.serviceUser.count({ where: { organisationId: A } }));
    expect(new Set(visits.map((v) => v.organisationId))).toEqual(new Set([A]));
  });

  it("a write inside a transaction that is rolled back leaves nothing behind, and the next query starts clean", async () => {
    await expect(
      withTenantScope(A, () =>
        db.$transaction(async (tx) => {
          await tx.serviceUser.updateMany({ data: { firstName: "Rolled back" } });
          throw new Error("stop");
        }),
      ),
    ).rejects.toThrow("stop");
    expect(await owner.serviceUser.count({ where: { firstName: "Rolled back" } })).toBe(0);
    expect(await withNoScope(() => db.serviceUser.count())).toBe(0);
  });

  it("scopes do not leak between concurrent requests sharing the connection pool", async () => {
    const [a, b] = await Promise.all([owner.serviceUser.count({ where: { organisationId: A } }), owner.serviceUser.count({ where: { organisationId: B } })]);
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const org = i % 3 === 0 ? null : i % 3 === 1 ? A : B;
      const work = () => db.serviceUser.findMany({ select: { organisationId: true } });
      return (org ? withTenantScope(org, work) : withNoScope(work)).then((rows) => ({ org, orgs: [...new Set(rows.map((r) => r.organisationId))], n: rows.length }));
    });
    for (const r of await Promise.all(jobs)) {
      if (r.org === null) expect(r.n).toBe(0);
      else expect(r).toEqual({ org: r.org, orgs: [r.org], n: r.org === A ? a : b });
    }
  });

  it("a query returned un-awaited from a scope still runs inside it", async () => {
    // Prisma queries are lazy; the scope helpers await the callback's result inside the scope for this reason.
    expect(await withTenantScope(A, () => db.serviceUser.count())).toBe(await owner.serviceUser.count({ where: { organisationId: A } }));
  });
});

describe("the audited bypass", () => {
  it("writes an audit entry each time, with the reason and the person", async () => {
    const before = await owner.auditLog.count({ where: { action: "rls.bypass" } });
    await withSystemScope("rls test: audited", () => db.serviceUser.count(), { actorId: "rls-test-actor" });
    const rows = await owner.auditLog.findMany({ where: { action: "rls.bypass" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(await owner.auditLog.count({ where: { action: "rls.bypass" } })).toBe(before + 1);
    expect(rows[0]).toMatchObject({ organisationId: null, actorId: "rls-test-actor", entityType: "System", entityId: "rls test: audited", data: { reason: "rls test: audited", uses: 1 } });
  });

  it("machine paths that repeat write one entry an hour, not one per run", async () => {
    const reason = `rls test: hourly ${Date.now()}`;
    for (let i = 0; i < 5; i++) await withSystemScope(reason, () => db.serviceUser.count(), { audit: "hourly" });
    expect(await owner.auditLog.count({ where: { action: "rls.bypass", entityId: reason } })).toBe(1);
  });

  it("ends with the callback: the next query is back to default deny", async () => {
    await withSystemScope("rls test: ends", () => db.serviceUser.count());
    expect(await withNoScope(() => db.serviceUser.count())).toBe(0);
  });
});

describe("signed-out paths that must still work", () => {
  it("a one-time invitation link can be read and used with no session, and joins only the organisation stored on it", async () => {
    const email = `rls-invite-${Date.now()}@example.test`;
    const admin = await owner.user.create({ data: { email: `rls-admin-${Date.now()}@example.test`, name: "Ada Fictional", passwordHash: "x" } });
    // The synthetic rows above have no parent records, so this test makes a real organisation of its own.
    const org = await owner.organisation.create({ data: { name: "RLS Invitation Test Care", slug: `rls-invite-${Date.now()}` } });
    const invite = await withTenantScope(org.id, () => inviteMemberIn(org.id, { userId: admin.id, level: "admin" }, { email, name: "Robin Fictional", roles: ["STAFF"] }));
    // The person holding the link has no session: no scope is set.
    const shown = await withNoScope(() => describeToken(invite.token));
    expect(shown).toMatchObject({ kind: "INVITE", email, needsName: true });
    await withNoScope(() => redeemToken(invite.token, { password: "a long synthetic password 2026" }));
    const memberships = await owner.membership.findMany({ where: { user: { email } }, select: { organisationId: true } });
    expect(memberships).toEqual([{ organisationId: org.id }]);
    // Used once: the link is dead afterwards, and the signed-out caller still sees no tenant rows.
    expect(await withNoScope(() => describeToken(invite.token))).toBeNull();
    expect(await withNoScope(() => db.serviceUser.count())).toBe(0);
  });
});
