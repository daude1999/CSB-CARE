import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { londonDate } from "@/lib/london";
import { attentionQueue, missedFilters } from "@/server/rota/attention-queue";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { missedCallRegister } from "@/server/rota/missed-calls";
import { outstandingCommunication } from "@/server/rota/cover-communication";
import { coverBoard } from "@/server/rota/cover";
import { listExceptions } from "@/server/rota/exceptions";
import { ABSENT_DAYS, PROBLEM_KINDS_ELSEWHERE } from "@/server/rota/attention-queue";
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

  it("is the one to-do list: carer-off bookings and visit problems from their registers, nothing listed twice", async () => {
    const ctx = await coordinator();
    const now = new Date();
    const q = await attentionQueue(ctx, {}, now);
    const cover = await coverBoard(ctx, { from: londonDate(now), days: ABSENT_DAYS }, now);
    expect(q.counts.absent).toBe(cover.items.length);
    expect(q.items.filter((i) => i.type === "absent")).toHaveLength(cover.items.length);
    const ex = await listExceptions(ctx, { state: "open" }, { take: 300 });
    const expected = ex.rows.filter((r) => r.visitId && !PROBLEM_KINDS_ELSEWHERE.has(r.kind));
    const problems = q.items.filter((i) => i.type === "problem");
    expect(problems.length).toBeLessThanOrEqual(expected.length);
    expect(q.counts.problem).toBe(problems.length);
    // A missed call is listed once, as a missed call, never again as a visit problem.
    for (const p of problems) if (p.type === "problem") expect(PROBLEM_KINDS_ELSEWHERE.has(p.kind)).toBe(false);
    // A carer-off booking is not listed again as an allocation to review.
    const absent = new Set(q.items.flatMap((i) => (i.type === "absent" ? [i.visitId] : [])));
    for (const p of problems) if (p.type === "problem" && p.kind === "ALLOCATION_REVIEW") expect(absent.has(p.visitId)).toBe(false);
    // Every item has its own key, so selecting one never opens another.
    expect(new Set(q.items.map((i) => i.key)).size).toBe(q.items.length);
  });

  it("shows each kind of work only with its own permission", async () => {
    const ctx = await coordinator();
    // A compliance lead may view the rota and monitor calls but not edit: no communication items.
    const lead = await attentionQueue({ ...ctx, orgRoles: ["COMPLIANCE_LEAD"] });
    expect(lead.can).toMatchObject({ unassigned: true, absent: true, missed: true, problem: true, comms: false, edit: false });
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
