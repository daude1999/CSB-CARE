import type { FinanceSettings, FunderKind, Prisma, RateCardKind, TimeBasis } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { parsePounds } from "./pricing";

type Tx = Prisma.TransactionClient;

/**
 * Funders, rate cards, bank holidays and finance settings. Reading needs finance.view; changing needs finance.manage.
 * Rate cards are dated: a change in price is a new card from a new date, so past runs can always be explained.
 */

export async function financeSettings(tx: Tx | typeof db, organisationId: string): Promise<FinanceSettings> {
  return (await tx.financeSettings.findUnique({ where: { organisationId } })) ?? (await tx.financeSettings.create({ data: { organisationId } }));
}

function uniqueOr(e: unknown, message: string): never {
  if ((e as { code?: string }).code === "P2002") throw new ConflictError(message);
  throw e;
}

export async function financeReference(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "finance.view");
  const [funders, cards, holidays, settings, packages, staff] = await Promise.all([
    db.funder.findMany({ where: { organisationId }, include: { chargeRateCard: { select: { id: true, name: true } }, _count: { select: { packages: { where: { status: "ACTIVE" } } } } }, orderBy: { name: "asc" } }),
    db.rateCard.findMany({ where: { organisationId }, include: { bands: { orderBy: [{ bankHoliday: "asc" }, { fromMinute: "asc" }] } }, orderBy: [{ kind: "asc" }, { effectiveFrom: "desc" }] }),
    db.bankHoliday.findMany({ where: { organisationId }, orderBy: { date: "asc" } }),
    financeSettings(db, organisationId),
    db.carePackage.findMany({ where: { organisationId, status: "ACTIVE" }, include: { serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true } }, funder: { select: { id: true, name: true } } }, orderBy: { serviceUser: { lastName: "asc" } } }),
    db.staffMember.findMany({ where: { organisationId, employmentStatus: { not: "ARCHIVED" }, hrMissing: false, assignments: { some: {} } }, select: { id: true, displayName: true, payRates: { where: { effectiveTo: null }, select: { id: true, rateCard: { select: { id: true, name: true } }, effectiveFrom: true } } }, orderBy: { displayName: "asc" } }),
  ]);
  return { funders, cards, holidays, settings, packages, staff };
}

const funderSchema = z.object({
  name: z.string().trim().min(2, "Give the funder a name").max(120),
  kind: z.enum(["LOCAL_AUTHORITY", "NHS", "PRIVATE", "OTHER"], { message: "Choose the type of funder" }),
  reference: z.string().trim().max(60).optional(),
  billingEmail: z.union([z.literal(""), z.string().trim().email("Check the billing email")]).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(120),
  chargeBasis: z.enum(["SCHEDULED", "ACTUAL"]),
  chargeRateCardId: z.string().optional(),
  shortNoticeCancelHours: z.union([z.literal(""), z.coerce.number().int().min(0).max(168)]).optional(),
});

export async function saveFunder(ctx: Ctx, id: string | null, input: Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const p = funderSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the funder");
  const d = p.data;
  return db.$transaction(async (tx) => {
    if (d.chargeRateCardId && !(await tx.rateCard.findFirst({ where: { id: d.chargeRateCardId, organisationId, kind: "CHARGE" } }))) throw new ValidationError("Choose a charge rate card");
    const data = { name: d.name, kind: d.kind as FunderKind, reference: d.reference || null, billingEmail: d.billingEmail || null, paymentTermsDays: d.paymentTermsDays, chargeBasis: d.chargeBasis as TimeBasis, chargeRateCardId: d.chargeRateCardId || null, shortNoticeCancelHours: d.shortNoticeCancelHours === "" || d.shortNoticeCancelHours === undefined ? null : d.shortNoticeCancelHours };
    try {
      if (id) {
        const f = await tx.funder.findFirst({ where: { id, organisationId } });
        if (!f) throw new NotFoundError("Funder");
        await tx.funder.update({ where: { id: f.id }, data });
        await audit({ organisationId, actorId: ctx.userId, action: "finance.funder.updated", entityType: "Funder", entityId: f.id, data: { name: d.name } }, tx);
        return f.id;
      }
      const f = await tx.funder.create({ data: { organisationId, ...data } });
      await audit({ organisationId, actorId: ctx.userId, action: "finance.funder.created", entityType: "Funder", entityId: f.id, data: { name: d.name } }, tx);
      return f.id;
    } catch (e) {
      return uniqueOr(e, "A funder with that name already exists");
    }
  });
}

