import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, fromDbDate, isoWeek, londonDate, mondayOf } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { activeReminders, rotaDashboard } from "@/server/rota/dashboard";
import { checklistOf, listVisits, patternWeek } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { nextBirthday, staffBirthdays, upcoming } from "@/server/workforce/birthdays";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The approved OnePlan-style Rota Dashboard and Daily Rota Live List (owner's brief, 31 Oct 2026): every figure and
 * column comes from the records, pattern week and calendar week are different things, checklists are truthful, birthdays
 * are permission-controlled, and branch-limited coordinators see only their own branch.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";
const branch: Record<string, string> = {};
const nextWed = addDays(mondayOf(londonDate()), 9);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
  await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
}, 180_000);

describe("date helpers", () => {
  it("gives the ISO calendar week, which is not the rota pattern week", () => {
    expect(isoWeek("2026-10-31")).toBe(44);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2024-12-30")).toBe(1);
  });

  it("works out the next birthday and the age turned", () => {
    expect(nextBirthday("1979-11-08", "2026-10-31")).toEqual({ next: "2026-11-08", turns: 47, inDays: 8 });
    expect(nextBirthday("1950-03-01", "2026-10-31")).toEqual({ next: "2027-03-01", turns: 77, inDays: 121 });
    expect(nextBirthday("1960-02-29", "2027-01-10").next).toBe("2027-02-28");
    const list = upcoming([{ id: "a", name: "A", dateOfBirth: "1979-11-08", href: null }, { id: "b", name: "B", dateOfBirth: "1980-12-25", href: null }, { id: "c", name: "C", dateOfBirth: "1990-11-01", href: null }], "2026-10-31", 30);
    expect(list.map((b) => b.id)).toEqual(["c", "a"]);
  });

  it("only counts a task as done when its latest outcome is Done", () => {
    expect(checklistOf([])).toEqual({ total: 0, recorded: 0, done: 0, outstanding: 0 });
    expect(checklistOf([{ outcomes: [{ outcome: "DONE" }] }, { outcomes: [{ outcome: "REFUSED" }] }, { outcomes: [] }])).toEqual({ total: 3, recorded: 2, done: 1, outstanding: 1 });
  });
});

describe("Daily Rota columns", () => {
  it("takes the pattern week from the build, from the template's cycle, or shows none for a one-off visit", async () => {
    const ctx = await manager();
    const settings = await rotaSettings(db, orgId);
    const { rows } = await listVisits(ctx, { date: nextWed }, 6000);
    expect(rows.length).toBeGreaterThan(0);
    for (const v of rows.slice(0, 50)) {
      const pw = patternWeek(v, settings);
      if (v.rotaBuild) expect(pw).toBe(v.rotaBuild.cycleWeek);
      else if (!v.templateId) expect(pw).toBeNull();
      else expect(pw).toBeGreaterThanOrEqual(1);
    }
    // A one-off visit has no pattern week, whatever its date.
    expect(patternWeek({ date: new Date(`${nextWed}T00:00:00Z`), templateId: null, rotaBuild: null }, settings)).toBeNull();
    // Checklist counts match the stored outcomes.
    const withTasks = rows.find((v) => v.tasks.length > 0);
    if (withTasks) {
      const tasks = await db.visitTask.findMany({ where: { visitId: withTasks.id }, include: { outcomes: { orderBy: { at: "desc" }, take: 1 } } });
      expect(checklistOf(withTasks.tasks).done).toBe(tasks.filter((t) => t.outcomes[0]?.outcome === "DONE").length);
    }
    // Note counts are the visit's own notes.
    const noted = rows[0]!;
    expect(noted._count.visitNotes).toBe(await db.visitNote.count({ where: { visitId: noted.id } }));
  });

  it("searches by carer name as well as service user and reference", async () => {
    const ctx = await manager();
    const { rows } = await listVisits(ctx, { date: nextWed }, 6000);
    const staffed = rows.find((v) => v.assignments.some((a) => a.slot !== "SHADOW"))!;
    const name = staffed.assignments.find((a) => a.slot !== "SHADOW")!.staff.displayName;
    const hits = await listVisits(ctx, { date: nextWed, q: name }, 6000);
    expect(hits.rows.map((v) => v.id)).toContain(staffed.id);
    expect(hits.rows.every((v) => v.assignments.some((a) => a.staff.displayName === name) || v.reference.includes(name) || `${v.serviceUser.firstName} ${v.serviceUser.lastName} ${v.serviceUser.postcode ?? ""}`.toLowerCase().includes(name.toLowerCase().split(" ")[0]!))).toBe(true);
  });
});

