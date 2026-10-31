import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { coverageOf, deliveryState, rotaActivity, rotaOverview, visitKpis } from "@/server/rota/overview";
import { visitInspector } from "@/server/rota/inspector";
import { listVisits, rotaLookups } from "@/server/rota/queries";
import { rotaSearch } from "@/server/rota/search";
import { assignCarer } from "@/server/rota/assign";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The final Rota Dashboard and Daily Rota (owner's brief, 31 Oct 2026): every figure reconciles with the visit list it
 * links to, the two screens agree, branch-limited coordinators see nothing from another branch, and there is no money.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};
let liverpool: () => ReturnType<typeof manager>;
const nextWed = addDays(mondayOf(londonDate()), 9);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
  await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
  liverpool = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
}, 180_000);

describe("Rota Dashboard figures", () => {
  it("reconcile with the Daily Rota list for the same day and branch", async () => {
    for (const ctx of [await manager(), await liverpool()]) {
      for (const date of [londonDate(), nextWed]) {
        const o = await rotaOverview(ctx, { date, period: "day" });
        const { rows } = await listVisits(ctx, { date }, 6000);
        expect(o.kpis.scheduled.value).toBe(rows.length);
        expect(o.kpis.completed.value).toBe(rows.filter((v) => v.status === "COMPLETED").length);
        expect(o.kpis.unassigned.value).toBe(rows.filter((v) => v.flags.unassignedSlots > 0).length);
        expect(o.kpis.missed.value).toBe(rows.filter((v) => v.status === "MISSED").length);
        // The same shared helper drives the Daily Rota tiles.
        const k = visitKpis(rows);
        expect([k.total, k.completed, k.unassigned, k.missed, k.late]).toEqual([o.kpis.scheduled.value, o.kpis.completed.value, o.kpis.unassigned.value, o.kpis.missed.value, o.kpis.late.value]);
      }
    }
  });

  it("puts every visit in exactly one performance state and one coverage state", async () => {
    const o = await rotaOverview(await manager(), { date: nextWed, period: "week" });
    const s = o.performance.states;
    expect(s.completed + s.inProgress + s.due + s.missed + s.notDelivered).toBe(o.performance.total);
    expect(o.performance.total).toBe(o.kpis.scheduled.value);
    for (const d of o.coverage) expect(d.full + d.partial + d.none).toBe(d.total);
    const { rows } = await listVisits(await manager(), { date: nextWed }, 6000);
    const day = o.coverage.find((d) => d.date === nextWed)!;
    expect(day.total).toBe(rows.filter((v) => v.status !== "NOT_DELIVERED").length);
    expect(day.notBuilt).toBe(false);
    expect(deliveryState("CANCELLED")).toBeNull();
    expect(coverageOf({ carersRequired: 2, assignments: [{ slot: "PRIMARY" }, { slot: "SHADOW" }] })).toBe("partial");
  });

  it("marks far-off unbuilt days as not built, and the needs-attention total counts each visit once", async () => {
    const far = addDays(mondayOf(londonDate()), 7 * 9);
    const o = await rotaOverview(await manager(), { date: far, period: "day" });
    expect(o.coverage.every((d) => d.notBuilt && d.total === 0)).toBe(true);
    const t = await rotaOverview(await manager(), { date: londonDate(), period: "day" });
    expect(t.attention.total).toBeLessThanOrEqual(t.attention.missed + t.attention.unassigned + t.attention.partial + t.attention.late + t.attention.readiness);
  });

  it("carries no money", async () => {
    const o = await rotaOverview(await manager(), { date: nextWed, period: "week" });
    const json = JSON.stringify(o);
    expect(json).not.toMatch(/pence|revenue|margin|cost|£/i);
  });

  it("keeps a branch coordinator to their own branch, even when another branch is asked for", async () => {
    const all = await rotaOverview(await manager(), { date: nextWed, period: "day" });
    const lv = await rotaOverview(await liverpool(), { date: nextWed, period: "day" });
    expect(lv.branches.map((b) => b.id)).toEqual([branch.Liverpool]);
    expect(lv.kpis.scheduled.value).toBeLessThan(all.kpis.scheduled.value);
    // Asking for Tower Hamlets is ignored: the figures stay Liverpool's.
    const sneaky = await rotaOverview(await liverpool(), { date: nextWed, period: "day", branch: branch["Tower Hamlets"] });
    expect(sneaky.branch).toBeNull();
    expect(sneaky.kpis.scheduled.value).toBe(lv.kpis.scheduled.value);
    // The Daily Rota's branch filter matches nothing for a branch the member may not pick.
    expect((await listVisits(await liverpool(), { date: nextWed, branchId: branch["Tower Hamlets"] })).rows).toHaveLength(0);
    // A manager's branch filter gives that branch's visits only, and branch figures add up to the whole.
    let sum = 0;
    for (const id of Object.values(branch)) {
      const { rows } = await listVisits(await manager(), { date: nextWed, branchId: id }, 6000);
      const ids = new Set((await db.visit.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { serviceUser: { select: { branchId: true } } } })).map((v) => v.serviceUser.branchId));
      expect([...ids].every((b) => b === id)).toBe(true);
      sum += (await rotaOverview(await manager(), { date: nextWed, period: "day", branch: id })).kpis.scheduled.value;
    }
    const unbranched = await db.visit.count({ where: { organisationId: orgId, date: new Date(`${nextWed}T00:00:00Z`), status: { not: "CANCELLED" }, serviceUser: { branchId: null } } });
    expect(sum + unbranched).toBe(all.kpis.scheduled.value);
    // Lookups offer only the member's own branch.
    expect((await rotaLookups(await liverpool())).branches.map((b) => b.id)).toEqual([branch.Liverpool]);
  });
});

