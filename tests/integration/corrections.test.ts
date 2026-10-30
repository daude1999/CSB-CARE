import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fromDbDate, hhmm, londonDate, londonMinute, mondayOf } from "@/lib/london";
import { clockMine, effectiveClocks, officeClock } from "@/server/rota/attendance";
import { decideClockCorrection, listCorrectionRequests, requestClockCorrection } from "@/server/rota/corrections";
import { generateTimesheets, submitTimesheet, verifyLines } from "@/server/finance/timesheets";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Attendance verification against a real database: correction requests, office entries, and checked timesheet lines. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ameliaId = "";
const MIN = 60_000;
function at(d: Date, minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(d.getTime() + minutes * MIN));
}
const timeOf = (d: Date) => ({ date: londonDate(d), time: hhmm(londonMinute(d)) });
async function ameliaVisit(skip = 0) {
  return db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 2 * 86400_000) }, assignments: { some: { staffId: ameliaId, removedAt: null } } }, orderBy: { scheduledStart: "asc" }, skip });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
}, 180_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("clock correction requests", () => {
  it("lets the carer ask, someone else approve, and records the time as an office entry that replaces theirs", async () => {
    const v = await ameliaVisit();
    const me = await carer();
    at(v.scheduledStart, 20);
    await clockMine(me, v.id, "IN", { nonce: `cr-${v.id}` });
    const arrived = new Date(v.scheduledStart.getTime() + 2 * MIN);
    await expect(requestClockCorrection(me, v.id, { kind: "IN", ...timeOf(arrived), reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    const r = await requestClockCorrection(me, v.id, { kind: "IN", ...timeOf(arrived), reason: "No signal at the door, pressed it later" });
    await expect(requestClockCorrection(me, v.id, { kind: "IN", ...timeOf(arrived), reason: "Asking twice by mistake" })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.rotaAlert.count({ where: { dedupeKey: `clockreq:${r.id}`, kind: "CLOCK_CORRECTION", resolvedAt: null } })).toBe(1);
    expect((await listCorrectionRequests(await coordinator())).some((x) => x.id === r.id)).toBe(true);

    await expect(decideClockCorrection(await coordinator(), r.id, "REJECTED", "")).rejects.toBeInstanceOf(ValidationError);
    const { clockId } = await decideClockCorrection(await coordinator(), r.id, "APPROVED", "");
    const clocks = await db.visitClock.findMany({ where: { visitId: v.id } });
    const live = effectiveClocks(clocks).find((c) => c.kind === "IN" && c.staffId === ameliaId)!;
    expect(live.id).toBe(clockId);
    expect(live.method).toBe("OFFICE");
    expect(live.at.getTime()).toBe(Math.floor(arrived.getTime() / MIN) * MIN);
    expect(clocks.length).toBe(2); // the carer's own record stays, superseded
    expect(await db.rotaAlert.count({ where: { dedupeKey: `clockreq:${r.id}`, resolvedAt: null } })).toBe(0);
    await expect(decideClockCorrection(await manager(), r.id, "REJECTED", "Too late")).rejects.toBeInstanceOf(ConflictError);
    // The database keeps decided requests as they are.
    await expect(db.clockCorrectionRequest.update({ where: { id: r.id }, data: { decisionNote: "edited" } })).rejects.toThrow(/cannot change/);
    await expect(db.clockCorrectionRequest.delete({ where: { id: r.id } })).rejects.toThrow(/evidence/);
  });

  it("refuses a request on someone else's visit and a decision by the person who asked", async () => {
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, scheduledStart: { lt: new Date() }, status: { notIn: ["CANCELLED", "NOT_DELIVERED"] }, assignments: { none: { staffId: ameliaId } } } });
    await expect(requestClockCorrection(await carer(), other.id, { kind: "IN", ...timeOf(other.scheduledStart), reason: "Not my visit really" })).rejects.toBeInstanceOf(NotFoundError);
    const v = await ameliaVisit(1);
    at(v.scheduledStart, 30);
    const r = await requestClockCorrection(await carer(), v.id, { kind: "IN", ...timeOf(v.scheduledStart), reason: "Forgot to clock in on arrival" });
    // The database refuses the requester deciding their own request, whatever the code does.
    await expect(db.clockCorrectionRequest.update({ where: { id: r.id }, data: { status: "APPROVED", decidedById: r.requestedById, decidedAt: new Date() } })).rejects.toThrow(/Someone other/);
    await expect(decideClockCorrection(await carer(), r.id, "APPROVED", "")).rejects.toBeInstanceOf(ForbiddenError);
    await decideClockCorrection(await coordinator(), r.id, "REJECTED", "No arrival on the call log");
    expect(await db.visitClock.count({ where: { visitId: v.id } })).toBe(0);
    expect(await db.notification.count({ where: { dedupeKey: `clockreq-decided:${r.id}` } })).toBe(1);
  });

  it("records office entries as approved requests", async () => {
    const v = await ameliaVisit(2);
    at(v.scheduledStart, 90);
    await officeClock(await coordinator(), v.id, { staffId: ameliaId, kind: "IN", ...timeOf(v.scheduledStart), reason: "Carer phoned in her arrival" });
    const r = await db.clockCorrectionRequest.findFirstOrThrow({ where: { visitId: v.id } });
    expect(r.origin).toBe("OFFICE");
    expect(r.status).toBe("APPROVED");
    expect(r.clockId).not.toBeNull();
  });
});

describe("timesheet attendance verification", () => {
  it("refuses to submit until exception lines are checked, and keeps checks across a refresh", async () => {
    // This week, looked at from a fortnight on, so it has ended and its unworked visits show as exceptions.
    const lastWeek = mondayOf(londonDate());
    at(new Date(), 14 * 24 * 60);
    await generateTimesheets(await coordinator(), lastWeek);
    const t = await db.timesheet.findFirstOrThrow({ where: { organisationId: orgId, periodStart: new Date(`${lastWeek}T00:00:00Z`), exceptions: { gt: 0 }, status: "DRAFT" } });
    await expect(submitTimesheet(await coordinator(), t.id, t.version)).rejects.toThrow(/still need checking/);
    await expect(verifyLines(await coordinator(), t.id, t.version, "exceptions", "")).rejects.toBeInstanceOf(ValidationError);
    const n = await verifyLines(await coordinator(), t.id, t.version, "exceptions", "Phoned the carer and checked the call log");
    expect(n).toBe(t.exceptions);
    const line = await db.timesheetLine.findFirstOrThrow({ where: { timesheetId: t.id, exception: { not: null } } });
    expect(line.verifiedAt).not.toBeNull();
    await expect(db.timesheetLine.update({ where: { id: line.id }, data: { verifiedById: null, verifiedAt: null } })).rejects.toThrow(/keeps its check/);
    await generateTimesheets(await coordinator(), lastWeek);
    expect(await db.timesheetLine.count({ where: { timesheetId: t.id, exception: { not: null }, verifiedAt: null } })).toBe(0);
    const fresh = await db.timesheet.findUniqueOrThrow({ where: { id: t.id } });
    await submitTimesheet(await coordinator(), t.id, fresh.version);
    expect((await db.timesheet.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("SUBMITTED");
    expect(fromDbDate(fresh.periodStart)).toBe(lastWeek);
  });
});
