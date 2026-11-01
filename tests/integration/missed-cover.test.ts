import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonTime, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { acknowledgeMyVisits } from "@/server/rota/carer";
import { escalateMissedCase, getMissedCase, missedCallRegister } from "@/server/rota/missed-calls";
import { confirmCover, coverRecord, coverStates, findCoverView, recordServiceUserInformed, type ConfirmCoverInput } from "@/server/rota/missed-cover";
import { visitKpis } from "@/server/rota/overview";
import { listVisits, type Candidate } from "@/server/rota/queries";
import { rosterWeek } from "@/server/rota/roster";
import { cancelVisit } from "@/server/rota/visits";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { makeMissedCall } from "../support/missed-fixture";

/** Find Cover against a real database: ranking, hard rules, warnings, recovery visits, double-ups, concurrency, isolation and the rota views. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let suIds: string[] = [];
let suIx = 0;

/** A fresh missed call for a different service user each time, so tests do not share bookings. */
async function missed(opts: Parameters<typeof makeMissedCall>[1] = {}) {
  const serviceUserId = suIds[suIx++ % suIds.length]!;
  return makeMissedCall(orgId, { serviceUserId, ...opts });
}

/**
 * Recovery times spread over tomorrow night (always within the 48-hour limit and clear of the demo rota's day visits),
 * so carers booked in one test stay free for the next whatever time of day the suite runs.
 */
const slotOf = new Map<string, { date: string; time: string }>();
let slotIx = 0;
function slot(caseId: string) {
  let s = slotOf.get(caseId);
  if (!s) {
    const m = (slotIx++ % 12) * 35;
    slotOf.set(caseId, (s = { date: addDays(londonDate(), 1), time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }));
  }
  return s;
}

async function view(caseId: string, staffId?: string) {
  const ctx = await coordinator();
  return findCoverView(ctx, caseId, { staffId, ...slot(caseId) });
}

/** Confirms the given carer for the default recovery time, acknowledging exactly the warnings the review step shows. */
async function confirmWith(caseId: string, staffId: string, extra: Partial<ConfirmCoverInput> = {}) {
  const v = await view(caseId, staffId);
  return confirmCover(await coordinator(), caseId, { staffId, date: v.date, time: v.time, source: "MANUAL", acknowledged: v.selected!.result.warnings.map((w) => w.message), warningReason: "Known to the family and the nearest carer free", seenRecoveryId: v.state.recovery?.id ?? "", ...extra });
}

async function eligiblePick(caseId: string, skip: string[] = []) {
  const v = await view(caseId);
  const pick = v.recommended.find((c) => !skip.includes(c.id));
  if (!pick) throw new Error("No carer to pick in the demo data");
  return pick;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  suIds = (await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, select: { id: true }, orderBy: { lastName: "asc" } })).map((s) => s.id);
}, 240_000);

