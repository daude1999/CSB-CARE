import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fromDbDate, londonMinute, hhmm } from "@/lib/london";
import { clockMine, notDeliveredMine, officeClock } from "@/server/rota/attendance";
import { monitorBoard, sweepCalls } from "@/server/rota/monitor";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Attendance and call monitoring against a real database: carer clocking, office entries and corrections, the
 * late and missed call sweep, and the monitor's view. Time-dependent rules use a fixed clock (only Date is faked).
 */

const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ameliaId = "";

const MIN = 60_000;
function at(d: Date, minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(d.getTime() + minutes * MIN));
}

/** Amelia's published, untouched visits from three days ahead (clear of anything the sweep test marks). */
async function ameliaVisits() {
  return db.visit.findMany({
    where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 3 * 86400_000) }, assignments: { some: { staffId: ameliaId, removedAt: null } } },
    orderBy: { scheduledStart: "asc" },
    take: 5,
  });
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

describe("call sweep", () => {
  it("raises a late alert, then marks the call missed once, and never repeats either", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, alertOnLate: true, scheduledStart: { gt: new Date() } }, orderBy: { scheduledStart: "asc" } });
    const s = await db.rotaSettings.findUniqueOrThrow({ where: { organisationId: orgId } });

    await sweepCalls({ organisationId: orgId, now: new Date(v.scheduledStart.getTime() + (s.lateAfterMin + 1) * MIN) });
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "LATE", resolvedAt: null } })).toBe(1);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");

    const missedAt = new Date(v.scheduledStart.getTime() + (s.missedAfterMin + 1) * MIN);
    await sweepCalls({ organisationId: orgId, now: missedAt });
    const again = await sweepCalls({ organisationId: orgId, now: missedAt });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("MISSED");
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "MISSED" } })).toBe(1);
    expect(await db.visitEvent.count({ where: { visitId: v.id, toStatus: "MISSED" } })).toBe(1);
    expect(again.alertsRaised).toBe(0);
    const run = await db.rotaProcessingRun.findFirstOrThrow({ where: { kind: "call.sweep", organisationId: orgId }, orderBy: { startedAt: "desc" } });
    expect(run.ok).toBe(true);
  });

  it("lets the office record a late arrival on a missed call, which answers the alerts and completes the visit", async () => {
    // Ordered, so the same visit is chosen whatever order the database happens to return rows in.
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "MISSED", assignments: { some: { removedAt: null } } }, orderBy: [{ scheduledStart: "asc" }, { id: "asc" }], include: { assignments: { where: { removedAt: null } } } });
    const staffId = v.assignments[0]!.staffId;
    const date = fromDbDate(v.date);
    const start = londonMinute(v.scheduledStart);
    // The carer arrives 40 minutes late and stays the planned length, so the "shorter than planned" rule (a separate
    // test below) does not come into it whatever the visit's length.
    const planned = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / MIN);
    const c = await coordinator();
    await expect(officeClock(c, v.id, { staffId, kind: "IN", date, time: hhmm(start + 40), reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(officeClock(c, v.id, { staffId, kind: "OUT", date, time: hhmm(start + 40), reason: "Phoned in" })).rejects.toThrow("Clock in first");

    // The visit may still be in the future in real time; office entries cannot be, so only run the rest for past visits.
    if (v.scheduledStart.getTime() + (40 + planned) * MIN > Date.now()) return;
    await officeClock(c, v.id, { staffId, kind: "IN", date, time: hhmm(start + 40), reason: "Carer phoned in, app not working" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("IN_PROGRESS");
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: { in: ["LATE", "MISSED"] }, resolvedAt: null } })).toBe(0);
    await officeClock(c, v.id, { staffId, kind: "OUT", date, time: hhmm(start + 40 + planned), reason: "Carer phoned in" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("COMPLETED");
  });
});

