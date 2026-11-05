import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { categoryLabel } from "./su-documents";
import { PACKAGE_QUERY_CATEGORIES } from "./package-view";

/**
 * Care packages: what a funder commissioned for one person (minutes a week, the visit pattern in plain words, dates).
 * One package is active per person at a time; a new one ends the current one the day before it starts. The invoice
 * run picks the package in force on each visit date, so ended packages keep their meaning for past weeks.
 */

export const REQUIREMENTS_MAX = 20000;

export const packageSchema = z.object({
  reference: z.string().trim().max(80).optional(),
  commissionedMinutesPerWeek: z.coerce.number().int().min(0, "Minutes cannot be negative").max(20160, "That is more than a week").optional().nullable(),
  startDate: z.string().refine(isIsoDate, "Give the start date"),
  endDate: z.string().refine((s) => !s || isIsoDate(s), "End must be a date").optional(),
  // Long enough for text saved by earlier imports, so an existing package can always be edited and saved unchanged.
  requirements: z.string().trim().max(REQUIREMENTS_MAX, "The requirements text is too long").optional(),
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

/**
 * Open and closed review items that belong to the package (funding to verify, hours to check, scheduling questions),
 * for a person the caller may see. Restricted items are counted but not shown without serviceUser.sensitive.
 */
export async function packageReviewItems(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true } });
  if (!su) throw new NotFoundError("Service user");
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const where = { organisationId: scope.organisationId, serviceUserId: su.id, category: { in: [...PACKAGE_QUERY_CATEGORIES] } };
  const [items, hidden] = await Promise.all([
    db.careIntakeReviewItem.findMany({ where: { ...where, ...(sensitive ? {} : { restricted: false }) }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100, select: { id: true, category: true, description: true, sourceRef: true, status: true, restricted: true, createdAt: true, resolvedAt: true, resolution: true, intakeId: true } }),
    sensitive ? Promise.resolve(0) : db.careIntakeReviewItem.count({ where: { ...where, restricted: true, status: "OPEN" } }),
  ]);
  return { items, hidden, open: items.filter((i) => i.status === "OPEN").length };
}

/** Council documents that usually commission a package; listed as "on file", never claimed as a package's source. */
const COMMISSIONING_CATEGORIES = ["COUNCIL_SUPPORT_PLAN", "PURCHASE_ORDER", "CARE_PACKAGE_AUTHORISATION", "INDIVIDUAL_SERVICE_AGREEMENT", "CARE_SUPPORT_ASSESSMENT", "COUNCIL_REVIEW"];

/**
 * Where each package came from, only where it is recorded: a Care Coordinator intake whose approved facts created the
 * package (with the documents and pages they were read from), plus the person's commissioning documents on file.
 * Sensitive documents keep only their category for someone without serviceUser.sensitive.
 */
export async function packageSources(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, packages: { select: { id: true } } } });
  if (!su) throw new NotFoundError("Service user");
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const org = scope.organisationId;
  const refs = su.packages.map((p) => `CarePackage:${p.id}`);
  const [facts, onFile] = await Promise.all([
    refs.length ? db.careIntakeFact.findMany({ where: { organisationId: org, appliedRef: { in: refs }, intake: { organisationId: org, serviceUserId: su.id } }, select: { appliedRef: true, intakeId: true, sourceDocumentId: true, sourcePage: true, intake: { select: { reference: true } } } }) : Promise.resolve([]),
    db.serviceUserDocument.findMany({ where: { organisationId: org, serviceUserId: su.id, section: "COUNCIL", category: { in: COMMISSIONING_CATEGORIES }, archivedAt: null }, select: { id: true, name: true, category: true, sensitive: true, receivedOn: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const docIds = [...new Set(facts.map((f) => f.sourceDocumentId).filter((x): x is string => !!x))];
  const docs = docIds.length ? await db.careIntakeDocument.findMany({ where: { id: { in: docIds }, intake: { organisationId: org } }, select: { id: true, name: true, section: true, category: true, sensitive: true, filedDocumentId: true } }) : [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const byPackage = new Map<string, { intakeId: string; intakeReference: string; documents: { name: string; pages: number[]; filedDocumentId: string | null; restricted: boolean }[] }>();
  for (const f of facts) {
    const packageId = f.appliedRef!.slice("CarePackage:".length);
    const entry = byPackage.get(packageId) ?? { intakeId: f.intakeId, intakeReference: f.intake.reference, documents: [] };
    const d = f.sourceDocumentId ? docById.get(f.sourceDocumentId) : undefined;
    if (d) {
      const restricted = d.sensitive && !sensitive;
      const name = restricted ? categoryLabel(d.section, d.category) : d.name;
      let row = entry.documents.find((x) => x.name === name);
      if (!row) {
        row = { name, pages: [], filedDocumentId: restricted ? null : d.filedDocumentId, restricted };
        entry.documents.push(row);
      }
      if (!restricted && f.sourcePage && !row.pages.includes(f.sourcePage)) row.pages.push(f.sourcePage);
    }
    byPackage.set(packageId, entry);
  }
  for (const e of byPackage.values()) for (const d of e.documents) d.pages.sort((a, b) => a - b);
  return {
    byPackage,
    onFile: onFile.map((d) => {
      const restricted = d.sensitive && !sensitive;
      return { id: d.id, name: restricted ? "Restricted document" : d.name, categoryLabel: categoryLabel("COUNCIL", d.category), receivedOn: d.receivedOn, restricted };
    }),
  };
}

/** The audit trail of the person's packages (created, changed, ended), newest first. */
export async function packageHistory(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true } });
  if (!su) throw new NotFoundError("Service user");
  return db.auditLog.findMany({ where: { organisationId: scope.organisationId, entityType: "ServiceUser", entityId: su.id, action: { startsWith: "care.package." } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorId: true, createdAt: true, data: true } });
}
