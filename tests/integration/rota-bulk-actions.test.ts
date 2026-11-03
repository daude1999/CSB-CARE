import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonMinute, londonToUtc } from "@/lib/london";
import { bulkVisits, createVisit, previewBulkVisits, type BulkAction, type BulkResult } from "@/server/rota/visits";
import { openMissedCase, visitStatusNow } from "@/server/rota/missed-calls";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Every Daily Rota bulk action, from the domain call to the database: valid visits change, visits already as asked
 * are reported as unchanged (and not written again), refusals say why, each visit is its own transaction, and every
 * change is audited. Complete Calls is tested in detail: it is a record correction and must never fabricate evidence.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";
let managerId = "";
let suIds: string[] = [];
let callTypeIds: string[] = [];
let staffIds: string[] = [];
let slotMinute = 0;

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } })).id;
  suIds = (await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, select: { id: true }, orderBy: { lastName: "asc" } })).map((s) => s.id);
  callTypeIds = (await db.callType.findMany({ where: { organisationId: orgId, active: true }, select: { id: true }, orderBy: { name: "asc" } })).map((c) => c.id);
  staffIds = (await db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE" }, select: { id: true }, orderBy: { displayName: "asc" } })).map((s) => s.id);
}, 180_000);

/** A fresh one-off visit. Past visits sit in the small hours on their own minute, so the carers booked on them never overlap. */
async function mkVisit(o: { days: number; carers?: number; staff?: number; publish?: boolean; minute?: number; length?: number }) {
  const ctx = await manager();
  const minute = o.minute ?? (o.days < 0 ? 60 + (slotMinute++ % 200) * 1 : 600);
  const v = await createVisit(ctx, { serviceUserId: suIds[slotMinute % suIds.length]!, callTypeId: callTypeIds[0]!, date: addDays(londonDate(), o.days), startMinute: minute, durationMin: o.length ?? 5, carersRequired: o.carers ?? 1, publish: o.publish ?? true });
  for (let i = 0; i < (o.staff ?? 0); i++) {
    await db.visitAssignment.create({ data: { organisationId: orgId, visitId: v.id, slot: i === 0 ? "PRIMARY" : i === 1 ? "SECOND" : "ADDITIONAL", position: i + 1, staffId: staffIds[(slotMinute + i * 7) % staffIds.length]!, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: managerId } });
  }
  return db.visit.findUniqueOrThrow({ where: { id: v.id } });
}

const one = async (id: string, action: BulkAction, ctx?: Awaited<ReturnType<typeof manager>>) => (await bulkVisits(ctx ?? (await manager()), [id], action))[0]!;
const visit = (id: string) => db.visit.findUniqueOrThrow({ where: { id } });
const counts = (r: BulkResult[]) => ({ updated: r.filter((x) => x.outcome === "updated").length, unchanged: r.filter((x) => x.outcome === "unchanged").length, refused: r.filter((x) => x.outcome === "refused").length, error: r.filter((x) => x.outcome === "error").length });

/** A carer the eligibility service lets onto this visit (warnings accepted), found with a dry run so nothing is booked. */
async function eligibleCarer(visitId: string, slot: "PRIMARY" | "SECOND" | "SHADOW" = "PRIMARY", not: string[] = []) {
  const ctx = await manager();
  for (const staffId of staffIds.filter((s) => !not.includes(s))) {
    const [r] = await bulkVisits(ctx, [visitId], { kind: "assign", staffId, slot, acceptWarnings: true }, { preview: true });
    if (r!.outcome === "updated") return staffId;
  }
  throw new Error("No eligible carer in the demo data");
}

