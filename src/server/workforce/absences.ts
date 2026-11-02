import type { AbsenceKind, AvailabilityKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate, londonToUtc, parseHhmm } from "@/lib/london";
import { read as readHr } from "@/hr/lib/workspace-tx";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { reviewStaffImpact } from "./impact";
import { raiseReviewFlag } from "@/server/readiness/flags";

/**
 * Holidays, sickness and working availability. These are HR-controlled: only people with an HR & Workforce account
 * may see or change them, limited to the branches that account covers, and Branch Viewers can only look. A request
 * cannot be approved by the person who entered it. Every decision re-checks the person's future visits, which are
 * flagged for the rota team; nothing is removed or reassigned automatically.
 */

export interface HrActor {
  organisationId: string;
  userId: string;
  name: string;
  branches: string[];
  canEdit: boolean;
}

export async function hrActor(ctx: Ctx): Promise<HrActor> {
  if (!ctx.organisationId || !ctx.hrUserId) throw new ForbiddenError("You need an HR & Workforce account for this");
  const state = await readHr(ctx.organisationId);
  const u = state.users.find((x) => x.id === ctx.hrUserId && x.active);
  if (!u) throw new ForbiddenError("Your HR account is not active");
  return { organisationId: ctx.organisationId, userId: ctx.userId, name: u.name, branches: u.branches, canEdit: u.role !== "Branch Viewer" };
}

function staffInBranches(a: HrActor): Prisma.StaffMemberWhereInput {
  return { organisationId: a.organisationId, hrBranchKey: { in: a.branches } };
}

async function staffFor(tx: Prisma.TransactionClient, a: HrActor, staffId: string) {
  const s = await tx.staffMember.findFirst({ where: { ...staffInBranches(a), id: staffId } });
  if (!s) throw new NotFoundError("Staff member");
  return s;
}

function editor(a: HrActor) {
  if (!a.canEdit) throw new ForbiddenError("Your HR role can view but not change absences");
  return a;
}

export async function listAbsences(ctx: Ctx, f: { status?: string; from?: string; staffId?: string }) {
  const a = await hrActor(ctx);
  const from = f.from && isIsoDate(f.from) ? f.from : addDays(londonDate(), -30);
  const status = (["REQUESTED", "APPROVED", "DECLINED", "CANCELLED"] as const).find((s) => s === f.status);
  const rows = await db.staffAbsence.findMany({
    where: { organisationId: a.organisationId, staff: staffInBranches(a), endsAt: { gte: londonToUtc(from, 0) }, ...(status ? { status } : {}), ...(f.staffId ? { staffId: f.staffId } : {}) },
    include: { staff: { select: { id: true, displayName: true, jobTitle: true } } },
    orderBy: [{ startsAt: "asc" }],
    take: 500,
  });
  return { actor: a, rows };
}

export async function absenceStaff(ctx: Ctx) {
  const a = await hrActor(ctx);
  return db.staffMember.findMany({ where: { ...staffInBranches(a), employmentStatus: { not: "ARCHIVED" }, hrMissing: false }, select: { id: true, displayName: true, jobTitle: true }, orderBy: { displayName: "asc" } });
}

const KINDS: AbsenceKind[] = ["HOLIDAY", "SICKNESS", "COMPASSIONATE", "TRAINING", "UNPAID", "OTHER"];

