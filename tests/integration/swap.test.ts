import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonToUtc } from "@/lib/london";
import { assignCarer } from "@/server/rota/assign";
import { swapCandidates, swapCarers } from "@/server/rota/swap";
import { createVisit } from "@/server/rota/visits";
import { saveRequirement } from "@/server/readiness";
import { rankCarers } from "@/server/workforce/eligibility";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Two-way shift swaps against a real database: both sides re-checked by the eligibility service, both rows locked,
 * all or nothing, with an audit trail. Each test books its own visits on a quiet future day so results are exact.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let day = "";
let callTypeId = "";
let serviceUsers: { id: string; areaId: string | null }[] = [];

async function liveCarer(visitId: string) {
  return (await db.visitAssignment.findFirst({ where: { visitId, slot: "PRIMARY", removedAt: null } }))?.staffId ?? null;
}

/** Carers who may be allocated (the demo's carers all carry readiness warnings) at every given time. */
async function eligibleAt(slots: { suId: string; start: number; minutes: number }[], exclude: string[] = []) {
  let pool: string[] | null = null;
  for (const s of slots) {
    const start = londonToUtc(day, s.start);
    const ranked = await rankCarers(db, orgId, { start, end: new Date(start.getTime() + s.minutes * 60000), slot: "PRIMARY", serviceUserId: s.suId, careTaskIds: [] });
    const ok = ranked.filter((r) => r.result.state !== "NOT_ELIGIBLE").map((r) => r.staff!.id);
    pool = pool ? pool.filter((id) => ok.includes(id)) : ok;
  }
  return (pool ?? []).filter((id) => !exclude.includes(id));
}

async function book(suId: string, start: number, staffId: string, minutes = 30) {
  const ctx = await manager();
  const v = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: start, durationMin: minutes });
  await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId, acceptWarnings: true });
  return db.visit.findUniqueOrThrow({ where: { id: v.id } });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  // A day five weeks out: nothing is built that far ahead, so the carers' diaries are empty.
  day = addDays(londonDate(), 35);
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  serviceUsers = await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, select: { id: true, areaId: true }, orderBy: { reference: "asc" }, take: 6 });
}, 180_000);

