import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate } from "@/lib/london";
import { officeClock } from "@/server/rota/attendance";
import { defaultRange, parseFilters, rotaReport, rotaReportCsv } from "@/server/rota/reports";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** Rota reports against the seeded demo: last week has completed visits with clock times, so the figures are real. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const week = defaultRange();
let orgId = "";

const num = (c: string | number) => (typeof c === "number" ? c : Number(c));

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("rota reports", () => {
  it("delivery by day matches the visit records, one row per day, with totals that add up", async () => {
    const r = await rotaReport(await coordinator(), parseFilters({ report: "delivery", ...week }));
    expect(r.rows).toHaveLength(7);
    const where = { organisationId: orgId, date: { gte: dbDate(week.from), lte: dbDate(week.to) } };
    const [completed, cancelled, live] = await Promise.all([
      db.visit.count({ where: { ...where, status: "COMPLETED" } }),
      db.visit.count({ where: { ...where, status: "CANCELLED" } }),
      db.visit.count({ where: { ...where, status: { not: "CANCELLED" } } }),
    ]);
    expect(completed).toBeGreaterThan(50);
    expect(r.totals![1]).toBe(live);
    expect(r.totals![2]).toBe(completed);
    expect(r.totals![6]).toBe(cancelled);
    for (const col of [1, 2, 3, 4, 5, 6, 8, 9]) expect(r.rows.reduce((n, row) => n + num(row.cells[col]!), 0)).toBe(r.totals![col]);
    expect(r.summary).toContain(`${completed} of ${live} planned visits completed`);
    expect(num(r.totals![2]!) + num(r.totals![3]!) + num(r.totals![4]!) + num(r.totals![5]!)).toBe(live);
  });

  it("uses corrected clock times, so an office correction changes the carer's clocked hours", async () => {
    const ctx = await manager();
    const f = parseFilters({ report: "carers", ...week });
    const before = await rotaReport(ctx, f);
    const clock = await db.visitClock.findFirstOrThrow({
      where: { organisationId: orgId, kind: "OUT", supersedesId: null, staffId: { not: null }, visit: { date: { gte: dbDate(week.from), lte: dbDate(week.to) }, status: "COMPLETED", clocks: { none: { method: "OFFICE" } } } },
    });
    // Move the clock-out 30 minutes later, recorded as an office correction.
    const later = new Date(clock.at.getTime() + 30 * 60_000);
    const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(later);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(later);
    await officeClock(ctx, clock.visitId, { staffId: clock.staffId!, kind: "OUT", date, time: london, reason: "Report test: carer phoned in a later finish", supersedesId: clock.id });
    const after = await rotaReport(ctx, f);
    const row = (r: typeof before) => r.rows.find((x) => x.href === `/rota/staff/${clock.staffId}`)!;
    // Hours are shown to one decimal place and the office time drops seconds, so allow one rounding step.
    expect(Math.abs(num(row(after).cells[9]!) - num(row(before).cells[9]!) - 0.5)).toBeLessThanOrEqual(0.11);
    expect(num(row(after).cells[7]!)).toBe(num(row(before).cells[7]!) + 1);
  });

  it("people, coverage and alerts reports agree with the records", async () => {
    const ctx = await coordinator();
    const people = await rotaReport(ctx, parseFilters({ report: "people", ...week }));
    const distinct = await db.visit.findMany({ where: { organisationId: orgId, date: { gte: dbDate(week.from), lte: dbDate(week.to) } }, distinct: ["serviceUserId"], select: { serviceUserId: true } });
    expect(people.rows).toHaveLength(distinct.length);
    expect(people.rows.every((r) => r.href?.startsWith("/rota/service-users/"))).toBe(true);

    const coverage = await rotaReport(ctx, parseFilters({ report: "coverage", ...week }));
    expect(num(coverage.totals![2]!) - num(coverage.totals![3]!)).toBe(coverage.totals![4]);

    const alerts = await rotaReport(ctx, parseFilters({ report: "alerts", ...week }));
    const raised = alerts.rows.reduce((n, r) => n + num(r.cells[1]!), 0);
    expect(alerts.totals ? alerts.totals[1] : 0).toBe(raised);
  });

  it("refuses bad ranges, other organisations' areas, carers, and CSV export without the export permission", async () => {
    expect(() => parseFilters({ from: "2026-10-10", to: "2026-10-01" })).toThrow(ValidationError);
    expect(() => parseFilters({ from: "2026-01-01", to: addDays("2026-01-01", 100) })).toThrow(ValidationError);
    expect(() => parseFilters({ from: "not-a-date", to: "2026-10-01" })).toThrow(ValidationError);
    expect(parseFilters({ report: "nonsense", ...week }).report).toBe("delivery");

    const otherOrg = await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } });
    const otherArea = await db.area.create({ data: { organisationId: otherOrg.id, name: "Report test area" } });
    await expect(rotaReport(await manager(), parseFilters({ ...week, area: otherArea.id }))).rejects.toThrow(ValidationError);

    await expect(rotaReport(await carer(), parseFilters(week))).rejects.toThrow(ForbiddenError);
    await expect(rotaReportCsv(await coordinator(), parseFilters(week))).rejects.toThrow(ForbiddenError);
  });

  it("exports CSV for a manager and records the export in the audit log", async () => {
    const ctx = await manager();
    const { name, body } = await rotaReportCsv(ctx, parseFilters({ report: "delivery", ...week }));
    expect(name).toBe(`csb-delivery-${week.from}-to-${week.to}.csv`);
    const lines = body.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Planned,Completed,Missed,Not delivered,Not finished,Cancelled,On time,Late arrivals,Short visits,Planned h,Delivered h");
    expect(lines).toHaveLength(9);
    expect(lines[8]!.startsWith("Total,")).toBe(true);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "rota.report.exported" } })).toBe(1);
  });
});
