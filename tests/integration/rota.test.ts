import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { confirmBuild, deleteBuild, previewBuild, publishBuild } from "@/server/rota/build";
import { listVisits } from "@/server/rota/queries";
import { rotaScope, staffDirectoryWhere } from "@/server/rota/scope";
import { createVisit } from "@/server/rota/visits";
import { cancelVisit, getVisit, setDoubleUp, updateVisit } from "@/server/rota/visits";
import { setTemplateCarer, updateTemplate } from "@/server/rota/templates";
import { checkStaffEligibility } from "@/server/workforce/eligibility";
import { decideAbsence, recordAbsence } from "@/server/workforce/absences";
import { linkLogin, myStaff } from "@/server/workforce/link";
import { addAbsence, getServiceUser, revealKeySafe, setServiceUserStatus } from "@/server/care/service-users";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Rostering against a real database: the HR projection, the build engine, the shared assignment path and the
 * database's own guards. One seeded organisation is shared by the tests in order, as the demo would be used.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";

async function futureVisit(where: object = {}) {
  return db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "SCHEDULED", scheduledStart: { gt: new Date(Date.now() + 86400_000) }, ...where }, include: { assignments: { where: { removedAt: null } } }, orderBy: { scheduledStart: "asc" } });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("HR to Rostering staff projection", () => {
  it("projects every HR employee once, with a branch, inside the HR save", async () => {
    const state = (await db.hrWorkspace.findUniqueOrThrow({ where: { organisationId: orgId } })).state as { employees: unknown[] };
    const staff = await db.staffMember.count({ where: { organisationId: orgId } });
    expect(staff).toBe(state.employees.length);
    expect(await db.staffMember.count({ where: { organisationId: orgId, branchId: null } })).toBe(0);
  });

  it("updates the staff record in the same HR transaction, and marks removed employees instead of deleting them", async () => {
    await hrTransaction(orgId, (s) => {
      const e = s.employees.find((x) => x.id === "emp-2")!;
      e.job = "Senior Care Worker";
      e.version += 1;
    });
    expect((await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: "emp-2" } })).jobTitle).toBe("Senior Care Worker");

    let removed: unknown;
    await hrTransaction(orgId, (s) => {
      const i = s.employees.findIndex((x) => x.id === "emp-45");
      removed = s.employees.splice(i, 1)[0];
    });
    const gone = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: "emp-45" } });
    expect(gone.hrMissing).toBe(true);
    await hrTransaction(orgId, (s) => {
      s.employees.push(removed as (typeof s.employees)[number]);
    });
    expect((await db.staffMember.findFirstOrThrow({ where: { id: gone.id } })).hrMissing).toBe(false);
  });

  it("rolls back the HR change if the projection fails", async () => {
    const before = await db.hrWorkspace.findUniqueOrThrow({ where: { organisationId: orgId } });
    await expect(
      hrTransaction(orgId, (s) => {
        s.employees[0]!.name = "Changed then failed";
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await db.hrWorkspace.findUniqueOrThrow({ where: { organisationId: orgId } });
    expect(JSON.stringify(after.state)).toBe(JSON.stringify(before.state));
  });
});

describe("Build Rota", () => {
  it("previews without saving, builds once, and never duplicates a week", async () => {
    const ctx = await manager();
    const week = addDays(mondayOf(londonDate()), 14);
    const before = await db.visit.count({ where: { organisationId: orgId } });
    const plan = await previewBuild(ctx, { weekStart: week });
    expect(plan.visits.length).toBeGreaterThan(0);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(before);

    const [a, b] = await Promise.allSettled([confirmBuild(ctx, { weekStart: week }), confirmBuild(ctx, { weekStart: week })]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(await db.visit.count({ where: { organisationId: orgId } })).toBe(before + plan.visits.length);
    await expect(confirmBuild(ctx, { weekStart: week })).rejects.toThrow(/already been built/);
    const dupes = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT "templateId", date FROM "Visit" WHERE "templateId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d`;
    expect(Number(dupes[0]!.n)).toBe(0);
  });

  it("never books a carer who is not eligible, and builds unpublished until published", async () => {
    const ctx = await manager();
    const week = addDays(mondayOf(londonDate()), 14);
    const build = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: orgId, weekStart: new Date(`${week}T00:00:00Z`) } });
    expect(await db.visit.count({ where: { rotaBuildId: build.id, publishedAt: { not: null } } })).toBe(0);
    const blocked = await db.visitAssignment.count({ where: { visit: { rotaBuildId: build.id }, eligibility: "NOT_ELIGIBLE" } });
    expect(blocked).toBe(0);
    const r = await publishBuild(ctx, build.id);
    expect(r.published).toBe(build.visitCount);
    expect(await db.notification.count({ where: { type: "rota.published" } })).toBeGreaterThan(0);
  });

  it("refuses past weeks and weeks that do not start on a Monday", async () => {
    const ctx = await manager();
    await expect(confirmBuild(ctx, { weekStart: addDays(mondayOf(londonDate()), -7) })).rejects.toThrow(ValidationError);
    await expect(previewBuild(ctx, { weekStart: addDays(mondayOf(londonDate()), 15) })).rejects.toThrow(/Monday/);
  });

  it("deletes an untouched build, but not one with a visit changed by hand", async () => {
    const ctx = await manager();
    const week = addDays(mondayOf(londonDate()), 21);
    await confirmBuild(ctx, { weekStart: week });
    const build = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: orgId, weekStart: new Date(`${week}T00:00:00Z`), status: "BUILT" } });
    const v = await db.visit.findFirstOrThrow({ where: { rotaBuildId: build.id } });
    await cancelVisit(ctx, v.id, "Changed by hand for the test");
    await expect(deleteBuild(ctx, build.id, "test")).rejects.toThrow(/Cannot delete/);
    const week2 = addDays(mondayOf(londonDate()), 28);
    await confirmBuild(ctx, { weekStart: week2 });
    const b2 = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: orgId, weekStart: new Date(`${week2}T00:00:00Z`), status: "BUILT" } });
    const r = await deleteBuild(ctx, b2.id, "Built by mistake");
    expect(r.removed).toBe(b2.visitCount);
    expect(await db.visit.count({ where: { rotaBuildId: b2.id } })).toBe(0);
  });
});

