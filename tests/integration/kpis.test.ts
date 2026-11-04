import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { computeKpis, kpiCategories, kpiCsv, KPI_GROUPS, KPIS, permittedKpiNames } from "@/server/reports/kpis";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Reporting & Analytics against a real database: definitions, permissions, branch scope and the audited CSV. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("KPI registry", () => {
  it("gives every measure a definition and works each one out from the records", async () => {
    expect(new Set(KPIS.map((k) => k.key)).size).toBe(KPIS.length);
    expect(KPIS.every((k) => k.definition.length > 40)).toBe(true);
    const r = await computeKpis(await manager(), {});
    expect(r.rows.length).toBe(KPIS.length);
    const delivered = r.rows.find((k) => k.key === "visits-delivered")!;
    const where = { organisationId: orgId, publishedAt: { not: null }, status: { not: "CANCELLED" as const }, date: { gte: dbDate(r.scope.from), lte: dbDate(addDays(londonDate(), -1)) } };
    const [due, done] = await Promise.all([db.visit.count({ where }), db.visit.count({ where: { ...where, status: "COMPLETED" } })]);
    expect(delivered.detail).toContain(`of ${due} visits`);
    expect(delivered.value).toBe(due ? Math.round((done / due) * 1000) / 10 : null);
  });

  it("shows only the measures a role may see", async () => {
    const finance = await computeKpis(await ctxFor("finance@care-solution.demo", BROOKFIELD), {});
    expect(finance.rows.every((k) => k.group === "finance")).toBe(true);
    expect(finance.rows.length).toBeGreaterThan(0);
  });

  it("keeps branch-limited members to their branches and refuses a branch they cannot see", async () => {
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const portsmouth = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Portsmouth" } });
    const all = await computeKpis(await manager(), {});
    const one = await computeKpis(await manager(), { branch: liverpool.id });
    const staffAll = all.rows.find((k) => k.key === "staff-ready")!.detail;
    const staffOne = one.rows.find((k) => k.key === "staff-ready")!.detail;
    expect(Number(staffOne.match(/of (\d+)/)![1])).toBeLessThan(Number(staffAll.match(/of (\d+)/)![1]));
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "manager@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [liverpool.id]);
    try {
      const limited = await ctxFor("manager@care-solution.demo", BROOKFIELD);
      await expect(computeKpis(limited, { branch: portsmouth.id })).rejects.toBeInstanceOf(ForbiddenError);
      const mine = await computeKpis(limited, {});
      expect(mine.rows.find((k) => k.key === "staff-ready")!.detail).toBe(staffOne);
    } finally {
      await setMemberBranches(await ctxFor("manager@care-solution.demo", BROOKFIELD), m.id, []);
    }
  });

  it("validates dates and audits the CSV export", async () => {
    await expect(computeKpis(await manager(), { from: "2026-10-10", to: "2026-10-01" })).rejects.toBeInstanceOf(ValidationError);
    const { columns, rows } = await kpiCsv(await manager(), {});
    expect(columns).toContain("Definition");
    expect(rows.length).toBe(KPIS.length);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "report.kpis.exported" } })).toBe(1);
    await expect(kpiCsv(await ctxFor("coordinator@care-solution.demo", BROOKFIELD), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Analytics categories", () => {
  const ORDER = Object.keys(KPI_GROUPS);

  it("lists every category with its count whichever category is chosen", async () => {
    const ctx = await manager();
    const all = await computeKpis(ctx, {});
    expect(all.categories.groups.map((c) => c.group)).toEqual(ORDER);
    expect(all.categories.total).toBe(all.rows.length);
    for (const c of all.categories.groups) expect(c.count).toBe(all.rows.filter((r) => r.group === c.group).length);
    for (const g of ORDER) {
      const one = await computeKpis(ctx, { group: g });
      expect(one.categories).toEqual(all.categories);
      expect(one.rows.every((r) => r.group === g)).toBe(true);
      expect(one.rows.length).toBe(all.categories.groups.find((c) => c.group === g)!.count);
    }
  });

  it("counts only the measures a role may see, and keeps the other categories in the list", async () => {
    const finance = await ctxFor("finance@care-solution.demo", BROOKFIELD);
    const cats = kpiCategories(finance);
    expect(cats.groups.map((c) => c.group)).toEqual(ORDER);
    expect(cats.groups.find((c) => c.group === "finance")!.count).toBeGreaterThan(0);
    expect(cats.groups.filter((c) => c.group !== "finance").every((c) => c.count === 0)).toBe(true);
    expect(cats.total).toBe((await computeKpis(finance, {})).rows.length);
    expect((await computeKpis(finance, { group: "quality" })).rows).toEqual([]);
    expect(permittedKpiNames(finance).every((k) => k.area === KPI_GROUPS.finance)).toBe(true);
  });

  it("works out the same figures for a category as on All", async () => {
    const ctx = await manager();
    const all = await computeKpis(ctx, {});
    const finance = await computeKpis(ctx, { group: "finance" });
    expect(finance.rows).toEqual(all.rows.filter((r) => r.group === "finance"));
    const { rows } = await kpiCsv(ctx, { group: "finance" });
    expect(rows.map((r) => r[1])).toEqual(finance.rows.map((r) => r.name));
  });
});
