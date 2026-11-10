import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { dbDate, londonDate, londonToUtc } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { commandActions, commandSearch } from "@/server/search/command";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Ctrl+K command bar's record search (approved redesign, 10 Nov 2026). Two organisations each get a fictional
 * service user, team member and visit today that all match the same search word, so anything leaking across the
 * organisation, branch or permission boundary would show up by id.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const TODAY = londonDate();
/** 06:00 today, so the 16:30 visits are always still to come whenever the suite runs. */
const NOW = londonToUtc(TODAY, 6 * 60);

interface Fixture { orgId: string; suId: string; staffId: string; visitId: string; areaName: string | null; callName: string }
const mine: Fixture = { orgId: "", suId: "", staffId: "", visitId: "", areaName: null, callName: "" };
const theirs: Fixture = { orgId: "", suId: "", staffId: "", visitId: "", areaName: null, callName: "" };
const branch: Record<string, string> = {};

/** Renames an existing person and team member of the demo organisation and gives the person a visit today. */
async function plant(slug: string, into: Fixture, names: { su: string; staff: string; ref: string }, branchId: string) {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug } });
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, branchId }, include: { area: true } });
  await db.serviceUser.update({ where: { id: su.id }, data: { firstName: "Zephyrine", lastName: names.su, preferredName: null } });
  const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: org.id, employmentStatus: "ACTIVE", branchId }, orderBy: { displayName: "asc" } });
  await db.staffMember.update({ where: { id: staff.id }, data: { displayName: `Zephyr ${names.staff}` } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id }, orderBy: { name: "asc" } });
  Object.assign(into, { orgId: org.id, suId: su.id, staffId: staff.id, visitId: await visitToday(org.id, su.id, callType.id, su.areaId, names.ref), areaName: su.area?.name ?? null, callName: callType.name });
}

/** The second organisation has no care records in the seed, so its matching person, team member and visit are created. */
async function plantOther(slug: string, into: Fixture, names: { su: string; staff: string; ref: string }) {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug } });
  const su = await db.serviceUser.create({ data: { organisationId: org.id, reference: "SYN-CMD-OTHER", firstName: "Zephyrine", lastName: names.su, status: "ACTIVE" } });
  const staff = await db.staffMember.create({ data: { organisationId: org.id, hrEmployeeId: "syn-cmd-other", hrVersion: 1, hrHash: "synthetic", staffNumber: "SYN-CMD-1", displayName: `Zephyr ${names.staff}`, jobTitle: "Care Worker", employmentStatus: "ACTIVE", hrBranchKey: "synthetic", projectedAt: new Date() } });
  const callType = await db.callType.create({ data: { organisationId: org.id, name: "Tea call" } });
  Object.assign(into, { orgId: org.id, suId: su.id, staffId: staff.id, visitId: await visitToday(org.id, su.id, callType.id, null, names.ref), areaName: null, callName: callType.name });
}

async function visitToday(organisationId: string, serviceUserId: string, callTypeId: string, areaId: string | null, reference: string) {
  return (await db.visit.create({ data: { organisationId, reference, serviceUserId, callTypeId, areaId, date: dbDate(TODAY), scheduledStart: londonToUtc(TODAY, 16 * 60 + 30), scheduledEnd: londonToUtc(TODAY, 17 * 60), carersRequired: 1, status: "SCHEDULED", publishedAt: new Date() } })).id;
}

const idsOf = (r: Awaited<ReturnType<typeof commandSearch>>) => ({ su: r.serviceUsers.map((s) => s.id), staff: r.staff.map((s) => s.id), visits: r.visitsToday.map((v) => v.id) });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } });
  for (const b of await db.branch.findMany({ where: { organisationId: org.id } })) branch[b.name] = b.id;
  await plant(BROOKFIELD, mine, { su: "Quartermain", staff: "Halloway", ref: "CMD-MINE" }, branch["Tower Hamlets"]!);
  await plantOther(OAKRIDGE, theirs, { su: "Otherfield", staff: "Elsewhere", ref: "CMD-THEIRS" });
}, 180_000);

