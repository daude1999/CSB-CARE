import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ownerDb } from "../support/owner-db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hhmm, londonDate, londonMinute, dbDate } from "@/lib/london";
import { drain } from "@/server/jobs/queue";
import { handlers } from "@/worker/handlers";
import { sweepCalls } from "@/server/rota/monitor";
import { visitReference } from "@/server/rota/visits";
import { recordReplacement, signOffMissedCase, submitForSignOff, escalateOverdueCases } from "@/server/rota/missed-calls";
import { requestClockCorrection } from "@/server/rota/corrections";
import { myStaff } from "@/server/workforce/link";
import { setMissedAutomation } from "@/server/rota/missed-auto/settings";
import { automationDetail, automationState, refreshEvidence, runInvestigation, catchUpInvestigations } from "@/server/rota/missed-auto/runs";
import { checkConfirmationDeadlines, getMyConfirmation, myMissedConfirmations, submitCarerResponse } from "@/server/rota/missed-auto/confirmations";
import { acceptSuggestion, dismissSuggestion } from "@/server/rota/missed-auto/review";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The automated missed-call investigation against a real database: the booked-carer snapshot, evidence runs as jobs,
 * carer confirmation with its access rules, deadlines, the rules-based suggestion and the coordinator's decision, and
 * proof that none of it changes the visit, its clocks, corrections or the case's own workflow.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const MIN = 60_000;
let orgId = "";
let ameliaId = "";
let noLoginStaffId = "";
let key = 0;
const nextKey = () => `test-submission-${++key}-${Date.now()}`;

/** A visit that started `minutesAgo` ago with the given carers booked before the sweep, then marked missed by the real sweep. */
async function missedVisit(staffIds: string[], opts: { minutesAgo?: number; carersRequired?: number; highRisk?: boolean } = {}) {
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: opts.highRisk ? "HIGH" : { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true }, orderBy: { name: "asc" } });
  // Find a half-hour in the last day when none of the carers is booked, so the fixture never collides with real bookings.
  let start = new Date(Math.floor((Date.now() - (opts.minutesAgo ?? 45) * MIN) / MIN) * MIN);
  for (let i = 0; i < 40; i++) {
    const clash = await db.visitAssignment.count({ where: { staffId: { in: staffIds }, removedAt: null, blocking: true, startsAt: { lt: new Date(start.getTime() + 30 * MIN) }, endsAt: { gt: start } } });
    if (!clash) break;
    start = new Date(start.getTime() - 35 * MIN);
  }
  const v = await db.visit.create({ data: { organisationId: orgId, reference: visitReference(londonDate(start)), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(londonDate(start)), scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * MIN), carersRequired: opts.carersRequired ?? Math.max(1, staffIds.length), publishedAt: new Date(), notes: "Synthetic test visit" } });
  const slots = ["PRIMARY", "SECOND"] as const;
  for (const [i, staffId] of staffIds.entries()) await db.visitAssignment.create({ data: { organisationId: orgId, visitId: v.id, slot: slots[i]!, staffId, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: "system" } });
  await sweepCalls({ organisationId: orgId, now: new Date() });
  const c = await db.missedCallCase.findUniqueOrThrow({ where: { visitId: v.id } });
  return { visit: v, caseId: c.id };
}

