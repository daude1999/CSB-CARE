import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { londonDate } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { sweepCalls } from "@/server/rota/monitor";
import {
  addCaseComment, addCaseEvidence, addFollowUp, assignCoordinator, bulkMissed, completeFollowUp, escalateMissedCase, escalateOverdueCases, exportMissedCalls,
  getMissedCase, missedCallRegister, missedHistory, readCaseEvidence, recordReason, recordReplacement, reopenMissedCase, signOffMissedCase, submitForSignOff,
} from "@/server/rota/missed-calls";
import { rotaReport, parseFilters } from "@/server/rota/reports";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** Missed Calls against a real database: cases open with the sweep, every investigation step, sign-off rules, filters, figures and exports. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const MIN = 60_000;
let orgId = "";

async function freshCase() {
  const c = await db.missedCallCase.findFirstOrThrow({ where: { organisationId: orgId, stage: "NEW", reasonCode: null, coordinatorId: null, escalatedAt: null }, orderBy: { scheduledStart: "desc" } });
  return c;
}

async function investigated(caseId: string) {
  const coord = await coordinator();
  await recordReason(coord, caseId, { reasonCode: "CARER_TRAVEL", findings: "Car broke down on the way; the carer did not ring the office." });
  await recordReplacement(coord, caseId, { replacementType: "FAMILY_COVERED", clientInformed: "Son told by phone at 08:25" });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 240_000);