describe("office clock-out notes", () => {
  it("lets the office record a short clock-out only with a note, and keeps the note on the visit", async () => {
    // A past, published, scheduled visit nobody has clocked: the seed's history week leaves some unclocked.
    const v = await db.visit.findFirst({
      where: { organisationId: orgId, status: { in: ["SCHEDULED", "MISSED"] }, scheduledEnd: { lt: new Date(Date.now() - 2 * 3600_000) }, clocks: { none: {} }, assignments: { some: { removedAt: null } } },
      include: { assignments: { where: { removedAt: null } } },
      orderBy: { scheduledStart: "desc" },
    });
    if (!v) return; // nothing suitable in this seed run
    const staffId = v.assignments[0]!.staffId;
    const date = fromDbDate(v.date);
    const start = londonMinute(v.scheduledStart);
    const c = await coordinator();
    await officeClock(c, v.id, { staffId, kind: "IN", date, time: hhmm(start), reason: "Carer phoned in" });
    // Clocking out after five minutes makes the visit short: the office must say why, like the carer would.
    await expect(officeClock(c, v.id, { staffId, kind: "OUT", date, time: hhmm(start + 5), reason: "Carer phoned in" })).rejects.toThrow(/shorter than planned/);
    const r = await officeClock(c, v.id, { staffId, kind: "OUT", date, time: hhmm(start + 5), reason: "Carer phoned in", note: "Person was out at a hospital appointment; carer left a note" });
    expect(r.short).toBe(true);
    const note = await db.visitNote.findFirst({ where: { visitId: v.id, category: "SHORT_VISIT" } });
    expect(note?.text).toContain("hospital appointment");
  });
});

describe("carer clocking", () => {
  it("clocks in from the carer's own sign-in, refuses repeats and early clock-ins, and needs a note on a short visit", async () => {
    const [v] = await ameliaVisits();
    const me = await carer();

    at(v!.scheduledStart, -4 * 60);
    await expect(clockMine(me, v!.id, "IN", { nonce: "n-early" })).rejects.toBeInstanceOf(ValidationError);

    at(v!.scheduledStart, 2);
    await clockMine(me, v!.id, "IN", { nonce: "n-1" });
    await expect(clockMine(me, v!.id, "IN", { nonce: "n-1" })).rejects.toBeInstanceOf(ConflictError);
    await expect(clockMine(me, v!.id, "IN", { nonce: "n-2" })).rejects.toBeInstanceOf(ConflictError);
    const started = await db.visit.findUniqueOrThrow({ where: { id: v!.id } });
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.actualStart?.getTime()).toBe(v!.scheduledStart.getTime() + 2 * MIN);

    at(v!.scheduledStart, 5);
    await expect(clockMine(me, v!.id, "OUT", { nonce: "n-3" })).rejects.toThrow(/shorter than planned/);
    await clockMine(me, v!.id, "OUT", { nonce: "n-4", note: "Service user asked me to leave early" });
    const done = await db.visit.findUniqueOrThrow({ where: { id: v!.id } });
    expect(done.status).toBe("COMPLETED");
    expect(await db.visitNote.count({ where: { visitId: v!.id, category: "SHORT_VISIT" } })).toBe(1);
    expect(await db.rotaAlert.count({ where: { visitId: v!.id, kind: "SHORT_VISIT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: v!.id, action: { in: ["visit.clock.in", "visit.clock.out"] } } })).toBe(2);
  });

  it("does not let a carer clock into someone else's visit", async () => {
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 3 * 86400_000) }, assignments: { none: { staffId: ameliaId } } } });
    at(other.scheduledStart, 1);
    await expect(clockMine(await carer(), other.id, "IN", { nonce: "n-other" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports a visit that could not be delivered and alerts the office", async () => {
    const [, v] = await ameliaVisits();
    at(v!.scheduledStart, 3);
    await expect(notDeliveredMine(await carer(), v!.id, "")).rejects.toBeInstanceOf(ValidationError);
    await notDeliveredMine(await carer(), v!.id, "No answer at the door");
    expect((await db.visit.findUniqueOrThrow({ where: { id: v!.id } })).status).toBe("NOT_DELIVERED");
    expect(await db.rotaAlert.count({ where: { visitId: v!.id, kind: "NOT_DELIVERED", severity: "CRITICAL" } })).toBe(1);
    await expect(clockMine(await carer(), v!.id, "IN", { nonce: "n-nd" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("corrects a clock time with a new row, keeping the original", async () => {
    // A completed visit whose clock-out is well after the corrected time (seeded history includes some short visits).
    const recent = await db.visit.findMany({ where: { organisationId: orgId, status: "COMPLETED", scheduledStart: { lt: new Date(Date.now() - 2 * 3600_000) } }, include: { clocks: true }, orderBy: { scheduledStart: "desc" }, take: 50 });
    const v = recent.find((x) => x.clocks.some((k) => k.kind === "OUT" && k.at.getTime() > x.scheduledStart.getTime() + 10 * MIN) && x.clocks.filter((k) => k.kind === "IN").length === 1);
    if (!v) throw new Error("No suitable completed visit in the seed");
    const original = v.clocks.find((x) => x.kind === "IN")!;
    const c = await coordinator();
    const date = fromDbDate(v.date);
    const time = hhmm(londonMinute(v.scheduledStart) + 5);
    await expect(officeClock(c, v.id, { staffId: original.staffId!, kind: "OUT", date, time, reason: "Wrong", supersedesId: original.id })).rejects.toThrow(/same carer and the same clock type/);
    await officeClock(c, v.id, { staffId: original.staffId!, kind: "IN", date, time, reason: "Carer arrived at 5 past, phone was slow", supersedesId: original.id });
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { clocks: true } });
    expect(after.status).toBe("COMPLETED");
    expect(after.actualStart?.getTime()).toBe(v.scheduledStart.getTime() + 5 * MIN);
    expect(after.clocks.find((x) => x.id === original.id)?.at.getTime()).toBe(original.at.getTime());
    expect(after.clocks.filter((x) => x.supersedesId === original.id)).toHaveLength(1);
    await expect(officeClock(c, v.id, { staffId: original.staffId!, kind: "IN", date, time, reason: "Again", supersedesId: original.id })).rejects.toThrow(/already been replaced/);
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "visit.clock.corrected" } })).toBe(1);
  });
});