describe("Recent rota activity", () => {
  it("records a real change, newest first, and a branch coordinator never sees another branch's visits", async () => {
    const ctx = await manager();
    const { rows } = await listVisits(ctx, { date: nextWed, unassigned: true }, 6000);
    const v = rows.find((r) => r.status === "SCHEDULED");
    if (v) {
      const lk = await rotaLookups(ctx);
      for (const s of lk.staff) {
        try {
          await assignCarer(ctx, { visitId: v.id, slot: v.assignments.some((a) => a.slot === "PRIMARY") ? "SECOND" : "PRIMARY", staffId: s.id, acceptWarnings: true });
          break;
        } catch {
          // Not eligible for this visit; try the next carer.
        }
      }
      const a = await rotaActivity(ctx, { take: 5 });
      expect(a.rows[0]!.at.getTime()).toBeGreaterThanOrEqual(a.rows[a.rows.length - 1]!.at.getTime());
    }
    const lv = await rotaActivity(await liverpool(), { take: 200 });
    const visitIds = lv.rows.filter((r) => r.href.startsWith("/rota/visits/")).map((r) => r.href.split("/").pop()!);
    const branches = new Set((await db.visit.findMany({ where: { id: { in: visitIds } }, select: { serviceUser: { select: { branchId: true } } } })).map((x) => x.serviceUser.branchId));
    expect([...branches].every((b) => b === branch.Liverpool || b === null)).toBe(true);
    // Whole-rota events cover every branch, so a branch coordinator does not get them.
    expect(lv.rows.some((r) => r.href === "/rota/build")).toBe(false);
    // Search narrows by reference.
    const any = (await rotaActivity(ctx, { take: 1 })).rows[0];
    if (any?.href.startsWith("/rota/visits/")) {
      const ref = any.details.split(" ")[0]!;
      expect((await rotaActivity(ctx, { q: ref, take: 50 })).rows.every((r) => r.details.startsWith(ref))).toBe(true);
    }
  });
});

describe("Visit Details panel and rostering search", () => {
  it("loads a visit with its choices for an editor, nothing for a visit in another branch or organisation", async () => {
    const ctx = await manager();
    const { rows } = await listVisits(ctx, { date: nextWed }, 6000);
    const mine = rows.find((r) => r.status === "SCHEDULED")!;
    const data = await visitInspector(ctx, mine.id);
    expect(data?.visit.reference).toBe(mine.reference);
    expect(data?.editable).toBe(true);
    expect(data?.candidates.length).toBe(mine.carersRequired > 1 ? 2 : 1);
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, serviceUser: { branchId: branch["Tower Hamlets"] } } });
    expect(await visitInspector(await liverpool(), other.id)).toBeNull();
    const foreign = await db.visit.findFirst({ where: { organisation: { slug: OAKRIDGE } } });
    if (foreign) expect(await visitInspector(ctx, foreign.id)).toBeNull();
    expect(await visitInspector(ctx, "not-a-visit")).toBeNull();
  });

  it("searches service users, team members and references within the member's scope", async () => {
    const ctx = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"] } });
    const hit = await rotaSearch(ctx, su.lastName);
    expect(hit.serviceUsers.some((s) => s.id === su.id)).toBe(true);
    const lv = await rotaSearch(await liverpool(), su.lastName);
    expect(lv.serviceUsers.some((s) => s.id === su.id)).toBe(false);
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, serviceUser: { branchId: branch["Tower Hamlets"] } } });
    expect((await rotaSearch(ctx, v.reference)).visits.map((x) => x.id)).toContain(v.id);
    expect((await rotaSearch(await liverpool(), v.reference)).visits.map((x) => x.id)).not.toContain(v.id);
    expect((await rotaSearch(ctx, "a")).serviceUsers).toHaveLength(0);
    const foreign = await db.serviceUser.findFirst({ where: { organisation: { slug: OAKRIDGE } } });
    if (foreign) expect((await rotaSearch(ctx, foreign.lastName)).serviceUsers.some((s) => s.id === foreign.id)).toBe(false);
  });
});
