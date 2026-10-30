import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { addRestriction, grantException, liftRestriction, readinessFor, readinessQueue, recordTraining, revokeException, saveRequirement, staffEvidenceRows, staffReadiness, verifyTraining } from "@/server/readiness";
import { confirmBuild, publishBuild } from "@/server/rota/build";
import { clockMine } from "@/server/rota/attendance";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Staff readiness against a real database: second-person verification, expiry, exceptions, restrictions, the
 * clock-in refusal, the re-check at publish and branch scope. The seed leaves three people without a sign-in short
 * on purpose (evidence awaiting verification, safeguarding expired, moving and handling sign-off outstanding).
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";

async function statusOf(staffId: string) {
  return (await readinessFor(db, orgId, [staffId])).get(staffId)!;
}
async function req(key: string) {
  return db.readinessRequirement.findFirstOrThrow({ where: { organisationId: orgId, key, status: "ACTIVE" } });
}
/** The seeded person whose general requirement `key` is in `state`. */
async function personWith(key: string, state: string) {
  const staff = await db.staffMember.findMany({ where: { organisationId: orgId, userId: null, hrMissing: false, employmentStatus: "ACTIVE" }, select: { id: true } });
  const all = await readinessFor(db, orgId, staff.map((s) => s.id));
  const hit = [...all.values()].find((r) => r.components.some((c) => c.key === key && c.state === state && !c.taskLevel));
  if (!hit) throw new Error(`No seeded person with ${key} ${state}`);
  return hit.staffId;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("evidence and verification", () => {
  it("counts training only once a second person verifies it", async () => {
    const id = await personWith("infection-prevention", "PENDING_VERIFICATION");
    expect((await statusOf(id)).status).toBe("PENDING_VERIFICATION");
    const record = await db.staffTrainingRecord.findFirstOrThrow({ where: { staffId: id, verificationStatus: "SUBMITTED" } });
    // The coordinator entered it, so the coordinator cannot verify it.
    await expect(verifyTraining(await coordinator(), record.id, "VERIFIED", "")).rejects.toBeInstanceOf(ForbiddenError);
    await verifyTraining(await manager(), record.id, "VERIFIED", "Certificate checked");
    const after = await statusOf(id);
    expect(after.components.find((c) => c.key === "infection-prevention")?.state).toBe("MET");
    expect(["READY", "READY_WITH_RESTRICTIONS"]).toContain(after.status);
    // Decided records are immutable: verifying twice is refused, and the database refuses a direct edit too.
    await expect(verifyTraining(await manager(), record.id, "REJECTED", "Changed my mind")).rejects.toThrow(/already been decided/);
    await expect(db.staffTrainingRecord.update({ where: { id: record.id }, data: { provider: "Edited" } })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { entityId: record.id, action: "readiness.training.verified" } })).toBe(1);
  });

  it("treats expired training as not ready until new evidence is verified", async () => {
    const id = await personWith("safeguarding-adults", "EXPIRED");
    const before = await statusOf(id);
    expect(before.status).toBe("NOT_READY");
    expect(before.reasons.join(" ")).toMatch(/Safeguarding adults: expired/);
    const sg = await req("safeguarding-adults");
    const rec = await recordTraining(await coordinator(), id, { requirementId: sg.id, completedAt: londonDate(), provider: "Test provider", result: "Pass" });
    // Unverified evidence does not count: the old verified record still decides, and it has expired.
    expect((await statusOf(id)).components.find((c) => c.key === "safeguarding-adults")?.state).toBe("EXPIRED");
    await verifyTraining(await manager(), rec.id, "VERIFIED", "Seen");
    expect((await statusOf(id)).status).not.toBe("NOT_READY");
  });

  it("refuses future completion dates and policy requirements recorded as training", async () => {
    const id = await personWith("safeguarding-adults", "MET");
    const sg = await req("safeguarding-adults");
    await expect(recordTraining(await coordinator(), id, { requirementId: sg.id, completedAt: addDays(londonDate(), 3) })).rejects.toBeInstanceOf(ValidationError);
    const policy = await db.readinessRequirement.findFirst({ where: { organisationId: orgId, category: "POLICY", status: "ACTIVE" } });
    if (policy) await expect(recordTraining(await coordinator(), id, { requirementId: policy.id, completedAt: londonDate() })).rejects.toThrow(/acknowledging the policy/);
  });
});

