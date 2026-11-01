import { toCsv } from "@/lib/csv";
import type { Prisma, RateBand, RateCard } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isoWeekday, londonMinute } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { priceAtCutOff, priceWork, splitWork } from "./pricing";
import { financeSettings } from "./rates";
import { weekOf } from "./timesheets";

type Tx = Prisma.TransactionClient;
type Card = RateCard & { bands: RateBand[] };

/**
 * Payroll and invoice preparation. A run is a draft worked out from approved timesheets (pay) or delivered visits
 * (invoices), with every problem listed as an exception. A second person approves it, after which the database
 * freezes it; a mistake is put right by voiding the run and preparing a new one. The platform never pays anyone,
 * submits payroll, or sends an invoice: approved runs are exported for the payroll provider and the accounts system.
 */

export interface RunException {
  kind: string;
  message: string;
  ref?: string;
}

function cardOn(cards: Card[], id: string | null | undefined, date: Date) {
  const c = cards.find((x) => x.id === id);
  return c && c.effectiveFrom <= date && (!c.effectiveTo || c.effectiveTo >= date) ? c : null;
}

async function bankHolidays(tx: Tx, organisationId: string, start: string, end: string) {
  const rows = await tx.bankHoliday.findMany({ where: { organisationId, date: { gte: dbDate(start), lte: dbDate(end) } } });
  return new Set(rows.map((r) => fromDbDate(r.date)));
}

async function noOpenRun(tx: Tx, table: "payRun" | "invoiceRun", organisationId: string, start: string) {
  const where = { organisationId, periodStart: dbDate(start), status: { not: "VOID" as const } };
  const open = table === "payRun" ? await tx.payRun.findFirst({ where }) : await tx.invoiceRun.findFirst({ where });
  if (open) throw new ConflictError(`There is already a ${open.status.toLowerCase()} run for this week. Void it first to prepare a new one.`);
}

// ── Payroll preparation ──

/**
 * Whether a cancelled visit is invoiced. The office's choice when cancelling wins. With no choice recorded (care ended,
 * the person was away), the funder's short-notice rule decides.
 */
export function cancellationCharged(v: { cancellationCharge: boolean | null; cancelledAt: Date | null; scheduledStart: Date }, shortNoticeCancelHours: number | null) {
  if (v.cancellationCharge !== null) return v.cancellationCharge;
  return shortNoticeCancelHours !== null && v.cancelledAt !== null && v.scheduledStart.getTime() - v.cancelledAt.getTime() < shortNoticeCancelHours * 3600000;
}

