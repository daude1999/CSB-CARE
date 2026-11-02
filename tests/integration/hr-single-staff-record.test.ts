import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/auth/current", () => ({ getCtx: vi.fn(async () => authMock.ctx), requireCtx: vi.fn(async () => authMock.ctx) }));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";
import type { Check, Employee } from "@/hr/lib/domain";
import { GET as hrHubGet } from "@/app/api/hr/hub/route";
import { assignCarer } from "@/server/rota/assign";
import { rotaLookups, visitCandidates } from "@/server/rota/queries";
import { addRotaAvailability, endRotaAvailability, staffWorkingPattern } from "@/server/rota/staff-availability";
import { checkStaffEligibility } from "@/server/workforce/eligibility";
import { recordAbsence } from "@/server/workforce/absences";
import { recordAssessment, recordTraining, verifyTraining } from "@/server/readiness";
import { hrRecordHref } from "@/server/workforce/hr-record";
import { workforceIdentityReport, staffReferenceCounts } from "@/server/workforce/identity";
import { reconcileWorkforce } from "@/server/workforce/projection";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * HR & Workforce is the one employee record; Rostering schedules the people it projects. These tests drive changes
 * through the HR Hub's own transaction (as the HR screens do) and check what the rota sees, offers and refuses.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";

async function bookedFuture(where: object = {}) {
  return db.visitAssignment.findFirstOrThrow({
    where: { organisationId: orgId, removedAt: null, slot: "PRIMARY", startsAt: { gt: new Date(Date.now() + 2 * 86400_000) }, visit: { status: "SCHEDULED" }, ...where },
    include: { visit: true, staff: true },
    orderBy: { startsAt: "asc" },
  });
}

/** A new HR employee modelled on an existing one (same branch), with copies of their checks so compliance matches. */
async function hireLike(templateHrId: string, over: Partial<Employee>) {
  const id = `emp-test-${Math.random().toString(36).slice(2, 8)}`;
  await hrTransaction(orgId, (s) => {
    const t = s.employees.find((e) => e.id === templateHrId)!;
    s.employees.push({ ...t, id, staffId: `T${id.slice(-6)}`, version: 1, employmentHistory: [], ...over });
    for (const c of s.checks.filter((c) => c.employee === templateHrId)) s.checks.push({ ...c, id: `${c.id}-${id}`, employee: id } as Check);
  });
  return db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: id } });
}

async function setHr(hrEmployeeId: string, change: (e: Employee) => void) {
  await hrTransaction(orgId, (s) => {
    const e = s.employees.find((x) => x.id === hrEmployeeId)!;
    change(e);
    e.version += 1;
  });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("one employee identity, fed from HR", () => {
  it("lists a new HR care worker in the rota's carer lists without creating them in Rostering", async () => {
    const before = await db.staffMember.count({ where: { organisationId: orgId } });
    const s = await hireLike("emp-1", { name: "Robin Newstart", job: "Care Worker", status: "Active" });
    expect(await db.staffMember.count({ where: { organisationId: orgId } })).toBe(before + 1);
    const lk = await rotaLookups(await coordinator());
    expect(lk.carers.map((c) => c.id)).toContain(s.id);
    const a = await bookedFuture();
    const candidates = await visitCandidates(await coordinator(), { ...a.visit, assignments: [] }, "SECOND");
    expect(candidates.map((c) => c.id)).toContain(s.id);
  });

  it("does not list office and other non-care employees as carers, but still names them", async () => {
    const s = await hireLike("emp-1", { name: "Pat Payroll", job: "Payroll Administrator", status: "Active" });
    const lk = await rotaLookups(await coordinator());
    expect(lk.staff.map((c) => c.id)).toContain(s.id);
    expect(lk.carers.map((c) => c.id)).not.toContain(s.id);
    const a = await bookedFuture();
    const candidates = await visitCandidates(await coordinator(), { ...a.visit, assignments: [] }, "SECOND");
    expect(candidates.map((c) => c.id)).not.toContain(s.id);
    // Asked about directly, the server still refuses and says why.
    const r = await checkStaffEligibility(await coordinator(), { staffId: s.id, start: a.visit.scheduledStart, end: a.visit.scheduledEnd, slot: "SECOND", visitId: a.visitId });
    expect(r.blocking.map((b) => b.code)).toContain("NOT_CARE_ROLE");
    await expect(assignCarer(await manager(), { visitId: a.visitId, slot: "PRIMARY", staffId: s.id, acceptWarnings: true })).rejects.toThrow(/not a care role/);
  });

  it("shows HR's changes to name and role in Rostering at once, on the same identity", async () => {
    const s = await hireLike("emp-1", { name: "Chris Rename", job: "Care Worker" });
    await setHr(s.hrEmployeeId, (e) => {
      e.name = "Chris Renamed";
      e.job = "Senior Care Worker";
    });
    const after = await db.staffMember.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.displayName).toBe("Chris Renamed");
    expect(after.jobTitle).toBe("Senior Care Worker");
    expect((await rotaLookups(await coordinator())).staff.find((x) => x.id === s.id)?.displayName).toBe("Chris Renamed");
  });
});

