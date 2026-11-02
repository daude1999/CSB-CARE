import type { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { confirmBuild, deleteBuild, listBuilds, previewBuild, publishBuild, suggestBuildWeek, weekIsBuilt } from "@/server/rota/build";
import { rotaDashboard } from "@/server/rota/dashboard";
import { monitorBoard } from "@/server/rota/monitor";
import { listVisits, rotaLookups, visitCandidates } from "@/server/rota/queries";
import { getVisit, moveVisit } from "@/server/rota/visits";
import { assignCarer } from "@/server/rota/assign";
import { DEFAULT_CARE_ROLES } from "@/server/rota/settings";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Build Rota and branch limits (owner's defect report of 31 Oct 2026): a coordinator limited to one branch can build,
 * see, publish and delete only that branch's rota, and nothing reaches them through a shared build, a search, the
 * Monitor, the dashboard or a visit that has no area. Build Rota opens on the next week that still needs building and
 * says exactly why a week cannot be built.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};
const areas: Record<string, string[]> = {};
const thisMonday = () => mondayOf(londonDate());
const wk = (n: number) => addDays(thisMonday(), n * 7);

async function limit(email: string, branchName: string) {
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email } } });
  await setMemberBranches(await manager(), m.id, [branch[branchName]!]);
  return () => ctxFor(email, BROOKFIELD);
}
let liverpool: () => ReturnType<typeof manager>;
let towerHamlets: () => ReturnType<typeof manager>;

async function visitBranches(where: Prisma.VisitWhereInput) {
  const rows = await db.visit.findMany({ where, select: { serviceUser: { select: { branchId: true } } } });
  return new Set(rows.map((r) => r.serviceUser.branchId));
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) {
    branch[b.name] = b.id;
    areas[b.name] = (await db.area.findMany({ where: { organisationId: orgId, branchId: b.id }, select: { id: true } })).map((a) => a.id);
  }
  // A second branch coordinator: the reviewer account is given the coordinator role for these tests.
  await db.membership.updateMany({ where: { organisationId: orgId, user: { email: "reviewer@care-solution.demo" } }, data: { roles: ["CARE_COORDINATOR"] } });
  liverpool = await limit("coordinator@care-solution.demo", "Liverpool");
  towerHamlets = await limit("reviewer@care-solution.demo", "Tower Hamlets");
}, 180_000);

describe("Build Rota explains itself", () => {
  it("opens on the next week that still needs building, not next Monday", async () => {
    // The demo seed has built last week, this week and next week for every area.
    const s = await suggestBuildWeek(await manager());
    expect(s.weekStart).toBe(wk(2));
    expect(s.builtThrough).toBe(addDays(wk(2), -1));
  });

  it("says a week is already built, never builds it twice, and points to the rota", async () => {
    const before = await db.visit.count({ where: { organisationId: orgId } });
    const plan = await previewBuild(await manager(), { weekStart: wk(1) });
    expect(plan.visits).toHaveLength(0);
    expect(plan.alreadyBuilt).toBeGreaterThan(0);
    expect(plan.blockers[0]).toMatchObject({ code: "ALREADY_BUILT", action: { href: `/rota/visits?date=${wk(1)}` } });
    await expect(confirmBuild(await manager(), { weekStart: wk(1) })).rejects.toThrow(/already built/);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(before);
  });

  it("names the cycle weeks that do have templates when the chosen week has none", async () => {
    const t = await db.visitTemplate.findMany({ where: { organisationId: orgId, enabled: true }, select: { id: true, cycleWeeks: true } });
    // Move every template to Week 1 only, then ask for a Week 2 build.
    await db.$transaction(t.map((x) => db.visitTemplate.update({ where: { id: x.id }, data: { cycleWeeks: [1] } })));
    try {
      const plan = await previewBuild(await manager(), { weekStart: wk(2), cycleWeek: 2 });
      expect(plan.visits).toHaveLength(0);
      expect(plan.blockers[0]!.code).toBe("NO_TEMPLATES_THIS_WEEK");
      expect(plan.blockers[0]!.message).toMatch(/Week 2.*Week 1/);
    } finally {
      await db.$transaction(t.map((x) => db.visitTemplate.update({ where: { id: x.id }, data: { cycleWeeks: x.cycleWeeks } })));
    }
  });

  it("says when there are no active templates at all", async () => {
    const on = await db.visitTemplate.findMany({ where: { organisationId: orgId, enabled: true }, select: { id: true } });
    await db.visitTemplate.updateMany({ where: { id: { in: on.map((x) => x.id) } }, data: { enabled: false } });
    try {
      const plan = await previewBuild(await manager(), { weekStart: wk(2) });
      expect(plan.blockers[0]).toMatchObject({ code: "NO_TEMPLATES", action: { href: "/rota/templates?state=all" } });
      await expect(confirmBuild(await manager(), { weekStart: wk(2) })).rejects.toThrow(/no active recurring templates/);
    } finally {
      await db.visitTemplate.updateMany({ where: { id: { in: on.map((x) => x.id) } }, data: { enabled: true } });
    }
  });

  it("rejects a Week Setting that is not a cycle week, with a readable message", async () => {
    await expect(previewBuild(await manager(), { weekStart: wk(2), cycleWeek: Number.NaN })).rejects.toThrow(ValidationError);
    await expect(previewBuild(await manager(), { weekStart: wk(2), cycleWeek: 9 })).rejects.toThrow(/outside the 4-week cycle/);
  });

  it("refuses a role without rota.build", async () => {
    await expect(previewBuild(await ctxFor("finance@care-solution.demo", BROOKFIELD), { weekStart: wk(2) })).rejects.toThrow(ForbiddenError);
  });
});

