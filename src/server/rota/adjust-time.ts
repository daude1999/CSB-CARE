import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, hhmm, londonMinute, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { raiseAlert } from "@/server/workforce/impact";
import { isOverlapViolation } from "./assign";
import { rotaScope, visitWhere, type Scope } from "./scope";
import { notifyVisitsChanged } from "./visit-change-notify";
import { updateVisitInTx } from "./visits";

/**
 * Quick Adjust Visit Time (brief of 3 Nov 2026): changes one scheduled visit's start time and length on its own day.
 * It goes through the shared visit service, so every screen shows the change, and it never touches the template.
 * Every carer on the visit is re-checked at the new time; a carer who cannot do it stops the change (no override).
 */

type Tx = Prisma.TransactionClient;

/** The only reasons a visit may be made shorter than its planned length. Carer availability is deliberately not one. */
export const SHORTEN_REASONS = {
  SU_REQUEST: "Service user or family request",
  APPOINTMENT: "Hospital or appointment",
  CARE_PLAN: "Approved care plan change",
} as const;
export type ShortenReason = keyof typeof SHORTEN_REASONS;
export const DURATION_CHIPS = [30, 40, 45, 60] as const;
/** Carers need at least this long between visits to travel; a shorter gap is a warning (it is not route data). */
export const TRAVEL_GAP_MIN = 10;

const inputSchema = z.object({
  visitId: z.string().min(1).max(60),
  lockVersion: z.coerce.number().int().min(0),
  start: z.string().refine((s) => parseHhmm(s) !== null, "Enter a start time, such as 08:30"),
  durationMin: z.coerce.number({ invalid_type_error: "Enter the length in minutes" }).int("Enter a whole number of minutes").min(5, "A visit lasts at least 5 minutes").max(1440, "A visit lasts at most 24 hours"),
  reason: z.string().trim().max(500).default(""),
  shortenReason: z.enum(["SU_REQUEST", "APPOINTMENT", "CARE_PLAN"]).optional(),
});
export type AdjustInput = z.input<typeof inputSchema>;

export interface Neighbour {
  reference: string;
  serviceUser: string;
  start: string;
  end: string;
  /** Minutes between this neighbour and the adjusted visit (negative = overlap). */
  gap: number;
}
export interface AdjustCarer {
  staffId: string;
  name: string;
  place: string;
  state: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE";
  blocking: string[];
  warnings: string[];
  previous: Neighbour | null;
  next: Neighbour | null;
}
export interface AdjustPreview {
  visitId: string;
  reference: string;
  lockVersion: number;
  serviceUser: string;
  date: string;
  published: boolean;
  original: { start: string; end: string; durationMin: number };
  revised: { start: string; end: string; durationMin: number };
  /** The planned length the shortening rule is measured against: the template's, or the visit's own. */
  plannedMin: number;
  shorter: boolean;
  carers: AdjustCarer[];
  /** Reasons the change cannot be made; Confirm stays off while any exist. */
  blocking: string[];
  warnings: string[];
  carersToTell: number;
}

