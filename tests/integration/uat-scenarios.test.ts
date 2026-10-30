import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate, londonToUtc } from "@/lib/london";
import { assignCarer } from "@/server/rota/assign";
import { applyTemplateChanges, previewTemplateChanges, updateTemplate } from "@/server/rota/templates";
import { createVisit, setDoubleUp } from "@/server/rota/visits";
import { sweepCalls } from "@/server/rota/monitor";
import { listVisits, visitCandidates, visitCandidatesMany } from "@/server/rota/queries";
import { recordAbsence } from "@/server/workforce/absences";
import { rankCarers } from "@/server/workforce/eligibility";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Operational scenarios from the V1 readiness brief (phase 8) that no other test file covers end to end. Each one
 * books its own visits on a quiet day weeks ahead, so the results do not depend on the demo rota.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let callTypeId = "";
let suIds: string[] = [];
const day = addDays(londonDate(), 42);

async function free(date: string, minute: number, su: string, exclude: string[] = []) {
  const start = londonToUtc(date, minute);
  const r = await rankCarers(db, orgId, { start, end: new Date(start.getTime() + 30 * 60000), slot: "PRIMARY", serviceUserId: su, careTaskIds: [] });
  return r.filter((x) => x.result.state !== "NOT_ELIGIBLE" && !exclude.includes(x.staff!.id)).map((x) => x.staff!.id);
}

async function booked(date: string, minute: number, staffId: string, su = suIds[0]!) {
  const ctx = await manager();
  const v = await createVisit(ctx, { serviceUserId: su, callTypeId, date, startMinute: minute, durationMin: 30 });
  await assignCarer(ctx, { visitId: v.id, slot: "PRIMARY", staffId, acceptWarnings: true });
  return db.visit.findUniqueOrThrow({ where: { id: v.id } });
}

const live = (visitId: string) => db.visitAssignment.findFirst({ where: { visitId, slot: "PRIMARY", removedAt: null } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  suIds = (await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { reference: "asc" }, take: 4 })).map((s) => s.id);
}, 180_000);