describe("a branch coordinator builds only their branch", () => {
  it("builds Liverpool's week without touching Tower Hamlets, and each branch is told what is left", async () => {
    const r = await confirmBuild(await liverpool(), { weekStart: wk(2) });
    expect(r.build.areaIds.every((a) => areas.Liverpool!.includes(a))).toBe(true);
    expect([...(await visitBranches({ rotaBuildId: r.build.id }))]).toEqual([branch.Liverpool]);
    // Liverpool is now built through week 2; Tower Hamlets still needs week 2.
    expect((await suggestBuildWeek(await liverpool())).weekStart).toBe(wk(3));
    expect((await suggestBuildWeek(await towerHamlets())).weekStart).toBe(wk(2));
    expect(await weekIsBuilt(await liverpool(), wk(2))).toBe(true);
    expect(await weekIsBuilt(await towerHamlets(), wk(2))).toBe(false);
    const th = await previewBuild(await towerHamlets(), { weekStart: wk(2) });
    expect(th.visits.length).toBeGreaterThan(0);
    expect(th.alreadyBuilt).toBe(0);
  });

  it("refuses to let Tower Hamlets see, publish or delete Liverpool's build", async () => {
    const b = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: orgId, weekStart: dbDate(wk(2)), status: "BUILT" } });
    expect((await listBuilds(await towerHamlets())).map((x) => x.id)).not.toContain(b.id);
    await expect(publishBuild(await towerHamlets(), b.id)).rejects.toThrow(NotFoundError);
    await expect(deleteBuild(await towerHamlets(), b.id, "Not mine")).rejects.toThrow(NotFoundError);
    expect(await db.visit.count({ where: { rotaBuildId: b.id, publishedAt: { not: null } } })).toBe(0);
    expect(await db.rotaBuild.count({ where: { id: b.id, status: "BUILT" } })).toBe(1);
  });

  it("lets Liverpool publish and delete its own build", async () => {
    const b = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: orgId, weekStart: dbDate(wk(2)), status: "BUILT" } });
    const listed = (await listBuilds(await liverpool())).find((x) => x.id === b.id)!;
    expect(listed.otherAreas).toBe(0);
    expect(listed.unpublished).toBe(b.visitCount);
    await expect(deleteBuild(await liverpool(), b.id, "Rebuilding after a template fix")).resolves.toMatchObject({ removed: b.visitCount });
    const again = await confirmBuild(await liverpool(), { weekStart: wk(2) });
    const pub = await publishBuild(await liverpool(), again.build.id);
    expect(pub.published).toBe(again.build.visitCount);
  });
});

