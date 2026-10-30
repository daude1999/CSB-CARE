import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { preparePayRun, voidRun, type RunException } from "@/server/finance/runs";
import { monitorBoard } from "@/server/rota/monitor";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Pay at the end of a week, and the monitor across midnight, against a real database. */
const finance = () => ctxFor("finance@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const MIN = 60_000;
let orgId = "";
const thisWeek = mondayOf(londonDate());
const lastWeek = addDays(thisWeek, -7);

/** A published visit today that the carer has started (the seed only starts visits due at the time it runs). */
async function startedVisitToday(last = false) {
  const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, date: dbDate(londonDate()), assignments: { some: { removedAt: null } } }, orderBy: { scheduledStart: last ? "desc" : "asc" } });
  return db.visit.update({ where: { id: v.id }, data: { status: "IN_PROGRESS", actualStart: v.scheduledStart } });
}

async function voidOpenRun(weekStart: string) {
  const open = await db.payRun.findFirst({ where: { organisationId: orgId, periodStart: dbDate(weekStart), status: { not: "VOID" } } });
  if (open) await voidRun(await finance(), "pay", open.id, "Prepared again for the cut-off test");
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 240_000);

describe("pay at the weekly cut-off", () => {
  it("pays Sunday-night work up to midnight and carries the rest into next week's run, once", async () => {
    const sunday = addDays(lastWeek, 6);
    const line = await db.timesheetLine.findFirstOrThrow({ where: { date: dbDate(sunday), payableMinutes: { gt: 0 }, visitId: { not: null }, timesheet: { organisationId: orgId, status: "APPROVED" } } });
    const visitId = line.visitId ?? "";
    // Make it a night visit: 23:00 on Sunday for two hours.
    const start = londonToUtc(sunday, 23 * 60);
    await db.visit.update({ where: { id: visitId }, data: { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 120 * MIN) } });
    await db.timesheetLine.update({ where: { id: line.id }, data: { payableMinutes: 120 } });

    await voidOpenRun(lastWeek);
    const run = await preparePayRun(await finance(), lastWeek);
    const head = await db.payLine.findFirstOrThrow({ where: { runId: run.id, visitId } });
    expect(head.minutes).toBe(60);
    expect(head.description).toContain("cut-off");
    expect((run.exceptions as unknown as RunException[]).some((e) => e.kind === "CARRIED" && e.ref === line.id)).toBe(true);

    await voidOpenRun(thisWeek);
    const next = await preparePayRun(await finance(), thisWeek);
    const tail = await db.payLine.findMany({ where: { runId: next.id, visitId } });
    expect(tail).toHaveLength(1);
    expect(tail[0]?.minutes).toBe(60);
    expect(tail[0]?.date.toISOString().slice(0, 10)).toBe(thisWeek);
    expect(head.amountPence + (tail[0]?.amountPence ?? 0)).toBeGreaterThan(0);
  });

  it("does not carry anything when last week's run already paid the whole visit", async () => {
    const sunday = addDays(lastWeek, 6);
    const line = await db.timesheetLine.findFirstOrThrow({ where: { date: dbDate(sunday), payableMinutes: 120, timesheet: { organisationId: orgId } } });
    const prev = await db.payRun.findFirstOrThrow({ where: { organisationId: orgId, periodStart: dbDate(lastWeek), status: { not: "VOID" } } });
    // As a run prepared before cut-off splitting would have done.
    await db.payLine.updateMany({ where: { runId: prev.id, visitId: line.visitId }, data: { minutes: 120 } });
    await voidOpenRun(thisWeek);
    const next = await preparePayRun(await finance(), thisWeek);
    expect(await db.payLine.count({ where: { runId: next.id, visitId: line.visitId } })).toBe(0);
  });

  it("lists visits still in progress at the cut-off instead of paying them", async () => {
    await startedVisitToday();
    const running = await db.visit.count({ where: { organisationId: orgId, status: "IN_PROGRESS", date: { gte: dbDate(thisWeek), lte: dbDate(addDays(thisWeek, 6)) } } });
    expect(running).toBeGreaterThan(0);
    await voidOpenRun(thisWeek);
    const run = await preparePayRun(await finance(), thisWeek);
    expect((run.exceptions as unknown as RunException[]).filter((e) => e.kind === "UNFINISHED_AT_CUTOFF").length).toBeGreaterThanOrEqual(running);
  });
});

describe("monitor across midnight", () => {
  it("keeps yesterday's overnight visit on the board while it is still running, and drops a finished day", async () => {
    const today = londonDate();
    // The day's last visit, so stretching it past midnight clashes with nothing else the carer has.
    const v = await startedVisitToday(true);
    // Any other visit today ends before midnight, so it is not on tomorrow's board.
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, id: { not: v.id }, date: dbDate(today), scheduledEnd: { lt: londonToUtc(addDays(today, 1), 0) } } });
    // Running until 02:00 tomorrow.
    await db.visit.update({ where: { id: v.id }, data: { scheduledEnd: londonToUtc(addDays(today, 1), 120) } });
    const board = await monitorBoard(await coordinator(), { now: londonToUtc(addDays(today, 1), 60) });
    expect(board.rows.some((r) => r.id === v.id)).toBe(true);
    expect(board.rows.some((r) => r.id === other.id)).toBe(false);
  });
});
