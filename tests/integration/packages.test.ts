import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, londonDate } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { createPackage, endPackage, packageCoverage, updatePackage } from "@/server/care/packages";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Care packages against a real database: one active at a time, replacement, ending, funders, coverage and scope. */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";

async function personWithPackage(skip = 0) {
  return db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, packages: { some: { status: "ACTIVE" } } }, include: { packages: true }, orderBy: { reference: "asc" }, skip });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("care packages", () => {
  it("replaces the active package: the old one ends the day before, and only one is ever active", async () => {
    const su = await personWithPackage();
    const old = su.packages.find((p) => p.status === "ACTIVE")!;
    const start = addDays(londonDate(), 7);
    const row = await createPackage(await coordinator(), su.id, { reference: "PKG-NEW", commissionedMinutesPerWeek: 600, startDate: start, requirements: "Two calls a day" });
    const ended = await db.carePackage.findUniqueOrThrow({ where: { id: old.id } });
    expect(ended.status).toBe("ENDED");
    expect(fromDbDate(ended.endDate!)).toBe(addDays(start, -1));
    expect(row.status).toBe("ACTIVE");
    // A new package that starts before the current one is refused rather than overlapping.
    await expect(createPackage(await coordinator(), su.id, { startDate: addDays(start, -3) })).rejects.toBeInstanceOf(ConflictError);
    // The database refuses a second active package too.
    await expect(db.carePackage.create({ data: { organisationId: orgId, serviceUserId: su.id, startDate: dbDate(start) } })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { entityId: su.id, action: { in: ["care.package.created", "care.package.ended"] } } })).toBeGreaterThanOrEqual(2);
  });

  it("validates input, keeps ended packages as they were and leaves the funder to finance", async () => {
    const su = await personWithPackage(1);
    const p = su.packages.find((x) => x.status === "ACTIVE")!;
    const start = fromDbDate(p.startDate);
    await expect(updatePackage(await coordinator(), p.id, { startDate: start, endDate: addDays(start, -1) })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePackage(await coordinator(), p.id, { startDate: start, commissionedMinutesPerWeek: -5 })).rejects.toBeInstanceOf(ValidationError);
    const funder = await db.funder.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
    await expect(updatePackage(await coordinator(), p.id, { startDate: start, funderId: funder.id })).rejects.toThrow(/finance/);
    const kept = await updatePackage(await coordinator(), p.id, { startDate: start, commissionedMinutesPerWeek: 420, reference: p.reference ?? undefined });
    expect(kept.funderId).toBe(p.funderId);
    expect(kept.commissionedMinutesPerWeek).toBe(420);
    await expect(endPackage(await coordinator(), p.id, { endDate: addDays(start, -1), reason: "Moved away" })).rejects.toBeInstanceOf(ValidationError);
    await endPackage(await coordinator(), p.id, { endDate: londonDate(), reason: "Moved to residential care" });
    await expect(updatePackage(await coordinator(), p.id, { startDate: start })).rejects.toBeInstanceOf(ConflictError);
    await expect(endPackage(await coordinator(), p.id, { endDate: londonDate(), reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("compares commissioned hours with the repeating visits", async () => {
    const su = await personWithPackage(2);
    const c = await packageCoverage(orgId, su.id);
    expect(c.templates).toBeGreaterThan(0);
    expect(c.planned).toBeGreaterThan(0);
    expect(c.plannedCarerMinutes).toBeGreaterThanOrEqual(c.planned);
    expect(c.difference).toBe(c.commissioned === null ? null : c.planned - c.commissioned);
  });

  it("keeps branch-limited coordinators to their branches' people", async () => {
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const elsewhere = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, packages: { some: { status: "ACTIVE" } }, area: { branchId: { not: liverpool.id } } }, include: { packages: true } });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [liverpool.id]);
    try {
      const ctx = await coordinator();
      await expect(createPackage(ctx, elsewhere.id, { startDate: addDays(londonDate(), 30) })).rejects.toBeInstanceOf(NotFoundError);
      await expect(endPackage(ctx, elsewhere.packages.find((p) => p.status === "ACTIVE")!.id, { endDate: londonDate(), reason: "Not mine" })).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(await manager(), m.id, []);
    }
  });
});
