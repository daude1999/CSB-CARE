import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, fromDbDate, londonDate, mondayOf } from "@/lib/london";
import { listTemplates } from "@/server/rota/templates";
import { parseSuRotaFilter, serviceUserRota, suRotaWeek } from "@/server/rota/su-rota";
import { BROOKFIELD, ctxFor, OAKRIDGE, resetDb, seedAll } from "../helpers";

/**
 * Service User Profile -> Visits -> Template and Rota (brief of 3 Nov 2026, tests 1-7 and 26). Both tabs read the
 * shared template and visit records, filtered to one person; nothing is copied.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let suId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const busiest = await db.visitTemplate.groupBy({ by: ["serviceUserId"], where: { organisationId: orgId }, _count: { _all: true }, orderBy: { _count: { serviceUserId: "desc" } }, take: 1 });
  suId = busiest[0]!.serviceUserId;
}, 180_000);

describe("Template tab", () => {
  it("shows only this service user's templates, active and inactive", async () => {
    const ctx = await manager();
    const rows = await listTemplates(ctx, { serviceUserId: suId, state: "all" });
    expect(rows.length).toBe(await db.visitTemplate.count({ where: { organisationId: orgId, serviceUserId: suId } }));
    expect(rows.every((r) => r.serviceUserId === suId)).toBe(true);
  });

  it("filters by any of several cycle weeks and any of several days, together", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, serviceUserId: suId } });
    // Narrow one template to Week 1 on Mondays so the filters have something to tell apart.
    await db.visitTemplate.update({ where: { id: t.id }, data: { cycleWeeks: [1], weekdays: [1] } });
    const w13 = await listTemplates(ctx, { serviceUserId: suId, state: "all", weeks: [1, 3] });
    expect(w13.map((r) => r.id)).toContain(t.id);
    expect(w13.every((r) => r.cycleWeeks.some((w) => w === 1 || w === 3))).toBe(true);
    const w2 = await listTemplates(ctx, { serviceUserId: suId, state: "all", weeks: [2] });
    expect(w2.map((r) => r.id)).not.toContain(t.id);
    const monWed = await listTemplates(ctx, { serviceUserId: suId, state: "all", weeks: [1, 2], days: [1, 3] });
    expect(monWed.map((r) => r.id)).toContain(t.id);
    expect(monWed.every((r) => r.weekdays.some((d) => d === 1 || d === 3) && r.cycleWeeks.some((w) => w === 1 || w === 2))).toBe(true);
    const tue = await listTemplates(ctx, { serviceUserId: suId, state: "all", days: [2] });
    expect(tue.map((r) => r.id)).not.toContain(t.id);
  });

  it("never lists another organisation's templates for this person", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    expect(await listTemplates(oak, { serviceUserId: suId, state: "all" })).toHaveLength(0);
  });
});

describe("Rota tab", () => {
  it("shows the same visit rows as the Daily Rota for one week, with planned and actual times apart", async () => {
    const ctx = await manager();
    const monday = mondayOf(londonDate());
    const rota = await serviceUserRota(ctx, suId, monday, "all");
    expect(rota.weekStart).toBe(monday);
    expect(rota.weekEnd).toBe(addDays(monday, 6));
    const ids = (await db.visit.findMany({ where: { organisationId: orgId, serviceUserId: suId, date: { gte: new Date(`${monday}T00:00:00Z`), lte: new Date(`${addDays(monday, 6)}T00:00:00Z`) } }, select: { id: true } })).map((v) => v.id);
    expect(rota.visits.map((v) => v.id).sort()).toEqual(ids.sort());
    expect(rota.visits.every((v) => v.date >= monday && v.date <= addDays(monday, 6))).toBe(true);
    expect(rota.counts.all).toBe(ids.length);
  });

  it("filters by status and by open carer places, with counts for every filter", async () => {
    const ctx = await manager();
    const monday = mondayOf(londonDate());
    const all = await serviceUserRota(ctx, suId, monday, "all");
    const done = await serviceUserRota(ctx, suId, monday, "completed");
    expect(done.visits.every((v) => v.status === "COMPLETED")).toBe(true);
    expect(done.visits.length).toBe(all.counts.completed);
    const open = await serviceUserRota(ctx, suId, monday, "unassigned");
    expect(open.visits.every((v) => v.openPlaces > 0)).toBe(true);
    expect(parseSuRotaFilter("nonsense")).toBe("all");
    expect(suRotaWeek("2026-11-11")).toBe("2026-11-09");
    expect(suRotaWeek("not-a-date")).toBe(mondayOf(londonDate()));
  });

  it("reflects an edit made to the shared visit record straight away", async () => {
    const ctx = await manager();
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, serviceUserId: suId, status: "SCHEDULED" }, orderBy: { scheduledStart: "asc" } });
    await db.visit.update({ where: { id: v.id }, data: { manuallyChanged: true, timeLocked: true } });
    const rota = await serviceUserRota(ctx, suId, fromDbDate(v.date), "all");
    const row = rota.visits.find((x) => x.id === v.id)!;
    expect(row.warnings).toEqual(expect.arrayContaining(["Manual change", "Time locked"]));
  });

  it("refuses another organisation", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(serviceUserRota(oak, suId, mondayOf(londonDate()), "all")).rejects.toThrow(/not found/i);
  });
});