export async function preparePayRun(ctx: Ctx, weekStart: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const { start, end } = weekOf(weekStart);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payrun:${organisationId}:${start}`}))`;
    await noOpenRun(tx, "payRun", organisationId, start);
    const [settings, cards, holidays, sheets, others, payRates, claims] = await Promise.all([
      financeSettings(tx, organisationId),
      tx.rateCard.findMany({ where: { organisationId, kind: "PAY" }, include: { bands: true } }),
      bankHolidays(tx, organisationId, start, end),
      tx.timesheet.findMany({ where: { organisationId, periodStart: dbDate(start), status: "APPROVED" }, include: { lines: true } }),
      tx.timesheet.findMany({ where: { organisationId, periodStart: dbDate(start), status: { not: "APPROVED" } }, select: { staffId: true, status: true } }),
      tx.staffPayRate.findMany({ where: { organisationId } }),
      tx.mileageClaim.findMany({ where: { organisationId, status: "APPROVED", date: { gte: dbDate(start), lte: dbDate(end) } } }),
    ]);
    const staff = new Map((await tx.staffMember.findMany({ where: { organisationId }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
    const exceptions: RunException[] = others.map((o) => ({ kind: "TIMESHEET", message: `${staff.get(o.staffId) ?? "A carer"}: timesheet is ${o.status.toLowerCase()}, so not included`, ref: o.staffId }));
    const lines: Prisma.PayLineCreateManyRunInput[] = [];
    /** Prices one timesheet line, split at the cut-off after `lastDay`, or explains why it cannot be priced. */
    const priceLine = async (staffId: string, l: { id: string; visitId: string | null; date: Date; description: string; payableMinutes: number }, lastDay: string) => {
      const rate = payRates.find((r) => r.staffId === staffId && r.effectiveFrom <= l.date && (!r.effectiveTo || r.effectiveTo >= l.date));
      const card = cardOn(cards, rate?.rateCardId ?? settings.defaultPayRateCardId, l.date);
      if (!card) return { ok: false as const, error: { kind: "NO_PAY_RATE", message: `${staff.get(staffId)}: no pay rate card on ${fromDbDate(l.date)}`, ref: l.id } };
      const visit = l.visitId ? await tx.visit.findUnique({ where: { id: l.visitId }, select: { scheduledStart: true } }) : null;
      const day = fromDbDate(l.date);
      // Work past midnight or across a band boundary is paid at each stretch's own band.
      const cut = priceAtCutOff(splitWork(card.bands, day, visit ? londonMinute(visit.scheduledStart) : 0, l.payableMinutes, (d) => holidays.has(d), (d) => addDays(d, 1), isoWeekday), lastDay);
      if (!cut) return { ok: false as const, error: { kind: "NO_BAND", message: `${staff.get(staffId)}: no band on "${card.name}" for all of ${l.description} on ${day}`, ref: l.id } };
      return { ok: true as const, card, ...cut };
    };
    for (const t of sheets) {
      for (const l of t.lines) {
        if (!l.payableMinutes) continue;
        const p = await priceLine(t.staffId, l, end);
        if (!p.ok) {
          exceptions.push(p.error);
          continue;
        }
        const note = p.tail ? " · paid to the cut-off; the rest is in next week's run" : p.head.split ? " · split across bands or midnight" : "";
        lines.push({ staffId: t.staffId, visitId: l.visitId, kind: "VISIT", date: l.date, description: `${l.description}${note}`, minutes: p.head.minutes, ratePence: p.head.ratePence, amountPence: p.head.amountPence, bandLabel: `${p.card.name} · ${p.head.bandLabel}` });
        if (p.tail) exceptions.push({ kind: "CARRIED", message: `${staff.get(t.staffId)}: ${p.tail.minutes} minutes of ${l.description} fall after the cut-off and are paid in next week's run`, ref: l.id });
      }
    }
    // The tail of last Sunday's overnight work belongs to this period. A run prepared before cut-off splitting paid it
    // in full, so nothing is carried when last week's run already holds the whole visit.
    const prevStart = addDays(start, -7);
    const [prevSheets, prevRun] = await Promise.all([
      tx.timesheet.findMany({ where: { organisationId, periodStart: dbDate(prevStart), status: "APPROVED" }, include: { lines: { where: { date: dbDate(addDays(start, -1)), payableMinutes: { gt: 0 } } } } }),
      tx.payRun.findFirst({ where: { organisationId, periodStart: dbDate(prevStart), status: { not: "VOID" } }, include: { lines: { where: { kind: "VISIT" } } } }),
    ]);
    for (const t of prevSheets) {
      for (const l of t.lines) {
        const p = await priceLine(t.staffId, l, addDays(start, -1));
        if (!p.ok || !p.tail) continue;
        const paid = prevRun?.lines.filter((x) => x.staffId === t.staffId && x.visitId === l.visitId).reduce((n, x) => n + x.minutes, 0) ?? 0;
        if (paid >= p.head.minutes + p.tail.minutes) continue;
        lines.push({ staffId: t.staffId, visitId: l.visitId, kind: "VISIT", date: dbDate(start), description: `${l.description} · after last week's cut-off`, minutes: p.tail.minutes, ratePence: p.tail.ratePence, amountPence: p.tail.amountPence, bandLabel: `${p.card.name} · ${p.tail.bandLabel}` });
      }
    }
    // A visit still running when the run is prepared has no clock-out, so it is not paid here.
    const running = await tx.visitAssignment.findMany({ where: { organisationId, removedAt: null, visit: { status: "IN_PROGRESS", date: { gte: dbDate(start), lte: dbDate(end) } } }, select: { staffId: true, visitId: true, visit: { select: { reference: true } } } });
    for (const r of running) exceptions.push({ kind: "UNFINISHED_AT_CUTOFF", message: `${staff.get(r.staffId) ?? "A carer"}: ${r.visit.reference} was still in progress at the cut-off and is not paid in this run`, ref: r.visitId });
    for (const c of claims) {
      const amount = Math.round(c.miles * settings.mileagePencePerMile);
      lines.push({ staffId: c.staffId, visitId: c.visitId, kind: "MILEAGE", date: c.date, description: `Mileage ${c.miles} miles${c.reason ? `: ${c.reason}` : ""}`, minutes: 0, ratePence: settings.mileagePencePerMile, amountPence: amount, bandLabel: "Mileage" });
    }
    const totalPence = lines.reduce((n, l) => n + l.amountPence, 0);
    const run = await tx.payRun.create({ data: { organisationId, periodStart: dbDate(start), periodEnd: dbDate(end), totalPence, exceptions: exceptions as unknown as Prisma.InputJsonValue, createdById: ctx.userId, lines: { createMany: { data: lines } } } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.payrun.prepared", entityType: "PayRun", entityId: run.id, data: { weekStart: start, totalPence, lines: lines.length, exceptions: exceptions.length } }, tx);
    return run;
  }, { timeout: 60_000 });
}

export async function getPayRun(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "finance.view");
  const run = await db.payRun.findFirst({ where: { id, organisationId }, include: { lines: { orderBy: [{ date: "asc" }] } } });
  if (!run) throw new NotFoundError("Pay run");
  const staff = new Map((await db.staffMember.findMany({ where: { organisationId, id: { in: [...new Set(run.lines.map((l) => l.staffId))] } }, select: { id: true, displayName: true, staffNumber: true } })).map((s) => [s.id, s]));
  return { run, staff, exceptions: run.exceptions as unknown as RunException[] };
}

// ── Invoice preparation ──

export async function prepareInvoiceRun(ctx: Ctx, weekStart: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  const { start, end } = weekOf(weekStart);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoicerun:${organisationId}:${start}`}))`;
    await noOpenRun(tx, "invoiceRun", organisationId, start);
    const [cards, holidays, visits] = await Promise.all([
      tx.rateCard.findMany({ where: { organisationId, kind: "CHARGE" }, include: { bands: true } }),
      bankHolidays(tx, organisationId, start, end),
      tx.visit.findMany({
        where: { organisationId, chargeable: true, date: { gte: dbDate(start), lte: dbDate(end) }, status: { in: ["COMPLETED", "CANCELLED", "MISSED", "SCHEDULED", "IN_PROGRESS"] } },
        include: { serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, packages: { include: { funder: true } } } }, callType: { select: { name: true } } },
        orderBy: { scheduledStart: "asc" },
      }),
    ]);
    const exceptions: RunException[] = [];
    const byFunder = new Map<string, Prisma.InvoiceLineCreateManyInvoiceInput[]>();
    for (const v of visits) {
      const name = `${v.serviceUser.preferredName ?? v.serviceUser.firstName} ${v.serviceUser.lastName}`;
      const day = fromDbDate(v.date);
      const what = `${day} ${name} · ${v.callType.name}`;
      if (v.status === "MISSED") { exceptions.push({ kind: "MISSED", message: `${what}: missed, not charged`, ref: v.id }); continue; }
      // The office chose not to charge this cancellation.
      if (v.status === "CANCELLED" && v.cancellationCharge === false) continue;
      if (v.status === "SCHEDULED" || v.status === "IN_PROGRESS") { exceptions.push({ kind: "UNFINISHED", message: `${what}: still ${v.status === "SCHEDULED" ? "not started" : "in progress"}, not charged`, ref: v.id }); continue; }
      const pkg = v.serviceUser.packages.find((p) => p.startDate <= v.date && (p.endDate ? p.endDate >= v.date : p.status === "ACTIVE"));
      const funder = pkg?.funder;
      if (!funder) { exceptions.push({ kind: "NO_FUNDER", message: `${what}: no funded care package on this date`, ref: v.serviceUser.id }); continue; }
      if (v.status === "CANCELLED") {
        if (!cancellationCharged(v, funder.shortNoticeCancelHours)) continue;
      }
      const card = cardOn(cards, funder.chargeRateCardId, v.date);
      if (!card) { exceptions.push({ kind: "NO_CHARGE_RATE", message: `${funder.name}: no charge rate card on ${day}`, ref: funder.id }); continue; }
      const scheduled = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
      const actual = v.actualStart && v.actualEnd ? Math.round((v.actualEnd.getTime() - v.actualStart.getTime()) / 60000) : null;
      if (funder.chargeBasis === "ACTUAL" && v.status === "COMPLETED" && actual === null) exceptions.push({ kind: "NO_ACTUAL", message: `${what}: no actual times, charged at planned length`, ref: v.id });
      const minutes = v.status === "CANCELLED" ? scheduled : funder.chargeBasis === "ACTUAL" && actual !== null ? actual : scheduled;
      const startAt = funder.chargeBasis === "ACTUAL" && v.status === "COMPLETED" && v.actualStart ? v.actualStart : v.scheduledStart;
      const p = priceWork(splitWork(card.bands, day, londonMinute(startAt), minutes, (d) => holidays.has(d), (d) => addDays(d, 1), isoWeekday));
      if (!p) { exceptions.push({ kind: "NO_BAND", message: `${what}: no band on "${card.name}" for all of the visit`, ref: v.id }); continue; }
      const carers = v.carersRequired;
      byFunder.set(funder.id, [...(byFunder.get(funder.id) ?? []), { visitId: v.id, serviceUserId: v.serviceUser.id, date: v.date, description: `${what}${carers > 1 ? ` (${carers} carers)` : ""}${v.status === "CANCELLED" ? (v.cancellationCharge ? " · cancellation charged" : " · short-notice cancellation") : ""}${p.split ? " · split across bands or midnight" : ""}`, minutes: p.minutes * carers, ratePence: p.ratePence, amountPence: p.amountPence * carers, bandLabel: `${card.name} · ${p.bandLabel}` }]);
    }
    const funders = await tx.funder.findMany({ where: { organisationId, id: { in: [...byFunder.keys()] } } });
    const totalPence = [...byFunder.values()].flat().reduce((n, l) => n + l.amountPence, 0);
    const run = await tx.invoiceRun.create({ data: { organisationId, periodStart: dbDate(start), periodEnd: dbDate(end), totalPence, exceptions: exceptions as unknown as Prisma.InputJsonValue, createdById: ctx.userId } });
    for (const f of funders) {
      const lines = byFunder.get(f.id)!;
      await tx.invoice.create({ data: { organisationId, runId: run.id, funderId: f.id, totalPence: lines.reduce((n, l) => n + l.amountPence, 0), dueDays: f.paymentTermsDays, lines: { createMany: { data: lines } } } });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "finance.invoicerun.prepared", entityType: "InvoiceRun", entityId: run.id, data: { weekStart: start, totalPence, invoices: funders.length, exceptions: exceptions.length } }, tx);
    return run;
  }, { timeout: 60_000 });
}