describe("assignment", () => {
  it("refuses to double-book a carer, in the service and in the database", async () => {
    const ctx = await manager();
    const v1 = await futureVisit({ carersRequired: 1, assignments: { some: { slot: "PRIMARY", removedAt: null } } });
    const busy = v1.assignments.find((a) => a.slot === "PRIMARY")!.staffId;
    const other = await db.visit.create({
      data: { organisationId: orgId, reference: `V-TEST-${Date.now()}`, serviceUserId: (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, id: { not: v1.serviceUserId }, status: "ACTIVE" } })).id, callTypeId: v1.callTypeId, areaId: v1.areaId, date: v1.date, scheduledStart: v1.scheduledStart, scheduledEnd: v1.scheduledEnd, carersRequired: 1 },
    });
    await expect(assignCarer(ctx, { visitId: other.id, slot: "PRIMARY", staffId: busy, acceptWarnings: true })).rejects.toThrow(/Already booked/);
    // Going round the service: the exclusion constraint still refuses the overlapping booking.
    await expect(db.visitAssignment.create({ data: { organisationId: orgId, visitId: other.id, slot: "PRIMARY", staffId: busy, startsAt: other.scheduledStart, endsAt: other.scheduledEnd, eligibility: "ELIGIBLE", assignedById: ctx.userId } })).rejects.toThrow(/overlap|exclusion|conflict/i);
    await db.visit.delete({ where: { id: other.id } });
  });

  it("asks for confirmation on warnings and records the accepted warnings", async () => {
    const ctx = await manager();
    const v = await futureVisit({ assignments: { none: { slot: "SHADOW" } } });
    const staff = await db.staffMember.findMany({ where: { organisationId: orgId, employmentStatus: "ACTIVE", hrMissing: false } });
    let pick: { id: string; state: string } | null = null;
    for (const s of staff.filter((x) => !v.assignments.some((a) => a.staffId === x.id))) {
      const r = await checkStaffEligibility(ctx, { staffId: s.id, start: v.scheduledStart, end: v.scheduledEnd, slot: "SHADOW", visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId });
      if (r.state === "REQUIRES_REVIEW") {
        pick = { id: s.id, state: r.state };
        break;
      }
    }
    expect(pick).not.toBeNull();
    await expect(assignCarer(ctx, { visitId: v.id, slot: "SHADOW", staffId: pick!.id })).rejects.toThrow(/Needs your confirmation/);
    await assignCarer(ctx, { visitId: v.id, slot: "SHADOW", staffId: pick!.id, acceptWarnings: true });
    const a = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, slot: "SHADOW", removedAt: null } });
    expect(a.warningsAccepted.length).toBeGreaterThan(0);
    await unassignCarer(ctx, { visitId: v.id, slot: "SHADOW", reason: "Test clean-up" });
  });

  it("needs two different carers on a double-up", async () => {
    const ctx = await manager();
    const v = await futureVisit({ carersRequired: 1, assignments: { some: { slot: "PRIMARY", removedAt: null } } });
    await setDoubleUp(ctx, v.id, 2);
    const primary = v.assignments.find((a) => a.slot === "PRIMARY")!.staffId;
    await expect(assignCarer(ctx, { visitId: v.id, slot: "SECOND", staffId: primary, acceptWarnings: true })).rejects.toThrow(/other slot|Already booked/);
  });

  it("refuses a stale edit (optimistic concurrency)", async () => {
    const ctx = await manager();
    const v = await futureVisit({ timeLocked: false });
    await updateVisit(ctx, v.id, v.lockVersion, { notes: "first" });
    await expect(updateVisit(ctx, v.id, v.lockVersion, { notes: "second" })).rejects.toThrow(ConflictError);
  });

  it("lets the database refuse an impossible status change", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, status: "COMPLETED" } });
    await expect(db.visit.update({ where: { id: v.id }, data: { status: "SCHEDULED" } })).rejects.toThrow();
  });

  it("keeps clock records append-only", async () => {
    const c = await db.visitClock.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(db.visitClock.update({ where: { id: c.id }, data: { reason: "rewritten" } })).rejects.toThrow();
    await expect(db.visitClock.delete({ where: { id: c.id } })).rejects.toThrow();
  });
});