describe("sickness cover", () => {
  it("flags the sick carer's visits without moving them, and a coordinator covers one with an eligible carer", async () => {
    const [sick, cover] = await free(day, 600, suIds[0]!);
    const v = await booked(day, 600, sick!);
    await recordAbsence(await manager(), { staffId: sick!, kind: "SICKNESS", from: day, to: day, reason: "Scenario: off sick" });
    const flagged = await live(v.id);
    // HR changes flag visits and never reassign them.
    expect(flagged?.staffId).toBe(sick);
    expect(flagged?.reviewReason).toMatch(/sickness/i);
    expect(await db.rotaAlert.count({ where: { organisationId: orgId, kind: "ALLOCATION_REVIEW", assignmentId: flagged!.id, resolvedAt: null } })).toBe(1);
    // The sick carer is no longer offered; the cover carer is.
    const offered = await visitCandidates(await manager(), { ...v, assignments: [] }, "PRIMARY");
    expect(offered.find((c) => c.id === sick)?.state).toBe("NOT_ELIGIBLE");
    await assignCarer(await manager(), { visitId: v.id, slot: "PRIMARY", staffId: cover!, acceptWarnings: true });
    expect((await live(v.id))?.staffId).toBe(cover);
    // The review alert was about the carer who has now been replaced, so it closes with the reassignment.
    expect(await db.rotaAlert.count({ where: { organisationId: orgId, kind: "ALLOCATION_REVIEW", assignmentId: flagged!.id, resolvedAt: null } })).toBe(0);
    const events = await db.visitEvent.findMany({ where: { visitId: v.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["ALLOCATION_FLAGGED", "REASSIGNED"]));
  });
});

describe("expiring compliance", () => {
  it("flags bookings after an HR check runs out, keeps the carer on them, and refuses new bookings", async () => {
    const [carer] = await free(day, 700, suIds[1]!);
    const v = await booked(day, 700, carer!, suIds[1]);
    const staff = await db.staffMember.findUniqueOrThrow({ where: { id: carer! } });
    // HR records a DBS review that fell due yesterday.
    await hrTransaction(orgId, (s) => {
      const c = s.checks.find((x) => x.employee === staff.hrEmployeeId && /dbs/i.test(x.name));
      if (!c) throw new Error("No DBS check in the fixture");
      Object.assign(c, { due: addDays(londonDate(), -1), version: c.version + 1 });
    });
    const a = await live(v.id);
    expect(a?.staffId).toBe(carer);
    expect(a?.reviewReason).toMatch(/DBS/);
    const other = await createVisit(await manager(), { serviceUserId: suIds[1]!, callTypeId, date: day, startMinute: 900, durationMin: 30 });
    await expect(assignCarer(await manager(), { visitId: other.id, slot: "PRIMARY", staffId: carer!, acceptWarnings: true })).rejects.toThrow(/DBS/);
  });
});

describe("partial double-up", () => {
  it("lists a double-up with one carer as needing a second, and suggests carers for the empty slot only", async () => {
    const [a] = await free(day, 800, suIds[2]!);
    const v = await booked(day, 800, a!, suIds[2]);
    await setDoubleUp(await manager(), v.id, 2);
    const { rows } = await listVisits(await manager(), { date: day, unassigned: true });
    const row = rows.find((r) => r.id === v.id);
    expect(row?.flags.unassignedSlots).toBe(1);
    const many = await visitCandidatesMany(await manager(), [{ visit: row!, slot: "SECOND" }]);
    const list = many.get(v.id)!;
    expect(list.some((c) => c.id === a)).toBe(false);
    // The batched list gives the same people and states as the single-visit one.
    const single = await visitCandidates(await manager(), row!, "SECOND");
    expect(list.map((c) => [c.id, c.state]).sort()).toEqual(single.map((c) => [c.id, c.state]).sort());
  });
});

describe("template change", () => {
  it("previews the future visits a template change affects and applies it only where history and hand edits allow", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, carersRequired: 1 }, orderBy: { startMinute: "asc" }, include: { tasks: true } });
    const future = await db.visit.findMany({ where: { templateId: t.id, status: "SCHEDULED", scheduledStart: { gt: new Date() } }, orderBy: { scheduledStart: "asc" } });
    expect(future.length).toBeGreaterThan(1);
    // One future visit was changed by hand; it must be left alone.
    await db.visit.update({ where: { id: future[0]!.id }, data: { manuallyChanged: true } });
    const updated = await updateTemplate(ctx, t.id, t.version, { serviceUserId: t.serviceUserId, callTypeId: t.callTypeId, areaId: t.areaId, cycleWeeks: t.cycleWeeks, weekdays: t.weekdays, startMinute: t.startMinute + 15, durationMin: t.durationMin, carersRequired: 1, preferredStaff1Id: t.preferredStaff1Id, medicationRequired: t.medicationRequired, effectiveFrom: t.effectiveFrom.toISOString().slice(0, 10), taskIds: t.tasks.map((x) => x.careTaskId).filter((x): x is string => !!x), runRouteTemplateId: t.runRouteTemplateId, rotaType: t.rotaType, timeLocked: t.timeLocked, alertOnLate: t.alertOnLate });
    const { impacts } = await previewTemplateChanges(ctx, t.id);
    expect(impacts.find((i) => i.visitId === future[0]!.id)).toMatchObject({ apply: false, reason: expect.stringMatching(/by hand/) });
    expect(impacts.filter((i) => i.apply).length).toBeGreaterThan(0);
    const results = await applyTemplateChanges(ctx, t.id, updated.version);
    const ok = results.filter((r) => r.ok).map((r) => r.reference);
    for (const r of ok) {
      const v = await db.visit.findFirstOrThrow({ where: { reference: r, organisationId: orgId } });
      expect(v.scheduledStart.getTime() - londonToUtc(v.date.toISOString().slice(0, 10), t.startMinute).getTime()).toBe(15 * 60000);
    }
    expect((await db.visit.findUniqueOrThrow({ where: { id: future[0]!.id } })).scheduledStart.getTime()).toBe(future[0]!.scheduledStart.getTime());
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "template.applied", entityId: t.id } })).toBe(1);
  });
});

describe("missing check-out", () => {
  it("raises one 'not clocked out' alert for a visit still open well after its end, and no repeat", async () => {
    const [carer] = await free(day, 300, suIds[3]!);
    const ctx = await manager();
    const v = await createVisit(ctx, { serviceUserId: suIds[3]!, callTypeId, date: day, startMinute: 300, durationMin: 30 });
    await db.visit.update({ where: { id: v.id }, data: { publishedAt: new Date(), status: "IN_PROGRESS", actualStart: v.scheduledStart } });
    await db.visitClock.create({ data: { organisationId: orgId, visitId: v.id, staffId: carer!, kind: "IN", at: v.scheduledStart, method: "APP", recordedById: ctx.userId, reason: "Scenario" } });
    // The sweep runs as if it were 90 minutes after the start: an hour after the visit should have ended.
    const now = new Date(v.scheduledStart.getTime() + 90 * 60000);
    await sweepCalls({ organisationId: orgId, now });
    await sweepCalls({ organisationId: orgId, now });
    expect(await db.rotaAlert.count({ where: { visitId: v.id, kind: "OVERRUN" } })).toBe(1);
  });
});