describe("monitor access", () => {
  it("shows the coordinator today's calls and keeps carers out", async () => {
    const b = await monitorBoard(await coordinator());
    expect(b.rows.every((r) => r.status !== "CANCELLED")).toBe(true);
    for (const r of b.rows.filter((x) => x.status === "MISSED")) expect(r.state).toBe("missed");
    await expect(monitorBoard(await carer())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(officeClock(await carer(), "x", {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a missed call whose carer has since been booked elsewhere", () => {
  it("refuses the late clock-in with a plain message instead of failing", async () => {
    const [v] = (await ameliaVisits()).slice(-1);
    // Another service user's visit at an overlapping time that Amelia is not on, and that clashes with none of her other
    // bookings (which of her visits is "the last of the next five" moves with the time of day, and so do its neighbours).
    const candidates = await db.visit.findMany({
      where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, id: { not: v!.id }, serviceUserId: { not: v!.serviceUserId }, scheduledStart: { lt: v!.scheduledEnd }, scheduledEnd: { gt: v!.scheduledStart }, assignments: { none: { staffId: ameliaId } } },
      orderBy: { scheduledStart: "asc" },
    });
    const booked = await db.visitAssignment.findMany({ where: { staffId: ameliaId, blocking: true, visitId: { not: v!.id } }, select: { startsAt: true, endsAt: true } });
    const other = candidates.find((o) => booked.every((b) => b.endsAt <= o.scheduledStart || b.startsAt >= o.scheduledEnd));
    if (!other) throw new Error("The demo rota has no overlapping visit Amelia is free for");
    // The call is missed, which frees Amelia's time; the office then books her onto the other visit.
    await db.visit.update({ where: { id: v!.id }, data: { status: "MISSED" } });
    const c = await coordinator();
    await db.visitAssignment.create({ data: { organisationId: orgId, visitId: other.id, staffId: ameliaId, slot: "SHADOW", startsAt: other.scheduledStart, endsAt: other.scheduledEnd, eligibility: "ELIGIBLE", assignedById: c.userId } });

    at(v!.scheduledStart, 20);
    const attempt = clockMine(await carer(), v!.id, "IN", {});
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("booked on another visit");
    vi.useRealTimers();
    expect((await db.visit.findUniqueOrThrow({ where: { id: v!.id } })).status).toBe("MISSED");
    expect(await db.visitClock.count({ where: { visitId: v!.id } })).toBe(0);
  });
});
