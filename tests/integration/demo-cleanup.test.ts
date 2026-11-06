import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Client } from "pg";
import { db } from "@/lib/db";
import { BACKUP_SCHEMA, CLEANUP_ID, cleanUp } from "../../prisma/demo-cleanup";
import { BROOKFIELD, OAKRIDGE, resetDb, seedAll } from "../helpers";

/** The one-off hosted clean-up of demonstration data (prisma/demo-cleanup.ts), against the seeded demo. */
const url = () => (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");

async function inTransaction<T>(run: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: url() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const out = await run(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

const dropBackup = () => db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${BACKUP_SCHEMA}" CASCADE`);

describe("demo data clean-up", () => {
  let before: { users: number; memberships: number; staff: number; policies: number; serviceUsers: number; visits: number };
  let orgId: string;

  beforeAll(async () => {
    await dropBackup();
    await resetDb();
    await seedAll({ care: true });
    const org = await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } });
    orgId = org.id;
    before = {
      users: await db.user.count({ where: { memberships: { some: { organisationId: orgId } } } }),
      memberships: await db.membership.count({ where: { organisationId: orgId } }),
      staff: await db.staffMember.count({ where: { organisationId: orgId } }),
      policies: await db.policy.count({ where: { organisationId: orgId } }),
      serviceUsers: await db.serviceUser.count({ where: { organisationId: orgId } }),
      visits: await db.visit.count({ where: { organisationId: orgId } }),
    };
  });
  afterAll(dropBackup);

  it("removes every service user and their records, keeps staff, logins and policies, and backs up first", async () => {
    expect(before.serviceUsers).toBeGreaterThan(0);
    expect(before.visits).toBeGreaterThan(0);
    const result = await inTransaction((c) => cleanUp(c));
    expect(result).toHaveProperty("deleted");

    expect(await db.serviceUser.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.visitTemplate.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.carePlan.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.candidate.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.audit.count({ where: { organisationId: orgId } })).toBe(0);
    expect(await db.notification.count({ where: { organisationId: orgId } })).toBe(0);

    expect(await db.user.count({ where: { memberships: { some: { organisationId: orgId } } } })).toBe(before.users);
    expect(await db.membership.count({ where: { organisationId: orgId } })).toBe(before.memberships);
    expect(await db.staffMember.count({ where: { organisationId: orgId } })).toBe(before.staff);
    expect(await db.policy.count({ where: { organisationId: orgId } })).toBe(before.policies);
    expect(await db.branch.count({ where: { organisationId: orgId } })).toBe(3);
    expect(await db.hrWorkspace.count({ where: { organisationId: orgId } })).toBe(1);

    // The test organisation and its own login are gone; the CSB platform logins stay.
    expect(await db.organisation.findUnique({ where: { slug: OAKRIDGE } })).toBeNull();
    expect(await db.user.findUnique({ where: { email: "manager@oakridge.demo" } })).toBeNull();
    expect(await db.user.findUnique({ where: { email: "admin@csb.demo" } })).not.toBeNull();

    // No longer a demo: name, label, and its logins can change their passwords.
    const org = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.isDemo).toBe(false);
    expect(org.name).not.toMatch(/DEMO/);
    expect(await db.user.count({ where: { isDemo: true, memberships: { some: { organisationId: orgId } } } })).toBe(0);

    // The restore copy holds the rows as they were.
    const [copy] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${BACKUP_SCHEMA}"."ServiceUser"`);
    expect(Number(copy!.n)).toBe(before.serviceUsers);
    expect(await db.auditLog.count({ where: { action: "demo.cleanup", entityId: CLEANUP_ID } })).toBe(1);
  });

  it("never runs twice", async () => {
    const result = await inTransaction((c) => cleanUp(c));
    expect(result).toHaveProperty("skipped");
  });

  it("rolls back completely if the transaction fails", async () => {
    await dropBackup();
    await resetDb();
    await seedAll({ care: true });
    const org = await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } });
    const count = await db.serviceUser.count({ where: { organisationId: org.id } });
    await expect(inTransaction(async (c) => {
      await cleanUp(c);
      throw new Error("simulated failure after the deletes");
    })).rejects.toThrow("simulated failure");
    expect(await db.serviceUser.count({ where: { organisationId: org.id } })).toBe(count);
    expect((await db.organisation.findUniqueOrThrow({ where: { id: org.id } })).isDemo).toBe(true);
    const [schema] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_namespace WHERE nspname = '${BACKUP_SCHEMA}'`);
    expect(Number(schema!.n)).toBe(0);
  });
});