export async function getInvoiceRun(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "finance.view");
  const run = await db.invoiceRun.findFirst({ where: { id, organisationId }, include: { invoices: { include: { lines: { orderBy: [{ date: "asc" }] } } } } });
  if (!run) throw new NotFoundError("Invoice run");
  const funders = new Map((await db.funder.findMany({ where: { organisationId, id: { in: run.invoices.map((i) => i.funderId) } } })).map((f) => [f.id, f]));
  return { run, funders, exceptions: run.exceptions as unknown as RunException[] };
}

// ── Shared: list, approve, void ──

export async function listRuns(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "finance.view");
  const [pay, invoice] = await Promise.all([
    db.payRun.findMany({ where: { organisationId }, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 30, include: { _count: { select: { lines: true } } } }),
    db.invoiceRun.findMany({ where: { organisationId }, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 30, include: { _count: { select: { invoices: true } } } }),
  ]);
  return { pay, invoice };
}

/** Approval by a second person. Invoices get their numbers at approval, in order, from the organisation's sequence. */
export async function approveRun(ctx: Ctx, kind: "pay" | "invoice", id: string) {
  const organisationId = requireOrgPermission(ctx, "finance.approve");
  return db.$transaction(async (tx) => {
    const run = kind === "pay" ? await tx.payRun.findFirst({ where: { id, organisationId } }) : await tx.invoiceRun.findFirst({ where: { id, organisationId } });
    if (!run) throw new NotFoundError(kind === "pay" ? "Pay run" : "Invoice run");
    if (run.status !== "DRAFT") throw new ValidationError("Only a draft run can be approved");
    if (run.createdById === ctx.userId) throw new ForbiddenError("You prepared this run, so someone else must approve it");
    if (kind === "pay") {
      await tx.payRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    } else {
      const s = await financeSettings(tx, organisationId);
      await tx.$queryRaw`SELECT "organisationId" FROM "FinanceSettings" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
      const invoices = await tx.invoice.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } });
      let n = (await tx.financeSettings.findUniqueOrThrow({ where: { organisationId } })).nextInvoiceNumber;
      for (const inv of invoices) await tx.invoice.update({ where: { id: inv.id }, data: { number: `${s.invoicePrefix}-${String(n++).padStart(5, "0")}` } });
      await tx.financeSettings.update({ where: { organisationId }, data: { nextInvoiceNumber: n } });
      await tx.invoiceRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    }
    await audit({ organisationId, actorId: ctx.userId, action: `finance.${kind}run.approved`, entityType: kind === "pay" ? "PayRun" : "InvoiceRun", entityId: run.id, data: { totalPence: run.totalPence } }, tx);
  });
}

export async function voidRun(ctx: Ctx, kind: "pay" | "invoice", id: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "finance.manage");
  if (reason.trim().length < 5) throw new ValidationError("Give a reason for voiding the run");
  return db.$transaction(async (tx) => {
    const run = kind === "pay" ? await tx.payRun.findFirst({ where: { id, organisationId } }) : await tx.invoiceRun.findFirst({ where: { id, organisationId } });
    if (!run) throw new NotFoundError(kind === "pay" ? "Pay run" : "Invoice run");
    if (run.status === "VOID") throw new ValidationError("Already void");
    const data = { status: "VOID" as const, voidedById: ctx.userId, voidedAt: new Date(), voidReason: reason.trim() };
    if (kind === "pay") await tx.payRun.update({ where: { id: run.id }, data });
    else await tx.invoiceRun.update({ where: { id: run.id }, data });
    await audit({ organisationId, actorId: ctx.userId, action: `finance.${kind}run.voided`, entityType: kind === "pay" ? "PayRun" : "InvoiceRun", entityId: run.id, data: { reason: reason.trim(), wasApproved: run.status === "APPROVED" } }, tx);
  });
}

/** CSV of a run for the payroll provider or accounts system. Approved runs only, after a permission check. */
export async function runCsv(ctx: Ctx, kind: "pay" | "invoice", id: string) {
  const organisationId = requireOrgPermission(ctx, "finance.view");
  const rows: (string | number)[][] = [];
  let name: string;
  if (kind === "pay") {
    const { run, staff } = await getPayRun(ctx, id);
    if (run.status !== "APPROVED") throw new ValidationError("Only an approved run can be exported");
    rows.push(["Staff number", "Name", "Date", "Kind", "Description", "Minutes", "Rate (pence)", "Amount (pence)", "Band"]);
    for (const l of run.lines) rows.push([staff.get(l.staffId)?.staffNumber ?? "", staff.get(l.staffId)?.displayName ?? "", fromDbDate(l.date), l.kind, l.description, l.minutes, l.ratePence, l.amountPence, l.bandLabel]);
    name = `pay-run-${fromDbDate(run.periodStart)}.csv`;
  } else {
    const { run, funders } = await getInvoiceRun(ctx, id);
    if (run.status !== "APPROVED") throw new ValidationError("Only an approved run can be exported");
    rows.push(["Invoice", "Funder", "Due days", "Date", "Description", "Minutes", "Rate (pence)", "Amount (pence)", "Band"]);
    for (const inv of run.invoices) for (const l of inv.lines) rows.push([inv.number ?? "", funders.get(inv.funderId)?.name ?? "", inv.dueDays, fromDbDate(l.date), l.description, l.minutes, l.ratePence, l.amountPence, l.bandLabel]);
    name = `invoice-run-${fromDbDate(run.periodStart)}.csv`;
  }
  await audit({ organisationId, actorId: ctx.userId, action: `finance.${kind}run.exported`, entityType: kind === "pay" ? "PayRun" : "InvoiceRun", entityId: id });
  const [head, ...body] = rows;
  return { name, body: toCsv(head!.map(String), body) };
}
