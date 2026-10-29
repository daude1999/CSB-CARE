import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { setMemberBranches } from "@/server/admin/branches";
import { assignExceptionOwner, escalateException, escalateOverdueExceptions, listExceptions, resolveException } from "@/server/rota/exceptions";
import { raiseAlert } from "@/server/workforce/impact";
import { handlers } from "@/worker/handlers";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** The exceptions register against a real database: owner, escalation, resolution, the overdue sweep and branch scope. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";
let n = 0;

async function alertOn(branchName: string, opts: { deadline?: Date | null } = {}) {
  const visit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, area: { branch: { name: branchName } } } });
  const { alert } = await raiseAlert(db, { organisationId: orgId, kind: "LATE", visitId: visit.id, message: `Test late call ${++n}`, dedupeKey: `test-exception:${n}`, deadline: opts.deadline === undefined ? new Date(Date.now() + 15 * 60_000) : opts.deadline, notify: false });
  return alert;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("exceptions register", () => {
  it("gives an exception an owner, tells them in-app and refuses someone outside the rota roles", async () => {
    const a = await alertOn("Liverpool");
    const coord = await coordinator();
    await assignExceptionOwner(await manager(), a.id, coord.userId);
    const row = await db.rotaAlert.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.ownerId).toBe(coord.userId);
    expect(row.ownerAssignedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: coord.userId, type: "rota.exception.assigned" } })).toBe(1);
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(assignExceptionOwner(await manager(), a.id, carer.userId)).rejects.toBeInstanceOf(ValidationError);
    const { rows } = await listExceptions(await manager(), { owner: coord.userId });
    expect(rows.some((r) => r.id === a.id)).toBe(true);
  });

  it("escalates once with a note, in-app only, and resolves with the evidence kept", async () => {
    const a = await alertOn("Liverpool");
    const coord = await coordinator();
    await expect(escalateException(coord, a.id, "no")).rejects.toBeInstanceOf(ValidationError);
    const jobsBefore = await db.backgroundJob.count({ where: { type: "notification.deliver" } });
    await escalateException(coord, a.id, "Family cannot reach the carer");
    await expect(escalateException(coord, a.id, "Again please")).rejects.toBeInstanceOf(ConflictError);
    const esc = await db.rotaAlert.findUniqueOrThrow({ where: { id: a.id } });
    expect(esc.escalationState).toBe("ESCALATED");
    expect(await db.notification.count({ where: { organisationId: orgId, type: "rota.exception.escalated", dedupeKey: { startsWith: `exception-escalated:${a.id}:` } } })).toBeGreaterThan(0);
    // Escalation never queues an email or anything else outside the platform.
    expect(await db.backgroundJob.count({ where: { type: "notification.deliver" } })).toBe(jobsBefore);
    await resolveException(coord, a.id, { resolution: "Carer arrived 25 minutes late; family told", evidenceNote: "Call log 14:05" });
    const done = await db.rotaAlert.findUniqueOrThrow({ where: { id: a.id } });
    expect(done.resolvedById).toBe(coord.userId);
    expect(done.escalationState).toBe("RESOLVED_AFTER_ESCALATION");
    expect(done.evidenceNote).toBe("Call log 14:05");
    await expect(resolveException(coord, a.id, { resolution: "Twice" })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditLog.count({ where: { entityId: a.id, action: { in: ["rota.exception.escalated", "rota.alert.resolved"] } } })).toBe(2);
  });

  it("escalates open exceptions past their deadline from the sweep job, once", async () => {
    const late = await alertOn("Liverpool", { deadline: new Date(Date.now() - 60_000) });
    const notYet = await alertOn("Liverpool");
    const first = await escalateOverdueExceptions();
    expect(first).toBeGreaterThanOrEqual(1);
    expect((await db.rotaAlert.findUniqueOrThrow({ where: { id: late.id } })).escalatedAt).not.toBeNull();
    expect((await db.rotaAlert.findUniqueOrThrow({ where: { id: notYet.id } })).escalatedAt).toBeNull();
    expect(await escalateOverdueExceptions()).toBe(0);
    const { overdue, rows } = await listExceptions(await manager(), { state: "overdue" });
    expect(overdue).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.overdue)).toBe(true);
  });

  it("runs call monitoring as its own job, separate from the policy maintenance tick", async () => {
    expect(typeof handlers["rota.sweep"]).toBe("function");
    const job = await db.backgroundJob.create({ data: { type: "rota.sweep", idempotencyKey: `test-sweep:${Date.now()}`, status: "SUCCEEDED" } });
    const out = await handlers["rota.sweep"]!({}, job);
    expect(out).toHaveProperty("escalated");
    const tick = await handlers["maintenance.tick"]!({}, job);
    expect(tick).not.toHaveProperty("calls");
  });

  it("keeps branch-limited members to their branches' exceptions", async () => {
    const elsewhere = await alertOn("Portsmouth");
    const mine = await alertOn("Liverpool");
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [liverpool.id]);
    try {
      const ctx = await coordinator();
      const { rows } = await listExceptions(ctx, { state: "open" });
      expect(rows.some((r) => r.id === mine.id)).toBe(true);
      expect(rows.some((r) => r.id === elsewhere.id)).toBe(false);
      await expect(resolveException(ctx, elsewhere.id, { resolution: "Not mine to close" })).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(await manager(), m.id, []);
    }
  });
});
