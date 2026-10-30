import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { hrBranches, saveBranch, setMemberBranches } from "@/server/admin/branches";
import { memberScope, rotaScope, serviceUserWhere, staffDirectoryWhere } from "@/server/rota/scope";
import { listVisits } from "@/server/rota/queries";
import { getVisit } from "@/server/rota/visits";
import { listServiceUsers, getServiceUser } from "@/server/care/service-users";
import { getTimesheet, listTimesheets } from "@/server/finance/timesheets";
import { startAudit } from "@/server/compliance/audits";
import { reportRows } from "@/server/reports/tables";
import { saveArea } from "@/server/rota/reference";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Branch scope: a member granted branches sees only those branches' records, in every module, however they ask
 * (lists, single records, filters, timesheets, audits, report exports). The scope is derived on the server from
 * MembershipBranch on each request; nothing relies on the interface hiding things.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const finance = () => ctxFor("finance@care-solution.demo", BROOKFIELD);
let orgId = "";
let liverpool = "";
let portsmouth = "";

async function limitTo(email: string, branchIds: string[]) {
  const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email } } });
  await setMemberBranches(await manager(), m.id, branchIds);
  return ctxFor(email, BROOKFIELD);
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  liverpool = (await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } })).id;
  portsmouth = (await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Portsmouth" } })).id;
}, 120_000);

describe("branch administration", () => {
  it("maps a branch to its HR branch explicitly, refuses unknown or duplicate mappings, and audits changes", async () => {
    const m = await manager();
    const hr = await hrBranches(orgId);
    expect(hr.map((b) => b.id)).toContain("liverpool");
    await expect(saveBranch(m, { id: liverpool, name: "Liverpool", hrBranchKey: "no-such-branch" })).rejects.toThrow(ValidationError);
    await expect(saveBranch(m, { id: portsmouth, name: "Portsmouth", hrBranchKey: "liverpool" })).rejects.toThrow(/already mapped/);
    await expect(saveBranch(m, { name: "Liverpool" })).rejects.toThrow(/already exists/);
    const id = await saveBranch(m, { name: "Leeds", address: "1 Test Street" });
    expect((await db.branch.findUniqueOrThrow({ where: { id } })).hrBranchKey).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "Branch", entityId: id, action: "branch.created" } })).toBe(1);
    await expect(saveBranch(await coordinator(), { name: "Nope" })).rejects.toThrow(ForbiddenError);
  });

  it("requires an area to belong to a branch once the organisation has branches", async () => {
    await expect(saveArea(await manager(), { name: "Floating", colour: "#123456", branchId: null })).rejects.toThrow(/branch/);
  });

  it("records who granted which branches", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    const admin = await manager();
    await setMemberBranches(admin, m.id, [liverpool]);
    const grants = await db.membershipBranch.findMany({ where: { membershipId: m.id } });
    expect(grants.map((g) => g.branchId)).toEqual([liverpool]);
    expect(grants[0]!.grantedById).toBe(admin.userId);
    await expect(setMemberBranches(admin, m.id, ["not-a-branch"])).rejects.toThrow(NotFoundError);
    await setMemberBranches(admin, m.id, []);
    expect(await db.membershipBranch.count({ where: { membershipId: m.id } })).toBe(0);
  });
});