describe("Daily Rota bulk actions: each action updates, reports unchanged, and refuses with a reason", () => {
  it("1 Cancel Visits: needs a reason, records the charge decision, and a second cancel changes nothing", async () => {
    const v = await mkVisit({ days: 20 });
    await expect(one(v.id, { kind: "cancel", reason: "", charge: true })).rejects.toThrow(/reason/);
    expect(await one(v.id, { kind: "cancel", reason: "Family visiting", charge: false })).toMatchObject({ outcome: "updated", ok: true });
    const after = await visit(v.id);
    expect(after).toMatchObject({ status: "CANCELLED", cancellationCharge: false, cancelReason: "Family visiting" });
    expect(await one(v.id, { kind: "cancel", reason: "Again", charge: true })).toMatchObject({ outcome: "unchanged", message: "Already cancelled" });
    const again = await visit(v.id);
    expect(again.cancellationCharge).toBe(false);
    expect(again.lockVersion).toBe(after.lockVersion);
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "visit.cancelled" } })).toBe(1);
  });

  it("2 Activate Visits: brings back a future cancelled visit, refuses missed and past visits, never completes anything", async () => {
    const v = await mkVisit({ days: 20 });
    await one(v.id, { kind: "cancel", reason: "Family visiting", charge: true });
    expect(await one(v.id, { kind: "activate", reason: "Plans changed" })).toMatchObject({ outcome: "updated" });
    expect(await visit(v.id)).toMatchObject({ status: "SCHEDULED", cancellationCharge: null, cancelReason: null });
    expect(await one(v.id, { kind: "activate", reason: "Plans changed" })).toMatchObject({ outcome: "unchanged" });

    const missed = await mkVisit({ days: -2, staff: 1 });
    await db.visit.update({ where: { id: missed.id }, data: { status: "MISSED" } });
    const r = await one(missed.id, { kind: "activate", reason: "Care was given" });
    expect(r).toMatchObject({ outcome: "refused" });
    expect(r.message).toMatch(/Complete Calls/);
    expect((await visit(missed.id)).status).toBe("MISSED");

    const past = await mkVisit({ days: -2 });
    await one(past.id, { kind: "cancel", reason: "Client in hospital", charge: false });
    expect(await one(past.id, { kind: "activate", reason: "Wrongly cancelled" })).toMatchObject({ outcome: "refused" });
    expect((await visit(past.id)).status).toBe("CANCELLED");
  });

  it("3 Reassign and 4 Unassign: go through eligibility, respect carer places, and report places already as asked", async () => {
    const v = await mkVisit({ days: 21, carers: 2 });
    const first = await eligibleCarer(v.id);
    expect(await one(v.id, { kind: "assign", staffId: first, slot: "PRIMARY", acceptWarnings: true })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "assign", staffId: first, slot: "PRIMARY", acceptWarnings: true })).toMatchObject({ outcome: "unchanged", message: "Already booked as Carer 1" });
    // The same carer cannot hold two places on one visit.
    expect(await one(v.id, { kind: "assign", staffId: first, slot: "SECOND", acceptWarnings: true })).toMatchObject({ outcome: "refused" });
    // A place the visit does not have is refused, not created.
    expect(await one(v.id, { kind: "assign", staffId: first, slot: "C3", acceptWarnings: true })).toMatchObject({ outcome: "refused" });
    expect(await db.visitAssignment.count({ where: { visitId: v.id, removedAt: null } })).toBe(1);
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "ASSIGNED" } })).toBe(1);

    expect(await one(v.id, { kind: "unassign", slot: "SECOND", reason: "Not needed" })).toMatchObject({ outcome: "unchanged", message: "Nobody is booked as Carer 2" });
    expect(await one(v.id, { kind: "unassign", slot: "PRIMARY", reason: "Carer on leave" })).toMatchObject({ outcome: "updated" });
    expect(await db.visitAssignment.count({ where: { visitId: v.id, removedAt: null } })).toBe(0);
    expect(await db.visitAssignment.count({ where: { visitId: v.id } })).toBe(1);
    expect(await one(v.id, { kind: "unassign", slot: "PRIMARY", reason: "Carer on leave" })).toMatchObject({ outcome: "unchanged" });
  });

  it("5 Add and 6 Remove Rota Lock(s): a lock stops time edits; repeating changes nothing", async () => {
    const v = await mkVisit({ days: 22 });
    expect(await one(v.id, { kind: "lock", locked: true })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "lock", locked: true })).toMatchObject({ outcome: "unchanged", message: "Time already locked" });
    expect(await one(v.id, { kind: "nudge", minutes: 15 })).toMatchObject({ outcome: "refused", message: expect.stringMatching(/locked/) });
    expect((await visit(v.id)).scheduledStart).toEqual(v.scheduledStart);
    expect(await one(v.id, { kind: "lock", locked: false })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "lock", locked: false })).toMatchObject({ outcome: "unchanged" });
    expect((await visit(v.id)).timeLocked).toBe(false);
  });

  it("7 Edit Times, 8 Edit Duration and 16 Nudge Times: change the times, keep the length, and say when nothing changes", async () => {
    const v = await mkVisit({ days: 23, length: 30 });
    expect(await one(v.id, { kind: "editTime", startMinute: 615 })).toMatchObject({ outcome: "updated" });
    let after = await visit(v.id);
    expect(londonMinute(after.scheduledStart)).toBe(615);
    expect(after.scheduledEnd.getTime() - after.scheduledStart.getTime()).toBe(30 * 60000);
    expect(await one(v.id, { kind: "editTime", startMinute: 615 })).toMatchObject({ outcome: "unchanged", message: "Already starts at 10:15" });

    expect(await one(v.id, { kind: "editDuration", minutes: 45 })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "editDuration", minutes: 45 })).toMatchObject({ outcome: "unchanged" });
    after = await visit(v.id);
    expect(after.scheduledEnd.getTime() - after.scheduledStart.getTime()).toBe(45 * 60000);

    expect(await one(v.id, { kind: "nudge", minutes: -15 })).toMatchObject({ outcome: "updated" });
    expect(londonMinute((await visit(v.id)).scheduledStart)).toBe(600);
    await expect(one(v.id, { kind: "nudge", minutes: 0 })).rejects.toThrow(ValidationError);
    await expect(one(v.id, { kind: "editDuration", minutes: 2 })).rejects.toThrow(ValidationError);
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "EDITED" } })).toBe(3);
  });

  it("9 Edit Service Name, 10 Add Alerts and 11 Remove Alerts", async () => {
    const v = await mkVisit({ days: 24 });
    expect(await one(v.id, { kind: "editService", callTypeId: callTypeIds[1]! })).toMatchObject({ outcome: "updated" });
    expect((await visit(v.id)).callTypeId).toBe(callTypeIds[1]);
    expect(await one(v.id, { kind: "editService", callTypeId: callTypeIds[1]! })).toMatchObject({ outcome: "unchanged" });
    expect(await one(v.id, { kind: "alert", on: true })).toMatchObject({ outcome: "unchanged", message: "Late alert already on" });
    expect(await one(v.id, { kind: "alert", on: false })).toMatchObject({ outcome: "updated" });
    expect((await visit(v.id)).alertOnLate).toBe(false);
    expect(await one(v.id, { kind: "alert", on: true })).toMatchObject({ outcome: "updated" });
  });

  it("12 Add Shadow Shifts: a shadow is extra and never fills a required place", async () => {
    const v = await mkVisit({ days: 25 });
    const shadow = await eligibleCarer(v.id, "SHADOW");
    expect(await one(v.id, { kind: "assign", staffId: shadow, slot: "SHADOW", acceptWarnings: true })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "assign", staffId: shadow, slot: "SHADOW", acceptWarnings: true })).toMatchObject({ outcome: "unchanged" });
    const a = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, removedAt: null } });
    expect(a).toMatchObject({ slot: "SHADOW", position: 0 });
    expect((await visit(v.id)).carersRequired).toBe(1);
  });

  it("13 Convert To Double Up, 14 Revert Double Up To Single and 15 Change Carers Needed", async () => {
    const v = await mkVisit({ days: 26 });
    expect(await one(v.id, { kind: "convert", to: "double" })).toMatchObject({ outcome: "updated" });
    expect((await visit(v.id)).carersRequired).toBe(2);
    expect(await one(v.id, { kind: "convert", to: "double" })).toMatchObject({ outcome: "unchanged", message: "Already a double-up" });

    // Reverting is refused while carer 2 is booked; nobody is removed silently.
    const c1 = await eligibleCarer(v.id, "PRIMARY");
    await one(v.id, { kind: "assign", staffId: c1, slot: "PRIMARY", acceptWarnings: true });
    const c2 = await eligibleCarer(v.id, "SECOND", [c1]);
    await one(v.id, { kind: "assign", staffId: c2, slot: "SECOND", acceptWarnings: true });
    expect(await one(v.id, { kind: "convert", to: "single" })).toMatchObject({ outcome: "refused", message: expect.stringMatching(/second carer/) });
    await one(v.id, { kind: "unassign", slot: "SECOND", reason: "Single carer is enough" });
    expect(await one(v.id, { kind: "convert", to: "single" })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "convert", to: "single" })).toMatchObject({ outcome: "unchanged" });

    expect(await one(v.id, { kind: "doubleUp", carers: 4 })).toMatchObject({ outcome: "updated" });
    expect(await one(v.id, { kind: "doubleUp", carers: 4 })).toMatchObject({ outcome: "unchanged", message: "Already needs 4 carers" });
    // Convert and Revert only switch between one and two carers; a four-carer visit is pointed at Change Carers Needed.
    expect(await one(v.id, { kind: "convert", to: "single" })).toMatchObject({ outcome: "refused", message: expect.stringMatching(/Change Carers Needed/) });
    expect(await one(v.id, { kind: "doubleUp", carers: 12 })).toMatchObject({ outcome: "updated" });
    expect((await visit(v.id)).carersRequired).toBe(12);
    await expect(one(v.id, { kind: "doubleUp", carers: 99 })).rejects.toThrow(ValidationError);
  });

  it("17 Publish to Carers: publishes, tells the booked carer in the app only, and never reports already-published visits as updated", async () => {
    const v = await mkVisit({ days: 27, publish: false });
    const carer = await eligibleCarer(v.id);
    await one(v.id, { kind: "assign", staffId: carer, slot: "PRIMARY", acceptWarnings: true });
    const userId = (await db.staffMember.findUniqueOrThrow({ where: { id: carer } })).userId;
    const before = userId ? await db.notification.count({ where: { userId, type: "rota.published" } }) : 0;
    expect(await one(v.id, { kind: "publish" })).toMatchObject({ outcome: "updated" });
    expect((await visit(v.id)).publishedAt).not.toBeNull();
    if (userId) expect(await db.notification.count({ where: { userId, type: "rota.published" } })).toBe(before + 1);
    expect(await one(v.id, { kind: "publish" })).toMatchObject({ outcome: "unchanged", message: "Already published to carers" });
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "PUBLISHED" } })).toBe(1);

    const cancelled = await mkVisit({ days: 27, publish: false, minute: 700 });
    await one(cancelled.id, { kind: "cancel", reason: "Not needed", charge: false });
    expect(await one(cancelled.id, { kind: "publish" })).toMatchObject({ outcome: "refused" });
    expect((await visit(cancelled.id)).publishedAt).toBeNull();
  });

  it("each visit is its own transaction: a refusal leaves the others changed and itself untouched", async () => {
    const a = await mkVisit({ days: 28 });
    const b = await mkVisit({ days: 28, minute: 660 });
    await one(b.id, { kind: "lock", locked: true });
    const r = await bulkVisits(await manager(), [a.id, b.id, a.id], { kind: "nudge", minutes: 30 });
    expect(r).toHaveLength(2); // the same visit ticked twice is changed once
    expect(counts(r)).toEqual({ updated: 1, unchanged: 0, refused: 1, error: 0 });
    expect(londonMinute((await visit(a.id)).scheduledStart)).toBe(630);
    expect((await visit(b.id)).scheduledStart).toEqual(b.scheduledStart);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "visit.bulk.nudge" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ requested: 2, updated: 1, refused: 1, errors: 0 });
  });

  it("the review step runs the real rules and saves nothing", async () => {
    const a = await mkVisit({ days: 29 });
    const b = await mkVisit({ days: 29, minute: 720 });
    await one(b.id, { kind: "cancel", reason: "Not needed", charge: false });
    const before = await db.visitEvent.count({ where: { visitId: { in: [a.id, b.id] } } });
    const rows = await previewBulkVisits(await manager(), [a.id, b.id], { kind: "cancel", reason: "Client away", charge: true });
    expect(rows.map((r) => r.outcome)).toEqual(["updated", "unchanged"]);
    expect(rows[0]).toMatchObject({ reference: a.reference, status: "SCHEDULED", carers: "0/1" });
    expect((await visit(a.id)).status).toBe("SCHEDULED");
    expect(await db.visitEvent.count({ where: { visitId: { in: [a.id, b.id] } } })).toBe(before);
  });

  it("permissions and tenant isolation are checked on the server", async () => {
    const v = await mkVisit({ days: 30 });
    await expect(bulkVisits(await ctxFor("carer@care-solution.demo", BROOKFIELD), [v.id], { kind: "alert", on: false })).rejects.toThrow(ForbiddenError);
    await expect(bulkVisits(await ctxFor("finance@care-solution.demo", BROOKFIELD), [v.id], { kind: "cancel", reason: "x x x", charge: false })).rejects.toThrow(ForbiddenError);
    // Another organisation's manager cannot see or change the visit, and is not told its reference.
    const [r] = await bulkVisits(await ctxFor("manager@oakridge.demo", OAKRIDGE), [v.id], { kind: "cancel", reason: "Not ours", charge: false });
    expect(r).toMatchObject({ outcome: "refused", reference: "—" });
    expect((await visit(v.id)).status).toBe("SCHEDULED");
  });
});

