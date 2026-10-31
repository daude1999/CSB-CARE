import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { recordAbsence } from "@/server/workforce/absences";
import { assignCarer } from "@/server/rota/assign";
import { coverBoard } from "@/server/rota/cover";
import { visitCandidatesMany } from "@/server/rota/queries";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Sickness and holiday cover: an absence flags the absent carer's bookings (never moves them), the cover board lists
 * them with ranked replacements, and choosing one goes through the normal assignment path. Branch limits apply.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};
const wk = (n: number) => addDays(mondayOf(londonDate()), n * 7);

async function bookedCarer(branchName: string) {
  return db.visitAssignment.findFirstOrThrow({
    where: { removedAt: null, slot: "PRIMARY", staff: { branchId: branch[branchName] }, visit: { organisationId: orgId, date: dbDate(addDays(wk(1), 2)), status: "SCHEDULED", carersRequired: 1 } },
    include: { staff: true, visit: true },
    orderBy: { startsAt: "asc" },
  });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
}, 180_000);

describe("sickness and holiday cover", () => {
  let a: Awaited<ReturnType<typeof bookedCarer>>;

  it("lists the bookings of a carer who goes off sick, without moving them", async () => {
    a = await bookedCarer("Tower Hamlets");
    const day = londonDate(a.visit.scheduledStart);
    await recordAbsence(await manager(), { staffId: a.staffId, kind: "SICKNESS", from: day, to: day, reason: "Flu" });
    // HR changes flag visits and never reassign them.
    const still = await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(still.removedAt).toBeNull();
    expect(still.reviewReason).toBeTruthy();

    const board = await coverBoard(await manager(), { from: wk(1), days: 7 });
    const abs = board.absences.find((x) => x.staffId === a.staffId)!;
    expect(abs.kind).toBe("SICKNESS");
    const item = abs.items.find((i) => i.visit.id === a.visitId)!;
    expect(item.reason).toContain(a.staff.displayName);
    expect(item.reason).toContain("sickness");
    // Listed once, under the absence, not again as a general HR flag.
    expect(board.flagged.some((i) => i.visit.id === a.visitId)).toBe(false);
    expect(board.counts.bookings).toBe(board.items.length);
  });

  it("filters by absence type", async () => {
    const holidays = await coverBoard(await manager(), { from: wk(1), days: 7, kind: "HOLIDAY" });
    expect(holidays.absences.some((x) => x.staffId === a.staffId)).toBe(false);
    expect(holidays.flagged).toHaveLength(0);
  });

  it("ranks replacements the rules allow and replaces the absent carer through the normal path", async () => {
    const mgr = await manager();
    const board = await coverBoard(mgr, { from: wk(1), days: 7 });
    const item = board.items.find((i) => i.visit.id === a.visitId)!;
    const list = (await visitCandidatesMany(mgr, [{ visit: item.visit, slot: "PRIMARY" }])).get(a.visitId)!;
    // The absent carer can never be offered with a score; a score never beats a failed rule.
    const self = list.find((c) => c.id === a.staffId);
    expect(self?.state).toBe("NOT_ELIGIBLE");
    expect(self?.score).toBeNull();
    const pick = list.find((c) => c.score !== null && c.id !== a.staffId)!;
    expect(pick).toBeDefined();
    expect(list.filter((c) => c.score !== null).every((c, i, xs) => i === 0 || (xs[i - 1]!.score ?? 0) >= (c.score ?? 0) || xs[i - 1]!.state !== c.state)).toBe(true);

    await assignCarer(mgr, { visitId: a.visitId, slot: "PRIMARY", staffId: pick.id, acceptWarnings: true, lockVersion: item.visit.lockVersion });
    const live = await db.visitAssignment.findFirstOrThrow({ where: { visitId: a.visitId, slot: "PRIMARY", removedAt: null } });
    expect(live.staffId).toBe(pick.id);
    expect(await db.rotaAlert.count({ where: { assignmentId: a.id, resolvedAt: null } })).toBe(0);
    expect(await db.visitEvent.count({ where: { visitId: a.visitId, type: "REASSIGNED" } })).toBeGreaterThan(0);
    const after = await coverBoard(mgr, { from: wk(1), days: 7 });
    expect(after.items.some((i) => i.visit.id === a.visitId)).toBe(false);
  });

  it("keeps a branch coordinator to their own branch's absences and visits", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
    const lpl = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    const board = await coverBoard(lpl, { from: wk(1), days: 7 });
    expect(board.absences.some((x) => x.staffId === a.staffId)).toBe(false);
    const ids = board.items.map((i) => i.visit.serviceUserId);
    const outside = await db.serviceUser.count({ where: { id: { in: ids }, branchId: { not: branch.Liverpool } } });
    expect(outside).toBe(0);
    // A Liverpool carer's sickness shows up for them.
    const l = await bookedCarer("Liverpool");
    const day = londonDate(l.visit.scheduledStart);
    await recordAbsence(await manager(), { staffId: l.staffId, kind: "SICKNESS", from: day, to: day });
    const mine = await coverBoard(lpl, { from: wk(1), days: 7 });
    expect(mine.absences.find((x) => x.staffId === l.staffId)?.items.some((i) => i.visit.id === l.visitId)).toBe(true);
  });
});
