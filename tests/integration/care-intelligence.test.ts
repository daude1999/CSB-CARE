import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { createCandidate, getCandidate, giveScreening, makeOffer, recordOfferResponse, recordScreeningAnswers, recruitmentBoard, reviewScreening, scheduleInterview, updateInterview } from "@/server/recruitment/candidates";
import { markReady, startOnboarding } from "@/server/recruitment/onboarding";
import { staffReadinessCheck } from "@/server/workforce/staff-check";
import { staffingAlerts } from "@/server/rota/staffing-alerts";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { generatePlan } from "@/server/rota/optimise";
import { careRecords, careSummariesFor, generateCareSummary, reviewCareSummary, setCareSummaryEnabled, startReviewFromSummary } from "@/server/care/care-summary";
import { monitorAlerts } from "@/server/rota/monitor-alerts";
import { computeKpis } from "@/server/reports/kpis";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The integrated build against a real database: recruitment into HR and readiness, rota staffing alerts and plans for
 * chosen visits, the Care Summary's citations and approvals, the Monitor's alert list and the new insight measures.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const branchHr = () => ctxFor("sam.parker@care-solution.demo", BROOKFIELD);
const viewer = () => ctxFor("taylor.reed@care-solution.demo", BROOKFIELD);
let orgId = "";
let liverpool = "";
let other = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const branches = await db.branch.findMany({ where: { organisationId: orgId, hrBranchKey: { not: null } }, orderBy: { name: "asc" } });
  liverpool = branches.find((b) => b.name === "Liverpool")!.id;
  other = branches.find((b) => b.id !== liverpool)!.id;
}, 240_000);

const lv = async (id: string) => (await db.candidate.findUniqueOrThrow({ where: { id } })).lockVersion;
const applicant = (n: string, branchId: string) => ({ firstName: "Test", lastName: n, email: `test.${n.toLowerCase()}@example.test`, phone: "07700 900123", roleApplied: "Care Support Worker", branchId, driving: "DRIVER_WITH_CAR", rightToWork: "VERIFIED", source: "Test", outstandingDocuments: ["Two references"], contactConsent: true });