export async function createRateCard(ctx: Ctx, input: { kind: string; name: string; effectiveFrom: string }) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const kind = (["CHARGE", "PAY"] as RateCardKind[]).find((k) => k === input.kind);
  if (!kind) throw new ValidationError("Choose charge or pay");
  if (input.name.trim().length < 2) throw new ValidationError("Give the rate card a name");
  if (!isIsoDate(input.effectiveFrom)) throw new ValidationError("Choose the date it applies from");
  try {
    const c = await db.rateCard.create({ data: { organisationId, kind, name: input.name.trim(), effectiveFrom: dbDate(input.effectiveFrom) } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.ratecard.created", entityType: "RateCard", entityId: c.id, data: { kind, name: c.name } });
    return c;
  } catch (e) {
    return uniqueOr(e, "A rate card with that name already exists");
  }
}

/** A rate card can be changed only until it is first used in a run; after that, start a new card. */
async function editableCard(tx: Tx, organisationId: string, cardId: string) {
  const card = await tx.rateCard.findFirst({ where: { id: cardId, organisationId } });
  if (!card) throw new NotFoundError("Rate card");
  const used = card.kind === "CHARGE"
    ? await tx.invoiceLine.count({ where: { invoice: { organisationId, run: { status: { not: "VOID" } } }, bandLabel: { startsWith: `${card.name} · ` } } })
    : await tx.payLine.count({ where: { run: { organisationId, status: { not: "VOID" } }, bandLabel: { startsWith: `${card.name} · ` } } });
  if (used) throw new ConflictError("This rate card has been used in a run. Create a new card from a new date instead of changing it.");
  return card;
}

export async function addBand(ctx: Ctx, cardId: string, input: { label: string; weekdays: number[]; from: string; to: string; bankHoliday: boolean; rate: string; unit: string; minimumMinutes?: string }) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const ratePence = parsePounds(input.rate);
  if (ratePence === null || ratePence <= 0) throw new ValidationError("Enter the rate in pounds, for example 24.50");
  if (input.label.trim().length < 2) throw new ValidationError("Give the band a label, for example Weekday daytime");
  const from = parseHhmm(input.from || "00:00");
  const to = input.to === "24:00" || !input.to ? 1440 : parseHhmm(input.to);
  if (from === null || to === null || to <= from) throw new ValidationError("The band must end after it starts");
  const days = [...new Set(input.weekdays)].filter((d) => d >= 1 && d <= 7);
  if (!input.bankHoliday && !days.length) throw new ValidationError("Choose the days this band applies to");
  const unit = input.unit === "PER_VISIT" ? "PER_VISIT" : "PER_HOUR";
  const min = input.minimumMinutes ? Number(input.minimumMinutes) : null;
  if (min !== null && (!Number.isInteger(min) || min < 0 || min > 240)) throw new ValidationError("The minimum must be between 0 and 240 minutes");
  return db.$transaction(async (tx) => {
    const card = await editableCard(tx, organisationId, cardId);
    if (input.bankHoliday && (await tx.rateBand.findFirst({ where: { rateCardId: card.id, bankHoliday: true } }))) throw new ConflictError("This card already has a bank holiday band");
    const b = await tx.rateBand.create({ data: { rateCardId: card.id, label: input.label.trim(), weekdays: input.bankHoliday ? [] : days, fromMinute: input.bankHoliday ? 0 : from, toMinute: input.bankHoliday ? 1440 : to, bankHoliday: input.bankHoliday, ratePence, unit, minimumMinutes: min } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.band.added", entityType: "RateCard", entityId: card.id, data: { label: b.label, ratePence } }, tx);
  });
}

export async function removeBand(ctx: Ctx, bandId: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  return db.$transaction(async (tx) => {
    const b = await tx.rateBand.findFirst({ where: { id: bandId, rateCard: { organisationId } } });
    if (!b) throw new NotFoundError("Rate band");
    await editableCard(tx, organisationId, b.rateCardId);
    await tx.rateBand.delete({ where: { id: b.id } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.band.removed", entityType: "RateCard", entityId: b.rateCardId, data: { label: b.label, ratePence: b.ratePence } }, tx);
  });
}

export async function addBankHoliday(ctx: Ctx, date: string, name: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  if (!isIsoDate(date) || name.trim().length < 2) throw new ValidationError("Choose the date and give it a name");
  try {
    await db.bankHoliday.create({ data: { organisationId, date: dbDate(date), name: name.trim() } });
  } catch (e) {
    uniqueOr(e, "That date is already a bank holiday");
  }
  await audit({ organisationId, actorId: ctx.userId, action: "finance.bankholiday.added", entityType: "Organisation", entityId: organisationId, data: { date, name: name.trim() } });
}

export async function removeBankHoliday(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const h = await db.bankHoliday.findFirst({ where: { id, organisationId } });
  if (!h) throw new NotFoundError("Bank holiday");
  await db.bankHoliday.delete({ where: { id: h.id } });
  await audit({ organisationId, actorId: ctx.userId, action: "finance.bankholiday.removed", entityType: "Organisation", entityId: organisationId, data: { date: h.date.toISOString().slice(0, 10) } });
}

const settingsSchema = z.object({
  defaultPayRateCardId: z.string().optional(),
  payBasis: z.enum(["SCHEDULED", "ACTUAL"]),
  mileage: z.string().refine((s) => parsePounds(s) !== null, "Enter the mileage rate in pounds, for example 0.45"),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,10}$/, "Use up to 10 capital letters, numbers or dashes"),
  estimateOnCostPercent: z.coerce.number({ invalid_type_error: "Enter the on-cost as a whole percentage" }).int("Enter the on-cost as a whole percentage").min(0).max(100).default(0),
});

export async function updateFinanceSettings(ctx: Ctx, input: Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const p = settingsSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the settings");
  return db.$transaction(async (tx) => {
    if (p.data.defaultPayRateCardId && !(await tx.rateCard.findFirst({ where: { id: p.data.defaultPayRateCardId, organisationId, kind: "PAY" } }))) throw new ValidationError("Choose a pay rate card");
    await financeSettings(tx, organisationId);
    await tx.financeSettings.update({ where: { organisationId }, data: { defaultPayRateCardId: p.data.defaultPayRateCardId || null, payBasis: p.data.payBasis, mileagePencePerMile: parsePounds(p.data.mileage)!, invoicePrefix: p.data.invoicePrefix, estimateOnCostPercent: p.data.estimateOnCostPercent, updatedById: ctx.userId } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.settings.updated", entityType: "Organisation", entityId: organisationId, data: { payBasis: p.data.payBasis, estimateOnCostPercent: p.data.estimateOnCostPercent } }, tx);
  });
}

/** Which funder pays for a person's active package. */
export async function setPackageFunder(ctx: Ctx, packageId: string, funderId: string | null) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  return db.$transaction(async (tx) => {
    const pkg = await tx.carePackage.findFirst({ where: { id: packageId, organisationId } });
    if (!pkg) throw new NotFoundError("Care package");
    if (funderId && !(await tx.funder.findFirst({ where: { id: funderId, organisationId, active: true } }))) throw new ValidationError("Choose an active funder");
    await tx.carePackage.update({ where: { id: pkg.id }, data: { funderId } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.package.funder", entityType: "ServiceUser", entityId: pkg.serviceUserId, data: { packageId: pkg.id, from: pkg.funderId, to: funderId } }, tx);
  });
}

/** Sets a carer's pay rate card from a date, ending their previous one the day before. */
export async function setStaffPayCard(ctx: Ctx, staffId: string, rateCardId: string, from: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  if (!isIsoDate(from)) throw new ValidationError("Choose the date it applies from");
  return db.$transaction(async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { id: staffId, organisationId } });
    if (!staff) throw new NotFoundError("Staff member");
    if (!(await tx.rateCard.findFirst({ where: { id: rateCardId, organisationId, kind: "PAY" } }))) throw new ValidationError("Choose a pay rate card");
    const current = await tx.staffPayRate.findFirst({ where: { staffId: staff.id, effectiveTo: null } });
    if (current && current.effectiveFrom >= dbDate(from)) throw new ValidationError("The new rate must start after the current one");
    if (current) await tx.staffPayRate.update({ where: { id: current.id }, data: { effectiveTo: new Date(dbDate(from).getTime() - 86400000) } });
    await tx.staffPayRate.create({ data: { organisationId, staffId: staff.id, rateCardId, effectiveFrom: dbDate(from) } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.payrate.set", entityType: "StaffMember", entityId: staff.id, data: { rateCardId, from } }, tx);
  });
}