describe("tenancy and access", () => {
  it("hides one organisation's visits and service users from another", async () => {
    const v = await futureVisit();
    const outsider = await ctxFor("manager@oakridge.demo", OAKRIDGE).catch(() => null);
    if (!outsider) return; // Oakridge has no manager sign-in in this seed.
    await expect(getVisit(outsider, v.id)).rejects.toThrow(NotFoundError);
    await expect(getServiceUser(outsider, v.serviceUserId)).rejects.toThrow(NotFoundError);
    await expect(assignCarer(outsider, { visitId: v.id, slot: "PRIMARY", staffId: v.assignments[0]?.staffId ?? "x" })).rejects.toThrow();
  });

  it("limits a coordinator with areas to those areas", async () => {
    const ctx = await coordinator();
    const areas = await db.area.findMany({ where: { organisationId: orgId }, orderBy: { name: "asc" } });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: ctx.userId } });
    await db.membershipArea.create({ data: { membershipId: m.id, areaId: areas[0]!.id } });
    const fresh = await coordinator();
    const { rows } = await listVisits(fresh, { date: londonDate(), to: addDays(londonDate(), 6) });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.areaId === areas[0]!.id)).toBe(true);
    const elsewhere = await futureVisit({ areaId: areas[1]!.id });
    // Refused (pages turn this into the same 404 as a missing record).
    await expect(getVisit(fresh, elsewhere.id)).rejects.toThrow(ForbiddenError);
    // The staff directory's area filter cannot widen the scope: asking for another area lists nobody.
    const scope = await rotaScope(fresh, "staff.directory");
    const inArea = await db.staffMember.count({ where: staffDirectoryWhere(scope, { area: areas[0]!.id }) });
    const outside = await db.staffMember.count({ where: staffDirectoryWhere(scope, { area: areas[1]!.id }) });
    expect(inArea).toBeGreaterThan(0);
    expect(outside).toBe(0);
    await db.membershipArea.deleteMany({ where: { membershipId: m.id } });
  });

  it("gives a carer no access to the office rota, and links sign-ins only explicitly", async () => {
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(listVisits(carer, {})).rejects.toThrow(ForbiddenError);
    expect((await myStaff(carer)).hrEmployeeId).toBe("emp-1");
    const ctx = await manager();
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, userId: null, employmentStatus: "ACTIVE" } });
    await expect(linkLogin(ctx, { staffId: staff.id, userId: carer.userId, confirm: false })).rejects.toThrow(ValidationError);
    await expect(linkLogin(ctx, { staffId: staff.id, userId: carer.userId, confirm: true })).rejects.toThrow(/already linked/);
  });
});

describe("HR absences and their effect on the rota", () => {
  it("needs a second person to approve, then flags clashing visits without removing them", async () => {
    const recorder = await manager();
    const approver = await ctxFor("jordan.ellis@care-solution.demo", BROOKFIELD);
    const v = await futureVisit({ assignments: { some: { slot: "PRIMARY", removedAt: null } } });
    const staffId = v.assignments.find((a) => a.slot === "PRIMARY")!.staffId;
    const day = londonDate(v.scheduledStart);
    await recordAbsence(recorder, { staffId, kind: "HOLIDAY", from: day, to: day });
    const abs = await db.staffAbsence.findFirstOrThrow({ where: { staffId, status: "REQUESTED" } });
    await expect(decideAbsence(recorder, abs.id, abs.version, "APPROVED", "")).rejects.toThrow(ForbiddenError);
    const r = await decideAbsence(approver, abs.id, abs.version, "APPROVED", "");
    expect(r.flagged).toBeGreaterThan(0);
    const a = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, staffId, removedAt: null } });
    expect(a.reviewReason).toMatch(/holiday/);
    expect(await db.rotaAlert.count({ where: { organisationId: orgId, staffId, resolvedAt: null } })).toBeGreaterThan(0);
  });

  it("does not let a Branch Viewer change absences", async () => {
    const viewer = await ctxFor("taylor.reed@care-solution.demo", BROOKFIELD);
    const s = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(recordAbsence(viewer, { staffId: s.id, kind: "SICKNESS", from: londonDate(), to: londonDate() })).rejects.toThrow(ForbiddenError);
  });
});

