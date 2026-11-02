import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";
import { inviteMember, redeemToken } from "@/server/admin/users";
import { ctxFromToken, login } from "@/server/auth/session";
import { addVisitNote, recordTaskOutcomes } from "@/server/care/visit-record";
import { createServiceUser, setServiceUserStatus } from "@/server/care/service-users";
import { decideTimesheet, generateTimesheets, submitTimesheet } from "@/server/finance/timesheets";
import { preparePayRun } from "@/server/finance/runs";
import { acknowledgeRow, createRule, markOpened } from "@/server/policies/assignment";
import { readinessFor, recordAssessment, recordTraining, verifyTraining } from "@/server/readiness";
import { computeKpis } from "@/server/reports/kpis";
import { assignCarer } from "@/server/rota/assign";
import { clockMine } from "@/server/rota/attendance";
import { confirmBuild, publishBuild } from "@/server/rota/build";
import { myVisits } from "@/server/rota/carer";
import { listExceptions, resolveException } from "@/server/rota/exceptions";
import { createTemplate } from "@/server/rota/templates";
import { linkLogin } from "@/server/workforce/link";
import type { Ctx } from "@/server/auth/rbac";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Version 1 principal scenario, end to end through the real services and database, in the brief's order:
 * HR creates a person → they appear in Rostering → training requirements apply → evidence is verified → policies are
 * assigned → acknowledged → competency verified → readiness calculated → a service user → a recurring schedule →
 * Build Rota → allocate → publish → the carer sees the visit → clocks in → records tasks → writes a note → clocks out
 * → the office reviews the exception → resolves it → the timesheet is approved → finance prepares pay → branch and
 * organisation reports count it.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
// Training evidence is recorded by HR & Workforce: a coordinator who also holds the Group HR account.
const hrCoordinator = async () => ({ ...(await coordinator()), hrUserId: "group" });
const finance = () => ctxFor("finance@care-solution.demo", BROOKFIELD);
const MIN = 60_000;
const EMAIL = "riley.scenario@example.com";
const PASSWORD = "scenario password for v1";
let orgId = "";

