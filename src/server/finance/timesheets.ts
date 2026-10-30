import type { Prisma, TimesheetStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, isoWeekday, londonDate, londonTime } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { effectiveClocks } from "@/server/rota/attendance";
import { rotaSettings } from "@/server/rota/settings";
import { financeSettings } from "./rates";

type Tx = Prisma.TransactionClient;

/**
 * Timesheets: one per carer per week, worked out from the visits they were booked on and their clock records.
 * Lines that are not straightforward (missed, no clock-out, short, entered by the office) are marked as exceptions
 * for a person to check. Coordinators prepare and submit; a finance approver who did not submit them approves.
 * Approved timesheets feed payroll preparation and are never changed afterwards.
 */

export function requireAny(ctx: Ctx, perms: OrgPermission[]) {
  if (!perms.some((p) => hasOrgPermission(ctx, p))) throw new ForbiddenError("You do not have access to this");
  return ctx.organisationId as string;
}

const PREPARE: OrgPermission[] = ["rota.edit", "finance.manage"];

/** Branch-limited members only see timesheets of staff in their branches (staff without a branch stay visible). */
async function staffInBranches(ctx: Ctx, organisationId: string): Promise<Prisma.TimesheetWhereInput> {
  if (!ctx.branchIds) return {};
  const ids = await db.staffMember.findMany({ where: { organisationId, OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] }, select: { id: true } });
  return { staffId: { in: ids.map((x) => x.id) } };
}

export function weekOf(weekStart: string) {
  if (!isIsoDate(weekStart) || isoWeekday(weekStart) !== 1) throw new ValidationError("Choose a week starting on a Monday");
  return { start: weekStart, end: addDays(weekStart, 6) };
}

/** Builds (or rebuilds, while still a draft) every carer's timesheet for a finished week. */
export async function generateTimesheets(ctx: Ctx, weekStart: string) {
  const organisationId = requireAny(ctx, PREPARE);
  const { start, end } = weekOf(weekStart);
  if (end >= londonDate()) throw new ValidationError("Timesheets are prepared once the week has ended");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timesheets:${organisationId}:${start}`}))`;
    const [settings, fin] = await Promise.all([rotaSettings(tx, organisationId), financeSettings(tx, organisationId)]);
    const assignments = await tx.visitAssignment.findMany({
      where: { organisationId, removedAt: null, visit: { date: { gte: dbDate(start), lte: dbDate(end) }, status: { not: "CANCELLED" } } },
      include: { visit: { include: { clocks: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } } } } },
      orderBy: { startsAt: "asc" },
    });
    const byStaff = new Map<string, typeof assignments>();
    for (const a of assignments) byStaff.set(a.staffId, [...(byStaff.get(a.staffId) ?? []), a]);
    let created = 0;
    let refreshed = 0;
    const skipped: string[] = [];
    for (const [staffId, rows] of byStaff) {
      const existing = await tx.timesheet.findUnique({ where: { organisationId_staffId_periodStart_periodEnd: { organisationId, staffId, periodStart: dbDate(start), periodEnd: dbDate(end) } } });
      if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
        skipped.push(staffId);
        continue;
      }
      const lines = rows.map((a) => {
        const v = a.visit;
        const clocks = effectiveClocks(v.clocks).filter((c) => c.staffId === staffId);
        const inAt = clocks.find((c) => c.kind === "IN");
        const outAt = clocks.find((c) => c.kind === "OUT");
        const scheduled = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
        const delivered = inAt && outAt ? Math.max(0, Math.round((outAt.at.getTime() - inAt.at.getTime()) / 60000)) : 0;
        const notes: string[] = [];
        if (v.status === "MISSED" && !inAt) notes.push("Missed: no clock-in");
        else if (v.status === "NOT_DELIVERED") notes.push(`Not delivered: ${v.notDeliveredReason ?? "no reason recorded"}`);
        else if (v.status === "SCHEDULED") notes.push("Visit never started");
        else if (inAt && !outAt) notes.push("No clock-out");
        if (inAt && outAt && delivered < (scheduled * settings.shortVisitPercent) / 100) notes.push(`Short visit (${Math.round((delivered / scheduled) * 100)}% of planned)`);
        if (clocks.some((c) => c.method === "OFFICE")) notes.push("Clock time entered by the office");
        const worked = inAt && outAt;
        const payable = !worked ? 0 : fin.payBasis === "ACTUAL" ? delivered : scheduled;
        const who = `${v.serviceUser.preferredName ?? v.serviceUser.firstName} ${v.serviceUser.lastName}`;
        return { visitId: v.id, date: v.date, description: `${londonTime(v.scheduledStart)} ${who} · ${v.callType.name}${a.slot === "SHADOW" ? " (shadowing)" : ""}`, scheduledMinutes: scheduled, deliveredMinutes: delivered, payableMinutes: payable, exception: notes.join("; ") || null };
      });
      const totals = { scheduledMinutes: lines.reduce((n, l) => n + l.scheduledMinutes, 0), deliveredMinutes: lines.reduce((n, l) => n + l.deliveredMinutes, 0), payableMinutes: lines.reduce((n, l) => n + l.payableMinutes, 0), exceptions: lines.filter((l) => l.exception).length };
      if (existing) {
        // Checks already made stay with a line whose figures and exception have not changed.
        const before = await tx.timesheetLine.findMany({ where: { timesheetId: existing.id, verifiedAt: { not: null } } });
        const kept = new Map(before.map((l) => [`${l.visitId}|${l.exception}|${l.payableMinutes}`, l]));
        const withChecks = lines.map((l) => {
          const k = kept.get(`${l.visitId}|${l.exception}|${l.payableMinutes}`);
          return k ? { ...l, verifiedById: k.verifiedById, verifiedAt: k.verifiedAt, verificationNote: k.verificationNote } : l;
        });
        await tx.timesheetLine.deleteMany({ where: { timesheetId: existing.id } });
        await tx.timesheet.update({ where: { id: existing.id }, data: { ...totals, status: "DRAFT", generatedById: ctx.userId, generatedAt: new Date(), submittedById: null, submittedAt: null, version: { increment: 1 }, lines: { create: withChecks } } });
        refreshed++;
      } else {
        await tx.timesheet.create({ data: { organisationId, staffId, periodStart: dbDate(start), periodEnd: dbDate(end), generatedById: ctx.userId, ...totals, lines: { create: lines } } });
        created++;
      }
    }
    await audit({ organisationId, actorId: ctx.userId, action: "finance.timesheets.generated", entityType: "Organisation", entityId: organisationId, data: { weekStart: start, created, refreshed, skipped: skipped.length } }, tx);
    return { created, refreshed, skipped: skipped.length };
  }, { timeout: 60_000 });
}