const suNameOf = (su: { firstName: string; lastName: string; preferredName: string | null }) => `${su.preferredName || su.firstName} ${su.lastName}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function parse(input: AdjustInput) {
  const r = inputSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the new time");
  return r.data;
}

async function check(tx: Tx, scope: Scope, input: ReturnType<typeof parse>): Promise<AdjustPreview> {
  const v = await tx.visit.findFirst({
    where: { ...visitWhere(scope), id: input.visitId },
    include: {
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
      template: { select: { durationMin: true } },
      tasks: { select: { careTaskId: true } },
      assignments: { where: { removedAt: null }, orderBy: { position: "asc" }, include: { staff: { select: { id: true, displayName: true, userId: true } } } },
    },
  });
  if (!v) throw new NotFoundError("Visit");
  if (v.lockVersion !== input.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
  const date = fromDbDate(v.date);
  const minute = parseHhmm(input.start)!;
  const start = londonToUtc(date, minute);
  const end = new Date(start.getTime() + input.durationMin * 60000);
  const originalMin = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  const plannedMin = v.template?.durationMin ?? originalMin;
  const now = new Date();
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (v.status !== "SCHEDULED") blocking.push(`This visit is ${v.status.toLowerCase().replace("_", " ")}, so its time cannot be changed. Use an office correction for the times actually worked.`);
  else if (v.scheduledStart <= now) blocking.push("This visit has already started or its start time has passed, so its time cannot be changed.");
  if (v.timeLocked) blocking.push("This visit's time is locked. Unlock it in Visit Details first if the time really must change.");
  if (start <= now) blocking.push("The new start time has already passed. Choose a later time.");
  if (start.getTime() === v.scheduledStart.getTime() && end.getTime() === v.scheduledEnd.getTime()) blocking.push("The new time is the same as the current time.");
  const shorter = input.durationMin < plannedMin;
  if (shorter) warnings.push(`This is ${plannedMin - input.durationMin} minutes shorter than the planned ${plannedMin} minutes. A permanent change must go through the care plan; the care manager will be told.`);
  if (londonMinute(end) < minute && input.durationMin < 1440) warnings.push("The visit now ends after midnight.");

  const carers: AdjustCarer[] = [];
  const careTaskIds = v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
  const dayFrom = londonToUtc(date, 0);
  const dayTo = new Date(dayFrom.getTime() + 36 * 3600_000);
  for (const a of v.assignments) {
    const r = await eligibilityFor(tx, scope.organisationId, { staffId: a.staffId, start, end, slot: a.slot, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds }, { otherSlotStaffIds: v.assignments.filter((x) => x.id !== a.id).map((x) => x.staffId) });
    // The carer's other visits that day, to show the gap before and after the new time.
    const others = await tx.visitAssignment.findMany({
      where: { organisationId: scope.organisationId, staffId: a.staffId, removedAt: null, visitId: { not: v.id }, startsAt: { lt: dayTo }, endsAt: { gt: dayFrom }, visit: { status: { not: "CANCELLED" } } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true, endsAt: true, visit: { select: { reference: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    });
    const n = (o: (typeof others)[number], gap: number): Neighbour => ({ reference: o.visit.reference, serviceUser: suNameOf(o.visit.serviceUser), start: londonTime(o.startsAt), end: londonTime(o.endsAt), gap });
    const before = others.filter((o) => o.startsAt < start).at(-1);
    const after = others.find((o) => o.startsAt >= start);
    const previous = before ? n(before, Math.round((start.getTime() - before.endsAt.getTime()) / 60000)) : null;
    const next = after ? n(after, Math.round((after.startsAt.getTime() - end.getTime()) / 60000)) : null;
    const name = a.staff.displayName;
    const travel: string[] = [];
    if (previous && previous.gap >= 0 && previous.gap < TRAVEL_GAP_MIN) travel.push(`only ${previous.gap} minutes after ${previous.reference} (${previous.serviceUser}) ends at ${previous.end}`);
    if (next && next.gap >= 0 && next.gap < TRAVEL_GAP_MIN) travel.push(`only ${next.gap} minutes before ${next.reference} (${next.serviceUser}) starts at ${next.start}`);
    if (travel.length) warnings.push(`${name}: less than ${TRAVEL_GAP_MIN} minutes to travel, ${travel.join(" and ")}.`);
    const place = a.slot === "SHADOW" ? "Shadow" : `Carer ${a.position}`;
    carers.push({ staffId: a.staffId, name, place, state: r.state, blocking: r.blocking.map((b) => b.message), warnings: r.warnings.map((w) => w.message), previous, next });
    if (r.state === "NOT_ELIGIBLE") blocking.push(`${name} cannot do the new time: ${r.blocking.map((b) => b.message).join("; ")}`);
  }
  return {
    visitId: v.id,
    reference: v.reference,
    lockVersion: v.lockVersion,
    serviceUser: suNameOf(v.serviceUser),
    date,
    published: !!v.publishedAt,
    original: { start: londonTime(v.scheduledStart), end: londonTime(v.scheduledEnd), durationMin: originalMin },
    revised: { start: hhmm(minute), end: londonTime(end), durationMin: input.durationMin },
    plannedMin,
    shorter,
    carers,
    blocking,
    warnings,
    carersToTell: v.publishedAt ? new Set(v.assignments.map((a) => a.staff.userId).filter(Boolean)).size : 0,
  };
}

/** Read only: what the change would do, with every check. */
export async function previewAdjustVisitTime(ctx: Ctx, input: AdjustInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  return check(db, scope, parse(input));
}

/**
 * Applies a checked change. Every check runs again inside the transaction with the visit locked; a shorter visit needs
 * one of the allowed reasons and raises a "Visit shortened" item for the care manager. Carers of a published visit are
 * told in the app. Clock, medication and care records are never edited.
 */
export async function adjustVisitTime(ctx: Ctx, input: AdjustInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  const p = parse(input);
  if (p.reason.length < 3) throw new ValidationError("Give a reason for changing the time");
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${p.visitId} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
      const c = await check(tx, scope, p);
      if (c.blocking.length) throw new ValidationError(c.blocking[0]!);
      if (c.shorter && !p.shortenReason) throw new ValidationError(`This visit would be shorter than the planned ${c.plannedMin} minutes. Choose why: ${Object.values(SHORTEN_REASONS).join(", ")}. Carer availability is not a reason to shorten care.`);
      const why = c.shorter && p.shortenReason ? `${SHORTEN_REASONS[p.shortenReason]}: ${p.reason}` : p.reason;
      const start = londonToUtc(c.date, parseHhmm(p.start)!);
      const end = new Date(start.getTime() + p.durationMin * 60000);
      const updated = await updateVisitInTx(tx, scope, ctx.userId, c.visitId, { scheduledStart: start, scheduledEnd: end }, { source: "quick-adjust", lockVersion: p.lockVersion, reason: why });
      await audit({
        organisationId: scope.organisationId,
        actorId: ctx.userId,
        action: "visit.time.adjusted",
        entityType: "Visit",
        entityId: c.visitId,
        data: { reference: c.reference, date: c.date, from: c.original, to: c.revised, plannedMin: c.plannedMin, shorter: c.shorter, shortenReason: p.shortenReason ?? null, reason: p.reason },
      }, tx);
      if (c.shorter) {
        await raiseAlert(tx, {
          organisationId: scope.organisationId,
          kind: "VISIT_SHORTENED",
          visitId: c.visitId,
          message: `${c.reference} for ${c.serviceUser} on ${fmtLondonDate(c.date, { weekday: "short", day: "numeric", month: "short" })} was shortened to ${c.revised.durationMin} minutes (planned ${c.plannedMin}). Reason: ${why}`,
          dedupeKey: `visit-shortened:${c.visitId}:${updated.lockVersion}`,
          actionUrl: `/rota/visits/${c.visitId}`,
        });
      }
      const carersTold = await notifyVisitsChanged(tx, scope.organisationId, [c.visitId], { key: `adjust:${updated.lockVersion}` });
      return { reference: c.reference, from: c.original, to: c.revised, carersTold, shorter: c.shorter, warnings: c.warnings };
    }, { timeout: 30_000 });
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("A carer on this visit is already booked at the new time. Nothing was changed.");
    throw e;
  }
}

export function adjustSummary(r: { reference: string; from: { start: string; end: string }; to: { start: string; end: string }; carersTold: number; shorter: boolean }) {
  return `${r.reference} now runs ${r.to.start}–${r.to.end} (was ${r.from.start}–${r.from.end}).${r.carersTold ? ` ${plural(r.carersTold, "carer")} told in the app.` : ""}${r.shorter ? " The care manager has been told it is shorter." : ""}`;
}