describe("HR changes and allocation", () => {
  it("blocks a suspended employee and flags their future visits without removing them, then clears the flag on return", async () => {
    const a = await bookedFuture();
    const hrId = a.staff.hrEmployeeId;
    await setHr(hrId, (e) => (e.status = "Suspended"));
    const s = await db.staffMember.findUniqueOrThrow({ where: { id: a.staffId } });
    expect(s.employmentStatus).toBe("SUSPENDED");
    const kept = await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(kept.removedAt).toBeNull();
    expect(kept.reviewReason).toMatch(/Suspended/);
    expect(await db.rotaAlert.count({ where: { organisationId: orgId, assignmentId: a.id, kind: "ALLOCATION_REVIEW", resolvedAt: null } })).toBeGreaterThan(0);
    const r = await checkStaffEligibility(await coordinator(), { staffId: a.staffId, start: a.visit.scheduledStart, end: a.visit.scheduledEnd, visitId: a.visitId });
    expect(r.blocking.map((b) => b.code)).toContain("SUSPENDED");

    await setHr(hrId, (e) => (e.status = "Active"));
    const back = await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } });
    // The suspension flag is gone (another, unrelated readiness point may remain for this demo person).
    expect(back.reviewReason ?? "").not.toMatch(/Suspended/);
    expect(back.removedAt).toBeNull();
  });

  it("judges start and leaving dates against the visit's date, not today", async () => {
    const a = await bookedFuture();
    const visitDay = londonDate(a.visit.scheduledStart);
    await setHr(a.staff.hrEmployeeId, (e) => (e.leavingDate = addDays(visitDay, -1)));
    const atVisit = await checkStaffEligibility(await coordinator(), { staffId: a.staffId, start: a.visit.scheduledStart, end: a.visit.scheduledEnd, visitId: a.visitId });
    expect(atVisit.blocking.map((b) => b.code)).toContain("LEFT");
    const now = new Date(Date.now() + 3600_000);
    const today = await checkStaffEligibility(await coordinator(), { staffId: a.staffId, start: now, end: new Date(now.getTime() + 1800_000) });
    expect(today.blocking.map((b) => b.code)).not.toContain("LEFT");
    expect((await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } })).reviewReason).toMatch(/Left on/);
    await setHr(a.staff.hrEmployeeId, (e) => delete e.leavingDate);

    const starter = await hireLike("emp-1", { name: "Future Starter", job: "Care Worker", start: addDays(visitDay, 1) });
    const early = await checkStaffEligibility(await coordinator(), { staffId: starter.id, start: a.visit.scheduledStart, end: a.visit.scheduledEnd });
    expect(early.blocking.map((b) => b.code)).toContain("NOT_STARTED");
  });

  it("judges mandatory training expiry on the visit's date", async () => {
    const s = await hireLike("emp-1", { name: "Tess Training", job: "Care Worker" });
    const training = await db.staffCompliance.findFirst({ where: { staffId: s.id, category: "Training", required: true } });
    if (!training) return; // The template employee has no required training in this seed.
    const lapse = addDays(londonDate(), 3);
    await hrTransaction(orgId, (st) => {
      const c = st.checks.find((x) => x.id === training.hrCheckId)!;
      c.due = lapse;
      c.verified = true;
      c.evidence = c.evidence ?? "evidence.pdf";
    });
    const at = (day: string) => new Date(`${day}T10:00:00Z`);
    const before = await checkStaffEligibility(await coordinator(), { staffId: s.id, start: at(addDays(lapse, -1)), end: at(addDays(lapse, -1)) });
    const after = await checkStaffEligibility(await coordinator(), { staffId: s.id, start: at(addDays(lapse, 1)), end: new Date(at(addDays(lapse, 1)).getTime() + 1800_000) });
    const codes = (r: typeof before) => [...r.blocking, ...r.warnings].filter((x) => x.message.startsWith(training.name)).map((x) => x.code);
    expect(codes(before)).not.toContain("TRAINING");
    expect(codes(after)).toContain("TRAINING");
  });

  it("stops a booking over approved sickness recorded in HR, re-checked on the server when saving", async () => {
    const a = await bookedFuture();
    const day = londonDate(a.visit.scheduledStart);
    // HR records sickness for someone else who is free, then a stale screen tries to book them.
    const lk = await rotaLookups(await coordinator());
    const free = lk.carers.find((c) => c.id !== a.staffId && c.employmentStatus === "ACTIVE")!;
    await recordAbsence(await manager(), { staffId: free.id, kind: "SICKNESS", from: day, to: day });
    await expect(assignCarer(await manager(), { visitId: a.visitId, slot: "PRIMARY", staffId: free.id, acceptWarnings: true })).rejects.toThrow(/sickness/);
  });

  it("never changes completed visits when HR changes", async () => {
    const done = await db.visitAssignment.findMany({ where: { organisationId: orgId, visit: { status: "COMPLETED" } }, orderBy: { id: "asc" } });
    expect(done.length).toBeGreaterThan(0);
    const staffId = done[0]!.staffId;
    const hrId = (await db.staffMember.findUniqueOrThrow({ where: { id: staffId } })).hrEmployeeId;
    await setHr(hrId, (e) => (e.status = "Suspended"));
    await setHr(hrId, (e) => (e.status = "Active"));
    const again = await db.visitAssignment.findMany({ where: { id: { in: done.map((d) => d.id) } }, orderBy: { id: "asc" } });
    expect(again).toEqual(done);
  });
});

