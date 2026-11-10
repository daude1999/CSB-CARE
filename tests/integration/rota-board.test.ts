import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { assignCarer, EligibilityError } from "@/server/rota/assign";
import { canMove, needsCarer, pendingMove, staffDay, visitDrawer } from "@/server/rota/board";
import { listVisits, rotaLookups } from "@/server/rota/queries";
import { boardData } from "@/app/(app)/rota/visits/board-data";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Daily Rota Board and its visit drawer (approved redesign, 10 Nov 2026), on synthetic visits on a day the demo
 * seed does not use so every figure can be checked by hand. The board only reads; a move goes through assignCarer.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const DAY = addDays(londonDate(), 40);
let orgId = "";
let managerId = "";
let suId = "";
let areaId = "";
const call: Record<string, string> = {};
const branch: Record<string, string> = {};
const staff: { id: string; displayName: string }[] = [];
const ids: Record<string, string> = {};

async function visit(key: string, startMin: number, opts: { callType?: string; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED"; carers?: number; tasks?: string[] } = {}) {
  const v = await db.visit.create({
    data: { organisationId: orgId, reference: `B-${key}`, serviceUserId: suId, callTypeId: call[opts.callType ?? "Morning call"]!, areaId, date: dbDate(DAY), scheduledStart: londonToUtc(DAY, startMin), scheduledEnd: londonToUtc(DAY, startMin + 45), carersRequired: opts.carers ?? 1, status: opts.status ?? "SCHEDULED", publishedAt: new Date(), ...(opts.status === "CANCELLED" ? { cancelReason: "In hospital", cancelledAt: new Date() } : {}), tasks: { create: (opts.tasks ?? []).map((name, i) => ({ name, position: i })) } },
  });
  ids[key] = v.id;
}
async function book(key: string, staffId: string, extra: { slot?: "PRIMARY" | "SECOND"; eligibility?: string; warningsAccepted?: string[] } = {}) {
  const v = await db.visit.findUniqueOrThrow({ where: { id: ids[key]! } });
  await db.visitAssignment.create({ data: { organisationId: orgId, visitId: v.id, slot: extra.slot ?? "PRIMARY", staffId, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: extra.eligibility ?? "ELIGIBLE", warningsAccepted: extra.warningsAccepted ?? [], assignedById: managerId } });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
  for (const c of await db.callType.findMany({ where: { organisationId: orgId } })) call[c.name] = c.id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], areaId: { not: null }, status: "ACTIVE" } });
  suId = su.id;
  areaId = su.areaId!;
  staff.push(...(await db.staffMember.findMany({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" }, take: 3, select: { id: true, displayName: true } })));

  await visit("m1", 7 * 60, { status: "COMPLETED", tasks: ["Personal care", "Breakfast"] });
  await book("m1", staff[0]!.id);
  await visit("m2", 8 * 60);
  await book("m2", staff[0]!.id, { eligibility: "REQUIRES_REVIEW", warningsAccepted: ["Synthetic warning accepted for the test"] });
  await visit("l1", 12 * 60, { callType: "Lunch call", carers: 2 });
  await book("l1", staff[1]!.id);
  await visit("l2", 13 * 60, { callType: "Lunch call" });
  await visit("x1", 14 * 60, { callType: "Lunch call", status: "CANCELLED" });
  await book("x1", staff[1]!.id);
}, 180_000);

describe("Daily Rota Board", () => {
  it("puts visits short of a carer first, then team members by number of visits, with real counts and hours", async () => {
    const ctx = await manager();
    const { rows: visits } = await listVisits(ctx, { date: DAY, includeCancelled: true });
    const b = boardData(visits, { date: DAY, today: londonDate(), canEdit: true });
    expect(b.rows.map((r) => [r.name, r.sub, r.blocks.length])).toEqual([
      ["Needs a carer", "2 visits", 2],
      [staff[0]!.displayName, "2 visits · 1.5 h", 2],
      // The cancelled visit stays on the row but is not counted in visits or hours.
      [staff[1]!.displayName, "1 visit · 0.8 h", 2],
    ]);
    expect(b.footer).toEqual({ visits: 4, completed: 1, toCome: 3, needs: 2, carers: 2 });
    expect(b.rounds.map((r) => r.name)).toEqual(["Morning call", "Lunch call"]);
    // 08:45 to 12:00 has no visits, so it is folded.
    expect(b.segments.filter((s) => s.folded)).toEqual([{ from: 9 * 60, to: 12 * 60, folded: true }]);
    expect(b.nowMin).toBeNull();
  });

  it("gives every block a full accessible name and the approved tones", async () => {
    const { rows: visits } = await listVisits(await manager(), { date: DAY, includeCancelled: true });
    const b = boardData(visits, { date: DAY, today: londonDate(), canEdit: true });
    const all = b.rows.flatMap((r) => r.blocks);
    const m1 = all.find((x) => x.id === ids.m1)!;
    expect(m1.tone).toBe("done");
    expect(m1.label).toMatch(new RegExp(`, Morning call, 07:00 for 45 minutes, carer ${staff[0]!.displayName}, Completed, reference B-m1$`));
    const needs = b.rows[0]!.blocks;
    expect(needs.every((x) => x.tone === "needs")).toBe(true);
    expect(needs.find((x) => x.id === ids.l1)!.double).toBe(true);
    expect(needs.find((x) => x.id === ids.l2)!.label).toContain("no carer booked");
    // The move carries the open place and the visit's current version, so a stale drag is refused.
    expect(needs.find((x) => x.id === ids.l1)!.move).toEqual({ slot: "SECOND", lockVersion: visits.find((v) => v.id === ids.l1)!.lockVersion });
    expect(all.find((x) => x.id === ids.x1 && x.tone === "cancelled")!.move).toBeUndefined();
    // Completed visits cannot be dragged; someone without rota.edit can drag nothing.
    expect(m1.move).toBeUndefined();
    expect(boardData(visits, { date: DAY, today: londonDate(), canEdit: false }).rows.flatMap((r) => r.blocks).some((x) => x.move || x.reassignHref)).toBe(false);
  });

  it("shares its grouping with the Advanced Rota planner", async () => {
    const { rows: visits } = await listVisits(await manager(), { date: DAY });
    expect(needsCarer(visits).map((n) => [n.visit.reference, n.place])).toEqual([["B-l1", "SECOND"], ["B-l2", "PRIMARY"]]);
    expect(staffDay(visits).map((s) => [s.name, s.visits, s.minutes]).sort()).toEqual([[staff[0]!.displayName, 2, 90], [staff[1]!.displayName, 1, 45]].sort());
    expect(canMove({ status: "SCHEDULED" }, true)).toBe(true);
    expect(canMove({ status: "COMPLETED" }, true)).toBe(false);
    expect(canMove({ status: "SCHEDULED" }, false)).toBe(false);
  });

  it("only accepts a pending move for a visit on the page and a team member the caller can see", async () => {
    const ctx = await manager();
    const [{ rows: visits }, lk] = await Promise.all([listVisits(ctx, { date: DAY }), rotaLookups(ctx)]);
    expect(pendingMove(`${ids.l2}~PRIMARY~${staff[2]!.id}~0`, visits, lk.staff)).toMatchObject({ visitId: ids.l2, staffId: staff[2]!.id, staff: staff[2]!.displayName });
    expect(pendingMove(`not-a-visit~PRIMARY~${staff[2]!.id}~0`, visits, lk.staff)).toBeNull();
    expect(pendingMove(`${ids.l2}~PRIMARY~not-staff~0`, visits, lk.staff)).toBeNull();
    expect(pendingMove(undefined, visits, lk.staff)).toBeNull();
  });

  it("a move still goes through the eligibility service: an overlapping booking is refused", async () => {
    const ctx = await manager();
    await visit("clash", 7 * 60 + 15);
    await expect(assignCarer(ctx, { visitId: ids.clash!, slot: "PRIMARY", staffId: staff[0]!.id })).rejects.toBeInstanceOf(EligibilityError);
    expect(await db.visitAssignment.count({ where: { visitId: ids.clash!, removedAt: null } })).toBe(0);
  });
});

describe("visit drawer", () => {
  it("shows the visit's care tasks and only what eligibility and matching really returned", async () => {
    const d = (await visitDrawer(await manager(), ids.m2!))!;
    expect(d.tasks).toEqual([]);
    expect(d.why).toHaveLength(1);
    expect(d.why[0]).toMatchObject({ name: staff[0]!.displayName, eligibility: "REQUIRES_REVIEW", warningsAccepted: ["Synthetic warning accepted for the test"] });
    expect(d.why[0]!.match[0]!.text).toBe("allowed, with warnings to read");
    const done = (await visitDrawer(await manager(), ids.m1!))!;
    expect(done.tasks).toEqual([{ name: "Personal care", outcome: null }, { name: "Breakfast", outcome: null }]);
    expect(done.why[0]!.match.some((m) => m.text === "passes every check")).toBe(true);
  });

  it("leaves 'Why this carer' empty when nobody is booked", async () => {
    expect((await visitDrawer(await manager(), ids.l2!))!.why).toEqual([]);
  });

  it("never returns another organisation's visit, another branch's visit, or one that does not exist", async () => {
    expect(await visitDrawer(await ctxFor("manager@oakridge.demo", OAKRIDGE), ids.m1!)).toBeNull();
    expect(await visitDrawer(await manager(), "does-not-exist")).toBeNull();
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
    expect(await visitDrawer(await coordinator(), ids.m1!)).toBeNull();
    const { rows } = await listVisits(await coordinator(), { date: DAY });
    expect(rows).toEqual([]);
  });
});