export async function listTimesheets(ctx: Ctx, weekStart: string, status?: string) {
  const organisationId = requireAny(ctx, [...PREPARE, "finance.view"]);
  const { start, end } = weekOf(weekStart);
  const s = (["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as TimesheetStatus[]).find((x) => x === status);
  const rows = await db.timesheet.findMany({ where: { organisationId, periodStart: dbDate(start), periodEnd: dbDate(end), ...(s ? { status: s } : {}), ...(await staffInBranches(ctx, organisationId)) }, orderBy: [{ status: "asc" }, { exceptions: "desc" }] });
  const staff = await db.staffMember.findMany({ where: { organisationId, id: { in: rows.map((r) => r.staffId) } }, select: { id: true, displayName: true, jobTitle: true } });
  const names = new Map(staff.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, staff: names.get(r.staffId) ?? null }));
}

export async function getTimesheet(ctx: Ctx, id: string) {
  const organisationId = requireAny(ctx, [...PREPARE, "finance.view"]);
  const t = await db.timesheet.findFirst({ where: { id, organisationId, ...(await staffInBranches(ctx, organisationId)) }, include: { lines: { orderBy: [{ date: "asc" }, { description: "asc" }] } } });
  if (!t) throw new NotFoundError("Timesheet");
  const staff = await db.staffMember.findFirst({ where: { id: t.staffId, organisationId }, select: { id: true, displayName: true, jobTitle: true } });
  const history = await db.auditLog.findMany({ where: { organisationId, entityType: "Timesheet", entityId: t.id }, orderBy: { createdAt: "asc" } });
  return { timesheet: t, staff, history };
}