describe("Find Cover: recommendations", () => {
  it("shows up to three carers, best first, and never recommends anyone who fails a hard rule", async () => {
    const m = await missed();
    const v = await view(m.caseId);
    expect(v.state.kind).toBe("needed");
    expect(v.recommended.length).toBeGreaterThan(0);
    expect(v.recommended.length).toBeLessThanOrEqual(3);
    expect(v.recommended.every((c) => c.state !== "NOT_ELIGIBLE" && c.score !== null)).toBe(true);
    const scores = v.recommended.map((c) => c.score!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // The manual list shows everyone the coordinator may book, including the ones who cannot be chosen, with the reasons.
    const blocked = v.list.filter((c) => c.state === "NOT_ELIGIBLE");
    expect(blocked.every((c) => c.reasons.length > 0 && c.score === null)).toBe(true);
  });

  it("does not offer the carer who missed the call (that is a late arrival, not cover)", async () => {
    const booked = await eligiblePick((await missed()).caseId);
    const m = await missed({ staffIds: [booked.id] });
    const v = await view(m.caseId);
    expect(v.recommended.map((c) => c.id)).not.toContain(booked.id);
    expect(v.list.find((c) => c.id === booked.id)?.state).toBe("NOT_ELIGIBLE");
    await expect(confirmWith(m.caseId, booked.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("excludes carers on approved sickness or annual leave, and refuses them if chosen by hand", async () => {
    const m = await missed();
    const [a, b] = (await view(m.caseId)).recommended;
    const v0 = await view(m.caseId);
    const win = v0.window!;
    await db.staffAbsence.create({ data: { organisationId: orgId, staffId: a!.id, kind: "SICKNESS", status: "APPROVED", startsAt: new Date(win.start.getTime() - 3600_000), endsAt: new Date(win.end.getTime() + 3600_000), requestedById: "system" } });
    await db.staffAbsence.create({ data: { organisationId: orgId, staffId: b!.id, kind: "HOLIDAY", status: "APPROVED", startsAt: new Date(win.start.getTime() - 3600_000), endsAt: new Date(win.end.getTime() + 3600_000), requestedById: "system" } });
    const v = await view(m.caseId);
    expect(v.recommended.map((c) => c.id)).not.toContain(a!.id);
    expect(v.recommended.map((c) => c.id)).not.toContain(b!.id);
    expect(v.list.find((c) => c.id === a!.id)?.reasons.join(" ")).toMatch(/sickness/);
    expect(v.list.find((c) => c.id === b!.id)?.reasons.join(" ")).toMatch(/holiday/);
    await expect(confirmWith(m.caseId, a!.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(confirmWith(m.caseId, b!.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.visit.count({ where: { recoveryOfId: m.visitId } })).toBe(0);
  });

  it("blocks a readiness restriction, a training failure under a blocking rule, and a service user's block", async () => {
    const m = await missed();
    const [a, b, c] = (await view(m.caseId)).list.filter((x) => x.state !== "NOT_ELIGIBLE");
    await db.staffRestriction.create({ data: { organisationId: orgId, staffId: a!.id, kind: "GENERAL", reason: "Under investigation (test)", startsAt: new Date(addDays(londonDate(), -1)), createdById: "system" } });
    await db.carerPreference.upsert({ where: { serviceUserId_staffId: { serviceUserId: m.serviceUserId, staffId: c!.id } }, create: { organisationId: orgId, serviceUserId: m.serviceUserId, staffId: c!.id, blocked: true, reason: "Client asked (test)", updatedById: "system" }, update: { blocked: true } });
    const training = await db.staffCompliance.findFirst({ where: { staffId: b!.id, category: "Training", required: true } });
    const settings = await db.rotaSettings.findUniqueOrThrow({ where: { organisationId: orgId } });
    if (training) {
      await db.staffCompliance.update({ where: { id: training.id }, data: { verified: false } });
      await db.rotaSettings.update({ where: { organisationId: orgId }, data: { trainingRule: "BLOCK" } });
    }
    try {
      const v = await view(m.caseId);
      const state = (id: string) => v.list.find((x) => x.id === id)?.state;
      expect(state(a!.id)).toBe("NOT_ELIGIBLE");
      expect(state(c!.id)).toBe("NOT_ELIGIBLE");
      if (training) expect(state(b!.id)).toBe("NOT_ELIGIBLE");
      await expect(confirmWith(m.caseId, a!.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(confirmWith(m.caseId, c!.id)).rejects.toBeInstanceOf(ConflictError);
      const rv = await view(m.caseId, a!.id);
      expect(rv.selected!.checks.find((k) => k.label === "Care competencies and readiness")!.state).toBe("fail");
    } finally {
      await db.rotaSettings.update({ where: { organisationId: orgId }, data: { trainingRule: settings.trainingRule } });
      if (training) await db.staffCompliance.update({ where: { id: training.id }, data: { verified: true } });
    }
  });

  it("only shows a green check when the eligibility service passed it", async () => {
    const m = await missed();
    const pick = await eligiblePick(m.caseId);
    const v = await view(m.caseId, pick.id);
    const checks = v.selected!.checks;
    const warnTexts = v.selected!.result.warnings.map((w) => w.message);
    for (const k of checks.filter((x) => x.state === "ok")) for (const w of warnTexts) expect(k.text).not.toContain(w);
    expect(checks.find((k) => k.label === "Rota clashes")!.state).toBe("ok");
  });
});

describe("Find Cover: confirming", () => {
  it("books a linked recovery visit, keeps the missed visit missed and the investigation open", async () => {
    const before = await missed({ minutesAgo: 75 });
    const original = await db.visit.findUniqueOrThrow({ where: { id: before.visitId } });
    const pick = await eligiblePick(before.caseId);
    const r = await confirmWith(before.caseId, pick.id);
    const rv = await db.visit.findUniqueOrThrow({ where: { id: r.recoveryVisitId }, include: { assignments: { where: { removedAt: null } }, tasks: true } });
    expect(rv.recoveryOfId).toBe(before.visitId);
    expect(rv.status).toBe("SCHEDULED");
    expect(rv.publishedAt).not.toBeNull();
    expect(rv.assignments.map((a) => [a.slot, a.staffId])).toEqual([["PRIMARY", pick.id]]);
    expect(rv.tasks.length).toBe(await db.visitTask.count({ where: { visitId: before.visitId } }));
    expect(rv.scheduledEnd.getTime() - rv.scheduledStart.getTime()).toBe(original.scheduledEnd.getTime() - original.scheduledStart.getTime());
    const after = await db.visit.findUniqueOrThrow({ where: { id: before.visitId } });
    expect(after.status).toBe("MISSED");
    expect(after.scheduledStart.getTime()).toBe(original.scheduledStart.getTime());
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id: before.caseId }, include: { covers: true } });
    expect(c.stage).toBe("INVESTIGATING");
    expect(c.replacementType).toBe("REPLACEMENT_VISIT");
    expect(c.covers).toHaveLength(1);
    expect(c.covers[0]!.recoveryVisitId).toBe(rv.id);
    // Recovery not delivered: nothing is marked completed until care is recorded.
    const rec = await coverRecord(await coordinator(), before.caseId);
    expect(rec.facts.find((f) => f.label === "Cover confirmed")!.done).toBe(true);
    expect(rec.facts.find((f) => f.label === "Recovery care delivered")!.done).toBe(false);
    expect(rec.facts.find((f) => f.label === "Investigation signed off")!.done).toBe(false);
    // Audit and case history.
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "MissedCallCase", entityId: before.caseId, action: "rota.missed.cover.confirmed" } });
    expect(a.actorId).toBe((await coordinator()).userId);
    expect(await db.missedCallComment.count({ where: { caseId: before.caseId, kind: "SYSTEM", body: { contains: rv.reference } } })).toBe(1);
    expect(await db.visitEvent.count({ where: { visitId: before.visitId, type: "RECOVERY_BOOKED" } })).toBe(1);
    // Booked once: Find Cover is no longer offered and a second confirmation is refused.
    expect((await coverStates(await coordinator(), [before.caseId])).get(before.caseId)!.kind).toBe("booked");
    const other = await eligiblePick((await missed()).caseId, [pick.id]);
    await expect(confirmCover(await coordinator(), before.caseId, { staffId: other.id, date: londonDate(rv.scheduledStart), time: londonTime(rv.scheduledStart), source: "MANUAL", acknowledged: [], seenRecoveryId: rv.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("needs every warning ticked and a reason, and keeps them in the record", async () => {
    const m = await missed();
    const v = await view(m.caseId);
    let pick: Candidate | undefined = v.list.find((c) => c.state === "REQUIRES_REVIEW");
    if (!pick) {
      // Make one: a service user who prefers the other gender gives a reviewable warning.
      pick = v.recommended[0]!;
      const p = await db.rotaStaffProfile.findUnique({ where: { staffId: pick.id } });
      await db.serviceUser.update({ where: { id: m.serviceUserId }, data: { carerGenderPreference: p?.gender === "MALE" ? "FEMALE" : "MALE" } });
    }
    if (!pick) throw new Error("No carer in the demo data");
    const sel = (await view(m.caseId, pick.id)).selected!;
    const warnings = sel.result.warnings.map((w) => w.message);
    expect(warnings.length).toBeGreaterThan(0);
    const base = { staffId: pick.id, date: v.date, time: v.time, source: "MANUAL" as const, seenRecoveryId: "" };
    const ctx = await coordinator();
    await expect(confirmCover(ctx, m.caseId, { ...base, acknowledged: [], warningReason: "Reason given" })).rejects.toBeInstanceOf(ConflictError);
    await expect(confirmCover(ctx, m.caseId, { ...base, acknowledged: warnings })).rejects.toBeInstanceOf(ValidationError);
    await confirmCover(ctx, m.caseId, { ...base, acknowledged: warnings, warningReason: "Spoke to the family; they are happy with this carer" });
    const cover = await db.missedCallCover.findFirstOrThrow({ where: { caseId: m.caseId } });
    expect(cover.eligibility).toBe("REQUIRES_REVIEW");
    expect(cover.warningsAccepted).toEqual(warnings);
    expect(cover.warningReason).toMatch(/family/);
    const a = await db.visitAssignment.findUniqueOrThrow({ where: { id: cover.assignmentId } });
    expect(a.warningsAccepted).toEqual(warnings);
  });

  it("refuses a stale choice: leave recorded after the panel was opened", async () => {
    const m = await missed();
    const pick = await eligiblePick(m.caseId);
    const v = await view(m.caseId, pick.id);
    await db.staffAbsence.create({ data: { organisationId: orgId, staffId: pick.id, kind: "SICKNESS", status: "APPROVED", startsAt: new Date(v.window!.start.getTime() - 60_000), endsAt: new Date(v.window!.end.getTime() + 60_000), requestedById: "system" } });
    await expect(confirmCover(await coordinator(), m.caseId, { staffId: pick.id, date: v.date, time: v.time, source: "RECOMMENDED", rank: 1, acknowledged: v.selected!.result.warnings.map((w) => w.message), warningReason: "As reviewed", seenRecoveryId: "" })).rejects.toThrow(/can no longer cover/);
  });

  it("lets only one of two coordinators book cover at the same moment", async () => {
    const m = await missed();
    const v = await view(m.caseId);
    const [a, b] = v.recommended;
    if (!a || !b) return;
    const go = async (id: string) => {
      const s = (await view(m.caseId, id)).selected!;
      return confirmCover(await (id === a.id ? coordinator() : manager()), m.caseId, { staffId: id, date: v.date, time: v.time, source: "RECOMMENDED", acknowledged: s.result.warnings.map((w) => w.message), warningReason: "As reviewed", seenRecoveryId: "" });
    };
    const results = await Promise.allSettled([go(a.id), go(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(await db.visit.count({ where: { recoveryOfId: m.visitId } })).toBe(1);
  });

  it("never double-books a carer across two missed calls at the same time", async () => {
    const m1 = await missed();
    const m2 = await missed();
    const pick = await eligiblePick(m1.caseId);
    const v1 = await view(m1.caseId);
    await confirmWith(m1.caseId, pick.id);
    slotOf.set(m2.caseId, { date: v1.date, time: v1.time });
    const v2 = await view(m2.caseId);
    expect(v2.recommended.map((c) => c.id)).not.toContain(pick.id);
    expect(v2.list.find((c) => c.id === pick.id)?.reasons.join(" ")).toMatch(/Already booked/);
    await expect(confirmCover(await coordinator(), m2.caseId, { staffId: pick.id, date: v1.date, time: v1.time, source: "MANUAL", acknowledged: [], seenRecoveryId: "" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("covers a double-up one slot at a time on one recovery visit (both carers missing)", async () => {
    const first = await eligiblePick((await missed()).caseId);
    const second = await eligiblePick((await missed()).caseId, [first.id]);
    const m = await missed({ carersRequired: 2, staffIds: [first.id, second.id] });
    let v = await view(m.caseId);
    expect(v.summary.carersRequired).toBe(2);
    expect(v.still).toBe(2);
    const a = v.recommended[0]!;
    const r1 = await confirmWith(m.caseId, a.id);
    expect(r1.stillNeeded).toBe(1);
    v = await view(m.caseId);
    expect(v.state.kind).toBe("partial");
    expect(v.slot).toBe("SECOND");
    expect(v.recommended.map((c) => c.id)).not.toContain(a.id);
    const b = v.recommended[0]!;
    const r2 = await confirmWith(m.caseId, b.id);
    expect(r2.recoveryVisitId).toBe(r1.recoveryVisitId);
    expect(r2.stillNeeded).toBe(0);
    const rv = await db.visit.findUniqueOrThrow({ where: { id: r1.recoveryVisitId }, include: { assignments: { where: { removedAt: null } } } });
    expect(rv.carersRequired).toBe(2);
    expect(rv.assignments.map((x) => x.slot).sort()).toEqual(["PRIMARY", "SECOND"]);
    expect(await db.visit.count({ where: { recoveryOfId: m.visitId } })).toBe(1);
    expect((await view(m.caseId)).state.kind).toBe("booked");
  });

  it("handles a double-up where only one carer was booked, and a call nobody was booked on", async () => {
    const booked = await eligiblePick((await missed()).caseId);
    const half = await missed({ carersRequired: 2, staffIds: [booked.id] });
    const vh = await view(half.caseId);
    expect(vh.summary.original).toHaveLength(1);
    expect(vh.still).toBe(2);
    const none = await missed();
    const vn = await view(none.caseId);
    expect(vn.summary.original).toHaveLength(0);
    expect(vn.still).toBe(1);
    await confirmWith(none.caseId, vn.recommended[0]!.id);
    expect((await view(none.caseId)).state.kind).toBe("booked");
  });

  it("does not book cover when the booked carer arrived late", async () => {
    const m = await missed();
    await db.visit.update({ where: { id: m.visitId }, data: { status: "IN_PROGRESS", actualStart: new Date() } });
    const v = await view(m.caseId);
    expect(v.state.kind).toBe("late-arrival");
    expect(v.recommended).toHaveLength(0);
    const pick = (await view((await missed()).caseId)).recommended[0]!;
    await expect(confirmCover(await coordinator(), m.caseId, { staffId: pick.id, date: londonDate(), time: "23:59", source: "MANUAL", acknowledged: [], seenRecoveryId: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.visit.count({ where: { recoveryOfId: m.visitId } })).toBe(0);
  });

  it("refuses a recovery time in the past or before the missed visit", async () => {
    const m = await missed();
    const pick = await eligiblePick(m.caseId);
    const past = londonTime(new Date(Date.now() - 3 * 3600_000));
    const v = await findCoverView(await coordinator(), m.caseId, { date: londonDate(new Date(Date.now() - 3 * 3600_000)), time: past });
    expect(v.timeError).toBeTruthy();
    await expect(confirmCover(await coordinator(), m.caseId, { staffId: pick.id, date: londonDate(new Date(Date.now() - 3 * 3600_000)), time: past, source: "MANUAL", acknowledged: [], seenRecoveryId: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows cover again after the recovery visit is cancelled", async () => {
    const m = await missed();
    const pick = await eligiblePick(m.caseId);
    const r = await confirmWith(m.caseId, pick.id);
    await cancelVisit(await coordinator(), r.recoveryVisitId, "Client went to hospital (test)");
    expect((await view(m.caseId)).state.kind).toBe("needed");
  });
});

describe("Find Cover: notifications and the record", () => {
  it("tells a carer with a linked sign-in in-app, and says plainly when nobody could be told", async () => {
    const m = await missed();
    const v = await view(m.caseId);
    const ids = v.list.filter((c) => c.state !== "NOT_ELIGIBLE").map((c) => c.id);
    const staff = await db.staffMember.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } });
    const linked = staff.find((s) => s.userId);
    const unlinked = staff.find((s) => !s.userId);
    if (linked) {
      await confirmWith(m.caseId, linked.id);
      const cover = await db.missedCallCover.findFirstOrThrow({ where: { caseId: m.caseId } });
      expect(cover.notifyStatus).toBe("IN_APP");
      const n = await db.notification.findUniqueOrThrow({ where: { id: cover.notificationId! } });
      expect(n.userId).toBe(linked.userId);
      expect(n.type).toBe("rota.cover.booked");
      expect(n.actionUrl).toBe("/carer");
      // No outbound channel is queued.
      expect(await db.notificationDelivery.count({ where: { notificationId: n.id } })).toBe(0);
      let rec = await coverRecord(await coordinator(), m.caseId);
      expect(rec.facts.find((f) => f.label === "Carer accepted")!.done).toBe(false);
      const carerUser = await db.user.findUniqueOrThrow({ where: { id: linked.userId! } });
      const carerCtx = await ctxFor(carerUser.email, BROOKFIELD).catch(() => null);
      if (carerCtx) {
        await acknowledgeMyVisits(carerCtx).catch(() => undefined);
        rec = await coverRecord(await coordinator(), m.caseId);
      }
    }
    if (unlinked) {
      const m2 = await makeMissedCall(orgId, { serviceUserId: m.serviceUserId });
      slotOf.set(m2.caseId, slot(m.caseId));
      await confirmWith(m2.caseId, unlinked.id);
      const cover = await db.missedCallCover.findFirstOrThrow({ where: { caseId: m2.caseId } });
      expect(cover.notifyStatus).toBe("NO_SIGN_IN");
      expect(cover.notificationId).toBeNull();
      const rec = await coverRecord(await coordinator(), m2.caseId);
      expect(rec.facts.find((f) => f.label === "Carer notified")!.text).toMatch(/no linked sign-in/);
    }
    expect(linked || unlinked).toBeTruthy();
  });

  it("records whether the service user was told, separately from cover", async () => {
    const m = await missed();
    await expect(recordServiceUserInformed(await coordinator(), m.caseId, { status: "MAYBE" })).rejects.toBeInstanceOf(ValidationError);
    await recordServiceUserInformed(await coordinator(), m.caseId, { status: "REPRESENTATIVE_INFORMED", note: "Son by phone at 14:05" });
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id: m.caseId } });
    expect(c.suInformedStatus).toBe("REPRESENTATIVE_INFORMED");
    expect(c.clientInformed).toMatch(/Son by phone/);
    const rec = await coverRecord(await coordinator(), m.caseId);
    expect(rec.facts.find((f) => f.label === "Service user informed")!.done).toBe(true);
    expect(rec.facts.find((f) => f.label === "Cover confirmed")!.done).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: m.caseId, action: "rota.missed.su-informed" } })).toBe(1);
  });

  it("escalates to the managers when nobody can cover", async () => {
    const m = await missed();
    await escalateMissedCase(await coordinator(), m.caseId, "No suitable carer available to cover this missed call.");
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id: m.caseId } });
    expect(c.escalatedAt).not.toBeNull();
    expect(await db.notification.count({ where: { type: "rota.missed.escalated", actionUrl: `/rota/missed/${m.caseId}` } })).toBeGreaterThan(0);
    expect((await view(m.caseId)).summary.escalatedAt).not.toBeNull();
  });

  it("keeps the existing investigation working after cover is booked", async () => {
    const m = await missed();
    await confirmWith(m.caseId, (await eligiblePick(m.caseId)).id);
    const d = await getMissedCase(await coordinator(), m.caseId);
    expect(d.c.replacementType).toBe("REPLACEMENT_VISIT");
    expect(d.auditTrail.map((a) => a.action)).toContain("rota.missed.cover.confirmed");
  });
});

describe("Find Cover: access", () => {
  it("never books another organisation's staff or shows another organisation's case", async () => {
    const m = await missed();
    const oak = await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } });
    const outsider = await db.staffMember.findFirst({ where: { organisationId: oak.id } });
    const v = await view(m.caseId);
    if (outsider) {
      await expect(confirmCover(await coordinator(), m.caseId, { staffId: outsider.id, date: v.date, time: v.time, source: "MANUAL", acknowledged: [], seenRecoveryId: "" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(findCoverView(await coordinator(), m.caseId, { staffId: outsider.id })).rejects.toBeInstanceOf(NotFoundError);
    }
    const oakMember = await db.membership.findFirst({ where: { organisationId: oak.id, roles: { hasSome: ["CARE_COORDINATOR", "CARE_MANAGER", "ORG_ADMIN"] } }, include: { user: true } });
    if (oakMember) await expect(findCoverView(await ctxFor(oakMember.user.email, OAKRIDGE), m.caseId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps a branch-limited coordinator to their own branch's cases and staff", async () => {
    const coord = await coordinator();
    const m = await missed();
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: m.serviceUserId } });
    const other = await db.branch.findFirst({ where: { organisationId: orgId, id: { not: su.branchId ?? "" } } });
    if (!other || !su.branchId) return;
    const admin = await manager();
    const membership = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: coord.userId } });
    await setMemberBranches(admin, membership.id, [other.id]);
    try {
      await expect(findCoverView(await coordinator(), m.caseId)).rejects.toThrow();
      const pick = (await findCoverView(admin, m.caseId, slot(m.caseId))).recommended[0]!;
      await expect(confirmCover(await coordinator(), m.caseId, { staffId: pick.id, date: londonDate(), time: "23:00", source: "MANUAL", acknowledged: [], seenRecoveryId: "" })).rejects.toThrow();
      expect(await db.visit.count({ where: { recoveryOfId: m.visitId } })).toBe(0);
    } finally {
      await setMemberBranches(admin, membership.id, []);
    }
  });

  it("needs rota.edit to open Find Cover", async () => {
    const m = await missed();
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(findCoverView(carer, m.caseId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Find Cover: rota views and figures", () => {
  it("shows the recovery visit on the Daily Rota and Weekly Planner, and counts the care need once", async () => {
    const m = await missed({ minutesAgo: 45 });
    const pick = await eligiblePick(m.caseId);
    const r = await confirmWith(m.caseId, pick.id);
    const rv = await db.visit.findUniqueOrThrow({ where: { id: r.recoveryVisitId } });
    const day = londonDate(rv.scheduledStart);
    const ctx = await coordinator();
    const daily = await listVisits(ctx, { date: day });
    const row = daily.rows.find((x) => x.id === rv.id);
    expect(row?.assignments.map((a) => a.staffId)).toContain(pick.id);
    const week = await rosterWeek(ctx, { week: mondayOf(day) }, (id) => `/rota/visits/${id}`);
    expect(JSON.stringify(week)).toContain(rv.id);
    // Refresh does not undo it: a second read sees the same booking.
    expect((await listVisits(ctx, { date: day })).rows.find((x) => x.id === rv.id)?.assignments).toHaveLength(1);
    // Figures: the missed visit stays missed; when both are in the list, the recovery is not counted again.
    const missedDay = londonDate(m.start);
    const both = (await listVisits(ctx, { date: missedDay, to: day })).rows;
    const k = visitKpis(both);
    const kWithout = visitKpis(both.filter((x) => x.id !== rv.id));
    expect(k.total).toBe(kWithout.total);
    expect(k.missed).toBe(kWithout.missed);
    expect(both.find((x) => x.id === m.visitId)?.status).toBe("MISSED");
    const reg = await missedCallRegister(ctx, { period: "custom", from: missedDay, to: day });
    expect(reg.rows.some((x) => x.id === m.caseId)).toBe(true);
    const visitsInPeriod = await db.visit.count({ where: { organisationId: orgId, date: { gte: new Date(missedDay), lte: new Date(day) }, status: { not: "CANCELLED" }, recoveryOfId: null } });
    const recoveriesOfOthers = await db.visit.count({ where: { organisationId: orgId, date: { gte: new Date(missedDay), lte: new Date(day) }, status: { not: "CANCELLED" }, recoveryOf: { date: { lt: new Date(missedDay) } } } });
    expect(reg.rings.total).toBe(visitsInPeriod + recoveriesOfOthers);
  });
});
