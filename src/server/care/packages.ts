import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";

/**
 * Care packages: what a funder commissioned for one person (minutes a week, the visit pattern in plain words, dates).
 * One package is active per person at a time; a new one ends the current one the day before it starts. The invoice
 * run picks the package in force on each visit date, so ended packages keep their meaning for past weeks.
 */

const packageSchema = z.object({
  reference: z.string().trim().max(80).optional(),
  commissionedMinutesPerWeek: z.coerce.number().int().min(0, "Minutes cannot be negative").max(20160, "That is more than a week").optional().nullable(),
  startDate: z.string().refine(isIsoDate, "Give the start date"),
  endDate: z.string().refine((s) => !s || isIsoDate(s), "End must be a date").optional(),
  requirements: z.string().trim().max(2000).optional(),
  funderId: z.string().optional(),
});
export type PackageInput = z.input<typeof packageSchema>;

async function serviceUserInScope(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId } });
  if (!su) throw new NotFoundError("Service user");
  return { su, organisationId: scope.organisationId };
}

async function checkFunder(ctx: Ctx, organisationId: string, funderId: string | undefined) {
  if (!funderId) return null;
  // Funding is a finance decision; coordinators record the package and finance links the funder.
  if (!hasOrgPermission(ctx, "finance.manage")) throw new ValidationError("Only finance can set the funder; leave it blank and finance will link it");
  if (!(await db.funder.findFirst({ where: { id: funderId, organisationId, active: true } }))) throw new ValidationError("Choose an active funder");
  return funderId;
}

/** Records a new package. The person's current active package, if any, ends the day before this one starts. */
export async function createPackage(ctx: Ctx, serviceUserId: string, input: PackageInput) {
  const p = packageSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the package");
  const d = p.data;
  if (d.endDate && d.endDate < d.startDate) throw new ValidationError("The end date is before the start");
  const { su, organisationId } = await serviceUserInScope(ctx, serviceUserId);
  const funderId = await checkFunder(ctx, organisationId, d.funderId);
  return db.$transaction(async (tx) => {
    const current = await tx.carePackage.findFirst({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" } });
    if (current) {
      if (fromDbDate(current.startDate) >= d.startDate) throw new ConflictError("The current package starts on or after this date; end or edit it instead");
      await tx.carePackage.update({ where: { id: current.id }, data: { status: "ENDED", endDate: dbDate(addDays(d.startDate, -1)) } });
      await audit({ organisationId, actorId: ctx.userId, action: "care.package.ended", entityType: "ServiceUser", entityId: su.id, data: { packageId: current.id, reason: "Replaced by a new package" } }, tx);
    }
    const row = await tx.carePackage.create({ data: { organisationId, serviceUserId: su.id, reference: d.reference || null, commissionedMinutesPerWeek: d.commissionedMinutesPerWeek ?? null, startDate: dbDate(d.startDate), endDate: d.endDate ? dbDate(d.endDate) : null, requirements: d.requirements || null, funderId } });
    await audit({ organisationId, actorId: ctx.userId, action: "care.package.created", entityType: "ServiceUser", entityId: su.id, data: { packageId: row.id, minutes: row.commissionedMinutesPerWeek } }, tx);
    return row;
  });
}

/** Edits an active package's details. Dates of an ended package are history and are not changed. */
export async function updatePackage(ctx: Ctx, packageId: string, input: PackageInput) {
  const p = packageSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the package");
  const d = p.data;
  if (d.endDate && d.endDate < d.startDate) throw new ValidationError("The end date is before the start");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const pkg = await db.carePackage.findFirst({ where: { id: packageId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
  if (!pkg) throw new NotFoundError("Care package");
  if (pkg.status !== "ACTIVE") throw new ConflictError("An ended package is kept as it was");
  const funderId = d.funderId === undefined ? pkg.funderId : await checkFunder(ctx, scope.organisationId, d.funderId);
  return db.$transaction(async (tx) => {
    const row = await tx.carePackage.update({ where: { id: pkg.id }, data: { reference: d.reference || null, commissionedMinutesPerWeek: d.commissionedMinutesPerWeek ?? null, startDate: dbDate(d.startDate), endDate: d.endDate ? dbDate(d.endDate) : null, requirements: d.requirements || null, funderId } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "care.package.updated", entityType: "ServiceUser", entityId: pkg.serviceUserId, data: { packageId: pkg.id, before: { minutes: pkg.commissionedMinutesPerWeek, start: fromDbDate(pkg.startDate) }, after: { minutes: row.commissionedMinutesPerWeek, start: d.startDate } } }, tx);
    return row;
  });
}

export async function endPackage(ctx: Ctx, packageId: string, input: { endDate: string; reason: string }) {
  if (!isIsoDate(input.endDate)) throw new ValidationError("Give the end date");
  if (input.reason.trim().length < 3) throw new ValidationError("Say why the package ends");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const pkg = await db.carePackage.findFirst({ where: { id: packageId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
  if (!pkg) throw new NotFoundError("Care package");
  if (pkg.status !== "ACTIVE") throw new ConflictError("This package has already ended");
  if (input.endDate < fromDbDate(pkg.startDate)) throw new ValidationError("A package cannot end before it starts");
  return db.$transaction(async (tx) => {
    await tx.carePackage.update({ where: { id: pkg.id }, data: { status: "ENDED", endDate: dbDate(input.endDate) } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "care.package.ended", entityType: "ServiceUser", entityId: pkg.serviceUserId, data: { packageId: pkg.id, endDate: input.endDate, reason: input.reason.trim() } }, tx);
  });
}

/**
 * Commissioned minutes against what the person's enabled templates plan, as a weekly average over the rota cycle
 * (a carer-minute counts once per carer, so double-ups count twice).
 */
export async function packageCoverage(organisationId: string, serviceUserId: string) {
  const [settings, templates, active] = await Promise.all([
    rotaSettings(db, organisationId),
    db.visitTemplate.findMany({ where: { organisationId, serviceUserId, enabled: true, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(londonDate()) } }] }, select: { cycleWeeks: true, weekdays: true, durationMin: true, carersRequired: true } }),
    db.carePackage.findFirst({ where: { organisationId, serviceUserId, status: "ACTIVE" } }),
  ]);
  const cycle = Math.max(1, settings.cycleLength);
  const perCycle = templates.reduce((n, t) => n + t.cycleWeeks.filter((w) => w >= 1 && w <= cycle).length * t.weekdays.length * t.durationMin, 0);
  const carerPerCycle = templates.reduce((n, t) => n + t.cycleWeeks.filter((w) => w >= 1 && w <= cycle).length * t.weekdays.length * t.durationMin * t.carersRequired, 0);
  const planned = Math.round(perCycle / cycle);
  const commissioned = active?.commissionedMinutesPerWeek ?? null;
  return { planned, plannedCarerMinutes: Math.round(carerPerCycle / cycle), commissioned, difference: commissioned === null ? null : planned - commissioned, templates: templates.length };
}
