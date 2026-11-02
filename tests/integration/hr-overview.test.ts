import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { closeCandidate, createCandidate, recruitmentBoard, scheduleInterview } from "@/server/recruitment/candidates";
import { recordAbsence } from "@/server/workforce/absences";
import { hrOverview } from "@/server/workforce/hr-overview";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The HR overview's interviews and leave requests (redesigned HR Dashboard): counted from authorised records only,
 * scoped to the HR account's branches and the branch chosen on screen, and never revealing another branch.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let liverpool: { id: string; key: string };
let other: { id: string; key: string };

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const branches = await db.branch.findMany({ where: { organisationId: orgId, hrBranchKey: { not: null } }, orderBy: { name: "asc" } });
  const pick = (b: (typeof branches)[number]) => ({ id: b.id, key: b.hrBranchKey! });
  liverpool = pick(branches.find((b) => b.name === "Liverpool")!);
  other = pick(branches.find((b) => b.name !== "Liverpool")!);
}, 240_000);

const applicant = (n: string, branchId: string) => ({ firstName: "Overview", lastName: n, email: `overview.${n.toLowerCase()}@example.test`, roleApplied: "Care Support Worker", branchId, contactConsent: true });

describe("HR overview: interviews and leave requests", () => {
  it("counts today's and upcoming interviews of open applications, by branch scope", async () => {
    const m = await manager();
    const before = await hrOverview(m, "all");
    const a = await createCandidate(m, applicant("Today", liverpool.id));
    const b = await createCandidate(m, applicant("Later", other.id));
    const c = await createCandidate(m, applicant("Closed", liverpool.id));
    await scheduleInterview(m, a.id, { date: addDays(londonDate(), 2), time: "10:00", durationMin: 30, interviewerId: m.userId });
    await scheduleInterview(m, b.id, { date: addDays(londonDate(), 3), time: "11:00", durationMin: 45, interviewerId: m.userId });
    await scheduleInterview(m, c.id, { date: addDays(londonDate(), 2), time: "12:00", durationMin: 30, interviewerId: m.userId });
    // Move one interview to earlier today (it has happened, so it counts today but is no longer "coming up").
    await db.candidateInterview.updateMany({ where: { candidateId: a.id }, data: { startsAt: new Date(Date.now() - 60_000), status: "CONFIRMED" } });
    const lv = (await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).lockVersion;
    await closeCandidate(m, c.id, lv, { outcome: "WITHDRAWN", reason: "Took another job" });

    const all = await hrOverview(m, "all");
    if (londonDate(new Date(Date.now() - 60_000)) === londonDate()) expect(all.interviewsToday).toBe(before.interviewsToday + 1);
    expect(all.interviews.map((i) => i.name)).toContain("Overview Later");
    expect(all.interviews.map((i) => i.name)).not.toContain("Overview Today");
    expect(all.interviews.map((i) => i.name)).not.toContain("Overview Closed");
    const later = all.interviews.find((i) => i.name === "Overview Later")!;
    expect(new Date(later.endsAt).getTime() - new Date(later.startsAt).getTime()).toBe(45 * 60_000);

    const lpool = await hrOverview(m, liverpool.key);
    expect(lpool.interviews.map((i) => i.name)).not.toContain("Overview Later");
    const elsewhere = await hrOverview(m, other.key);
    expect(elsewhere.interviews.map((i) => i.name)).toContain("Overview Later");
  });

  it("counts leave requests waiting for a decision in the chosen branch only", async () => {
    const m = await manager();
    const orgId = m.organisationId!;
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrBranchKey: liverpool.key, employmentStatus: "ACTIVE", hrMissing: false } });
    const [lp0, ot0] = [await hrOverview(m, liverpool.key), await hrOverview(m, other.key)];
    await recordAbsence(m, { staffId: staff.id, kind: "HOLIDAY", from: addDays(londonDate(), 40), to: addDays(londonDate(), 41) });
    await recordAbsence(m, { staffId: staff.id, kind: "SICKNESS", from: addDays(londonDate(), 50), to: addDays(londonDate(), 50) }); // recorded as approved
    expect((await hrOverview(m, liverpool.key)).leaveRequests).toBe(lp0.leaveRequests + 1);
    expect((await hrOverview(m, other.key)).leaveRequests).toBe(ot0.leaveRequests);
  });

  it("refuses unknown or unauthorised branches and people without an HR account", async () => {
    const m = await manager();
    await expect(hrOverview(m, "not-a-branch")).rejects.toBeInstanceOf(NotFoundError);
    const coordinator = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    if (!coordinator.hrUserId) await expect(hrOverview(coordinator, "all")).rejects.toBeInstanceOf(ForbiddenError);
    const branchHr = await ctxFor("sam.parker@care-solution.demo", BROOKFIELD);
    const state = await db.hrWorkspace.findUniqueOrThrow({ where: { organisationId: m.organisationId! } });
    const users = (state.state as { users: { id: string; branches: string[] }[] }).users;
    const mine = users.find((u) => u.id === branchHr.hrUserId)!.branches;
    const outside = [liverpool.key, other.key].find((k) => !mine.includes(k));
    if (outside) await expect(hrOverview(branchHr, outside)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("filters the recruitment board by the role applied for", async () => {
    const m = await manager();
    await createCandidate(m, { ...applicant("Coordinator", liverpool.id), roleApplied: "Care Coordinator" });
    const board = await recruitmentBoard(m, { role: "care coordinator" });
    expect(board.roles).toContain("Care Coordinator");
    expect(board.rows.length).toBeGreaterThan(0);
    expect(board.rows.every((r) => r.roleApplied === "Care Coordinator")).toBe(true);
  });
});