describe("command bar search", () => {
  it("finds the service user, team member and today's visit, with real details and links", async () => {
    const r = await commandSearch(await manager(), "zephyr", NOW);
    expect(idsOf(r)).toMatchObject({ su: [mine.suId], staff: [mine.staffId] });
    // The renamed person and team member also have seeded visits today; every one listed belongs to this organisation.
    expect(r.visitsToday.map((v) => v.id)).toContain(mine.visitId);
    expect(await db.visit.count({ where: { id: { in: r.visitsToday.map((v) => v.id) }, organisationId: mine.orgId, date: dbDate(TODAY) } })).toBe(r.visitsToday.length);
    const su = r.serviceUsers[0]!;
    expect(su.title).toBe("Zephyrine Quartermain");
    expect(su.detail).toBe(`${mine.areaName} · next visit 16:30`);
    expect(su.href).toBe(`/rota/service-users/${mine.suId}`);
    expect(su.addVisitHref).toBe(`/rota/visits/new?serviceUserId=${mine.suId}`);
    expect(su.carePlanHref).toBe(`/rota/service-users/${mine.suId}?tab=care-plans`);
    expect(r.staff[0]).toMatchObject({ title: "Zephyr Halloway", href: `/rota/staff/${mine.staffId}` });
    // Nobody is booked on it, so it says so; the hour chip is the visit's hour in London.
    expect(r.visitsToday.find((v) => v.id === mine.visitId)).toMatchObject({ title: `Zephyrine Quartermain · ${mine.callName} 16:30`, detail: "Needs a carer", hour: "16", href: `/rota/visits/${mine.visitId}` });
  });

  it("finds today's visit by its reference and by the booked carer's name", async () => {
    expect(idsOf(await commandSearch(await manager(), "CMD-MINE", NOW)).visits).toEqual([mine.visitId]);
    const v = await db.visit.findUniqueOrThrow({ where: { id: mine.visitId } });
    const by = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
    await db.visitAssignment.create({ data: { organisationId: mine.orgId, visitId: v.id, slot: "PRIMARY", staffId: mine.staffId, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: by.id } });
    const r = await commandSearch(await manager(), "halloway", NOW);
    // Every visit listed has that carer booked (the first six of the day are shown), and none says "Needs a carer".
    expect(r.visitsToday.length).toBeGreaterThan(0);
    expect(await db.visit.count({ where: { id: { in: r.visitsToday.map((x) => x.id) }, assignments: { some: { staffId: mine.staffId, removedAt: null } } } })).toBe(r.visitsToday.length);
    const again = await commandSearch(await manager(), "CMD-MINE", NOW);
    expect(again.visitsToday[0]!.detail).toBe("Scheduled");
  });

  it("only lists visits dated today", async () => {
    const v = await db.visit.findUniqueOrThrow({ where: { id: mine.visitId } });
    const tomorrow = new Date(v.date.getTime() + 86_400_000);
    const later = await db.visit.create({ data: { organisationId: mine.orgId, reference: "CMD-MINE-TOMORROW", serviceUserId: mine.suId, callTypeId: v.callTypeId, areaId: v.areaId, date: tomorrow, scheduledStart: new Date(v.scheduledStart.getTime() + 86_400_000), scheduledEnd: new Date(v.scheduledEnd.getTime() + 86_400_000), carersRequired: 1, status: "SCHEDULED", publishedAt: new Date() } });
    const r = await commandSearch(await manager(), "CMD-MINE", NOW);
    expect(r.visitsToday.map((x) => x.id)).toEqual([mine.visitId]);
    await db.visit.delete({ where: { id: later.id } });
  });

  it("never returns another organisation's service user, team member or visit, in either direction", async () => {
    for (const q of ["zephyr", "zephyrine", "Otherfield", "Elsewhere", "CMD-THEIRS", "CMD"]) {
      const r = idsOf(await commandSearch(await manager(), q, NOW));
      expect(r.su).not.toContain(theirs.suId);
      expect(r.staff).not.toContain(theirs.staffId);
      expect(r.visits).not.toContain(theirs.visitId);
    }
    expect(idsOf(await commandSearch(await manager(), "Otherfield", NOW))).toEqual({ su: [], staff: [], visits: [] });
    expect(idsOf(await commandSearch(await manager(), "CMD-THEIRS", NOW))).toEqual({ su: [], staff: [], visits: [] });
    const other = await commandSearch(await otherOrg(), "zephyr", NOW);
    expect(idsOf(other)).toEqual({ su: [theirs.suId], staff: [theirs.staffId], visits: [theirs.visitId] });
    expect(JSON.stringify(other)).not.toContain("Quartermain");
    expect(JSON.stringify(other)).not.toContain("Halloway");
    expect(JSON.stringify(await commandSearch(await manager(), "zephyr", NOW))).not.toContain("Otherfield");
  });

  it("returns no records without the rota permission, when suspended, or without an organisation", async () => {
    const m = await manager();
    const nothing = { su: [], staff: [], visits: [] };
    expect(idsOf(await commandSearch({ ...m, orgRoles: ["CARER"] }, "zephyr", NOW))).toEqual(nothing);
    expect(idsOf(await commandSearch({ ...m, suspended: true }, "zephyr", NOW))).toEqual(nothing);
    expect(idsOf(await commandSearch({ ...m, organisationId: null }, "zephyr", NOW))).toEqual(nothing);
    // One letter is not searched.
    expect(idsOf(await commandSearch(m, "z", NOW))).toEqual(nothing);
  });

  it("offers Add a visit only to someone who may change the rota", async () => {
    const m = await manager();
    const viewer = { ...m, orgRoles: ["COMPLIANCE_LEAD" as const] };
    const r = await commandSearch(viewer, "zephyrine", NOW);
    expect(r.serviceUsers.map((s) => s.id)).toEqual([mine.suId]);
    expect(r.serviceUsers[0]!.addVisitHref).toBeNull();
    expect(commandActions(viewer).map((a) => a.label)).not.toContain("Add a visit");
    expect(commandActions(m).map((a) => a.label)).toEqual(expect.arrayContaining(["Add a visit", "Build the rota for a week", "Add a service user"]));
    expect(commandActions({ ...m, orgRoles: ["CARER"] }).map((a) => a.label)).toEqual(["Open notifications"]);
    expect(commandActions({ ...m, organisationId: null })).toEqual([]);
  });

  it("keeps a branch-limited coordinator to their own branches", async () => {
    expect(idsOf(await commandSearch(await coordinator(), "zephyr", NOW)).su).toEqual([mine.suId]);
    const membership = await db.membership.findFirstOrThrow({ where: { organisationId: mine.orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), membership.id, [branch.Liverpool!]);
    const r = idsOf(await commandSearch(await coordinator(), "zephyr", NOW));
    expect(r.su).toEqual([]);
    expect(r.visits).toEqual([]);
    expect(r.staff).not.toContain(mine.staffId);
    expect(idsOf(await commandSearch(await coordinator(), "CMD-MINE", NOW)).visits).toEqual([]);
  });
});