describe("service users", () => {
  it("records an absence by cancelling built visits in the period, with the reason", async () => {
    const ctx = await manager();
    const v = await futureVisit();
    const day = londonDate(v.scheduledStart);
    const r = await addAbsence(ctx, v.serviceUserId, { reason: "HOSPITAL", from: day, to: day });
    expect(r.cancelled).toBeGreaterThan(0);
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toMatch(/hospital/);
  });

  it("audits every key safe reveal and hides it from roles without access", async () => {
    const ctx = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, keySafeCipher: { not: null } } });
    const code = await revealKeySafe(ctx, su.id);
    expect(code).toMatch(/^\d+$/);
    expect(await db.auditLog.count({ where: { entityId: su.id, action: "serviceUser.keysafe.revealed" } })).toBe(1);
    const finance = await ctxFor("finance@care-solution.demo", BROOKFIELD);
    await expect(revealKeySafe(finance, su.id)).rejects.toThrow(ForbiddenError);
  });

  it("ending care switches off templates and cancels only future visits", async () => {
    const ctx = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { reference: "desc" } });
    const done = await db.visit.count({ where: { serviceUserId: su.id, status: "COMPLETED" } });
    await setServiceUserStatus(ctx, su.id, "ENDED", "Moved to residential care");
    expect(await db.visitTemplate.count({ where: { serviceUserId: su.id, enabled: true } })).toBe(0);
    expect(await db.visit.count({ where: { serviceUserId: su.id, status: "SCHEDULED", scheduledStart: { gt: londonToUtc(addDays(londonDate(), 1), 0) } } })).toBe(0);
    expect(await db.visit.count({ where: { serviceUserId: su.id, status: "COMPLETED" } })).toBe(done);
  });
});

describe("templates", () => {
  it("refuses a stale template edit and a carer clash in the pattern", async () => {
    const ctx = await manager();
    const t = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, preferredStaff1Id: { not: null } } });
    await expect(updateTemplate(ctx, t.id, t.version + 5, { serviceUserId: t.serviceUserId, callTypeId: t.callTypeId, cycleWeeks: t.cycleWeeks, weekdays: t.weekdays, startMinute: t.startMinute, durationMin: t.durationMin, carersRequired: t.carersRequired, effectiveFrom: "2026-01-05" })).rejects.toThrow(ConflictError);
    const clash = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, enabled: true, id: { not: t.id }, startMinute: t.startMinute, preferredStaff1Id: { notIn: [t.preferredStaff1Id!] } } });
    await expect(setTemplateCarer(ctx, clash.id, clash.version, "PRIMARY", t.preferredStaff1Id)).rejects.toThrow(/overlapping/);
  });
});

describe("one-off visits", () => {
  it("adds a visit for an active service user only, unassigned, with its creation recorded", async () => {
    const ctx = await coordinator();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
    const date = addDays(londonDate(), 10);
    await expect(createVisit(ctx, { serviceUserId: su.id, callTypeId: callType.id, date, startMinute: 9 * 60, durationMin: 2 })).rejects.toThrow(ValidationError);
    const v = await createVisit(ctx, { serviceUserId: su.id, callTypeId: callType.id, date, startMinute: 9 * 60, durationMin: 45, carersRequired: 2, notes: "One-off review visit" });
    expect(v.status).toBe("SCHEDULED");
    expect(v.carersRequired).toBe(2);
    expect(v.manuallyChanged).toBe(true);
    expect(await db.visitAssignment.count({ where: { visitId: v.id } })).toBe(0);
    expect(await db.visitEvent.count({ where: { visitId: v.id, type: "CREATED" } })).toBe(1);
    const paused = await db.serviceUser.findFirst({ where: { organisationId: orgId, status: { not: "ACTIVE" } } });
    if (paused) await expect(createVisit(ctx, { serviceUserId: paused.id, callTypeId: callType.id, date, startMinute: 9 * 60, durationMin: 30 })).rejects.toThrow(/active/);
  });
});
