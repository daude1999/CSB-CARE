import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { londonDate } from "@/lib/london";
import { attentionQueue, missedFilters } from "@/server/rota/attention-queue";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { missedCallRegister } from "@/server/rota/missed-calls";
import { outstandingCommunication } from "@/server/rota/cover-communication";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Visits Needing Attention against a real database: the same totals as the pages it summarises, and the same permissions. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
}, 240_000);

describe("attention queue", () => {
  it("has the same totals as Unassigned Visits, Missed Calls and outstanding communication", async () => {
    const ctx = await coordinator();
    const now = new Date();
    const q = await attentionQueue(ctx, {}, now);
    const board = await unassignedBoard(ctx, parseUnassigned({ when: "week" }, londonDate(now)), now);
    const reg = await missedCallRegister(ctx, missedFilters(londonDate(now)), now);
    const comms = await outstandingCommunication(ctx, now);
    expect(q.counts.unassigned).toBe(board.summary.visits);
    expect(q.counts.missed).toBe(reg.rows.length);
    expect(q.counts.comms).toBe(comms.total);
    expect(q.items.filter((i) => i.type === "unassigned")).toHaveLength(board.all.length);
    expect(q.items.filter((i) => i.type === "missed")).toHaveLength(reg.rows.length);
    expect(q.counts.now).toBe(q.items.filter((i) => i.group === "now").length);
    expect(q.counts.unassigned + q.counts.missed).toBeGreaterThan(0);
    expect(new Set(q.items.map((i) => i.key)).size).toBe(q.items.length);
  });

  it("shows each kind of work only with its own permission", async () => {
    const ctx = await coordinator();
    // A compliance lead may view the rota and monitor calls but not edit: no communication items.
    const lead = await attentionQueue({ ...ctx, orgRoles: ["COMPLIANCE_LEAD"] });
    expect(lead.can).toMatchObject({ unassigned: true, missed: true, comms: false, edit: false });
    expect(lead.items.some((i) => i.type === "comms")).toBe(false);
  });

  it("ignores a branch the member may not pick", async () => {
    const ctx = await coordinator();
    const now = new Date();
    const all = await attentionQueue(ctx, {}, now);
    const odd = await attentionQueue(ctx, { branch: "not-a-branch" }, now);
    expect(odd.branch).toBeNull();
    expect(odd.counts).toEqual(all.counts);
  });
});
