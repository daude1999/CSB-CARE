import { beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

/**
 * The live site reaches its database through a pooler that gives each server instance ONE connection. A query made on
 * the global client while a transaction holds that connection waits for it until the pool times out (error P2024),
 * which is how "Prepare records" failed on the live site on 7 Nov 2026. Locally the pool is larger, so this file runs
 * the coordinator's steps on a one-connection client to catch any such query. Seeding uses a normal client.
 */
const pool = vi.hoisted(() => ({ current: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => {
  const options = { transactionOptions: { maxWait: 10_000, timeout: 60_000 } };
  pool.current = new PrismaClient(options);
  const db = new Proxy({} as PrismaClient, { get: (_t, key) => { const v = Reflect.get(pool.current, key); return typeof v === "function" ? v.bind(pool.current) : v; } });
  return { db };
});

import { db } from "@/lib/db";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { addDocuments, createIntake, decideSection, submitIntake } from "@/server/care/coordinator/intake";
import { applyApproved } from "@/server/care/coordinator/apply";
import { draftSummary, prepareDrafts } from "@/server/care/coordinator/prepare";
import { rotaReadiness } from "@/server/care/coordinator/rota";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanPdf } from "../support/coordinator-fixture";

const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let plan: Buffer;

function oneConnectionUrl() {
  const u = new URL(process.env.DATABASE_URL!);
  u.searchParams.set("connection_limit", "1");
  u.searchParams.set("pool_timeout", "5");
  return u.toString();
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  plan = await supportPlanPdf();
  await pool.current.$disconnect();
  pool.current = new PrismaClient({ datasourceUrl: oneConnectionUrl(), transactionOptions: { maxWait: 10_000, timeout: 60_000 } });
}, 180_000);

describe("coordinator steps on a one-connection database pool, as on the live site", () => {
  let intakeId = "";

  it("prepares the records and a draft rota for a new person", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "One connection check" });
    intakeId = intake.id;
    await addDocuments(c, intakeId, [{ name: "Support plan.pdf", type: "application/pdf", bytes: plan }]);
    const r = await prepareDrafts(c, intakeId);
    expect(r.blocked).toBeNull();
    expect(r.serviceUserId).toBeTruthy();
    expect(r.rota?.visits).toBeGreaterThan(0);
    expect((await draftSummary(c, intakeId)).templates?.length).toBe(4);
    await rotaReadiness(await manager(), intakeId);
  }, 120_000);

  it("stops at a possible duplicate without waiting for a second connection", async () => {
    const c = await coordinator();
    const dup = await createIntake(c, { title: "Same person again" });
    await addDocuments(c, dup.id, [{ name: "Support plan copy.pdf", type: "application/pdf", bytes: plan }]);
    const r = await prepareDrafts(c, dup.id);
    expect(r.blocked).toMatch(/already on record/);
  }, 120_000);

  it("sends the intake to a manager once every fact is decided", async () => {
    const c = await coordinator();
    await db.careIntakeFact.updateMany({ where: { intakeId, decision: { in: ["PENDING", "NEEDS_INFO"] } }, data: { decision: "APPROVED" } });
    await submitIntake(c, intakeId, { notADuplicate: true });
    expect((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } })).status).toBe("SUBMITTED");
  }, 120_000);

  it("lets a manager approve the sections and save them to the record", async () => {
    const m = await manager();
    const waiting = await db.careIntakeSection.findMany({ where: { intakeId, status: "SUBMITTED" }, select: { section: true } });
    for (const { section } of waiting) await decideSection(m, intakeId, section, { decision: "APPROVED" });
    const results = await applyApproved(m, intakeId);
    expect(results.filter((r) => r.status !== "DONE")).toEqual([]);
  }, 120_000);
});
