import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonMinute, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { previewBuild, publishBuild } from "@/server/rota/build";
import { confirmRollForward, previewRollForward } from "@/server/rota/roll-forward";
import { updateVisit } from "@/server/rota/visits";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * One-Click Roll Forward: copies a built week, with its hand-made changes, into 1, 2 or 4 following weeks as drafts.
 * Carers are re-checked for the new dates, existing visits are never duplicated, and branch limits apply.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};
const wk = (n: number) => addDays(mondayOf(londonDate()), n * 7);
const dupes = async () => Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT "templateId", date FROM "Visit" WHERE "templateId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d`)[0]!.n);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
}, 180_000);

describe("roll forward", () => {
  it("refuses impossible requests with readable messages", async () => {
    await expect(previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 3 })).rejects.toThrow(/1, 2 or 4/);
    await expect(previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(1), weeks: 1 })).rejects.toThrow(/after the week you copy from/);
    await expect(previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: addDays(wk(2), 1), weeks: 1 })).rejects.toThrow(ValidationError);
    await expect(previewRollForward(await ctxFor("finance@care-solution.demo", BROOKFIELD), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 1 })).rejects.toThrow();
  });

  it("carries a change made by hand into the new week, and keeps eligible carers", async () => {
    // Move one of next week's visits 20 minutes later by hand; the roll forward copies the visits as they are now.
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: dbDate(wk(1)), status: "SCHEDULED", timeLocked: false, assignments: { none: {} } }, orderBy: { scheduledStart: "asc" } });
    const start = new Date(v.scheduledStart.getTime() + 20 * 60000);
    await updateVisit(await manager(), v.id, v.lockVersion, { scheduledStart: start, scheduledEnd: new Date(v.scheduledEnd.getTime() + 20 * 60000) });

    const plan = await previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 1 });
    expect(plan.counts.create).toBeGreaterThan(0);
    // Demo carers carry HR warnings, so most are kept "for review" rather than outright; either way they stay on.
    expect(plan.counts.kept + plan.counts.review).toBeGreaterThan(0);
    const copied = plan.visits.find((x) => x.sourceVisitId === v.id)!;
    expect(copied.date).toBe(addDays(londonDate(start), 7));
    expect(londonMinute(copied.start)).toBe(londonMinute(start));
  });

  it("saves drafts once, never duplicates, and a later template build adds nothing", async () => {
    const before = await db.visit.count({ where: { organisationId: orgId } });
    const r = await confirmRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 1 });
    expect(r.builds).toHaveLength(1);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(before + r.plan.visits.length);
    expect(await db.visit.count({ where: { rotaBuildId: r.builds[0]!.id, publishedAt: { not: null } } })).toBe(0);
    expect(await dupes()).toBe(0);
    // Again: everything exists already.
    await expect(confirmRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 1 })).rejects.toThrow(/already exists/);
    const again = await previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(2), weeks: 1 });
    expect(again.visits).toHaveLength(0);
    expect(again.existing).toBe(r.plan.visits.length);
    // Build Rota for the same week finds the template visits already there.
    expect((await previewBuild(await manager(), { weekStart: wk(2) })).visits).toHaveLength(0);
    // The audit log records it, and the draft can be published like any build.
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "rota.rolled_forward" } })).toBe(1);
    const pub = await publishBuild(await manager(), r.builds[0]!.id);
    expect(pub.published).toBe(r.plan.visits.length);
  });

  it("does not copy a carer who is on leave in the new weeks, and says why", async () => {
    const a = await db.visitAssignment.findFirstOrThrow({ where: { removedAt: null, slot: "PRIMARY", visit: { organisationId: orgId, date: dbDate(wk(1)), status: "SCHEDULED" } }, include: { staff: true } });
    const mgr = await manager();
    await db.staffAbsence.create({ data: { organisationId: orgId, staffId: a.staffId, kind: "HOLIDAY", status: "APPROVED", startsAt: new Date(`${wk(3)}T00:00:00Z`), endsAt: new Date(`${addDays(wk(3), 14)}T00:00:00Z`), requestedById: mgr.userId, decidedById: mgr.userId, decidedAt: new Date() } });
    const plan = await previewRollForward(mgr, { sourceWeek: wk(1), targetWeek: wk(3), weeks: 2 });
    const theirs = plan.visits.flatMap((v) => v.slots).filter((s) => s.fromStaffId === a.staffId && s.slot !== "SHADOW");
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((s) => s.staffId === null && s.state === "UNCOVERED")).toBe(true);
    expect(theirs[0]!.reason).toContain(a.staff.displayName);
    expect(plan.counts.uncovered).toBeGreaterThanOrEqual(theirs.length);
    expect(new Set(plan.visits.map((v) => v.weekStart))).toEqual(new Set([wk(3), wk(4)]));
  });

  it("rolls four weeks forward in one go, one draft per week", async () => {
    const r = await confirmRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(3), weeks: 4 });
    expect(r.builds.map((b) => b.weekStart)).toEqual([wk(3), wk(4), wk(5), wk(6)]);
    for (const b of r.builds) expect(await db.visit.count({ where: { rotaBuildId: b.id } })).toBe(b.visits);
    expect(await dupes()).toBe(0);
    // Nobody on approved leave was booked into the new weeks.
    const clash = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "VisitAssignment" a JOIN "Visit" v ON v.id = a."visitId" JOIN "StaffAbsence" s ON s."staffId" = a."staffId" AND s.status = 'APPROVED' AND s."startsAt" < a."endsAt" AND s."endsAt" > a."startsAt" WHERE a."removedAt" IS NULL AND v."rotaBuildId" = ANY(${r.builds.map((b) => b.id)})`;
    expect(Number(clash[0]!.n)).toBe(0);
  });

  it("keeps a branch coordinator to their own branch", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
    const lpl = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    const r = await confirmRollForward(lpl, { sourceWeek: wk(1), targetWeek: wk(7), weeks: 1 });
    const outside = await db.visit.count({ where: { rotaBuildId: r.builds[0]!.id, NOT: { serviceUser: { branchId: branch.Liverpool } } } });
    expect(outside).toBe(0);
    const foreignCarers = await db.visitAssignment.count({ where: { visit: { rotaBuildId: r.builds[0]!.id }, staff: { branchId: { notIn: [branch.Liverpool!] } } } });
    expect(foreignCarers).toBe(0);
    // Tower Hamlets' part of week 7 is still there to roll forward for a manager.
    const rest = await previewRollForward(await manager(), { sourceWeek: wk(1), targetWeek: wk(7), weeks: 1 });
    expect(rest.visits.length).toBeGreaterThan(0);
    expect(rest.visits.every((v) => v.areaId === null || !r.plan.areaIds.includes(v.areaId))).toBe(true);
  });
});