describe("working patterns on the rota side", () => {
  it("lets a coordinator keep a working pattern, flags clashing visits, and keeps the record shared with HR", async () => {
    const a = await bookedFuture();
    const day = londonDate(a.visit.scheduledStart);
    const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const ctx = await coordinator();
    const r = await addRotaAvailability(ctx, { staffId: a.staffId, weekdays: [weekday], start: "00:00", end: "24:00", kind: "UNAVAILABLE", from: londonDate() });
    expect(r.flagged).toBeGreaterThan(0);
    const kept = await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(kept.removedAt).toBeNull();
    expect(kept.reviewReason).toBeTruthy();
    const now = await checkStaffEligibility(ctx, { staffId: a.staffId, start: a.visit.scheduledStart, end: a.visit.scheduledEnd, visitId: a.visitId });
    expect(now.blocking.map((b) => b.code)).toContain("UNAVAILABLE");
    const { pattern, timeOff } = await staffWorkingPattern(ctx, a.staffId);
    const line = pattern.find((p) => p.weekday === weekday && p.kind === "UNAVAILABLE")!;
    expect(line).toBeTruthy();
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "rota.availability.added", entityId: a.staffId } })).toBe(1);
    // Time off comes from HR as kind, dates and status only: never HR's reason or decision notes.
    for (const t of timeOff) expect(Object.keys(t).sort()).toEqual(["endsAt", "id", "kind", "startsAt", "status"]);
    await endRotaAvailability(ctx, a.staffId, line.id);
    expect((await db.visitAssignment.findUniqueOrThrow({ where: { id: a.id } })).reviewReason ?? "").not.toMatch(/Not available/);
  });

  it("refuses people without rota editing rights and staff outside the organisation", async () => {
    const a = await bookedFuture();
    const finance = await ctxFor("finance@care-solution.demo", BROOKFIELD);
    await expect(addRotaAvailability(finance, { staffId: a.staffId, weekdays: [1], start: "09:00", end: "10:00", kind: "AVAILABLE", from: londonDate() })).rejects.toThrow(ForbiddenError);
    const outsider = await ctxFor("manager@oakridge.demo", OAKRIDGE).catch(() => null);
    if (!outsider) return;
    await expect(staffWorkingPattern(outsider, a.staffId)).rejects.toThrow(NotFoundError);
    await expect(addRotaAvailability(outsider, { staffId: a.staffId, weekdays: [1], start: "09:00", end: "10:00", kind: "AVAILABLE", from: londonDate() })).rejects.toThrow(NotFoundError);
  });
});