describe("exceptions and restrictions", () => {
  it("lets a time-limited exception stand in for a requirement, and revoking it makes the person not ready again", async () => {
    const id = await personWith("moving-handling", "EXCEPTION");
    const ex = await db.readinessException.findFirstOrThrow({ where: { staffId: id, revokedAt: null } });
    expect((await statusOf(id)).status).not.toBe("NOT_READY");
    await revokeException(await manager(), ex.id, "Assessment did not happen");
    const after = await statusOf(id);
    expect(after.components.find((c) => c.key === "moving-handling")?.state).toBe("COMPETENCY_DUE");
    expect(after.status).toBe("NOT_READY");
    const mh = await req("moving-handling");
    await expect(grantException(await manager(), id, { requirementId: mh.id, reason: "Assessment rebooked for next week", compensatingControls: "Double-up visits only", expiresAt: addDays(londonDate(), 120) })).rejects.toThrow(/at most 90 days/);
    await expect(grantException(await coordinator(), id, { requirementId: mh.id, reason: "Assessment rebooked for next week", compensatingControls: "Double-up visits only", expiresAt: addDays(londonDate(), 10) })).rejects.toBeInstanceOf(ForbiddenError);
    await grantException(await manager(), id, { requirementId: mh.id, reason: "Assessment rebooked for next week", compensatingControls: "Double-up visits only", expiresAt: addDays(londonDate(), 10) });
    expect((await statusOf(id)).status).not.toBe("NOT_READY");
  });

  it("never grants an exception where the requirement forbids one", async () => {
    const meds = await db.readinessRequirement.findFirst({ where: { organisationId: orgId, key: "medication-competency", status: "ACTIVE" } });
    if (!meds) return;
    const id = await personWith("safeguarding-adults", "MET");
    await expect(grantException(await manager(), id, { requirementId: meds.id, reason: "We are short of staff this week", compensatingControls: "Senior on call by phone", expiresAt: addDays(londonDate(), 7) })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("clock-in and publish", () => {
  it("refuses clock-in on a hard stop, alerts the office, and allows it once the restriction is lifted", async () => {
    const me = await carer();
    const amelia = await myStaff(me);
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 3 * 86400_000) }, assignments: { some: { staffId: amelia.id, removedAt: null } } }, orderBy: { scheduledStart: "asc" } });
    const r = await addRestriction(await manager(), amelia.id, { kind: "GENERAL", reason: "Under investigation; no lone visits", startsAt: londonDate() });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(v.scheduledStart.getTime() + 2 * 60_000));
    await expect(clockMine(me, v.id, "IN", { nonce: "ready-1" })).rejects.toThrow(/cannot clock in.*office has been alerted/);
    // The alert survives the refusal.
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "READINESS", severity: "CRITICAL" } })).toBe(1);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");
    vi.useRealTimers();
    await liftRestriction(await manager(), r.id, "Investigation closed");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(v.scheduledStart.getTime() + 3 * 60_000));
    await clockMine(me, v.id, "IN", { nonce: "ready-2" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("IN_PROGRESS");
  });

  it("re-checks readiness at publish and flags affected visits without reassigning anyone", async () => {
    const c = await coordinator();
    const week = addDays(mondayOf(londonDate()), 21);
    const { build } = await confirmBuild(c, { weekStart: week });
    const a = await db.visitAssignment.findFirst({ where: { visit: { rotaBuildId: build.id }, removedAt: null, staff: { userId: null } } });
    if (!a) return; // nothing allocated in that week of the template cycle
    await addRestriction(await manager(), a.staffId, { kind: "GENERAL", reason: "Suspended pending review", startsAt: londonDate() });
    const res = await publishBuild(c, build.id);
    expect(res.flagged).toBeGreaterThan(0);
    const after = await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.removedAt).toBeNull();
    expect(after.reviewReason).toMatch(/Restriction|readiness|Suspended/i);
  });
});

describe("scope and evidence", () => {
  it("keeps branch-limited members to their branches' people", async () => {
    const portsmouth = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Portsmouth" } });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [portsmouth.id]);
    try {
      const c = await coordinator();
      const elsewhere = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: { not: portsmouth.id }, NOT: { branchId: null }, hrMissing: false } });
      const sg = await req("safeguarding-adults");
      await expect(recordTraining(c, elsewhere.id, { requirementId: sg.id, completedAt: londonDate() })).rejects.toBeInstanceOf(NotFoundError);
      await expect(staffReadiness(c, elsewhere.id)).rejects.toBeInstanceOf(NotFoundError);
      const q = await readinessQueue(c);
      expect(q.rows.every((r) => r.branchId === portsmouth.id || r.branchId === null)).toBe(true);
    } finally {
      await setMemberBranches(await manager(), m.id, []);
    }
  });

  it("exports an evidence pack only for people allowed to see evidence, and audits it", async () => {
    const id = await personWith("safeguarding-adults", "MET");
    await expect(staffEvidenceRows(await coordinator(), id)).rejects.toBeInstanceOf(ForbiddenError);
    const pack = await staffEvidenceRows(await manager(), id);
    expect(pack.rows.some((r) => String(r[8]).includes("verified by"))).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: id, action: "readiness.evidence.exported" } })).toBe(1);
  });

  it("versions a requirement instead of rewriting it, keeps evidence counting, and flags everyone it applies to", async () => {
    const sg = await req("fire-safety");
    const scopes = await db.readinessScope.findMany({ where: { requirementId: sg.id } });
    const next = await saveRequirement(await manager(), { id: sg.id, key: sg.key, name: sg.name, category: "TRAINING", renewalMonths: 24, warningDays: 30, hardStop: true, exceptionAllowed: true, effectiveFrom: londonDate(), scopes: scopes.map((s) => (s.kind === "JOB_TITLE" ? { kind: "JOB_TITLE" as const, jobTitle: s.jobTitle ?? "" } : { kind: "ALL" as const })) });
    expect(next.version).toBe(sg.version + 1);
    expect((await db.readinessRequirement.findUniqueOrThrow({ where: { id: sg.id } })).status).toBe("RETIRED");
    const id = await personWith("fire-safety", "MET");
    expect((await statusOf(id)).openFlags.some((f) => /Fire safety/.test(f.reason))).toBe(true);
    await expect(saveRequirement(await coordinator(), { key: "x-test", name: "Test", category: "TRAINING", effectiveFrom: londonDate(), scopes: [{ kind: "ALL" }] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