function at(t: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(t);
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 240_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("Version 1 principal scenario", () => {
  it("takes a new carer from HR to a paid, reported visit", { timeout: 240_000 }, async () => {
    // 1. HR creates the person: a copy of a ready carer's HR record and checks, under a new name.
    const staffAll = await db.staffMember.findMany({ where: { organisationId: orgId, hrMissing: false, employmentStatus: "ACTIVE", branch: { name: "Liverpool" } } });
    const ready = await readinessFor(db, orgId, staffAll.map((s) => s.id));
    const model = staffAll.find((s) => ready.get(s.id)?.status === "READY" && /care/i.test(s.jobTitle));
    if (!model) throw new Error("The demo has no ready Liverpool carer to copy");
    const NEW_ID = "emp-scenario";
    await hrTransaction(orgId, (s) => {
      const src = s.employees.find((e) => e.id === model.hrEmployeeId);
      if (!src) throw new Error("HR record not found");
      s.employees.push({ ...src, id: NEW_ID, name: "Riley Scenario", preferredName: "Riley", email: EMAIL, staffId: "CSB-9001", version: 1 });
      // The new person's checks are done: verified, evidenced and in date, as HR would record them for a new starter.
      const nextYear = addDays(londonDate(), 365);
      for (const c of s.checks.filter((x) => x.employee === src.id)) s.checks.push({ ...c, id: `${c.id}-scn`, employee: NEW_ID, verified: true, evidence: c.evidence ? `${c.evidence}-scn` : `doc-${c.id}-scn`, due: c.due ? nextYear : c.due });
      for (const d of s.documents.filter((x) => x.employee === src.id)) s.documents.push({ ...d, id: `${d.id}-scn`, employee: NEW_ID });
    });

    // 2. They appear in Rostering through the projection.
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: NEW_ID } });
    expect(staff.displayName).toContain("Riley");

    // 3. Training requirements apply: without evidence they are not ready.
    const before = (await readinessFor(db, orgId, [staff.id])).get(staff.id);
    expect(before?.status).not.toBe("READY");

    // A sign-in for them, through an invitation, linked to the staff record by hand.
    const invite = await inviteMember(await manager(), { email: EMAIL, name: "Riley Scenario", roles: ["STAFF"] });
    await redeemToken(invite.token, { password: PASSWORD });
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    await linkLogin(await manager(), { staffId: staff.id, userId: user.id, grantCarerRole: true, confirm: true });
    const carer = async (): Promise<Ctx> => {
      const { token } = await login(EMAIL, PASSWORD);
      const c = await ctxFromToken(token);
      if (!c) throw new Error("Could not sign in");
      return c;
    };

    // 4–7. Evidence recorded by the coordinator and verified by the manager; policies assigned and acknowledged;
    // competency assessed. Every unmet part of readiness is met through the services that own it.
    const today = londonDate();
    const policyIds = new Set<string>();
    for (const c of before?.components ?? []) {
      if (c.state === "MET" || !c.requirementId) continue;
      const req = await db.readinessRequirement.findUniqueOrThrow({ where: { id: c.requirementId } });
      if (req.category === "POLICY" && req.policyId) {
        policyIds.add(req.policyId);
        continue;
      }
      if (req.category === "TRAINING" || req.category === "QUALIFICATION") {
        const rec = await recordTraining(await hrCoordinator(), staff.id, { requirementId: req.id, completedAt: addDays(today, -3), provider: "Scenario training", evidenceNote: "Certificate seen" });
        await verifyTraining(await manager(), rec.id, "VERIFIED", "Certificate checked");
      }
      if (req.category === "COMPETENCY" || req.requiresPractical) {
        await recordAssessment(await manager(), staff.id, { requirementId: req.id, method: "OBSERVED", observedEvidence: "Observed on two shadow visits, safe and confident", outcome: "COMPETENT", assessedAt: addDays(today, -1) });
      }
    }
    for (const policyId of policyIds) await createRule(await manager(), { policyId, scope: "STAFF", staffMemberIds: [staff.id], dueDays: 7 });
    const rows = await db.acknowledgement.findMany({ where: { organisationId: orgId, staffMemberId: staff.id, acknowledgedAt: null, state: { notIn: ["WITHDRAWN", "EXEMPTED"] }, supersededAt: null }, include: { publication: { select: { policyId: true } } } });
    for (const r of rows) {
      await markOpened(await carer(), r.publication.policyId);
      await acknowledgeRow(await carer(), r.id);
    }

    // 8. Readiness is worked out from those records.
    const after = (await readinessFor(db, orgId, [staff.id])).get(staff.id);
    expect(after?.reasons).toEqual([]);
    expect(after?.status).toBe("READY");

    // 9. A new service user, active, in a Liverpool area.
    const area = await db.area.findFirstOrThrow({ where: { organisationId: orgId, active: true, branch: { name: "Liverpool" } } });
    const su = await createServiceUser(await coordinator(), { firstName: "Pat", lastName: "Scenario", areaId: area.id, carerGenderPreference: "ANY", postcode: "ZZ9 9ZZ" });
    await setServiceUserStatus(await coordinator(), su.id, "ACTIVE", "Assessment complete");

    // 10. A recurring schedule: a 10:00 call every weekday.
    const week = addDays(mondayOf(today), 14);
    const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId } });
    const task = await db.careTask.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
    await createTemplate(await coordinator(), { serviceUserId: su.id, callTypeId: callType.id, areaId: area.id, cycleWeeks: [1, 2, 3, 4], weekdays: [1, 2, 3, 4, 5], startMinute: 600, durationMin: 45, carersRequired: 1, effectiveFrom: addDays(today, 1), taskIds: [task.id] });

    // 11. Build Rota for a future week.
    const { build } = await confirmBuild(await coordinator(), { weekStart: week });
    const visit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, serviceUserId: su.id, date: dbDate(week) }, include: { tasks: true } });

    // 12. Allocate through the eligibility check.
    await assignCarer(await coordinator(), { visitId: visit.id, slot: "PRIMARY", staffId: staff.id });

    // 13. Publish.
    await publishBuild(await coordinator(), build.id);

    // 14. On the day, the carer sees the visit.
    at(new Date(visit.scheduledStart.getTime() + 2 * MIN));
    const mine = await myVisits(await carer());
    expect(mine.visits.some((v) => v.id === visit.id)).toBe(true);

    // 15–18. Clock in, record the task, write a concern, clock out after the full visit.
    await clockMine(await carer(), visit.id, "IN", { nonce: "scenario-in" });
    const t1 = visit.tasks[0];
    if (!t1) throw new Error("The visit has no task");
    await recordTaskOutcomes(await carer(), visit.id, [{ visitTaskId: t1.id, outcome: "DONE" }]);
    await addVisitNote(await carer(), visit.id, { category: "CONCERN", text: "Pat seemed more confused than usual today" });
    at(new Date(visit.scheduledEnd.getTime() + 1 * MIN));
    await clockMine(await carer(), visit.id, "OUT", { nonce: "scenario-out", note: "All done" });
    vi.useRealTimers();
    expect((await db.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe("COMPLETED");

    // 19–20. The office reviews the exception and resolves it with what was done.
    const { rows: open } = await listExceptions(await coordinator(), { state: "open", kind: "CONCERN" });
    const concern = open.find((r) => r.visit?.id === visit.id);
    if (!concern) throw new Error("The concern did not reach the exceptions register");
    await resolveException(await coordinator(), concern.id, { resolution: "Called the family; GP visit booked", evidenceNote: "Call 11:05" });

    // 21. After the week ends: the timesheet is prepared, submitted and approved by someone else.
    at(londonToUtc(addDays(week, 8), 9 * 60));
    await generateTimesheets(await coordinator(), week);
    const sheet = await db.timesheet.findFirstOrThrow({ where: { organisationId: orgId, staffId: staff.id, periodStart: dbDate(week) } });
    await submitTimesheet(await coordinator(), sheet.id, sheet.version);
    const submitted = await db.timesheet.findUniqueOrThrow({ where: { id: sheet.id } });
    await decideTimesheet(await finance(), sheet.id, submitted.version, "APPROVED", "");

    // 22. Finance prepares pay from it.
    const run = await preparePayRun(await finance(), week);
    const pay = await db.payLine.findMany({ where: { runId: run.id, staffId: staff.id, visitId: visit.id } });
    expect(pay).toHaveLength(1);
    expect(pay[0]?.amountPence).toBeGreaterThan(0);

    // 23. Branch and organisation reports count the delivered visit.
    const range = { from: week, to: addDays(week, 6) };
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const org = await computeKpis(await manager(), range);
    const branch = await computeKpis(await manager(), { ...range, branch: liverpool.id });
    const delivered = (k: typeof org) => k.rows.find((r) => r.key === "visits-delivered");
    expect(delivered(org)?.value).not.toBeNull();
    expect(delivered(branch)?.value).not.toBeNull();
    expect(branch.branch).toBe(liverpool.id);
    vi.useRealTimers();

    // Every step left an audit trail.
    const actions = (await db.auditLog.findMany({ where: { organisationId: orgId, createdAt: { gte: new Date(Date.now() - 3_600_000) } }, select: { action: true } })).map((a) => a.action);
    for (const a of ["admin.member.joined", "serviceUser.created", "visit.tasks.recorded", "visit.note.added", "rota.alert.resolved", "finance.payrun.prepared"]) expect(actions).toContain(a);
  });
});