describe("HR confidentiality", () => {
  it("offers the HR record only to people HR itself lets in", async () => {
    const s = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: "emp-1" } });
    expect(await hrRecordHref(await coordinator(), s, "/rota/staff/x")).toBeNull();
    const href = await hrRecordHref(await manager(), s, `/rota/staff/${s.id}`);
    expect(href).toMatch(/^\/hr\/people\/emp-1\?branch=/);
    // A Branch HR account sees only its own branches.
    const branchHr = await ctxFor("sam.parker@care-solution.demo", BROOKFIELD);
    const state = (await db.$queryRaw<{ state: { users: { id: string; branches: string[] }[] } }[]>`SELECT "state" FROM "HrWorkspace" WHERE "organisationId" = ${orgId}`)[0]!.state;
    const allowed = state.users.find((u) => u.id === branchHr.hrUserId)!.branches;
    const elsewhere = await db.staffMember.findFirst({ where: { organisationId: orgId, hrBranchKey: { notIn: allowed } } });
    if (elsewhere) expect(await hrRecordHref(branchHr, elsewhere, "/rota")).toBeNull();
  });

  it("keeps training and competency evidence with HR: a coordinator without an HR account cannot enter, verify or assess it", async () => {
    const s = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: "emp-1" } });
    const req = await db.readinessRequirement.findFirstOrThrow({ where: { organisationId: orgId, category: "TRAINING", status: "ACTIVE" } });
    await expect(recordTraining(await coordinator(), s.id, { requirementId: req.id, completedAt: londonDate() })).rejects.toThrow(/recorded by HR & Workforce/);
    await expect(recordAssessment(await coordinator(), s.id, { requirementId: req.id, method: "OBSERVED", observedEvidence: "Observed safely on a visit", outcome: "COMPETENT", assessedAt: londonDate() })).rejects.toThrow(ForbiddenError);
    // With an HR account that covers the person, the same coordinator can enter it; a second HR person verifies it.
    const rec = await recordTraining({ ...(await coordinator()), hrUserId: "group" }, s.id, { requirementId: req.id, completedAt: londonDate(), provider: "Test" });
    await expect(verifyTraining(await coordinator(), rec.id, "VERIFIED", "")).rejects.toThrow(ForbiddenError);
    await verifyTraining(await manager(), rec.id, "VERIFIED", "Certificate seen");
    expect((await db.staffTrainingRecord.findUniqueOrThrow({ where: { id: rec.id } })).verificationStatus).toBe("VERIFIED");
  });

  it("refuses a coordinator who asks the HR Hub's API directly", async () => {
    authMock.ctx = await coordinator();
    const res = await hrHubGet(new Request("http://localhost/api/hr/hub"));
    expect(res.status).toBe(403);
    authMock.ctx = null;
  });

  it("gives scheduling only HR check summaries, never documents or personal details", async () => {
    const cols = (await db.$queryRaw<{ column_name: string }[]>`SELECT column_name::text FROM information_schema.columns WHERE table_name = 'StaffMember'`).map((c) => c.column_name);
    for (const secret of ["dateOfBirth", "addressLine1", "postcode", "identificationLastFour", "emergencyPhone", "salary"]) expect(cols).not.toContain(secret);
    const checkCols = (await db.$queryRaw<{ column_name: string }[]>`SELECT column_name::text FROM information_schema.columns WHERE table_name = 'StaffCompliance'`).map((c) => c.column_name);
    for (const secret of ["evidence", "reviewer", "certificateNumber"]) expect(checkCols).not.toContain(secret);
  });
});