/** Holiday and other leave start as requests; sickness is recorded as a fact (approved), since there is nothing to decide. */
export async function recordAbsence(ctx: Ctx, input: { staffId: string; kind: string; from: string; to: string; startTime?: string; endTime?: string; reason?: string }) {
  const a = editor(await hrActor(ctx));
  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) throw new ValidationError("Choose the type of absence");
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) throw new ValidationError("Choose the first and last day");
  if (input.to < input.from) throw new ValidationError("The last day must be on or after the first day");
  const startMin = input.startTime ? parseHhmm(input.startTime) : 0;
  const endMin = input.endTime ? parseHhmm(input.endTime) : 1440;
  if (startMin === null || endMin === null) throw new ValidationError("Times must be like 09:00");
  const startsAt = londonToUtc(input.from, startMin);
  const endsAt = londonToUtc(input.to, endMin);
  if (endsAt <= startsAt) throw new ValidationError("The absence must end after it starts");
  const status = kind === "SICKNESS" ? "APPROVED" : "REQUESTED";
  return db.$transaction(async (tx) => {
    const s = await staffFor(tx, a, input.staffId);
    const overlap = await tx.staffAbsence.findFirst({ where: { staffId: s.id, status: { in: ["REQUESTED", "APPROVED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    if (overlap) throw new ConflictError("This person already has an absence recorded for part of that time");
    const created = await tx.staffAbsence.create({ data: { organisationId: a.organisationId, staffId: s.id, kind, startsAt, endsAt, status, reason: input.reason?.trim() || null, requestedById: ctx.userId, ...(status === "APPROVED" ? { decidedById: ctx.userId, decidedAt: new Date(), decisionNote: "Sickness recorded" } : {}) } });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: `workforce.absence.${status === "APPROVED" ? "recorded" : "requested"}`, entityType: "StaffAbsence", entityId: created.id, data: { staffId: s.id, kind } }, tx);
    const impact = await reviewStaffImpact(tx, a.organisationId, [s.id], { source: "absence" });
    return { status, impact };
  });
}

/** Approve or decline a request. The person who entered it cannot decide it (separation of duties). */
export async function decideAbsence(ctx: Ctx, absenceId: string, version: number, decision: "APPROVED" | "DECLINED", note: string) {
  const a = editor(await hrActor(ctx));
  if (decision === "DECLINED" && note.trim().length < 3) throw new ValidationError("Give a reason for declining");
  return db.$transaction(async (tx) => {
    const abs = await tx.staffAbsence.findFirst({ where: { id: absenceId, organisationId: a.organisationId, staff: staffInBranches(a) } });
    if (!abs) throw new NotFoundError("Absence");
    if (abs.version !== version) throw new ConflictError("This request changed since you opened it. Reload and try again.");
    if (abs.status !== "REQUESTED") throw new ValidationError(`This absence is already ${abs.status.toLowerCase()}`);
    if (abs.requestedById === ctx.userId) throw new ForbiddenError("You entered this request, so someone else must decide it");
    await tx.staffAbsence.update({ where: { id: abs.id }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() || null, version: { increment: 1 } } });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: `workforce.absence.${decision.toLowerCase()}`, entityType: "StaffAbsence", entityId: abs.id, data: { staffId: abs.staffId } }, tx);
    // A long absence (four weeks or more) means a manager looks at readiness before the person returns to duties.
    if (decision === "APPROVED" && abs.endsAt.getTime() - abs.startsAt.getTime() >= 28 * 86400_000) {
      await raiseReviewFlag(tx, a.organisationId, abs.staffId, `Absence of ${Math.round((abs.endsAt.getTime() - abs.startsAt.getTime()) / 86400_000)} days approved (${abs.kind.toLowerCase()}); check readiness before return`, ctx.userId);
    }
    return reviewStaffImpact(tx, a.organisationId, [abs.staffId], { source: "absence" });
  });
}

export async function cancelStaffAbsence(ctx: Ctx, absenceId: string, reason: string) {
  const a = editor(await hrActor(ctx));
  if (reason.trim().length < 3) throw new ValidationError("Give a reason");
  return db.$transaction(async (tx) => {
    const abs = await tx.staffAbsence.findFirst({ where: { id: absenceId, organisationId: a.organisationId, staff: staffInBranches(a) } });
    if (!abs) throw new NotFoundError("Absence");
    if (!["REQUESTED", "APPROVED"].includes(abs.status)) throw new ValidationError("Only requested or approved absences can be cancelled");
    await tx.staffAbsence.update({ where: { id: abs.id }, data: { status: "CANCELLED", decisionNote: reason.trim(), version: { increment: 1 } } });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "workforce.absence.cancelled", entityType: "StaffAbsence", entityId: abs.id, data: { staffId: abs.staffId, reason: reason.trim() } }, tx);
    return reviewStaffImpact(tx, a.organisationId, [abs.staffId], { source: "absence" });
  });
}