describe("Rota Dashboard", () => {
  it("call cards reconcile with the Daily Rota list for the same day and branch", async () => {
    for (const ctx of [await manager(), await coordinator()]) {
      const d = await rotaDashboard(ctx, { date: nextWed });
      const { rows } = await listVisits(ctx, { date: nextWed }, 6000);
      expect(d.calls.total).toBe(rows.length);
      expect(d.calls.complete).toBe(rows.filter((v) => v.status === "COMPLETED").length);
      expect(d.calls.unassigned).toBe(rows.filter((v) => v.flags.unassignedSlots > 0).length);
      expect(d.calls.missed).toBe(rows.filter((v) => v.status === "MISSED").length);
    }
  });

  it("ignores a branch the member may not choose, and narrows to a branch the member may choose", async () => {
    const lv = await rotaDashboard(await coordinator(), { date: nextWed });
    const sneaky = await rotaDashboard(await coordinator(), { date: nextWed, branchId: branch["Tower Hamlets"] });
    expect(sneaky.branchId).toBeNull();
    expect(sneaky.calls.total).toBe(lv.calls.total);
    const suBranches = new Set((await db.serviceUser.findMany({ where: { id: { in: lv.serviceUsers.map((s) => s.id) } }, select: { branchId: true } })).map((s) => s.branchId));
    expect([...suBranches].every((b) => b === branch.Liverpool || b === null)).toBe(true);
    const th = await rotaDashboard(await manager(), { date: nextWed, branchId: branch["Tower Hamlets"] });
    expect(th.branchId).toBe(branch["Tower Hamlets"]);
    const { rows } = await listVisits(await manager(), { date: nextWed, branchId: branch["Tower Hamlets"] }, 6000);
    expect(th.calls.total).toBe(rows.length);
  });

  it("gives each team member one day status from absences, readiness and bookings, and next visits from scheduled visits", async () => {
    const d = await rotaDashboard(await manager(), { date: nextWed });
    for (const t of d.team) expect(["Off sick", "On leave", "Not ready", "On rota", "Off rota"]).toContain(d.teamStatus.get(t.id)!.status);
    const { rows } = await listVisits(await manager(), { date: nextWed }, 6000);
    const booked = new Set(rows.filter((v) => v.status !== "NOT_DELIVERED").flatMap((v) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staffId)));
    for (const t of d.team) if (d.teamStatus.get(t.id)!.status === "On rota") expect(booked.has(t.id)).toBe(true);
    const su = d.serviceUsers.find((s) => d.nextVisit.get(s.id));
    if (su) {
      const first = await db.visit.findFirst({ where: { serviceUserId: su.id, status: "SCHEDULED", scheduledStart: { gte: new Date() } }, orderBy: { scheduledStart: "asc" } });
      expect(d.nextVisit.get(su.id)?.getTime()).toBe(first!.scheduledStart.getTime());
    }
  });

  it("lists service-user birthdays from stored dates of birth, and team birthdays only for HR users", async () => {
    const ctx = await manager();
    const d = await rotaDashboard(ctx, {});
    const today = londonDate();
    const people = await db.serviceUser.findMany({ where: { id: { in: d.serviceUsers.map((s) => s.id) }, dateOfBirth: { not: null } }, select: { id: true, dateOfBirth: true } });
    const expected = people.filter((p) => nextBirthday(fromDbDate(p.dateOfBirth!), today).inDays <= 30).map((p) => p.id).sort();
    expect((d.birthdays.serviceUsers ?? []).map((b) => b.id).sort()).toEqual(expected);
    // Without an HR sign-in, team dates of birth are not read at all.
    expect(await staffBirthdays({ ...ctx, hrUserId: null }, d.team.map((t) => t.id), today, 30)).toBeNull();
    // A role without service-user records gets no service-user birthdays.
    const finance = await ctxFor("finance@care-solution.demo", BROOKFIELD).catch(() => null);
    const f = finance ? await rotaDashboard(finance, {}).catch(() => null) : null;
    if (f && !f.canPeople) expect(f.birthdays.serviceUsers).toBeNull();
  });

  it("reminders come from real review dates and leave requests, overdue first, within the member's branch", async () => {
    const all = await activeReminders(await manager(), { windowDays: 90 });
    expect(all.map((r) => r.due)).toEqual([...all.map((r) => r.due)].sort());
    for (const r of all) expect(r.overdueDays).toBe(Math.max(0, Math.round((Date.parse(londonDate()) - Date.parse(r.due)) / 86_400_000)));
    const lv = await activeReminders(await coordinator(), { windowDays: 90, branchId: branch["Tower Hamlets"] });
    const lvAll = await activeReminders(await coordinator(), { windowDays: 90 });
    expect(lv).toEqual(lvAll);
    expect(lvAll.length).toBeLessThanOrEqual(all.length);
  });
});
