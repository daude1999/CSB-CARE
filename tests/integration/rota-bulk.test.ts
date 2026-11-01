import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonMinute, mondayOf } from "@/lib/london";
import { bulkVisits } from "@/server/rota/visits";
import { bulkTemplates, duplicateTemplates, listTemplates } from "@/server/rota/templates";
import { listBuilds } from "@/server/rota/build";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** The OnePlan bulk actions on the Daily Rota and Daily Templates, and the All Rotas list. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

async function futureVisit() {
  return db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", timeLocked: false, scheduledStart: { gt: new Date(Date.now() + 2 * 86400000) } }, orderBy: { scheduledStart: "asc" } });
}

describe("Daily Rota bulk actions", () => {
  it("edits times, duration, alerts and double-up on each selected visit", async () => {
    const ctx = await manager();
    const v = await futureVisit();
    const length = v.scheduledEnd.getTime() - v.scheduledStart.getTime();
    // Each step can be refused by a carer's eligibility; any refusal must say why and leave the visit as it was.
    const [t] = await bulkVisits(ctx, [v.id], { kind: "editTime", startMinute: londonMinute(v.scheduledStart) + 5 });
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    if (t!.ok) {
      expect(londonMinute(after.scheduledStart)).toBe(londonMinute(v.scheduledStart) + 5);
      expect(after.scheduledEnd.getTime() - after.scheduledStart.getTime()).toBe(length);
    } else {
      expect(t!.message).toBeTruthy();
      expect(after.scheduledStart).toEqual(v.scheduledStart);
    }
    const [d] = await bulkVisits(ctx, [v.id], { kind: "editDuration", minutes: 20 });
    const afterD = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    if (d!.ok) expect(afterD.scheduledEnd.getTime() - afterD.scheduledStart.getTime()).toBe(20 * 60000);
    expect((await bulkVisits(ctx, [v.id], { kind: "alert", on: false }))[0]!.ok).toBe(true);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).alertOnLate).toBe(false);
    expect((await bulkVisits(ctx, [v.id], { kind: "doubleUp", carers: 2 }))[0]!.ok).toBe(true);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).carersRequired).toBe(2);
    const events = await db.visitEvent.count({ where: { visitId: v.id, type: "EDITED" } });
    expect(events).toBeGreaterThanOrEqual(2);
  });

  it("activates a cancelled future visit only with a reason", async () => {
    const ctx = await manager();
    const v = await futureVisit();
    expect((await bulkVisits(ctx, [v.id], { kind: "cancel", reason: "Family visiting", charge: false }))[0]!.ok).toBe(true);
    await expect(bulkVisits(ctx, [v.id], { kind: "activate", reason: "" })).rejects.toThrow(/reason/);
    const [r] = await bulkVisits(ctx, [v.id], { kind: "activate", reason: "Family plans changed" });
    expect(r!.ok).toBe(true);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");
  });

  it("refuses a carer", async () => {
    const v = await futureVisit();
    await expect(bulkVisits(await ctxFor("carer@care-solution.demo", BROOKFIELD), [v.id], { kind: "alert", on: true })).rejects.toThrow(ForbiddenError);
  });
});

describe("Daily Templates", () => {
  it("lists one week and day, and applies bulk changes with the time lock respected", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, timeLocked: false, carersRequired: 1 }, orderBy: { startMinute: "asc" } });
    const week = t.cycleWeeks[0]!;
    const day = t.weekdays[0]!;
    const list = await listTemplates(ctx, { week, day });
    expect(list.map((x) => x.id)).toContain(t.id);
    expect(list.every((x) => x.cycleWeeks.includes(week) && x.weekdays.includes(day) && x.enabled)).toBe(true);

    expect((await bulkTemplates(ctx, [t.id], { kind: "lock", on: true }))[0]!.ok).toBe(true);
    const locked = await bulkTemplates(ctx, [t.id], { kind: "editTime", startMinute: 600 });
    expect(locked[0]).toMatchObject({ ok: false, message: "Time is locked" });
    await bulkTemplates(ctx, [t.id], { kind: "lock", on: false });
    expect((await bulkTemplates(ctx, [t.id], { kind: "editTime", startMinute: 600 }))[0]!.ok).toBe(true);
    expect((await bulkTemplates(ctx, [t.id], { kind: "editDuration", minutes: 40 }))[0]!.ok).toBe(true);
    expect((await bulkTemplates(ctx, [t.id], { kind: "doubleUp", carers: 2 }))[0]!.ok).toBe(true);
    const after = await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ startMinute: 600, durationMin: 40, carersRequired: 2 });
    expect(after.version).toBeGreaterThan(t.version);
    expect(await db.auditLog.count({ where: { entityId: t.id, action: { startsWith: "template.bulk." } } })).toBeGreaterThanOrEqual(4);

    expect((await bulkTemplates(ctx, [t.id], { kind: "unassign", slot: "PRIMARY" }))[0]!.ok).toBe(true);
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } })).preferredStaff1Id).toBeNull();
  });

  it("duplicates templates as disabled copies", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true } });
    const before = await db.visitTemplate.count({ where: { organisationId: orgId, serviceUserId: t.serviceUserId } });
    expect((await duplicateTemplates(ctx, [t.id, t.id]))).toHaveLength(1);
    expect(await db.visitTemplate.count({ where: { organisationId: orgId, serviceUserId: t.serviceUserId } })).toBe(before + 1);
    expect(await db.visitTemplate.count({ where: { organisationId: orgId, serviceUserId: t.serviceUserId, enabled: false, startMinute: t.startMinute } })).toBeGreaterThanOrEqual(1);
  });
});

describe("All Rotas", () => {
  it("lists every build newest week first and marks this week as current", async () => {
    const rows = await listBuilds(await manager());
    expect(rows.length).toBe(await db.rotaBuild.count({ where: { organisationId: orgId } }));
    expect(rows.map((r) => r.weekStart)).toEqual([...rows.map((r) => r.weekStart)].sort().reverse());
    const thisMonday = mondayOf(londonDate());
    for (const r of rows) {
      expect(r.current).toBe(r.weekStart === thisMonday);
      expect(r.weekEnd).toBe(addDays(r.weekStart, 6));
    }
    expect(await db.rotaBuild.count({ where: { organisationId: orgId, weekStart: dbDate(thisMonday) } })).toBe(rows.filter((r) => r.current).length);
    await expect(listBuilds(await ctxFor("carer@care-solution.demo", BROOKFIELD))).rejects.toThrow(ForbiddenError);
  });
});
