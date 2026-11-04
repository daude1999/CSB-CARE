import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, fromDbDate, hhmm, londonMinute, londonTime, mondayOf } from "@/lib/london";
import { adjustVisitTime, previewAdjustVisitTime } from "@/server/rota/adjust-time";
import { previewRollForward } from "@/server/rota/roll-forward";
import { BROOKFIELD, ctxFor, OAKRIDGE, resetDb, seedAll } from "../helpers";

/**
 * Quick Adjust Visit Time (brief of 3 Nov 2026, PR C, QA-1 to QA-10): one visit's time on its own day, through the
 * shared visit service. Carers re-checked, no override, template untouched, reason and audit stored, carers of a
 * published visit told in the app, shorter visits only for allowed reasons, Roll Forward goes back to the template time.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";

const minutesOf = (v: { scheduledStart: Date; scheduledEnd: Date }) => Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);

/** A future, published, scheduled visit from a template, with a carer who has a sign-in, and room to move 15 minutes. */
async function pickVisit(exclude: string[] = []) {
  const soon = new Date(Date.now() + 36 * 3600_000);
  const list = await db.visit.findMany({
    where: { organisationId: orgId, status: "SCHEDULED", timeLocked: false, publishedAt: { not: null }, templateId: { not: null }, scheduledStart: { gt: soon }, id: { notIn: exclude }, assignments: { some: { removedAt: null, staff: { userId: { not: null } } } } },
    include: { template: true, assignments: { where: { removedAt: null } } },
    orderBy: { scheduledStart: "asc" },
    take: 40,
  });
  const v = list.find((x) => x.template && londonMinute(x.scheduledStart) === x.template.startMinute && minutesOf(x) === x.template.durationMin);
  if (!v) throw new Error("No suitable demo visit");
  return v;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("Adjust Visit Time", () => {
  it("previews original and revised times side by side and writes nothing", async () => {
    const ctx = await manager();
    const v = await pickVisit();
    const start = hhmm(londonMinute(v.scheduledStart) + 15);
    const p = await previewAdjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start, durationMin: minutesOf(v), reason: "" });
    expect(p.original.start).toBe(londonTime(v.scheduledStart));
    expect(p.revised.start).toBe(start);
    expect(p.revised.durationMin).toBe(minutesOf(v));
    expect(p.carers.length).toBe(v.assignments.length);
    expect(p.published).toBe(true);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).lockVersion).toBe(v.lockVersion);
    const same = await previewAdjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start: londonTime(v.scheduledStart), durationMin: minutesOf(v) });
    expect(same.blocking).toContain("The new time is the same as the current time.");
  });

  it("applies a later start with a reason: manual change, template untouched, audit, carers told", async () => {
    const ctx = await manager();
    const v = await pickVisit();
    const start = hhmm(londonMinute(v.scheduledStart) + 15);
    await expect(adjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start, durationMin: minutesOf(v), reason: "" })).rejects.toBeInstanceOf(ValidationError);
    const p = await previewAdjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start, durationMin: minutesOf(v) });
    if (p.blocking.length) return expect.fail(`Demo visit cannot move: ${p.blocking.join("; ")}`);
    const r = await adjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start, durationMin: minutesOf(v), reason: "GP appointment at 09:00" });
    expect(r.to.start).toBe(start);
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(londonTime(after.scheduledStart)).toBe(start);
    expect(after.manuallyChanged).toBe(true);
    const tpl = await db.visitTemplate.findUniqueOrThrow({ where: { id: v.templateId! } });
    expect(tpl.startMinute).toBe(v.template!.startMinute);
    expect(tpl.version).toBe(v.template!.version);
    const ev = await db.visitEvent.findFirstOrThrow({ where: { visitId: v.id, type: "EDITED" }, orderBy: { createdAt: "desc" } });
    expect(ev.data).toMatchObject({ source: "quick-adjust", reason: "GP appointment at 09:00" });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: v.id, action: "visit.time.adjusted" } });
    expect(log.data).toMatchObject({ reason: "GP appointment at 09:00", from: { start: londonTime(v.scheduledStart) }, to: { start } });
    const users = new Set((await db.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null }, include: { staff: true } })).map((a) => a.staff.userId).filter(Boolean));
    expect(r.carersTold).toBe(users.size);
    expect(await db.notification.count({ where: { type: "rota.visit.changed", dedupeKey: { startsWith: "visit-changed:adjust:" }, userId: { in: [...users] as string[] } } })).toBeGreaterThanOrEqual(users.size);
  });

  it("refuses a shorter visit without an allowed reason, and flags an allowed one to the care manager", async () => {
    const ctx = await manager();
    const v = await pickVisit((await db.visit.findMany({ where: { organisationId: orgId, manuallyChanged: true }, select: { id: true } })).map((x) => x.id));
    const shorter = v.template!.durationMin - 10;
    const input = { visitId: v.id, lockVersion: v.lockVersion, start: londonTime(v.scheduledStart), durationMin: shorter, reason: "Family asked for a shorter call" };
    const p = await previewAdjustVisitTime(ctx, input);
    expect(p.shorter).toBe(true);
    await expect(adjustVisitTime(ctx, input)).rejects.toThrow("Carer availability is not a reason");
    // "Carer availability" is not one of the accepted values.
    await expect(adjustVisitTime(ctx, { ...input, shortenReason: "CARER_AVAILABILITY" as never })).rejects.toBeInstanceOf(ValidationError);
    await adjustVisitTime(ctx, { ...input, shortenReason: "SU_REQUEST" });
    expect(minutesOf(await db.visit.findUniqueOrThrow({ where: { id: v.id } }))).toBe(shorter);
    const alert = await db.rotaAlert.findFirstOrThrow({ where: { visitId: v.id, kind: "VISIT_SHORTENED" } });
    expect(alert.message).toContain("Service user or family request");
  });

  it("refuses time-locked, started and stale visits, and another organisation", async () => {
    const ctx = await manager();
    const used = (await db.visit.findMany({ where: { organisationId: orgId, manuallyChanged: true }, select: { id: true } })).map((x) => x.id);
    const v = await pickVisit(used);
    const input = { visitId: v.id, lockVersion: v.lockVersion, start: hhmm(londonMinute(v.scheduledStart) + 5), durationMin: minutesOf(v), reason: "Testing the refusals" };
    await expect(adjustVisitTime(ctx, { ...input, lockVersion: v.lockVersion + 7 })).rejects.toBeInstanceOf(ConflictError);
    await db.visit.update({ where: { id: v.id }, data: { timeLocked: true } });
    const locked = await previewAdjustVisitTime(ctx, input);
    expect(locked.blocking.join(" ")).toContain("locked");
    await expect(adjustVisitTime(ctx, input)).rejects.toThrow("locked");
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(previewAdjustVisitTime(oak, input)).rejects.toBeInstanceOf(NotFoundError);
    // The database allows no way back from In Progress, so this visit stays started.
    await db.visit.update({ where: { id: v.id }, data: { timeLocked: false, status: "IN_PROGRESS" } });
    await expect(adjustVisitTime(ctx, input)).rejects.toThrow("in progress");
  });

  it("blocks a time when a carer is booked elsewhere, naming the visit", async () => {
    const ctx = await manager();
    const used = (await db.visit.findMany({ where: { organisationId: orgId, manuallyChanged: true }, select: { id: true } })).map((x) => x.id);
    const v = await pickVisit(used);
    const a = v.assignments[0]!;
    const other = await db.visitAssignment.findFirst({ where: { staffId: a.staffId, removedAt: null, visitId: { not: v.id }, startsAt: { gt: v.scheduledStart, lt: new Date(v.scheduledStart.getTime() + 12 * 3600_000) }, visit: { status: "SCHEDULED", date: v.date } }, include: { visit: true } });
    if (!other) return; // This carer has no later visit that day in the demo data.
    const p = await previewAdjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start: londonTime(other.visit.scheduledStart), durationMin: minutesOf(v) });
    expect(p.blocking.join(" ")).toContain("cannot do the new time");
    await expect(adjustVisitTime(ctx, { visitId: v.id, lockVersion: v.lockVersion, start: londonTime(other.visit.scheduledStart), durationMin: minutesOf(v), reason: "Should be refused" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Roll Forward and one-off times", () => {
  it("rolls an adjusted visit forward at the template time unless the office ticks Keep one-off times", async () => {
    const ctx = await manager();
    const ids = (await db.auditLog.findMany({ where: { organisationId: orgId, action: "visit.time.adjusted" }, select: { entityId: true } })).map((l) => l.entityId).filter((x): x is string => !!x);
    const adjusted = await db.visit.findFirstOrThrow({ where: { id: { in: ids }, status: "SCHEDULED" }, include: { template: true } });
    expect(londonMinute(adjusted.scheduledStart) !== adjusted.template!.startMinute || minutesOf(adjusted) !== adjusted.template!.durationMin).toBe(true);
    const sourceWeek = mondayOf(fromDbDate(adjusted.date));
    const targetWeek = addDays(sourceWeek, 7 * 15);
    const normal = await previewRollForward(ctx, { sourceWeek, targetWeek, weeks: 1 });
    const copy = normal.visits.find((x) => x.sourceVisitId === adjusted.id)!;
    expect(copy.oneOff).toMatchObject({ kept: false });
    expect(londonMinute(copy.start)).toBe(adjusted.template!.startMinute);
    expect(copy.durationMin).toBe(adjusted.template!.durationMin);
    expect(normal.counts.oneOff).toBeGreaterThan(0);
    const keep = await previewRollForward(ctx, { sourceWeek, targetWeek, weeks: 1, keepOneOff: true });
    const kept = keep.visits.find((x) => x.sourceVisitId === adjusted.id)!;
    expect(kept.oneOff).toMatchObject({ kept: true });
    expect(londonMinute(kept.start)).toBe(londonMinute(adjusted.scheduledStart));
    expect(keep.fingerprint).not.toBe(normal.fingerprint);
  });
});
