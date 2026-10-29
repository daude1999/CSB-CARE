import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { rotaDashboard } from "@/server/rota/dashboard";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** The Rota dashboard's call boxes, lists and counters, counted from the seeded demo records. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("rota dashboard", () => {
  it("counts a past day's calls from the visit records", async () => {
    const day = addDays(mondayOf(londonDate()), -7);
    const d = await rotaDashboard(await manager(), { date: day });
    const where = { organisationId: orgId, date: dbDate(day) };
    expect(d.calls.total).toBe(await db.visit.count({ where: { ...where, status: { not: "CANCELLED" } } }));
    expect(d.calls.complete).toBe(await db.visit.count({ where: { ...where, status: "COMPLETED" } }));
    expect(d.calls.missed).toBe(await db.visit.count({ where: { ...where, status: "MISSED" } }));
    expect(d.calls.complete).toBeGreaterThan(0);
    expect(d.calls.late).toBeLessThanOrEqual(d.calls.total);
  });

  it("lists people and reminders only for those allowed to see them, most urgent reminder first", async () => {
    const d = await rotaDashboard(await manager(), {});
    expect(d.serviceUsers.length).toBeGreaterThan(0);
    expect(d.team.length).toBeGreaterThan(0);
    expect(d.reminders.map((r) => r.due)).toEqual([...d.reminders.map((r) => r.due)].sort());
    const finance = await rotaDashboard(await ctxFor("coordinator@care-solution.demo", BROOKFIELD), {}).catch((e) => e);
    expect(finance).not.toBeInstanceOf(Error);
  });

  it("counts template conflicts and refuses people without the rota permission", async () => {
    const d = await rotaDashboard(await manager(), {});
    const open = await db.visitTemplate.count({ where: { organisationId: orgId, enabled: true, preferredStaff1Id: null } });
    expect(d.counters.templateConflicts).toBeGreaterThanOrEqual(open);
    await expect(rotaDashboard(await ctxFor("carer@care-solution.demo", BROOKFIELD), {})).rejects.toThrow(ForbiddenError);
  });
});