describe("a build shared by every branch", () => {
  let shared = "";
  beforeAll(async () => {
    shared = (await confirmBuild(await manager(), { weekStart: wk(3) })).build.id;
  }, 120_000);

  it("shows a branch coordinator only their own visits and counts the other areas without naming them", async () => {
    const mine = await db.visit.count({ where: { rotaBuildId: shared, serviceUser: { branchId: branch.Liverpool } } });
    const row = (await listBuilds(await liverpool())).find((x) => x.id === shared)!;
    expect(row.visitCount).toBe(mine);
    expect(row.unpublished).toBe(mine);
    expect(row.areaIds.every((a) => areas.Liverpool!.includes(a))).toBe(true);
    expect(row.otherAreas).toBe(areas.Portsmouth!.length + areas["Tower Hamlets"]!.length);
  });

  it("publishes only Liverpool's part when Liverpool presses Publish", async () => {
    const r = await publishBuild(await liverpool(), shared);
    expect([...(await visitBranches({ rotaBuildId: shared, publishedAt: { not: null } }))]).toEqual([branch.Liverpool]);
    expect(r.published).toBe(await db.visit.count({ where: { rotaBuildId: shared, serviceUser: { branchId: branch.Liverpool } } }));
    expect(await db.visit.count({ where: { rotaBuildId: shared, publishedAt: null, serviceUser: { branchId: branch["Tower Hamlets"] } } })).toBeGreaterThan(0);
    await expect(publishBuild(await liverpool(), shared)).rejects.toThrow(/already published/);
    // Tower Hamlets publishes its own part afterwards.
    await publishBuild(await towerHamlets(), shared);
    expect(await db.visit.count({ where: { rotaBuildId: shared, publishedAt: null, serviceUser: { branchId: branch["Tower Hamlets"] } } })).toBe(0);
  });

  it("refuses to let a branch coordinator delete a week that covers other branches", async () => {
    await expect(deleteBuild(await liverpool(), shared, "Mine to delete?")).rejects.toThrow(ForbiddenError);
    expect(await db.rotaBuild.count({ where: { id: shared, status: "BUILT" } })).toBe(1);
  });
});

describe("visits without an area cannot cross branches", () => {
  let orphan = "";
  let thLastName = "";
  beforeAll(async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], status: "ACTIVE" } });
    thLastName = su.lastName;
    const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId } });
    const mgr = await manager();
    const start = londonToUtc(londonDate(), 23 * 60);
    orphan = (
      await db.visit.create({
        data: { organisationId: orgId, reference: `NOAREA-${Date.now()}`, serviceUserId: su.id, callTypeId: callType.id, areaId: null, date: dbDate(londonDate()), scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * 60000), createdById: mgr.userId },
      })
    ).id;
  });

  it("keeps a Tower Hamlets visit with no area out of Liverpool's lists, searches, Monitor and visit page", async () => {
    const today = londonDate();
    expect((await listVisits(await liverpool(), { date: today })).rows.map((r) => r.id)).not.toContain(orphan);
    // A search used to replace the branch limit, so a name search showed other branches' visits.
    const searched = await listVisits(await liverpool(), { date: today, q: thLastName });
    expect(searched.rows.filter((r) => r.serviceUser.lastName === thLastName && r.id !== orphan)).toHaveLength(0);
    expect(searched.rows.map((r) => r.id)).not.toContain(orphan);
    const board = await monitorBoard(await liverpool());
    expect(JSON.stringify(board)).not.toContain(orphan);
    await expect(getVisit(await liverpool(), orphan)).rejects.toThrow(/outside your areas/);
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch.Liverpool, employmentStatus: "ACTIVE" } });
    await expect(assignCarer(await liverpool(), { visitId: orphan, slot: "PRIMARY", staffId: staff.id })).rejects.toThrow(/outside your areas/);
  });

  it("still shows it to Tower Hamlets and to an all-branch manager", async () => {
    expect((await getVisit(await towerHamlets(), orphan)).id).toBe(orphan);
    expect((await listVisits(await towerHamlets(), { date: londonDate() })).rows.map((r) => r.id)).toContain(orphan);
    expect((await listVisits(await manager(), { date: londonDate() })).rows.map((r) => r.id)).toContain(orphan);
  });

  it("keeps the Monitor to the coordinator's own branch", async () => {
    const board = await monitorBoard(await liverpool());
    const json = JSON.stringify(board);
    const thVisit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: dbDate(londonDate()), serviceUser: { branchId: branch["Tower Hamlets"] } } });
    expect(json).not.toContain(thVisit.id);
  });
});