describe("two-way shift swap", () => {
  it("swaps two carers atomically, keeps both visits staffed and records who did it and why", async () => {
    const [su1, su2] = serviceUsers;
    const [a, b] = await eligibleAt([{ suId: su1!.id, start: 600, minutes: 30 }, { suId: su2!.id, start: 840, minutes: 30 }]);
    expect(a && b).toBeTruthy();
    const v1 = await book(su1!.id, 600, a!);
    const v2 = await book(su2!.id, 840, b!);

    const offered = await swapCandidates(await manager(), v1.id, "PRIMARY");
    expect(offered.map((o) => o.visitId)).toContain(v2.id);

    const r = await swapCarers(await manager(), { first: { visitId: v1.id, slot: "PRIMARY", lockVersion: v1.lockVersion }, second: { visitId: v2.id, slot: "PRIMARY", lockVersion: v2.lockVersion }, reason: "Carer asked to finish earlier", acceptWarnings: true });
    expect(r.first).toBe(v1.reference);
    expect(await liveCarer(v1.id)).toBe(b);
    expect(await liveCarer(v2.id)).toBe(a);
    // The old bookings are kept as history, not deleted.
    const old = await db.visitAssignment.findMany({ where: { visitId: { in: [v1.id, v2.id] }, removedAt: { not: null } } });
    expect(old.map((o) => o.removeReason)).toEqual(["Swapped: Carer asked to finish earlier", "Swapped: Carer asked to finish earlier"]);
    expect(await db.visitEvent.count({ where: { visitId: { in: [v1.id, v2.id] }, type: "SWAPPED" } })).toBe(2);
    const log = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "visit.swapped", entityId: v1.id } });
    expect(log.data).toMatchObject({ reason: "Carer asked to finish earlier", acceptWarnings: true });
  });

  it("refuses a swap that would double-book a carer, and changes nothing", async () => {
    const [su1, su2, su3] = serviceUsers;
    const [c, d] = await eligibleAt([{ suId: su1!.id, start: 300, minutes: 30 }, { suId: su3!.id, start: 300, minutes: 30 }, { suId: su2!.id, start: 1200, minutes: 30 }]);
    // c is booked at 05:00 for su3 and at 20:00 for su2; d is booked at 05:00 for su1.
    await book(su3!.id, 300, c!);
    const late = await book(su2!.id, 1200, c!);
    const early = await book(su1!.id, 300, d!);
    // Swapping c's 20:00 visit with d's 05:00 visit would put c at 05:00 twice.
    await expect(swapCarers(await manager(), { first: { visitId: late.id, slot: "PRIMARY" }, second: { visitId: early.id, slot: "PRIMARY" }, reason: "Test overlap", acceptWarnings: true })).rejects.toThrow(/Swap refused: .* (cannot take|is already booked)/);
    expect(await liveCarer(late.id)).toBe(c);
    expect(await liveCarer(early.id)).toBe(d);
    expect(await db.visitEvent.count({ where: { visitId: { in: [late.id, early.id] }, type: "SWAPPED" } })).toBe(0);
  });

  it("refuses a swap when one carer lacks training the other visit needs, naming who and why", async () => {
    const [, , , su4, su5] = serviceUsers;
    const [e, f] = await eligibleAt([{ suId: su4!.id, start: 420, minutes: 30 }, { suId: su5!.id, start: 1020, minutes: 30 }]);
    const v4 = await book(su4!.id, 420, e!);
    const v5 = await book(su5!.id, 1020, f!);
    // su5 now needs specific training that nobody has recorded.
    await saveRequirement(await manager(), { key: "peg-feeding-su5", name: "PEG feeding (person-specific)", category: "TRAINING", effectiveFrom: londonDate(), hardStop: true, scopes: [{ kind: "SERVICE_USER", serviceUserId: su5!.id }] });
    const name = (await db.staffMember.findUniqueOrThrow({ where: { id: e! } })).displayName;
    await expect(swapCarers(await manager(), { first: { visitId: v4.id, slot: "PRIMARY" }, second: { visitId: v5.id, slot: "PRIMARY" }, reason: "Cover request", acceptWarnings: true })).rejects.toThrow(new RegExp(`${name} cannot take ${v5.reference}.*PEG feeding`));
    expect(await liveCarer(v4.id)).toBe(e);
    expect(await liveCarer(v5.id)).toBe(f);
  });

  it("lets only one of two coordinators' overlapping swaps win, leaving every visit with exactly one carer", async () => {
    const [su1, su2, su3] = serviceUsers;
    const [g, h, i] = await eligibleAt([{ suId: su1!.id, start: 660, minutes: 30 }, { suId: su2!.id, start: 720, minutes: 30 }, { suId: su3!.id, start: 780, minutes: 30 }]);
    const x = await book(su1!.id, 660, g!);
    const y = await book(su2!.id, 720, h!);
    const z = await book(su3!.id, 780, i!);
    const ctx = await manager();
    const results = await Promise.allSettled([
      swapCarers(ctx, { first: { visitId: x.id, slot: "PRIMARY", lockVersion: x.lockVersion }, second: { visitId: y.id, slot: "PRIMARY", lockVersion: y.lockVersion }, reason: "Coordinator one", acceptWarnings: true }),
      swapCarers(ctx, { first: { visitId: y.id, slot: "PRIMARY", lockVersion: y.lockVersion }, second: { visitId: z.id, slot: "PRIMARY", lockVersion: z.lockVersion }, reason: "Coordinator two", acceptWarnings: true }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    for (const v of [x, y, z]) expect(await db.visitAssignment.count({ where: { visitId: v.id, slot: "PRIMARY", removedAt: null } })).toBe(1);
    const carers = await Promise.all([x, y, z].map((v) => liveCarer(v.id)));
    expect(new Set(carers).size).toBe(3);
  });

  it("is refused to people without rota edit rights and to visits outside the caller's organisation", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const any = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED" } });
    await expect(swapCarers(carer, { first: { visitId: any.id, slot: "PRIMARY" }, second: { visitId: any.id, slot: "SECOND" }, reason: "Not allowed" })).rejects.toThrow(ForbiddenError);
    await expect(swapCarers(await manager(), { first: { visitId: any.id, slot: "PRIMARY" }, second: { visitId: any.id, slot: "PRIMARY" }, reason: "Same" })).rejects.toThrow(ValidationError);
    const other = await db.visit.findFirst({ where: { organisationId: { not: orgId } } });
    if (other) await expect(swapCarers(await manager(), { first: { visitId: any.id, slot: "PRIMARY" }, second: { visitId: other.id, slot: "PRIMARY" }, reason: "Other organisation" })).rejects.toThrow(/not found/i);
    await expect(swapCarers(await manager(), { first: { visitId: any.id, slot: "PRIMARY" }, second: { visitId: "x", slot: "PRIMARY" }, reason: "" })).rejects.toThrow(/reason/i);
  });
});