async function lockTimesheet(tx: Tx, ctx: Ctx, organisationId: string, id: string, version: number) {
  await tx.$queryRaw`SELECT id FROM "Timesheet" WHERE id = ${id} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const t = await tx.timesheet.findFirst({ where: { id, organisationId, ...(await staffInBranches(ctx, organisationId)) } });
  if (!t) throw new NotFoundError("Timesheet");
  if (t.version !== version) throw new ConflictError("This timesheet changed since you opened it. Reload and try again.");
  return t;
}

/** Corrects the payable minutes on one line of a draft, with a reason that stays on the line and in the audit log. */
export async function adjustLine(ctx: Ctx, timesheetId: string, version: number, lineId: string, minutes: number, reason: string) {
  const organisationId = requireAny(ctx, PREPARE);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) throw new ValidationError("Payable minutes must be a whole number between 0 and 1440");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for the change");
  return db.$transaction(async (tx) => {
    const t = await lockTimesheet(tx, ctx, organisationId, timesheetId, version);
    if (t.status !== "DRAFT" && t.status !== "REJECTED") throw new ValidationError("Only a draft or rejected timesheet can be changed");
    const line = await tx.timesheetLine.findFirst({ where: { id: lineId, timesheetId: t.id } });
    if (!line) throw new NotFoundError("Timesheet line");
    // A change with a reason is the office's check of that line.
    await tx.timesheetLine.update({ where: { id: line.id }, data: { payableMinutes: minutes, exception: [line.exception, `Adjusted from ${line.payableMinutes} to ${minutes} min: ${reason.trim()}`].filter(Boolean).join("; "), ...(line.verifiedAt ? {} : { verifiedById: ctx.userId, verifiedAt: new Date(), verificationNote: reason.trim() }) } });
    const sum = await tx.timesheetLine.aggregate({ where: { timesheetId: t.id }, _sum: { payableMinutes: true } });
    await tx.timesheet.update({ where: { id: t.id }, data: { payableMinutes: sum._sum.payableMinutes ?? 0, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.timesheet.adjusted", entityType: "Timesheet", entityId: t.id, data: { lineId: line.id, from: line.payableMinutes, to: minutes, reason: reason.trim() } }, tx);
  });
}

export async function submitTimesheet(ctx: Ctx, id: string, version: number) {
  const organisationId = requireAny(ctx, PREPARE);
  return db.$transaction(async (tx) => {
    const t = await lockTimesheet(tx, ctx, organisationId, id, version);
    if (t.status !== "DRAFT" && t.status !== "REJECTED") throw new ValidationError("Only a draft or rejected timesheet can be submitted");
    const unchecked = await tx.timesheetLine.count({ where: { timesheetId: t.id, exception: { not: null }, verifiedAt: null } });
    if (unchecked) throw new ValidationError(`${unchecked} line${unchecked === 1 ? "" : "s"} with exceptions still need checking before this can be submitted`);
    await tx.timesheet.update({ where: { id: t.id }, data: { status: "SUBMITTED", submittedById: ctx.userId, submittedAt: new Date(), decidedById: null, decidedAt: null, decisionNote: null, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.timesheet.submitted", entityType: "Timesheet", entityId: t.id, data: { payableMinutes: t.payableMinutes, exceptions: t.exceptions } }, tx);
  });
}

/**
 * Attendance verification: the office confirms lines with exceptions against what happened (a call, the carer's
 * account, the family). Nobody checks their own timesheet. The check stays on the line and in the audit log.
 */
export async function verifyLines(ctx: Ctx, timesheetId: string, version: number, which: string[] | "exceptions", note: string) {
  const organisationId = requireAny(ctx, PREPARE);
  if (note.trim().length < 3) throw new ValidationError("Say how the lines were checked");
  return db.$transaction(async (tx) => {
    const t = await lockTimesheet(tx, ctx, organisationId, timesheetId, version);
    if (t.status !== "DRAFT" && t.status !== "REJECTED") throw new ValidationError("Only a draft or rejected timesheet can be checked");
    if (await tx.staffMember.findFirst({ where: { id: t.staffId, userId: ctx.userId } })) throw new ForbiddenError("You cannot check your own timesheet");
    const lines = await tx.timesheetLine.findMany({ where: { timesheetId: t.id, verifiedAt: null, ...(which === "exceptions" ? { exception: { not: null } } : { id: { in: which } }) }, select: { id: true } });
    if (!lines.length) throw new ValidationError("Nothing left to check on this timesheet");
    await tx.timesheetLine.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { verifiedById: ctx.userId, verifiedAt: new Date(), verificationNote: note.trim() } });
    await tx.timesheet.update({ where: { id: t.id }, data: { version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "finance.timesheet.verified", entityType: "Timesheet", entityId: t.id, data: { lines: lines.length, note: note.trim() } }, tx);
    return lines.length;
  });
}

/** Approve or reject. The person who submitted a timesheet cannot decide it. */
export async function decideTimesheet(ctx: Ctx, id: string, version: number, decision: "APPROVED" | "REJECTED", note: string) {
  const organisationId = requireOrgPermission(ctx, "finance.approve");
  if (decision === "REJECTED" && note.trim().length < 3) throw new ValidationError("Say what needs correcting");
  return db.$transaction(async (tx) => {
    const t = await lockTimesheet(tx, ctx, organisationId, id, version);
    if (t.status !== "SUBMITTED") throw new ValidationError("Only a submitted timesheet can be approved or rejected");
    if (t.submittedById === ctx.userId) throw new ForbiddenError("You submitted this timesheet, so someone else must decide it");
    await tx.timesheet.update({ where: { id: t.id }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() || null, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: `finance.timesheet.${decision.toLowerCase()}`, entityType: "Timesheet", entityId: t.id, data: { note: note.trim() || null } }, tx);
  });
}

/** Submits or approves every eligible timesheet of a week in one go, each checked on its own. */
export async function bulkTimesheets(ctx: Ctx, weekStart: string, kind: "submit" | "approve") {
  const { start } = weekOf(weekStart);
  const organisationId = kind === "submit" ? requireAny(ctx, PREPARE) : requireOrgPermission(ctx, "finance.approve");
  const rows = await db.timesheet.findMany({ where: { organisationId, periodStart: dbDate(start), status: kind === "submit" ? "DRAFT" : "SUBMITTED", ...(await staffInBranches(ctx, organisationId)) } });
  let done = 0;
  const refused: string[] = [];
  for (const t of rows) {
    try {
      if (kind === "submit") await submitTimesheet(ctx, t.id, t.version);
      else await decideTimesheet(ctx, t.id, t.version, "APPROVED", "");
      done++;
    } catch (e) {
      refused.push((e as Error).message);
    }
  }
  return { done, refused };
}
