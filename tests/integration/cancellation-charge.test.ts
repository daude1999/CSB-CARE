import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { cancellationCharged } from "@/server/finance/runs";
import { bulkVisits, cancelVisit, reinstateVisit } from "@/server/rota/visits";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Cancelling a visit asks the office to charge or not charge (owner, 1 Nov 2026). The choice is saved on the visit, shown
 * in its history, cleared when the visit is reinstated, and decides whether the cancellation is invoiced.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const nextWeek = addDays(mondayOf(londonDate()), 7);

async function futureVisits(n: number) {
  return db.visit.findMany({ where: { organisationId: orgId, status: "SCHEDULED", date: { gte: dbDate(nextWeek) } }, orderBy: { scheduledStart: "asc" }, take: n });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("cancellation charge", () => {
  it("the office's choice decides the invoice; with no choice, the funder's short-notice rule does", () => {
    const start = new Date("2026-11-10T09:00:00Z");
    const early = new Date("2026-11-01T09:00:00Z");
    const late = new Date("2026-11-10T07:00:00Z");
    expect(cancellationCharged({ cancellationCharge: true, cancelledAt: early, scheduledStart: start }, 24)).toBe(true);
    expect(cancellationCharged({ cancellationCharge: false, cancelledAt: late, scheduledStart: start }, 24)).toBe(false);
    expect(cancellationCharged({ cancellationCharge: null, cancelledAt: late, scheduledStart: start }, 24)).toBe(true);
    expect(cancellationCharged({ cancellationCharge: null, cancelledAt: early, scheduledStart: start }, 24)).toBe(false);
    expect(cancellationCharged({ cancellationCharge: null, cancelledAt: late, scheduledStart: start }, null)).toBe(false);
  });

  it("saves the choice on a single cancel, records it in the history, and clears it on reinstating", async () => {
    const ctx = await manager();
    const [v] = await futureVisits(1);
    await cancelVisit(ctx, v!.id, "In hospital", undefined, true);
    let saved = await db.visit.findUniqueOrThrow({ where: { id: v!.id } });
    expect(saved.status).toBe("CANCELLED");
    expect(saved.cancellationCharge).toBe(true);
    expect(saved.cancelReason).toBe("In hospital");
    const event = await db.visitEvent.findFirstOrThrow({ where: { visitId: v!.id, toStatus: "CANCELLED" } });
    expect(event.reason).toBe("In hospital (charged)");

    await reinstateVisit(ctx, v!.id, "Home again");
    saved = await db.visit.findUniqueOrThrow({ where: { id: v!.id } });
    expect(saved.status).toBe("SCHEDULED");
    expect(saved.cancellationCharge).toBeNull();
  });

  it("saves Don't charge for every visit in a bulk cancel", async () => {
    const ctx = await manager();
    const visits = await futureVisits(3);
    const results = await bulkVisits(ctx, visits.map((v) => v.id), { kind: "cancel", reason: "Family visiting", charge: false });
    expect(results.every((r) => r.ok)).toBe(true);
    const saved = await db.visit.findMany({ where: { id: { in: visits.map((v) => v.id) } } });
    expect(saved.every((v) => v.status === "CANCELLED" && v.cancellationCharge === false)).toBe(true);
  });
});