describe("missed calls", () => {
  it("opens exactly one case when the sweep marks a call missed, with the booked carer as a snapshot", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date() }, assignments: { some: { removedAt: null, slot: "PRIMARY" } } }, include: { assignments: { where: { removedAt: null, slot: "PRIMARY" } } }, orderBy: { scheduledStart: "asc" } });
    const s = await db.rotaSettings.findUniqueOrThrow({ where: { organisationId: orgId } });
    const at = new Date(v.scheduledStart.getTime() + (s.missedAfterMin + 1) * MIN);
    await sweepCalls({ organisationId: orgId, now: at });
    await sweepCalls({ organisationId: orgId, now: at });
    const cases = await db.missedCallCase.findMany({ where: { visitId: v.id } });
    expect(cases).toHaveLength(1);
    expect(cases[0]!.staffId).toBe(v.assignments[0]!.staffId);
    expect(cases[0]!.stage).toBe("NEW");
    expect(cases[0]!.deadline!.getTime()).toBe(at.getTime() + 30 * MIN);
  });

  it("seeds demo cases at every stage", async () => {
    const stages = await db.missedCallCase.groupBy({ by: ["stage"], where: { organisationId: orgId }, _count: true });
    expect(stages.map((s) => s.stage).sort()).toEqual(["AWAITING_SIGNOFF", "CLOSED", "INVESTIGATING", "NEW"]);
  });

  it("validates the reason, records it and moves the case to investigating", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    await expect(recordReason(coord, c.id, { reasonCode: "NOPE", findings: "Something long enough" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordReason(coord, c.id, { reasonCode: "CARER_SICKNESS", findings: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordReason(coord, c.id, { reasonCode: "OTHER", findings: "Something long enough" })).rejects.toBeInstanceOf(ValidationError);
    await recordReason(coord, c.id, { reasonCode: "CARER_SICKNESS", findings: "Carer was taken ill overnight and did not call in." });
    const after = await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.stage).toBe("INVESTIGATING");
    expect(after.reasonRecordedById).toBe(coord.userId);
    expect(after.coordinatorId).toBe(coord.userId);
    expect(await db.auditLog.count({ where: { entityType: "MissedCallCase", entityId: c.id, action: "rota.missed.reason" } })).toBe(1);
  });

  it("refuses a stale edit (optimistic locking)", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    await recordReason(coord, c.id, { reasonCode: "ACCESS", findings: "Key safe code had been changed by the family.", lockVersion: c.lockVersion });
    await expect(recordReason(coord, c.id, { reasonCode: "ROTA_ERROR", findings: "A second edit from an old page", lockVersion: c.lockVersion })).rejects.toBeInstanceOf(ConflictError);
  });

  it("checks a replacement carer with the eligibility service and needs the details", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    await expect(recordReplacement(coord, c.id, { replacementType: "REPLACEMENT_VISIT", clientInformed: "Told by phone" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordReplacement(coord, c.id, { replacementType: "CARER_ARRIVED_LATE", clientInformed: "Told by phone" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordReplacement(coord, c.id, { replacementType: "FAMILY_COVERED", clientInformed: "" })).rejects.toBeInstanceOf(ValidationError);
    // A staff member from another organisation is never found.
    const oak = await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } });
    const outsider = await db.staffMember.findFirst({ where: { organisationId: oak.id } });
    if (outsider) await expect(recordReplacement(coord, c.id, { replacementType: "REPLACEMENT_VISIT", replacementStaffId: outsider.id, arrivedAt: "09:05", clientInformed: "Told" })).rejects.toBeInstanceOf(NotFoundError);
    await recordReplacement(coord, c.id, { replacementType: "NONE_POSSIBLE", clientInformed: "Daughter told at 08:30" });
    const after = await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.replacementType).toBe("NONE_POSSIBLE");
    // No replacement possible tells the care managers in-app.
    expect(await db.notification.count({ where: { organisationId: orgId, type: "rota.missed.nocare", actionUrl: `/rota/missed/${c.id}` } })).toBeGreaterThan(0);
  });

  it("assigns a coordinator and follow-up actions, telling the owner in-app", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    const mgr = await manager();
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(assignCoordinator(mgr, c.id, carer.userId)).rejects.toBeInstanceOf(ValidationError);
    await assignCoordinator(mgr, c.id, coord.userId);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } })).coordinatorId).toBe(coord.userId);
    expect(await db.notification.count({ where: { userId: coord.userId, type: "rota.missed.assigned", actionUrl: `/rota/missed/${c.id}` } })).toBe(1);
    await expect(addFollowUp(mgr, c.id, { text: "Call", ownerId: coord.userId, due: "2020-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await addFollowUp(mgr, c.id, { text: "Welfare call this evening", ownerId: coord.userId, due: londonDate() });
    const a = await db.missedCallAction.findFirstOrThrow({ where: { caseId: c.id } });
    expect(await db.notification.count({ where: { userId: coord.userId, type: "rota.missed.action" } })).toBeGreaterThan(0);
    await completeFollowUp(coord, a.id);
    await expect(completeFollowUp(coord, a.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps comments and evidence, and serves evidence only inside the organisation", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    await expect(addCaseComment(coord, c.id, " ")).rejects.toBeInstanceOf(ValidationError);
    await addCaseComment(coord, c.id, "Spoke to the family; they were not worried.");
    const doc = await addCaseEvidence(coord, c.id, { name: "call-log.txt", type: "text/plain", bytes: Buffer.from("08:22 carer rang the office") }, "Phone log");
    await expect(addCaseEvidence(coord, c.id, { name: "fake.pdf", type: "application/pdf", bytes: Buffer.from("not a pdf") })).rejects.toBeInstanceOf(ValidationError);
    const read = await readCaseEvidence(coord, doc.id);
    expect(read.bytes.toString()).toContain("carer rang");
    const oakAdmin = await ctxFor("manager@oakridge.demo", OAKRIDGE).catch(() => null);
    if (oakAdmin) await expect(readCaseEvidence(oakAdmin, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    // Comments are a permanent record.
    const comment = await db.missedCallComment.findFirstOrThrow({ where: { caseId: c.id, kind: "COMMENT" } });
    await expect(db.missedCallComment.update({ where: { id: comment.id }, data: { body: "changed" } })).rejects.toThrow();
  });

  it("needs a reason and replacement before sign-off, and the investigator cannot sign off their own case", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    const mgr = await manager();
    const outcome = { outcome: "MISSED_CARER", preventable: "yes" as const, outcomeNote: "Reminded about calling the office when delayed." };
    await expect(submitForSignOff(coord, c.id, outcome)).rejects.toBeInstanceOf(ValidationError);
    await investigated(c.id);
    await submitForSignOff(coord, c.id, outcome);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("AWAITING_SIGNOFF");
    await expect(recordReason(coord, c.id, { reasonCode: "ROTA_ERROR", findings: "Changed after submitting" })).rejects.toBeInstanceOf(ConflictError);
    // A coordinator is not a manager.
    await expect(signOffMissedCase(coord, c.id, { decision: "approve", note: "" })).rejects.toBeInstanceOf(ForbiddenError);
    // A manager who recorded the reason cannot sign off.
    const c2 = await freshCase();
    await recordReason(mgr, c2.id, { reasonCode: "ROTA_ERROR", findings: "The run was built without travel time." });
    await recordReplacement(mgr, c2.id, { replacementType: "NOT_NEEDED", clientInformed: "Client was in hospital" });
    await submitForSignOff(coord, c2.id, outcome);
    await expect(signOffMissedCase(mgr, c2.id, { decision: "approve", note: "" })).rejects.toBeInstanceOf(ForbiddenError);
    // Sending back needs a note and reopens the investigation.
    await expect(signOffMissedCase(mgr, c.id, { decision: "return", note: "" })).rejects.toBeInstanceOf(ValidationError);
    await signOffMissedCase(mgr, c.id, { decision: "return", note: "Add what the carer said" });
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("INVESTIGATING");
    await submitForSignOff(coord, c.id, outcome);
    await signOffMissedCase(mgr, c.id, { decision: "approve", note: "Agreed" });
    const closed = await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(closed.stage).toBe("CLOSED");
    expect(closed.signedOffById).toBe(mgr.userId);
    // The Exceptions register's alert for the same call is resolved too.
    expect(await db.rotaAlert.count({ where: { visitId: c.visitId, kind: "MISSED", resolvedAt: null } })).toBe(0);
    await expect(reopenMissedCase(coord, c.id, "Family complained")).rejects.toBeInstanceOf(ForbiddenError);
    await reopenMissedCase(mgr, c.id, "Family raised a complaint");
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("INVESTIGATING");
  });

  it("escalates by hand once, and overdue uninvestigated cases from the sweep job, in-app only", async () => {
    const c = await freshCase();
    const coord = await coordinator();
    const jobs = await db.backgroundJob.count({ where: { type: "notification.deliver" } });
    await expect(escalateMissedCase(coord, c.id, "no")).rejects.toBeInstanceOf(ValidationError);
    await escalateMissedCase(coord, c.id, "High-risk client and nobody can reach the family");
    await expect(escalateMissedCase(coord, c.id, "Again please")).rejects.toBeInstanceOf(ConflictError);
    expect(await db.notification.count({ where: { type: "rota.missed.escalated", actionUrl: `/rota/missed/${c.id}` } })).toBeGreaterThan(0);
    expect(await db.backgroundJob.count({ where: { type: "notification.deliver" } })).toBe(jobs);
    const overdue = await freshCase();
    await db.missedCallCase.update({ where: { id: overdue.id }, data: { deadline: new Date(Date.now() - MIN) } });
    expect(await escalateOverdueCases()).toBeGreaterThanOrEqual(1);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: overdue.id } })).escalatedAt).not.toBeNull();
    expect(await escalateOverdueCases()).toBe(0);
  });

  it("filters, searches and counts the register consistently", async () => {
    const mgr = await manager();
    const all = await missedCallRegister(mgr, { period: "custom", from: "2020-01-01", to: londonDate() });
    expect(all.kpis.total).toBe(await db.missedCallCase.count({ where: { organisationId: orgId, scheduledStart: { gte: new Date(`${all.range.from}T00:00:00Z`) } } }));
    expect(all.rows).toHaveLength(all.kpis.total);
    const un = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, smart: "uninvestigated" });
    expect(un.rows).toHaveLength(all.kpis.uninvestigated);
    expect(un.rows.every((r) => !r.reasonCode && r.stage !== "CLOSED")).toBe(true);
    const high = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, smart: "highrisk" });
    expect(high.rows).toHaveLength(all.kpis.highRisk);
    const repeat = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, smart: "repeat" });
    expect(new Set(repeat.rows.map((r) => r.staffId)).size).toBeLessThanOrEqual(all.kpis.repeatOffenders);
    const closed = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, stage: "CLOSED" });
    expect(closed.rows).toHaveLength(all.kpis.resolved);
    const withCarer = all.rows.find((r) => r.carerName);
    if (withCarer) {
      const byCarer = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, carer: withCarer.staffId! });
      expect(byCarer.rows.every((r) => r.staffId === withCarer.staffId)).toBe(true);
      const searched = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, q: withCarer.carerName!.slice(0, 5) });
      expect(searched.rows.some((r) => r.id === withCarer.id)).toBe(true);
      const hist = await missedHistory(mgr, { staffId: withCarer.staffId! });
      expect(hist.rows.length).toBeGreaterThan(0);
    }
    const reason = await missedCallRegister(mgr, { period: "custom", from: all.range.from, to: all.range.to, reason: "none" });
    expect(reason.rows.every((r) => !r.reasonCode)).toBe(true);
    const week = await missedCallRegister(mgr, { period: "week" });
    expect(week.range.to > week.range.from).toBe(true);
  });

  it("limits a branch-limited coordinator to their own branches' cases", async () => {
    const coord = await coordinator();
    const branches = await db.branch.findMany({ where: { organisationId: orgId }, orderBy: { name: "asc" } });
    const mine = branches[0]!;
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: coord.userId } });
    await setMemberBranches(await ctxFor("manager@care-solution.demo", BROOKFIELD), m.id, [mine.id]);
    try {
      const limited = await coordinator();
      const reg = await missedCallRegister(limited, { period: "custom", from: "2020-01-01", to: londonDate() });
      const areas = (await db.area.findMany({ where: { branchId: mine.id }, select: { id: true } })).map((a) => a.id);
      expect(reg.rows.every((r) => !r.areaId || areas.includes(r.areaId))).toBe(true);
      const other = await db.missedCallCase.findFirst({ where: { organisationId: orgId, areaId: { notIn: areas, not: null } } });
      if (other) await expect(getMissedCase(limited, other.id)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(await ctxFor("manager@care-solution.demo", BROOKFIELD), m.id, []);
    }
  });

  it("bulk-assigns and reports what was skipped", async () => {
    const mgr = await manager();
    const coord = await coordinator();
    const ids = (await db.missedCallCase.findMany({ where: { organisationId: orgId, stage: { not: "CLOSED" } }, take: 3, select: { id: true } })).map((x) => x.id);
    const closed = await db.missedCallCase.findFirstOrThrow({ where: { organisationId: orgId, stage: "CLOSED" } });
    const r = await bulkMissed(mgr, [...ids, closed.id], "assign", { coordinatorId: coord.userId });
    expect(r.done).toBe(3);
    expect(r.skipped).toHaveLength(1);
    await expect(bulkMissed(mgr, [], "assign", { coordinatorId: coord.userId })).rejects.toBeInstanceOf(ValidationError);
  });

  it("exports real Excel and PDF files for managers only, and the Missed calls report agrees", async () => {
    const mgr = await manager();
    const xlsx = await exportMissedCalls(mgr, { period: "custom", from: "2020-01-01", to: londonDate() }, "xlsx");
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");
    const pdf = await exportMissedCalls(mgr, { period: "custom", from: "2020-01-01", to: londonDate() }, "pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(exportMissedCalls(await coordinator(), { period: "week" }, "xlsx")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "rota.missed.exported" } })).toBe(2);
    const today = londonDate();
    const from = new Date(Date.now() - 80 * 86400000).toISOString().slice(0, 10);
    const report = await rotaReport(mgr, parseFilters({ report: "missed", from, to: today }));
    const reg = await missedCallRegister(mgr, { period: "custom", from, to: today });
    expect(report.totals?.[1]).toBe(reg.kpis.total);
  });
});
