import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { dbDate, londonDate } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { rotaSnapshot } from "@/server/overview/snapshot";
import { rotaHeadline } from "@/server/rota/summary";
import { rotaDashboard } from "@/server/rota/dashboard";
import { listVisits } from "@/server/rota/queries";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Rostering & Care Management card on the Overview (owner-approved design, 1 Nov 2026) shows five figures for
 * today. Each must agree with the Rota Dashboard and Daily Rota for the same person, within their branch grants.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
  await setMemberBranches(await manager(), m.id, [liverpool.id]);
}, 180_000);

describe("Overview Rota figures", () => {
  it("match the Rota Dashboard and Daily Rota for today", async () => {
    for (const ctx of [await manager(), await coordinator()]) {
      const [snap, head, dash, list] = await Promise.all([rotaSnapshot(ctx), rotaHeadline(ctx), rotaDashboard(ctx, {}), listVisits(ctx, { date: londonDate() }, 6000)]);
      expect(snap && head).toBeTruthy();
      const live = list.rows.filter((v) => v.status !== "CANCELLED");
      expect(snap!.completedToday).toBe(live.filter((v) => v.status === "COMPLETED").length);
      expect(snap!.pendingToday).toBe(live.filter((v) => v.status === "SCHEDULED").length);
      // Only visits confirmed as missed: a late visit still waiting for a clock-in is not counted.
      expect(snap!.missedToday).toBe(dash.calls.missed);
      expect(snap!.staffOnRota).toBe(dash.calls.staffOnDuty);
      // The same figure as the "Unassigned visits today" row in Needs your attention.
      expect(head!.unassignedToday).toBe(live.filter((v) => !["COMPLETED", "NOT_DELIVERED"].includes(v.status) && v.flags.unassignedSlots > 0).length);
    }
  });

  it("are limited to the person's branches and organisation", async () => {
    const [all, liverpoolOnly] = await Promise.all([rotaSnapshot(await manager()), rotaSnapshot(await coordinator())]);
    expect(liverpoolOnly!.staffOnRota).toBeLessThanOrEqual(all!.staffOnRota);
    expect(liverpoolOnly!.completedToday + liverpoolOnly!.pendingToday + liverpoolOnly!.missedToday).toBeLessThanOrEqual(all!.completedToday + all!.pendingToday + all!.missedToday);
    // Another organisation's figures come only from its own visits.
    const oakridge = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const other = await rotaSnapshot(oakridge);
    const own = await db.visit.count({ where: { organisationId: oakridge.organisationId!, date: dbDate(londonDate()), status: "COMPLETED" } });
    expect(other?.completedToday ?? 0).toBe(own);
  });

  it("are hidden from people who may not see the rota", async () => {
    expect(await rotaSnapshot(await ctxFor("carer@care-solution.demo", BROOKFIELD))).toBeNull();
    expect(await rotaHeadline(await ctxFor("carer@care-solution.demo", BROOKFIELD))).toBeNull();
  });
});