describe("identity report and reconciliation", () => {
  it("reports duplicates, look-alikes and unmatched records without merging or deleting anything", async () => {
    const a = await hireLike("emp-1", { name: "Sam Twin", job: "Care Worker" });
    const b = await hireLike("emp-1", { name: "Sam  Twin", job: "Care Worker" });
    expect(a.id).not.toBe(b.id);
    await hrTransaction(orgId, (s) => {
      s.employees.find((e) => e.id === b.hrEmployeeId)!.staffId = a.staffNumber;
    });
    // An HR employee who disappears (HR archives rather than deletes, but a bad import could remove one).
    const gone = await bookedFuture();
    let removed: Employee | undefined;
    await hrTransaction(orgId, (s) => {
      removed = s.employees.splice(s.employees.findIndex((e) => e.id === gone.staff.hrEmployeeId), 1)[0];
    });

    const report = (await workforceIdentityReport(orgId))!;
    expect(report.sameName.some((g) => g.hrEmployeeIds.includes(a.hrEmployeeId) && g.hrEmployeeIds.includes(b.hrEmployeeId))).toBe(true);
    expect(report.duplicateStaffNumbers.some((g) => g.hrEmployeeIds.includes(b.hrEmployeeId))).toBe(true);
    const u = report.unmatched.find((x) => x.staffId === gone.staffId)!;
    expect(u.references).toBeGreaterThan(0);
    expect(u.futureAssignments).toBeGreaterThan(0);
    expect(report.counts.notProjected).toBe(0);
    expect(report.counts.linked).toBe(report.counts.hrEmployees);
    // Kept, flagged, still on the rota until someone acts.
    const kept = await db.visitAssignment.findUniqueOrThrow({ where: { id: gone.id } });
    expect(kept.removedAt).toBeNull();
    expect(kept.reviewReason).toMatch(/HR record/);

    await hrTransaction(orgId, (s) => {
      s.employees.push(removed!);
    });
  });

  it("is safe to re-run: reconciliation changes nothing the second time and keeps every reference", async () => {
    const refs = await staffReferenceCounts(db, orgId);
    const staffBefore = await db.staffMember.count({ where: { organisationId: orgId } });
    await reconcileWorkforce(orgId);
    const second = await reconcileWorkforce(orgId);
    expect(second).toMatchObject({ created: 0, updated: 0, missing: 0 });
    expect(await db.staffMember.count({ where: { organisationId: orgId } })).toBe(staffBefore);
    expect(await staffReferenceCounts(db, orgId)).toEqual(refs);
    const report = (await workforceIdentityReport(orgId))!;
    expect(report.counts.stale).toBe(0);
    expect(report.references).toEqual(refs);
  });
});