describe("branch scope in rostering", () => {
  it("compiles branch grants into the areas of those branches, intersected with any area limits", async () => {
    const ctx = await limitTo("coordinator@care-solution.demo", [liverpool]);
    expect(ctx.branchIds).toEqual([liverpool]);
    const scope = await memberScope(ctx.userId, orgId);
    const liverpoolAreas = (await db.area.findMany({ where: { organisationId: orgId, branchId: liverpool }, select: { id: true } })).map((a) => a.id);
    expect(liverpoolAreas.length).toBeGreaterThan(0);
    expect([...(scope.areaIds ?? [])].sort()).toEqual([...liverpoolAreas].sort());
    // A Portsmouth-only area limit on a Liverpool-only member leaves nothing (the intersection is empty, never "everything").
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: ctx.userId } });
    const portsmouthArea = await db.area.findFirstOrThrow({ where: { organisationId: orgId, branchId: portsmouth } });
    await db.membershipArea.create({ data: { membershipId: m.id, areaId: portsmouthArea.id } });
    const again = await memberScope((await coordinator()).userId, orgId);
    expect(again.areaIds).toEqual([]);
    await db.membershipArea.deleteMany({ where: { membershipId: m.id } });
  });

  it("lists, opens and filters visits, service users and staff within the granted branches only", async () => {
    const ctx = await limitTo("coordinator@care-solution.demo", [liverpool]);
    const scope = await rotaScope(ctx, "rota.view");
    const { rows } = await listVisits(ctx, { date: londonDate(), to: addDays(londonDate(), 6) });
    expect(rows.length).toBeGreaterThan(0);
    const areaBranch = new Map((await db.area.findMany({ where: { organisationId: orgId } })).map((a) => [a.id, a.branchId]));
    expect(rows.every((r) => r.areaId === null || areaBranch.get(r.areaId) === liverpool)).toBe(true);
    const elsewhere = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, area: { branchId: portsmouth }, scheduledStart: { gt: new Date() } } });
    await expect(getVisit(ctx, elsewhere.id)).rejects.toThrow(ForbiddenError);
    // Asking for a Portsmouth area by filter does not widen the scope: it returns nothing.
    const portsmouthArea = await db.area.findFirstOrThrow({ where: { organisationId: orgId, branchId: portsmouth } });
    expect((await listVisits(ctx, { date: londonDate(), to: addDays(londonDate(), 6), areaId: portsmouthArea.id })).rows).toEqual([]);

    const people = await listServiceUsers(ctx, {});
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((p) => p.branchId === liverpool || p.branchId === null)).toBe(true);
    const outsider = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: portsmouth } });
    await expect(getServiceUser(ctx, outsider.id)).rejects.toThrow();
    expect(await db.serviceUser.count({ where: { ...serviceUserWhere(scope), id: outsider.id } })).toBe(0);

    const staffOutside = await db.staffMember.count({ where: { ...staffDirectoryWhere(scope, {}), branchId: portsmouth } });
    expect(staffOutside).toBe(0);
    expect(await db.staffMember.count({ where: staffDirectoryWhere(scope, {}) })).toBeGreaterThan(0);

    const wide = await limitTo("coordinator@care-solution.demo", []);
    expect(wide.branchIds).toBeNull();
    expect((await listVisits(wide, { date: londonDate(), to: addDays(londonDate(), 6) })).rows.length).toBeGreaterThan(rows.length);
  });
});

describe("branch scope in finance, audits and exports", () => {
  it("shows a branch-limited finance officer only their branches' timesheets", async () => {
    const all = await listTimesheets(await finance(), addDays(mondayOf(londonDate()), -7));
    expect(all.length).toBeGreaterThan(0);
    const ctx = await limitTo("finance@care-solution.demo", [portsmouth]);
    const mine = await listTimesheets(ctx, addDays(mondayOf(londonDate()), -7));
    const staff = new Map((await db.staffMember.findMany({ where: { organisationId: orgId } })).map((s) => [s.id, s.branchId]));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((t) => staff.get(t.staffId) === portsmouth || staff.get(t.staffId) === null)).toBe(true);
    const other = all.find((t) => staff.get(t.staffId) === liverpool)!;
    await expect(getTimesheet(ctx, other.id)).rejects.toThrow(NotFoundError);
    await limitTo("finance@care-solution.demo", []);
  });

  it("keeps a branch-limited manager to audits in their branches and scopes the acknowledgement export", async () => {
    const ctx = await limitTo("manager@care-solution.demo", [liverpool]);
    const tpl = await db.auditTemplate.findFirstOrThrow({ where: { status: "ACTIVE" } });
    await expect(startAudit(ctx, tpl.id, { title: "Org-wide" })).rejects.toThrow(/Choose one of your branches/);
    await expect(startAudit(ctx, tpl.id, { title: "Elsewhere", branchId: portsmouth })).rejects.toThrow(NotFoundError);
    const a = await startAudit(ctx, tpl.id, { title: "Liverpool spot check", branchId: liverpool });
    expect(a.branchId).toBe(liverpool);
    const report = await reportRows(ctx, "acknowledgements");
    const names = new Set(report.rows.map((r) => r[0]));
    const portsmouthMember = await db.membership.findFirst({ where: { organisationId: orgId, branchId: portsmouth }, include: { user: true } });
    if (portsmouthMember) expect(names.has(portsmouthMember.user.name)).toBe(false);
    await limitTo("manager@care-solution.demo", []);
  });
});