describe("18 Complete Calls", () => {
  const confirm = (extra: Partial<Extract<BulkAction, { kind: "complete" }>> = {}): BulkAction => ({ kind: "complete", reason: "Carer's phone failed; care confirmed by phone", verifiedBy: "Jo Smith, senior carer", confirmed: true, ...extra });

  it("completes one past visit as office confirmed, without any clock, medicine or invented times", async () => {
    const v = await mkVisit({ days: -3, staff: 1 });
    await db.visit.update({ where: { id: v.id }, data: { medicationRequired: true } });
    const r = await one(v.id, confirm(), await coordinator());
    expect(r).toMatchObject({ outcome: "updated", ok: true });
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no medicine record/), expect.stringMatching(/No clock-in/)]));
    const after = await visit(v.id);
    expect(after).toMatchObject({ status: "COMPLETED", completionSource: "OFFICE_CONFIRMED", completedFromStatus: "SCHEDULED", completionVerifiedBy: "Jo Smith, senior carer", actualStart: null, actualEnd: null });
    expect(await db.visitClock.count({ where: { visitId: v.id } })).toBe(0);
    expect(await db.marRecord.count({ where: { visitId: v.id } })).toBe(0);
    const ev = await db.visitEvent.findFirstOrThrow({ where: { visitId: v.id, type: "STATUS", toStatus: "COMPLETED" } });
    expect(ev).toMatchObject({ fromStatus: "SCHEDULED", reason: "Carer's phone failed; care confirmed by phone" });
    expect(ev.data).toMatchObject({ source: "office.complete", verifiedBy: "Jo Smith, senior carer", actualTimesEntered: false });
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "visit.completed.office" } })).toBe(1);
  });

  it("never completes the same visit twice", async () => {
    const v = await mkVisit({ days: -3, staff: 1 });
    await one(v.id, confirm());
    const lock = (await visit(v.id)).lockVersion;
    expect(await one(v.id, confirm())).toMatchObject({ outcome: "unchanged", message: "Already completed by the office" });
    expect((await visit(v.id)).lockVersion).toBe(lock);
    expect(await db.visitEvent.count({ where: { visitId: v.id, toStatus: "COMPLETED" } })).toBe(1);
  });

  it("corrects a missed visit and keeps the missed record, its case and its history", async () => {
    const v = await mkVisit({ days: -4, staff: 1 });
    await db.$transaction(async (tx) => {
      await tx.visit.update({ where: { id: v.id }, data: { status: "MISSED" } });
      await tx.visitEvent.create({ data: { organisationId: orgId, visitId: v.id, type: "STATUS", fromStatus: "SCHEDULED", toStatus: "MISSED", data: { source: "call.sweep" } } });
      await openMissedCase(tx, v);
    });
    const r = await one(v.id, confirm());
    expect(r.outcome).toBe("updated");
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { missedCallCase: { include: { comments: true } }, events: true } });
    expect(after).toMatchObject({ status: "COMPLETED", completedFromStatus: "MISSED" });
    expect(after.events.some((e) => e.toStatus === "MISSED")).toBe(true);
    expect(after.missedCallCase?.stage).toBe("NEW");
    expect(after.missedCallCase?.comments.some((c) => /office confirmed the care was delivered/.test(c.body))).toBe(true);
    expect(visitStatusNow(after)).toBe("Completed by the office (confirmed delivered)");
  });

  it("refuses cancelled, not-delivered, future and unstaffed visits with a reason, and changes none of them", async () => {
    const cancelled = await mkVisit({ days: -3, staff: 1 });
    await one(cancelled.id, { kind: "cancel", reason: "Client in hospital", charge: false });
    const notDelivered = await mkVisit({ days: -3, staff: 1 });
    await db.visit.update({ where: { id: notDelivered.id }, data: { status: "NOT_DELIVERED", notDeliveredReason: "No access" } });
    const future = await mkVisit({ days: 3, minute: 800 });
    const unstaffed = await mkVisit({ days: -3 });
    const r = await bulkVisits(await manager(), [cancelled.id, notDelivered.id, future.id, unstaffed.id], confirm());
    expect(counts(r)).toEqual({ updated: 0, unchanged: 0, refused: 4, error: 0 });
    expect(r[0]!.message).toMatch(/Cancelled visits are not completed/);
    expect(r[1]!.message).toMatch(/not delivered/);
    expect(r[2]!.message).toMatch(/not started/);
    expect(r[3]!.message).toMatch(/Nobody is booked/);
    expect((await db.visit.findMany({ where: { id: { in: [cancelled.id, notDelivered.id, future.id, unstaffed.id] } }, select: { status: true } })).map((x) => x.status).sort()).toEqual(["CANCELLED", "NOT_DELIVERED", "SCHEDULED", "SCHEDULED"]);
  });

  it("completes a partly staffed visit with a warning, and a mixed selection reports exact counts", async () => {
    const partly = await mkVisit({ days: -2, carers: 2, staff: 1 });
    const done = await mkVisit({ days: -2, staff: 1 });
    await one(done.id, confirm());
    const cancelled = await mkVisit({ days: -2, staff: 1 });
    await one(cancelled.id, { kind: "cancel", reason: "Client away", charge: false });
    const ok = await mkVisit({ days: -2, staff: 1 });
    const r = await bulkVisits(await manager(), [partly.id, done.id, cancelled.id, ok.id], confirm());
    expect(counts(r)).toEqual({ updated: 2, unchanged: 1, refused: 1, error: 0 });
    expect(r[0]!.warnings).toEqual(expect.arrayContaining(["Only 1 of 2 carers were booked"]));
  });

  it("records actual times only when entered, and checks them", async () => {
    const v = await mkVisit({ days: -2, staff: 1, minute: 300 });
    expect(await one(v.id, confirm({ perVisit: { [v.id]: { actualStart: "05:10", actualEnd: "05:00" } } }))).toMatchObject({ outcome: "refused", message: expect.stringMatching(/after/) });
    expect(await one(v.id, confirm({ perVisit: { [v.id]: { actualStart: "23:59" } } }))).toMatchObject({ outcome: "refused", message: expect.stringMatching(/12 hours/) });
    expect(await one(v.id, confirm({ perVisit: { [v.id]: { actualStart: "05:05", actualEnd: "05:30" } } }))).toMatchObject({ outcome: "updated" });
    const date = londonDate(v.scheduledStart);
    expect(await visit(v.id)).toMatchObject({ actualStart: londonToUtc(date, 305), actualEnd: londonToUtc(date, 330) });
    expect(await db.visitClock.count({ where: { visitId: v.id } })).toBe(0);
  });

  it("works for today's visits that are under way, keeping the real clock-in", async () => {
    // Just after midnight there is no earlier visit today, so yesterday's late visit stands in.
    const now = londonMinute(new Date());
    const v = await mkVisit(now >= 40 ? { days: 0, staff: 1, minute: now - 30, length: 10 } : { days: -1, staff: 1, minute: 1400, length: 10 });
    const staffId = (await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id } })).staffId;
    const inAt = new Date(v.scheduledStart.getTime() + 60000);
    await db.$transaction(async (tx) => {
      await tx.visitClock.create({ data: { organisationId: orgId, visitId: v.id, staffId, kind: "IN", at: inAt, method: "APP", recordedById: managerId } });
      await tx.visit.update({ where: { id: v.id }, data: { status: "IN_PROGRESS", actualStart: inAt } });
    });
    expect(await one(v.id, confirm())).toMatchObject({ outcome: "updated" });
    expect(await visit(v.id)).toMatchObject({ status: "COMPLETED", completedFromStatus: "IN_PROGRESS", actualStart: inAt, actualEnd: null });
    expect(await db.visitClock.count({ where: { visitId: v.id } })).toBe(1);
  });

  it("needs a reason, who confirmed it, and the coordinator's confirmation; and a visit changed since the review is refused", async () => {
    const v = await mkVisit({ days: -2, staff: 1 });
    await expect(one(v.id, confirm({ reason: "ok" }))).rejects.toThrow(/reason/);
    // A short reason of 3+ letters is enough, as for the other bulk actions.
    expect((await previewBulkVisits(await manager(), [v.id], confirm({ reason: "TEST" })))[0]!.outcome).toBe("updated");
    await expect(one(v.id, confirm({ verifiedBy: "" }))).rejects.toThrow(/who confirmed/);
    await expect(one(v.id, confirm({ confirmed: false }))).rejects.toThrow(/confirm/);
    // The review may be made before ticking the confirmation.
    expect((await previewBulkVisits(await manager(), [v.id], confirm({ confirmed: false })))[0]!.outcome).toBe("updated");
    expect(await one(v.id, confirm({ perVisit: { [v.id]: { lockVersion: v.lockVersion - 1 } } }))).toMatchObject({ outcome: "refused", message: expect.stringMatching(/reviewed/) });
    expect((await visit(v.id)).status).toBe("SCHEDULED");
  });

  it("is only for people allowed to correct attendance records", async () => {
    const v = await mkVisit({ days: -2, staff: 1 });
    await expect(bulkVisits(await ctxFor("carer@care-solution.demo", BROOKFIELD), [v.id], confirm())).rejects.toThrow(ForbiddenError);
    await expect(bulkVisits(await ctxFor("reviewer@care-solution.demo", BROOKFIELD), [v.id], confirm())).rejects.toThrow(ForbiddenError);
    const [r] = await bulkVisits(await ctxFor("manager@oakridge.demo", OAKRIDGE), [v.id], confirm());
    expect(r).toMatchObject({ outcome: "refused", reference: "—" });
    expect((await visit(v.id)).status).toBe("SCHEDULED");
  });

  it("two coordinators completing the same visits at once complete each visit exactly once", async () => {
    const vs = [];
    for (let i = 0; i < 6; i++) vs.push(await mkVisit({ days: -5, staff: 1 }));
    const ids = vs.map((v) => v.id);
    const [a, b] = await Promise.all([bulkVisits(await manager(), ids, confirm()), bulkVisits(await coordinator(), [...ids].reverse(), confirm())]);
    const all = [...a!, ...b!];
    expect(all.filter((r) => r.outcome === "error")).toEqual([]);
    for (const id of ids) {
      expect(all.filter((r) => r.visitId === id && r.outcome === "updated")).toHaveLength(1);
      expect(await db.visitEvent.count({ where: { visitId: id, toStatus: "COMPLETED" } })).toBe(1);
    }
  });

  it("handles a large selection and reports the exact number completed", async () => {
    const vs = [];
    for (let i = 0; i < 40; i++) vs.push(await mkVisit({ days: -6, staff: 1 }));
    const unstaffed = await mkVisit({ days: -6 });
    const r = await bulkVisits(await manager(), [...vs.map((v) => v.id), unstaffed.id], confirm());
    expect(counts(r)).toEqual({ updated: 40, unchanged: 0, refused: 1, error: 0 });
    expect(await db.visit.count({ where: { id: { in: vs.map((v) => v.id) }, status: "COMPLETED", completionSource: "OFFICE_CONFIRMED" } })).toBe(40);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "visit.bulk.complete" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ requested: 41, updated: 40, refused: 1 });
  });

  it("the database refuses an office completion on a visit that is not completed", async () => {
    const v = await mkVisit({ days: -2, staff: 1 });
    await expect(db.visit.update({ where: { id: v.id }, data: { completionSource: "OFFICE_CONFIRMED", completionReason: "x", completionVerifiedBy: "y", completedById: managerId, completedAt: new Date(), completedFromStatus: "SCHEDULED" } })).rejects.toThrow(/visit_office_completion_chk/);
  });
});