export async function listAvailability(ctx: Ctx, staffId?: string) {
  const a = await hrActor(ctx);
  const today = dbDate(londonDate());
  const rows = await db.staffAvailability.findMany({
    where: { organisationId: a.organisationId, staff: staffInBranches(a), ...(staffId ? { staffId } : {}), OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
    include: { staff: { select: { id: true, displayName: true } } },
    orderBy: [{ staff: { displayName: "asc" } }, { weekday: "asc" }, { startMinute: "asc" }],
  });
  return { actor: a, rows };
}

export interface AvailabilityInput { staffId: string; weekdays: number[]; start: string; end: string; kind: string; from: string; to?: string; note?: string }

/** Validates a working-pattern line. Shared by HR's Availability page and the rota's Staff & Eligibility page. */
export function parseAvailability(input: AvailabilityInput) {
  const kind = (["AVAILABLE", "UNAVAILABLE"] as AvailabilityKind[]).find((k) => k === input.kind);
  if (!kind) throw new ValidationError("Choose available or unavailable");
  const days = [...new Set(input.weekdays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (!days.length) throw new ValidationError("Choose at least one day");
  const s = parseHhmm(input.start);
  const e = input.end === "24:00" ? 1440 : parseHhmm(input.end);
  if (s === null || e === null || e <= s) throw new ValidationError("The end time must be after the start time");
  if (!isIsoDate(input.from) || (input.to && (!isIsoDate(input.to) || input.to < input.from))) throw new ValidationError("Check the dates");
  return { kind, days, startMinute: s, endMinute: e, from: input.from, to: input.to || null, note: input.note?.trim() || null };
}

/** Writes a validated pattern line for a staff member the caller has already been authorised for, then re-checks their visits. */
export async function insertAvailability(tx: Prisma.TransactionClient, organisationId: string, staffId: string, p: ReturnType<typeof parseAvailability>, actor: { userId: string; action: string }) {
  await tx.staffAvailability.createMany({ data: p.days.map((weekday) => ({ organisationId, staffId, weekday, startMinute: p.startMinute, endMinute: p.endMinute, kind: p.kind, effectiveFrom: dbDate(p.from), effectiveTo: p.to ? dbDate(p.to) : null, note: p.note, createdById: actor.userId })) });
  await audit({ organisationId, actorId: actor.userId, action: actor.action, entityType: "StaffMember", entityId: staffId, data: { kind: p.kind, days: p.days } }, tx);
  return reviewStaffImpact(tx, organisationId, [staffId], { source: "availability" });
}

/** Ends a pattern line from today (kept for history), or removes it if it had not started yet, then re-checks visits. */
export async function closeAvailability(tx: Prisma.TransactionClient, organisationId: string, row: { id: string; staffId: string; effectiveFrom: Date }, actor: { userId: string; action: string }) {
  const today = londonDate();
  if (row.effectiveFrom >= dbDate(today)) await tx.staffAvailability.delete({ where: { id: row.id } });
  else await tx.staffAvailability.update({ where: { id: row.id }, data: { effectiveTo: dbDate(addDays(today, -1)) } });
  await audit({ organisationId, actorId: actor.userId, action: actor.action, entityType: "StaffMember", entityId: row.staffId }, tx);
  return reviewStaffImpact(tx, organisationId, [row.staffId], { source: "availability" });
}

/** Adds a weekly pattern line (available or unavailable) for one or more weekdays. */
export async function addAvailability(ctx: Ctx, input: AvailabilityInput) {
  const a = editor(await hrActor(ctx));
  const p = parseAvailability(input);
  return db.$transaction(async (tx) => {
    const st = await staffFor(tx, a, input.staffId);
    return insertAvailability(tx, a.organisationId, st.id, p, { userId: ctx.userId, action: "workforce.availability.added" });
  });
}

/** Ends a pattern line from today (kept for history), or removes it if it had not started yet. */
export async function endAvailability(ctx: Ctx, id: string) {
  const a = editor(await hrActor(ctx));
  return db.$transaction(async (tx) => {
    const row = await tx.staffAvailability.findFirst({ where: { id, organisationId: a.organisationId, staff: staffInBranches(a) } });
    if (!row) throw new NotFoundError("Availability");
    return closeAvailability(tx, a.organisationId, row, { userId: ctx.userId, action: "workforce.availability.ended" });
  });
}
