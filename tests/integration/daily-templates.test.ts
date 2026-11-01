import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { setMemberBranches } from "@/server/admin/branches";
import { createTemplate, duplicateTemplate, setTemplatesEnabled, templateDetails, templatePage, templateRef } from "@/server/rota/templates";
import { BROOKFIELD, ctxFor, OAKRIDGE, resetDb, seedAll } from "../helpers";

/**
 * Daily Templates (owner's approved design, 1 Nov 2026): the paged list behind the table, its filters, one row per
 * template however many carers it needs, the Template Details panel, and branch and organisation limits.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
  await setMemberBranches(await manager(), m.id, [branch["Liverpool"]!]);
}, 180_000);

describe("Daily Templates list", () => {
  it("pages the templates and reports the true total", async () => {
    const ctx = await manager();
    const all = await db.visitTemplate.count({ where: { organisationId: orgId, enabled: true } });
    const p1 = await templatePage(ctx, { state: "on" }, { page: 1, per: 10 });
    expect(p1.total).toBe(all);
    expect(p1.rows).toHaveLength(Math.min(10, all));
    const p2 = await templatePage(ctx, { state: "on" }, { page: 2, per: 10 });
    expect(p2.rows.map((r) => r.id).some((id) => p1.rows.some((r) => r.id === id))).toBe(false);
    // A page past the end clamps to the last page rather than showing nothing.
    expect((await templatePage(ctx, {}, { page: 999, per: 10 })).page).toBe(p1.pages);
  });

  it("filters by cycle week and weekday; an All Weeks template shows in every week", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, cycleWeeks: { hasEvery: [1, 2, 3, 4] } } });
    for (const week of [1, 2, 3, 4]) {
      const page = await templatePage(ctx, { week, day: t.weekdays[0] }, { page: 1, per: 200 });
      expect(page.rows.map((r) => r.id)).toContain(t.id);
      expect(page.rows.every((r) => r.cycleWeeks.includes(week) && r.weekdays.includes(t.weekdays[0]!))).toBe(true);
    }
  });

  it("filters by area, team member, service user, call type, enabled state and missing carer", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, preferredStaff1Id: { not: null }, areaId: { not: null } } });
    const one = (f: Parameters<typeof templatePage>[1]) => templatePage(ctx, f, { page: 1, per: 200 }).then((p) => p.rows);
    expect((await one({ areaId: t.areaId! })).every((r) => r.areaId === t.areaId)).toBe(true);
    expect((await one({ staffId: t.preferredStaff1Id! })).every((r) => [r.preferredStaff1Id, r.preferredStaff2Id, r.shadowStaffId].includes(t.preferredStaff1Id))).toBe(true);
    expect((await one({ serviceUserId: t.serviceUserId })).every((r) => r.serviceUserId === t.serviceUserId)).toBe(true);
    expect((await one({ callTypeId: t.callTypeId })).every((r) => r.callTypeId === t.callTypeId)).toBe(true);
    expect((await one({ noCarer: true })).every((r) => !r.preferredStaff1Id || (r.carersRequired === 2 && !r.preferredStaff2Id))).toBe(true);
    await setTemplatesEnabled(ctx, [t.id], false);
    expect((await one({})).map((r) => r.id)).not.toContain(t.id);
    expect((await one({ state: "off" })).map((r) => r.id)).toContain(t.id);
    expect((await one({ state: "all" })).map((r) => r.id)).toContain(t.id);
    await setTemplatesEnabled(ctx, [t.id], true);
  });

  it("searches by service user, template reference and carer name", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, preferredStaff1Id: { not: null } }, include: { serviceUser: true } });
    const staff = await db.staffMember.findUniqueOrThrow({ where: { id: t.preferredStaff1Id! } });
    const ids = async (q: string) => (await templatePage(ctx, { q }, { page: 1, per: 200 })).rows.map((r) => r.id);
    expect(await ids(t.serviceUser.lastName)).toContain(t.id);
    expect(await ids(templateRef(t.id))).toEqual([t.id]);
    expect(await ids(staff.displayName)).toContain(t.id);
    expect(await ids("zzz-nobody-zzz")).toEqual([]);
  });

  it("shows a double-up as one row with both carers", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, carersRequired: 2, preferredStaff2Id: { not: null } } });
    const rows = (await templatePage(ctx, { serviceUserId: t.serviceUserId, state: "all" }, { page: 1, per: 200 })).rows.filter((r) => r.id === t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.carer1?.id).toBe(t.preferredStaff1Id);
    expect(rows[0]!.carer2?.id).toBe(t.preferredStaff2Id);
  });
});

describe("Template Details", () => {
  it("shows the template with warnings and leaves data unchanged", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, carersRequired: 1 } });
    const before = await db.visitTemplate.findUniqueOrThrow({ where: { id: t.id } });
    await db.visitTemplate.update({ where: { id: t.id }, data: { preferredStaff1Id: null } });
    const d = await templateDetails(ctx, t.id);
    expect(d?.template.id).toBe(t.id);
    expect(d?.warnings.some((w) => /No carer planned/.test(w))).toBe(true);
    await db.visitTemplate.update({ where: { id: t.id }, data: { preferredStaff1Id: before.preferredStaff1Id } });
  });

  it("a duplicate starts disabled and is listed as its own template", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true } });
    const copy = await duplicateTemplate(ctx, t.id);
    expect(copy.enabled).toBe(false);
    expect((await templateDetails(ctx, copy.id))?.warnings[0]).toMatch(/Switched off/);
  });

  it("never shows another organisation's or another branch's template", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId } });
    expect(await templateDetails(oak, t.id)).toBeNull();

    const liverpool = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    const away = await db.visitTemplate.findFirst({ where: { organisationId: orgId, serviceUser: { branchId: { not: branch["Liverpool"] } } } });
    expect(away).not.toBeNull();
    expect(await templateDetails(liverpool, away!.id)).toBeNull();
    const page = await templatePage(liverpool, { state: "all" }, { page: 1, per: 200 });
    expect(page.rows.map((r) => r.id)).not.toContain(away!.id);
    // Searching or filtering by another branch's service user reveals nothing either.
    expect((await templatePage(liverpool, { serviceUserId: away!.serviceUserId, state: "all" }, { page: 1, per: 200 })).total).toBe(0);
  });

  it("a template created here appears in the list for its week and day", async () => {
    const ctx = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    const ct = await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
    const t = await createTemplate(ctx, { serviceUserId: su.id, callTypeId: ct.id, cycleWeeks: [1, 3], weekdays: [2], startMinute: 600, durationMin: 30, carersRequired: 2, effectiveFrom: "2026-01-05" });
    const ids = async (week: number) => (await templatePage(ctx, { week, day: 2 }, { page: 1, per: 200 })).rows.map((r) => r.id);
    expect(await ids(1)).toContain(t.id);
    expect(await ids(3)).toContain(t.id);
    expect(await ids(2)).not.toContain(t.id);
  });
});