describe("recruitment into HR and the rota", () => {
  it("takes a candidate from application to onboarding, creating one HR employee who cannot yet work visits", async () => {
    const m = await manager();
    const c = await createCandidate(m, applicant("Alpha", liverpool));
    expect(c.reference).toMatch(/^CAN-\d{4}$/);
    await expect(createCandidate(m, applicant("Alpha", liverpool))).rejects.toBeInstanceOf(ConflictError);

    await giveScreening(m, c.id, "PHONE");
    const sc = await db.candidateScreening.findFirstOrThrow({ where: { candidateId: c.id } });
    await recordScreeningAnswers(m, sc.id, { experience: "Two years", availability: "Weekdays", travel: "Car", start: "Now", why: "Care" });
    await reviewScreening(m, sc.id, "PROCEED", "Good");
    await expect(makeOffer(m, c.id, await lv(c.id))).rejects.toBeInstanceOf(ValidationError); // no passed interview yet

    const interviewer = m.userId;
    await scheduleInterview(m, c.id, { date: addDays(londonDate(), 2), time: "10:00", durationMin: 45, location: "Office", interviewerId: interviewer });
    const iv = await db.candidateInterview.findFirstOrThrow({ where: { candidateId: c.id } });
    await expect(updateInterview(m, iv.id, { action: "outcome", outcome: "PASSED", notes: "Too early" })).rejects.toBeInstanceOf(ValidationError);
    await db.candidateInterview.update({ where: { id: iv.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } }); // the interview has now taken place
    await updateInterview(m, iv.id, { action: "outcome", outcome: "PASSED", notes: "Good answers" });
    await expect(makeOffer(m, c.id, (await lv(c.id)) + 1)).rejects.toBeInstanceOf(ConflictError); // someone else changed it
    await makeOffer(m, c.id, await lv(c.id));
    await recordOfferResponse(m, c.id, await lv(c.id), "ACCEPTED");

    await startOnboarding(m, c.id, { mode: "create", staffId: "TEST-ALPHA", start: addDays(londonDate(), 7), lockVersion: await lv(c.id) });
    const after = await db.candidate.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.stage).toBe("ONBOARDING");
    expect(after.hrEmployeeId).toBeTruthy();
    await expect(startOnboarding(m, c.id, { mode: "create", staffId: "TEST-ALPHA-2", start: addDays(londonDate(), 7), lockVersion: after.lockVersion })).rejects.toThrow();

    // The HR record was projected into the rota as an onboarding staff member, and the eligibility check refuses them.
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: after.hrEmployeeId! } });
    expect(staff.employmentStatus).toBe("ONBOARDING");
    const check = await staffReadinessCheck(orgId, staff.id);
    expect(check.state).not.toBe("ELIGIBLE");
    await expect(markReady(m, c.id, after.lockVersion)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.candidateEvent.count({ where: { candidateId: c.id } })).toBeGreaterThan(5);
  });

  it("keeps branch HR to their own branches and a viewer read-only", async () => {
    const m = await manager();
    const elsewhere = await createCandidate(m, applicant("Bravo", other));
    expect(await getCandidate(await branchHr(), elsewhere.id)).toBeNull();
    await expect(createCandidate(await branchHr(), applicant("Charlie", other))).rejects.toThrow();
    await expect(createCandidate(await viewer(), applicant("Delta", liverpool))).rejects.toBeInstanceOf(ForbiddenError);
    const board = await recruitmentBoard(await branchHr(), {});
    expect(board.rows.every((r) => r.branchId === liverpool)).toBe(true);
  });

  it("refuses everyone without an HR account", async () => {
    await expect(recruitmentBoard(await coordinator(), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("rota intelligence", () => {
  it("counts tomorrow's unassigned visits exactly as Unassigned Visits does, and links there", async () => {
    const m = await manager();
    const tomorrow = addDays(londonDate(), 1);
    const board = await unassignedBoard(m, parseUnassigned({ when: "custom", from: tomorrow, to: tomorrow }, londonDate()));
    const alerts = await staffingAlerts(m);
    const a = alerts.find((x) => x.key === "unassigned");
    if (board.summary.visits) {
      expect(a?.count).toBe(board.summary.visits);
      expect(a?.href).toContain("when=tomorrow");
    } else expect(a).toBeUndefined();
  });

  it("plans only the visits the coordinator chose, and changes nothing on the rota", async () => {
    const m = await manager();
    const open = await db.visit.findMany({ where: { organisationId: orgId, status: "SCHEDULED", date: { gte: new Date(`${addDays(londonDate(), 1)}T00:00:00Z`) }, assignments: { none: { removedAt: null } } }, take: 2, select: { id: true } });
    if (!open.length) return;
    const before = await db.visitAssignment.count({ where: { organisationId: orgId, removedAt: null } });
    const plan = await generatePlan(m, { visitIds: open.map((v) => v.id), gapMinutes: 10, maxShiftMinutes: 0 });
    const changes = await db.rotaPlanChange.findMany({ where: { planId: plan.id } });
    expect(changes.every((c) => open.some((v) => v.id === c.visitId))).toBe(true);
    expect(await db.visitAssignment.count({ where: { organisationId: orgId, removedAt: null } })).toBe(before);
  });
});

describe("Care Summary", () => {
  it("is off until an admin switches it on, then stores a cited, unapproved summary with its provenance", async () => {
    setAiProviderForTests(new SimulatedProvider());
    const m = await manager();
    const c = await coordinator();
    const plan = await db.carePlan.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    const range = { from: addDays(londonDate(), -29), to: londonDate() };
    const { records } = await careRecords(c, plan.serviceUserId, range);
    await expect(generateCareSummary(c, plan.serviceUserId, range)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCareSummaryEnabled(c, true, "Not allowed to do this")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCareSummaryEnabled(m, true, "short")).rejects.toBeInstanceOf(ValidationError);
    await setCareSummaryEnabled(m, true, "A. Morgan after the data protection review");
    if (!records.length) return;

    const row = await generateCareSummary(c, plan.serviceUserId, range);
    expect(row.status).toBe("UNREVIEWED");
    expect(row.isSimulated).toBe(true);
    const [stored] = await careSummariesFor(c, plan.serviceUserId);
    const sids = new Set(stored!.sources.map((s) => s.sid));
    for (const p of [...stored!.output.summary, ...stored!.output.changes, ...stored!.output.concerns, ...stored!.output.nextActions]) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(sids.has(s)).toBe(true);
    }
    // The text and its sources are frozen by the database.
    await expect(db.careSummary.update({ where: { id: row.id }, data: { output: {} } })).rejects.toThrow();

    // Only a manager reviews it; starting a review opens an ordinary draft linked to the summary.
    await expect(reviewCareSummary(c, row.id, "REVIEWED", "")).rejects.toBeInstanceOf(ForbiddenError);
    await reviewCareSummary(m, row.id, "REVIEWED", "Checked against the notes");
    await expect(reviewCareSummary(m, row.id, "DISMISSED", "Again")).rejects.toBeInstanceOf(ConflictError);
    const open = await db.carePlan.findFirst({ where: { serviceUserId: plan.serviceUserId, status: { in: ["DRAFT", "IN_REVIEW"] } } });
    if (!open) {
      const draft = await startReviewFromSummary(c, row.id);
      expect(draft.sourceSummaryId).toBe(row.id);
      expect(draft.status).toBe("DRAFT");
      expect((await db.carePlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("ACTIVE");
    }
  });

  it("says plainly when no AI provider is configured", async () => {
    setAiProviderForTests(null);
    const c = await coordinator();
    const plan = await db.carePlan.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    await expect(generateCareSummary(c, plan.serviceUserId, { from: addDays(londonDate(), -6), to: londonDate() })).rejects.toThrow(/No AI provider/);
    setAiProviderForTests(undefined);
  });
});

describe("monitoring and insights", () => {
  it("lists each alert once per visit, folding a late alert into the missed one for the same visit", async () => {
    const m = await manager();
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: new Date(`${londonDate()}T00:00:00Z`) } });
    await db.rotaAlert.createMany({ data: [
      { organisationId: orgId, kind: "LATE", visitId: v.id, message: "Late test", dedupeKey: `t-late-${v.id}` },
      { organisationId: orgId, kind: "MISSED", severity: "CRITICAL", visitId: v.id, message: "Missed test", dedupeKey: `t-missed-${v.id}` },
    ] });
    const { alerts, folded } = await monitorAlerts(m);
    const mine = alerts.filter((a) => a.visit?.id === v.id);
    expect(mine.map((a) => a.kind)).toEqual(["MISSED"]);
    expect(folded).toBeGreaterThanOrEqual(1);
    expect(mine[0]!.actions.map((x) => x.label)).toContain("Owner and resolve");
  });

  it("adds staffing, HR and care quality measures with definitions and links", async () => {
    const r = await computeKpis(await manager(), {});
    const keys = r.rows.map((k) => k.key);
    for (const k of ["double-ups-short", "bookings-review", "open-candidates", "new-starters", "plans-overdue", "incidents-open", "tasks-not-done", "summaries-waiting"]) expect(keys).toContain(k);
    expect(r.rows.find((k) => k.key === "open-candidates")!.value).toBeGreaterThanOrEqual(1);
    for (const k of r.rows) expect(k.definition.length).toBeGreaterThan(20);
  });
});