const runJobs = () => drain("test", handlers, { types: ["missed.investigate"], max: 200 });
const switches = async (on: { evidence: boolean; confirm: boolean; summary: boolean }) => setMissedAutomation(await manager(), { ...on, confirmMinutes: 60, reminders: 1, reminderMinutes: 30 });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
  noLoginStaffId = (await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, userId: null, employmentStatus: "ACTIVE", hrMissing: false } })).id;
  // Anything already due in the seeded rota is marked missed now, before the automation is switched on.
  await sweepCalls({ organisationId: orgId, now: new Date() });
}, 240_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("with the automation switched off", () => {
  it("still opens exactly one case and snapshots every booked carer, but runs and asks nothing", async () => {
    const { caseId } = await missedVisit([ameliaId, noLoginStaffId], { carersRequired: 2 });
    await sweepCalls({ organisationId: orgId, now: new Date() });
    expect(await db.missedCallCase.count({ where: { id: caseId } })).toBe(1);
    const snap = await db.missedCallCarerConfirmation.findMany({ where: { caseId }, orderBy: { position: "asc" } });
    expect(snap.map((s) => [s.staffId, s.slot, s.status])).toEqual([[ameliaId, "PRIMARY", "NOT_REQUESTED"], [noLoginStaffId, "SECOND", "NOT_REQUESTED"]]);
    expect(snap[0]!.userIdAtDetection).not.toBeNull();
    expect(snap[1]!.userIdAtDetection).toBeNull();
    expect(await db.backgroundJob.count({ where: { type: "missed.investigate", payload: { path: ["caseId"], equals: caseId } } })).toBe(0);
    expect(await runInvestigation(caseId, "MANUAL")).toEqual({ skipped: "off" });
    await expect(refreshEvidence(await coordinator(), caseId)).rejects.toBeInstanceOf(ValidationError);
    // The snapshot cannot be rewritten by a later rota change.
    await expect(db.missedCallCarerConfirmation.update({ where: { id: snap[0]!.id }, data: { staffId: noLoginStaffId } })).rejects.toThrow(/cannot be changed/);
  });

  it("only lets an organisation admin change the switches, and needs evidence before the other stages", async () => {
    await expect(setMissedAutomation(await coordinator(), { evidence: true, confirm: false, summary: false, confirmMinutes: 60, reminders: 1, reminderMinutes: 30 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(switches({ evidence: false, confirm: true, summary: false })).rejects.toBeInstanceOf(ValidationError);
    await expect(setMissedAutomation(await manager(), { evidence: true, confirm: true, summary: true, confirmMinutes: 60, reminders: 1, reminderMinutes: 90 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("with the automation switched on", () => {
  let caseId = "";
  let visitId = "";
  let confirmationId = "";

  beforeAll(async () => {
    await switches({ evidence: true, confirm: true, summary: true });
  });

  it("queues one evidence job after the case is committed, collects evidence and asks the linked carer only", async () => {
    const m = await missedVisit([ameliaId, noLoginStaffId], { carersRequired: 2 });
    caseId = m.caseId;
    visitId = m.visit.id;
    await sweepCalls({ organisationId: orgId, now: new Date() });
    expect(await db.backgroundJob.count({ where: { type: "missed.investigate", idempotencyKey: `missed-inv:${caseId}:DETECTED` } })).toBe(1);
    const before = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    const caseBefore = await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } });
    await runJobs();
    const run = await db.missedCallInvestigationRun.findFirstOrThrow({ where: { caseId, status: "COMPLETED" } });
    expect(run.reason).toBe("DETECTED");
    const items = run.evidence as { key: string; availability: string }[];
    expect(items.find((i) => i.key === "attendance.none")?.availability).toBe("ABSENT");
    expect(items.some((i) => i.key === `booking.snapshot:${noLoginStaffId}`)).toBe(true);
    // Minimised: no address or phone number in the snapshot, by key or by value.
    const snap = JSON.stringify(run.evidence);
    expect(snap).not.toMatch(/"(postcode|addressLine\d?|phone|altPhone)"/i);
    const person = await db.serviceUser.findUniqueOrThrow({ where: { id: m.visit.serviceUserId } });
    for (const v of [person.postcode, person.addressLine1, person.phone, person.altPhone]) if (v) expect(snap).not.toContain(v);
    const confs = await db.missedCallCarerConfirmation.findMany({ where: { caseId }, orderBy: { position: "asc" } });
    expect(confs.map((c) => c.status)).toEqual(["REQUESTED", "NO_LOGIN"]);
    confirmationId = confs[0]!.id;
    const n = await db.notification.findMany({ where: { dedupeKey: `missed-confirm:${confirmationId}` } });
    expect(n).toHaveLength(1);
    expect(n[0]!.actionUrl).toBe(`/carer/missed/${confirmationId}`);
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: m.visit.serviceUserId } });
    expect(n[0]!.body).not.toContain(su.lastName);
    // The case's own workflow and the visit are untouched.
    const after = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(after.lockVersion).toBe(before.lockVersion);
    const caseAfter = await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } });
    expect([caseAfter.stage, caseAfter.reasonCode, caseAfter.outcome, caseAfter.lockVersion]).toEqual([caseBefore.stage, null, null, caseBefore.lockVersion]);
    expect(await db.visitClock.count({ where: { visitId } })).toBe(0);
    // Asking twice does not ask twice.
    await runInvestigation(caseId, "MANUAL");
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `missed-confirm:${confirmationId}` } } })).toBe(1);
    const draft = await db.missedCallInvestigationDraft.findFirstOrThrow({ where: { caseId, reviewStatus: "PENDING" } });
    expect(draft.classification).toBe("AWAITING_CARER");
    expect(draft.suggestedReason).toBeNull();
  });

  it("records an unchanged re-check as UNCHANGED, with no new suggestion", async () => {
    const drafts = await db.missedCallInvestigationDraft.count({ where: { caseId } });
    const r = await runInvestigation(caseId, "MANUAL");
    expect("unchanged" in r && r.unchanged).toBe(true);
    expect(await db.missedCallInvestigationDraft.count({ where: { caseId } })).toBe(drafts);
    await expect(db.missedCallInvestigationRun.updateMany({ where: { caseId, status: "COMPLETED" }, data: { error: "edited" } })).rejects.toThrow(/cannot be changed/);
  });

  it("shows the carer only their own request, with only what they need to recognise the visit", async () => {
    const mine = await myMissedConfirmations(await carer());
    expect(mine.map((m) => m.id)).toContain(confirmationId);
    const { c } = await getMyConfirmation(await carer(), confirmationId);
    expect(Object.keys(c.case.visit.serviceUser).sort()).toEqual(["firstName", "lastName", "preferredName"]);
    // Someone else in the organisation, an office user and another organisation get nothing.
    await expect(getMyConfirmation(await ctxFor("carer2@care-solution.demo", BROOKFIELD), confirmationId)).rejects.toBeInstanceOf(Error);
    await expect(getMyConfirmation(await coordinator(), confirmationId)).rejects.toBeInstanceOf(ForbiddenError);
    const otherConf = await db.missedCallCarerConfirmation.findFirstOrThrow({ where: { caseId, staffId: noLoginStaffId } });
    await expect(getMyConfirmation(await carer(), otherConf.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitCarerResponse(await carer(), otherConf.id, { answer: "OTHER", explanation: "Trying someone else's", submissionKey: nextKey() })).rejects.toBeInstanceOf(NotFoundError);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(automationDetail(oak, caseId)).rejects.toBeInstanceOf(Error);
  });

  it("validates the answer, stores it once, keeps it unchanged and adds further statements alongside", async () => {
    const me = await carer();
    await expect(submitCarerResponse(me, confirmationId, { answer: "ATTENDED_NO_CLOCK", submissionKey: nextKey() })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitCarerResponse(me, confirmationId, { answer: "NOT_AN_ANSWER", submissionKey: nextKey() })).rejects.toBeInstanceOf(ValidationError);
    const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    const arrive = hhmm(londonMinute(new Date(v.scheduledStart.getTime() + 3 * MIN)));
    const leave = hhmm(londonMinute(new Date(v.scheduledStart.getTime() + 29 * MIN)));
    await expect(submitCarerResponse(me, confirmationId, { answer: "ATTENDED_NO_CLOCK", arrival: leave, departure: arrive, careDelivered: "YES", submissionKey: nextKey() })).rejects.toBeInstanceOf(ValidationError);
    const k = nextKey();
    const first = await submitCarerResponse(me, confirmationId, { answer: "ATTENDED_NO_CLOCK", arrival: arrive, departure: leave, careDelivered: "YES", explanation: "Phone battery died", submissionKey: k });
    const again = await submitCarerResponse(me, confirmationId, { answer: "ATTENDED_NO_CLOCK", arrival: arrive, departure: leave, careDelivered: "YES", explanation: "Phone battery died", submissionKey: k });
    expect(again.duplicate).toBe(true);
    expect(await db.missedCallCarerResponse.count({ where: { confirmationId } })).toBe(1);
    await expect(db.missedCallCarerResponse.update({ where: { id: first.id }, data: { explanation: "edited" } })).rejects.toThrow(/cannot be changed/);
    const more = await submitCarerResponse(me, confirmationId, { answer: "ATTENDED_NO_CLOCK", arrival: arrive, departure: leave, careDelivered: "PARTLY", explanation: "Correction: I did not finish the shopping task", submissionKey: nextKey() });
    expect((await db.missedCallCarerResponse.findUniqueOrThrow({ where: { id: more.id } })).supplementsId).toBe(first.id);
    expect((await db.missedCallCarerConfirmation.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("RESPONDED");
    // The statement records nothing on the visit: no clock rows and no correction requests.
    expect(await db.visitClock.count({ where: { visitId } })).toBe(0);
    expect(await db.clockCorrectionRequest.count({ where: { visitId } })).toBe(0);
  });

  it("refreshes the suggestion from the answer without making it the case's reason", async () => {
    await runJobs();
    const draft = await db.missedCallInvestigationDraft.findFirstOrThrow({ where: { caseId, reviewStatus: "PENDING" } });
    expect(draft.classification).toBe("POSSIBLE_NOT_CLOCKED");
    expect(draft.suggestedReason).toBe("NOT_CLOCKED");
    expect(draft.support).toBe("WEAK");
    expect(await db.missedCallInvestigationDraft.count({ where: { caseId, reviewStatus: "SUPERSEDED" } })).toBeGreaterThan(0);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } })).reasonCode).toBeNull();
    const d = await automationDetail(await coordinator(), caseId);
    expect(d.status).toBe("ready");
    expect(d.timeline.some((t) => t.kind === "CARER_REPORTED")).toBe(true);
    const state = await automationState(orgId, [{ id: caseId, stage: "NEW", reasonCode: null, highRisk: false }]);
    expect(state.get(caseId)!.carer).toBe("1 answered, 1 without a sign-in");
  });

  it("lets the carer ask for a clock correction, which still needs someone else's decision", async () => {
    const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    const { correctionOpen } = await getMyConfirmation(await carer(), confirmationId);
    expect(correctionOpen).toBe(true);
    await requestClockCorrection(await carer(), visitId, { kind: "IN", date: londonDate(v.scheduledStart), time: hhmm(londonMinute(new Date(v.scheduledStart.getTime() + 3 * MIN))), reason: "I attended but forgot to clock" });
    expect(await db.clockCorrectionRequest.count({ where: { visitId, status: "PENDING" } })).toBe(1);
    expect(await db.visitClock.count({ where: { visitId } })).toBe(0);
    expect(await db.backgroundJob.count({ where: { type: "missed.investigate", idempotencyKey: { startsWith: `missed-inv:${caseId}:CORRECTION` } } })).toBe(1);
  });

  it("makes the suggestion the reason only when the coordinator accepts it with findings, and sign-off rules still apply", async () => {
    await runJobs();
    const coord = await coordinator();
    const draft = await db.missedCallInvestigationDraft.findFirstOrThrow({ where: { caseId, reviewStatus: "PENDING" } });
    await expect(acceptSuggestion(coord, caseId, draft.id, { findings: "short" })).rejects.toBeInstanceOf(ValidationError);
    expect((await db.missedCallInvestigationDraft.findUniqueOrThrow({ where: { id: draft.id } })).reviewStatus).toBe("PENDING");
    const lock = (await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } })).lockVersion;
    await expect(acceptSuggestion(coord, caseId, draft.id, { findings: "Spoke to the carer and the daughter; care was given.", lockVersion: lock - 1 })).rejects.toBeInstanceOf(ConflictError);
    await acceptSuggestion(coord, caseId, draft.id, { findings: "Spoke to the carer and the daughter; care was given.", lockVersion: lock });
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } });
    expect([c.reasonCode, c.reasonRecordedById, c.stage]).toEqual(["NOT_CLOCKED", coord.userId, "INVESTIGATING"]);
    expect((await db.missedCallInvestigationDraft.findUniqueOrThrow({ where: { id: draft.id } })).reviewStatus).toBe("ACCEPTED");
    await expect(acceptSuggestion(coord, caseId, draft.id, { findings: "Accepting it a second time" })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditLog.count({ where: { entityId: caseId, action: "rota.missed.auto.suggestion_accepted" } })).toBe(1);
    // Existing workflow unchanged: replacement care is still required, and whoever accepted cannot sign off.
    await expect(submitForSignOff(coord, caseId, { outcome: "DELIVERED_NOT_CLOCKED", preventable: "yes", outcomeNote: "Carer forgot to clock; reminded of the procedure." })).rejects.toBeInstanceOf(ValidationError);
    await recordReplacement(coord, caseId, { replacementType: "NOT_NEEDED", clientInformed: "Daughter by phone at 10:00" });
    await submitForSignOff(coord, caseId, { outcome: "DELIVERED_NOT_CLOCKED", preventable: "yes", outcomeNote: "Carer forgot to clock; reminded of the procedure." });
    await signOffMissedCase(await manager(), caseId, { decision: "approve", note: "" });
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } })).stage).toBe("CLOSED");
  });

  it("never touches a closed case: no runs, no answers, no reopening", async () => {
    expect(await runInvestigation(caseId, "MANUAL")).toEqual({ skipped: "closed" });
    await expect(submitCarerResponse(await carer(), confirmationId, { answer: "OTHER", explanation: "One more thing to add", submissionKey: nextKey() })).rejects.toBeInstanceOf(ConflictError);
    await expect(refreshEvidence(await coordinator(), caseId)).rejects.toBeInstanceOf(ConflictError);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id: caseId } })).stage).toBe("CLOSED");
    expect(await catchUpInvestigations()).toBeGreaterThanOrEqual(0);
    expect(await db.backgroundJob.count({ where: { type: "missed.investigate", status: "QUEUED", payload: { path: ["caseId"], equals: caseId } } })).toBe(0);
  });

  it("suggests an unassigned visit when nobody was booked", async () => {
    const { caseId: id } = await missedVisit([]);
    await runJobs();
    expect(await db.missedCallCarerConfirmation.count({ where: { caseId: id } })).toBe(0);
    const d = await db.missedCallInvestigationDraft.findFirstOrThrow({ where: { caseId: id, reviewStatus: "PENDING" } });
    expect([d.classification, d.suggestedReason]).toEqual(["POSSIBLE_UNASSIGNED", "UNASSIGNED"]);
  });

  it("does not ask a carer about a visit due more than a day ago, but still collects its evidence", async () => {
    const { caseId: id } = await missedVisit([ameliaId], { minutesAgo: 26 * 60 });
    await runJobs();
    const conf = await db.missedCallCarerConfirmation.findFirstOrThrow({ where: { caseId: id } });
    expect(conf.status).toBe("NOT_REQUESTED");
    expect(await db.notification.count({ where: { dedupeKey: `missed-confirm:${conf.id}` } })).toBe(0);
    expect(await db.missedCallInvestigationRun.count({ where: { caseId: id, status: "COMPLETED" } })).toBe(1);
  });

  it("dismisses a suggestion with a reason, and settles it as a different reason when another is recorded", async () => {
    const { caseId: id } = await missedVisit([noLoginStaffId]);
    await runJobs();
    const coord = await coordinator();
    const d = await db.missedCallInvestigationDraft.findFirstOrThrow({ where: { caseId: id, reviewStatus: "PENDING" } });
    expect(d.classification).toBe("UNRESOLVED");
    await expect(dismissSuggestion(coord, id, d.id, "no")).rejects.toBeInstanceOf(ValidationError);
    await dismissSuggestion(coord, id, d.id, "The office rang the carer: they were stuck in traffic");
    expect((await db.missedCallInvestigationDraft.findUniqueOrThrow({ where: { id: d.id } })).reviewStatus).toBe("DISMISSED");
    await expect(db.missedCallInvestigationDraft.update({ where: { id: d.id }, data: { reviewNote: "rewritten" } })).rejects.toThrow(/already been reviewed/);
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id } })).reasonCode).toBeNull();
  });

  it("sends at most the set reminders, then tells the coordinator once, and never delays the case's own escalation", async () => {
    const { caseId: id } = await missedVisit([ameliaId], { highRisk: true });
    await runJobs();
    const conf = await db.missedCallCarerConfirmation.findFirstOrThrow({ where: { caseId: id } });
    expect(conf.status).toBe("REQUESTED");
    const requested = conf.requestedAt!.getTime();
    const detail = await automationDetail(await coordinator(), id);
    expect(detail.status).toBe("urgent");
    await checkConfirmationDeadlines(new Date(requested + 31 * MIN));
    await checkConfirmationDeadlines(new Date(requested + 45 * MIN));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `missed-confirm-remind:${conf.id}` } } })).toBe(1);
    await checkConfirmationDeadlines(new Date(requested + 61 * MIN));
    await checkConfirmationDeadlines(new Date(requested + 75 * MIN));
    expect((await db.missedCallCarerConfirmation.findUniqueOrThrow({ where: { id: conf.id } })).status).toBe("NO_RESPONSE");
    const told = await db.notification.count({ where: { dedupeKey: { startsWith: `missed-noresponse:${conf.id}` } } });
    expect(told).toBeGreaterThan(0);
    await checkConfirmationDeadlines(new Date(requested + 90 * MIN));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `missed-noresponse:${conf.id}` } } })).toBe(told);
    // The existing 30-minute escalation still happens even though a carer was asked.
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id } });
    await escalateOverdueCases(new Date(c.deadline!.getTime() + MIN));
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id } })).escalatedAt).not.toBeNull();
  });

  it("records a failed evidence check without touching the case, and the coordinator can refresh", async () => {
    await runJobs();
    const { caseId: id } = await missedVisit([noLoginStaffId]);
    // Make the run's final write fail inside the database for this case only, then remove the fault.
    await ownerDb.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_run() RETURNS trigger AS $$ BEGIN IF NEW.status = 'COMPLETED' AND NEW."caseId" = '${id}' THEN RAISE EXCEPTION 'injected test failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await ownerDb.$executeRawUnsafe(`CREATE TRIGGER test_fail_run BEFORE UPDATE ON "MissedCallInvestigationRun" FOR EACH ROW EXECUTE FUNCTION test_fail_run()`);
    const job = await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: `missed-inv:${id}:DETECTED` } });
    await drain("test", handlers, { types: ["missed.investigate"], max: 1 });
    await ownerDb.$executeRawUnsafe(`DROP TRIGGER test_fail_run ON "MissedCallInvestigationRun"`);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    const failed = await db.missedCallInvestigationRun.findFirstOrThrow({ where: { caseId: id, status: "FAILED" } });
    expect(failed.error).not.toMatch(/injected/);
    expect((await automationDetail(await coordinator(), id)).status).toBe("failed");
    expect((await db.missedCallCase.findUniqueOrThrow({ where: { id } })).stage).toBe("NEW");
    expect(await refreshEvidence(await coordinator(), id)).toBe("updated");
    expect((await automationDetail(await coordinator(), id)).status).not.toBe("failed");
  });

  it("withdraws open requests when carer confirmation is switched off", async () => {
    const { caseId: id } = await missedVisit([ameliaId]);
    await runJobs();
    await switches({ evidence: true, confirm: false, summary: true });
    expect((await db.missedCallCarerConfirmation.findFirstOrThrow({ where: { caseId: id } })).status).toBe("WITHDRAWN");
    await switches({ evidence: true, confirm: true, summary: true });
  });
});
