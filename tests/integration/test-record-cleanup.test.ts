import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Client } from "pg";
import { db } from "@/lib/db";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { prepareDrafts } from "@/server/care/coordinator/prepare";
import { BACKUP_SCHEMA, CLEANUP_ID, TEST_INTAKE_TITLE, cleanUpTestPerson } from "../../prisma/test-record-cleanup";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanPdf } from "../support/coordinator-fixture";

/** The one-off removal of the fictional test person made on the hosted site (prisma/test-record-cleanup.ts). */
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

describe("test person clean-up", () => {
  let orgId = "";
  let testIntake = "";
  let otherIntake = "";
  let suId = "";
  let before = { serviceUsers: 0, visits: 0, staff: 0 };

  beforeAll(async () => {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${BACKUP_SCHEMA}" CASCADE`);
    await resetDb();
    await seedAll({ simulatedChange: false, care: true });
    setAiProviderForTests(new SimulatedProvider());
    orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
    const c = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    // Another intake that must be kept (not prepared, like the owner's own one).
    otherIntake = (await createIntake(c, { title: "Real referral" })).id;
    before = { serviceUsers: await db.serviceUser.count({ where: { organisationId: orgId } }), visits: await db.visit.count({ where: { organisationId: orgId } }), staff: await db.staffMember.count({ where: { organisationId: orgId } }) };
    testIntake = (await createIntake(c, { title: TEST_INTAKE_TITLE })).id;
    await addDocuments(c, testIntake, [{ name: "Support plan.pdf", type: "application/pdf", bytes: await supportPlanPdf() }]);
    const r = await prepareDrafts(c, testIntake);
    suId = r.serviceUserId!;
    expect(await db.visit.count({ where: { serviceUserId: suId } })).toBeGreaterThan(0);
  }, 180_000);

  it("removes only the test intake and the fictional person it made, with a backup and an audit entry", async () => {
    const out = await inTransaction(cleanUpTestPerson);
    expect(out).toHaveProperty("deleted");
    expect(await db.careIntake.count({ where: { id: testIntake } })).toBe(0);
    expect(await db.serviceUser.count({ where: { id: suId } })).toBe(0);
    expect(await db.visit.count({ where: { serviceUserId: suId } })).toBe(0);
    expect(await db.visitTemplate.count({ where: { serviceUserId: suId } })).toBe(0);
    expect(await db.careIntake.count({ where: { id: otherIntake } })).toBe(1);
    expect(await db.serviceUser.count({ where: { organisationId: orgId } })).toBe(before.serviceUsers);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(before.visits);
    expect(await db.staffMember.count({ where: { organisationId: orgId } })).toBe(before.staff);
    const backup = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${BACKUP_SCHEMA}"."ServiceUser"`);
    expect(backup[0]!.n).toBe(1);
    expect(await db.auditLog.count({ where: { action: "test-person.cleanup", entityId: CLEANUP_ID } })).toBe(1);
  }, 120_000);

  it("does nothing the second time", async () => {
    expect(await inTransaction(cleanUpTestPerson)).toEqual({ skipped: `${CLEANUP_ID} already applied` });
  });
});