describe("the Rota Dashboard follows branch limits", () => {
  it("lists only the coordinator's own team, absences and holidays", async () => {
    const th = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], employmentStatus: "ACTIVE" } });
    const mgr = await manager();
    const soon = new Date(Date.now() + 3 * 86_400_000);
    await db.staffAbsence.createMany({
      data: [
        { organisationId: orgId, staffId: th.id, kind: "HOLIDAY", startsAt: soon, endsAt: new Date(soon.getTime() + 86_400_000), status: "APPROVED", requestedById: mgr.userId },
        { organisationId: orgId, staffId: th.id, kind: "HOLIDAY", startsAt: new Date(soon.getTime() + 5 * 86_400_000), endsAt: new Date(soon.getTime() + 6 * 86_400_000), status: "REQUESTED", requestedById: mgr.userId },
      ],
    });
    const [lpl, thd, all] = await Promise.all([rotaDashboard(await liverpool(), {}), rotaDashboard(await towerHamlets(), {}), rotaDashboard(mgr, {})]);
    expect(lpl.team.map((t) => t.id)).not.toContain(th.id);
    expect(thd.team.map((t) => t.id)).toContain(th.id);
    expect(lpl.reminders.some((r) => r.account === th.displayName)).toBe(false);
    expect(thd.reminders.some((r) => r.account === th.displayName)).toBe(true);
    expect(all.counters.holidaysDue).toBeGreaterThan(lpl.counters.holidaysDue);
    expect(thd.counters.holidaysDue).toBeGreaterThanOrEqual(1);
  });

  it("says a week is not built for a branch even when another branch has built it", async () => {
    // Week 4: only Liverpool builds it.
    await confirmBuild(await liverpool(), { weekStart: wk(4) });
    const d = addDays(wk(4), 2);
    expect((await rotaDashboard(await towerHamlets(), { date: d })).notBuilt).toEqual({ weekStart: wk(4) });
    expect((await rotaDashboard(await liverpool(), { date: d })).notBuilt).toBeNull();
  });
});

describe("pick lists and moves", () => {
  it("lists only the coordinator's own branch staff in the rota filters and pick lists", async () => {
    const th = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], employmentStatus: "ACTIVE" } });
    expect((await rotaLookups(await liverpool())).staff.map((s) => s.id)).not.toContain(th.id);
    expect((await rotaLookups(await towerHamlets())).staff.map((s) => s.id)).toContain(th.id);
  });

  it("refuses, with a clear reason, to move a regular call onto a day that already has it", async () => {
    // A Liverpool template that runs every day of week 2: move Monday's visit onto Tuesday.
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: dbDate(wk(2)), templateId: { not: null }, status: "SCHEDULED", timeLocked: false, serviceUser: { branchId: branch.Liverpool } }, orderBy: { scheduledStart: "asc" } });
    const twin = await db.visit.findFirst({ where: { templateId: v.templateId, date: dbDate(addDays(wk(2), 1)) } });
    expect(twin).not.toBeNull();
    const before = await db.visit.count({ where: { templateId: v.templateId } });
    const primary = await db.visitAssignment.findFirst({ where: { visitId: v.id, slot: "PRIMARY", removedAt: null } });
    await expect(moveVisit(await liverpool(), { visitId: v.id, slot: "PRIMARY", staffId: primary?.staffId ?? null, toDate: addDays(wk(2), 1) })).rejects.toThrow(/already has this regular call/);
    expect(await db.visit.count({ where: { templateId: v.templateId } })).toBe(before);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).date).toEqual(dbDate(wk(2)));
  });
});

describe("allocation stays inside the branch", () => {
  it("never offers or books another branch's carer for a branch-limited coordinator", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: dbDate(wk(2)), status: "SCHEDULED", serviceUser: { branchId: branch.Liverpool } }, include: { assignments: true } });
    // A carer in a care role: office staff are never offered as carers to anyone (HR_SINGLE_STAFF_RECORD.md).
    const th = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], employmentStatus: "ACTIVE", jobTitle: { in: DEFAULT_CARE_ROLES } } });
    const offered = await visitCandidates(await liverpool(), v, "PRIMARY");
    expect(offered.map((c) => c.id)).not.toContain(th.id);
    expect(offered.length).toBeGreaterThan(0);
    await expect(assignCarer(await liverpool(), { visitId: v.id, slot: "PRIMARY", staffId: th.id, acceptWarnings: true })).rejects.toThrow(ForbiddenError);
    expect(await db.visitAssignment.count({ where: { visitId: v.id, staffId: th.id, removedAt: null } })).toBe(0);
    // An all-branch manager is still offered the whole organisation.
    expect((await visitCandidates(await manager(), v, "PRIMARY")).map((c) => c.id)).toContain(th.id);
  });
});
