import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonToUtc } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { closeAvailability, insertAvailability, parseAvailability, type AvailabilityInput } from "@/server/workforce/absences";
import { rotaScope, staffDirectoryWhere } from "./scope";

/**
 * Working patterns from the rota side. Rostering owns operational availability (when someone is free to be booked), so
 * coordinators keep and change it on the Staff & Eligibility page within their own branches and areas. It is the same
 * StaffAvailability record HR's Availability page shows, never a copy. Holidays and sickness stay with HR: here they are
 * read only, and only the kind, dates and status are exposed, never the reason or HR's notes.
 */

/** The working pattern and the next four weeks of HR-recorded time off for one person, for coordinators. */
export async function staffWorkingPattern(ctx: Ctx, staffId: string) {
  const scope = await rotaScope(ctx, "staff.directory");
  const staff = await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: staffId }, select: { id: true } });
  if (!staff) throw new NotFoundError("Staff member");
  const today = londonDate();
  const [pattern, timeOff] = await Promise.all([
    db.staffAvailability.findMany({
      where: { organisationId: scope.organisationId, staffId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(today) } }] },
      select: { id: true, weekday: true, startMinute: true, endMinute: true, kind: true, effectiveFrom: true, effectiveTo: true, note: true },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    }),
    db.staffAbsence.findMany({
      where: { organisationId: scope.organisationId, staffId, status: { in: ["REQUESTED", "APPROVED"] }, endsAt: { gte: londonToUtc(today, 0) }, startsAt: { lt: londonToUtc(addDays(today, 28), 0) } },
      select: { id: true, kind: true, startsAt: true, endsAt: true, status: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  return { pattern, timeOff };
}

async function editableStaff(ctx: Ctx, staffId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const staff = await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: staffId }, select: { id: true } });
  if (!staff) throw new NotFoundError("Staff member");
  return { scope, staff };
}

/** Adds a working-pattern line. Future visits that no longer fit are flagged for review, never removed. */
export async function addRotaAvailability(ctx: Ctx, input: AvailabilityInput) {
  const p = parseAvailability(input);
  const { scope, staff } = await editableStaff(ctx, input.staffId);
  return db.$transaction((tx) => insertAvailability(tx, scope.organisationId, staff.id, p, { userId: ctx.userId, action: "rota.availability.added" }));
}

/** Ends a working-pattern line from today (kept for history), or removes it if it had not started yet. */
export async function endRotaAvailability(ctx: Ctx, staffId: string, id: string) {
  const { scope, staff } = await editableStaff(ctx, staffId);
  return db.$transaction(async (tx) => {
    const row = await tx.staffAvailability.findFirst({ where: { id, organisationId: scope.organisationId, staffId: staff.id } });
    if (!row) throw new NotFoundError("Availability");
    return closeAvailability(tx, scope.organisationId, row, { userId: ctx.userId, action: "rota.availability.ended" });
  });
}
