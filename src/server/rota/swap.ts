import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { assignInTx, EligibilityError, isOverlapViolation, lockVisit } from "./assign";
import { rotaScope, visitWhere } from "./scope";

const side = z.object({
  visitId: z.string().min(1),
  slot: z.enum(["PRIMARY", "SECOND", "SHADOW"]),
  lockVersion: z.number().int().nonnegative().optional(),
});

export const swapSchema = z.object({
  first: side,
  second: side,
  reason: z.string().trim().min(3, "Give a reason for the swap").max(500),
  acceptWarnings: z.boolean().default(false),
});

export type SwapInput = z.input<typeof swapSchema>;

/**
 * A two-way shift swap: the carer on the first visit takes the second, and the carer on the second takes the first,
 * in one transaction. Both visits and both carers are row-locked (in a fixed order, so two coordinators cannot
 * deadlock), each carer is checked for the other's visit by the eligibility service as if their own visit were already
 * given away, and the database's double-booking guard has the final say. If either side fails, nothing changes.
 */
export async function swapCarers(ctx: Ctx, raw: SwapInput | Record<string, unknown>) {
  const input = swapSchema.parse(raw);
  const scope = await rotaScope(ctx, "rota.edit");
  if (input.first.visitId === input.second.visitId) throw new ValidationError("Choose two different visits to swap");

  try {
    return await db.$transaction(
      async (tx) => {
        const sides = [input.first, input.second] as const;
        for (const s of [...sides].sort((a, b) => a.visitId.localeCompare(b.visitId))) {
          const v = await lockVisit(tx, scope, s.visitId);
          if (s.lockVersion !== undefined && s.lockVersion !== v.lockVersion) throw new ConflictError(`Visit ${v.reference} changed since you opened it. Reload and try again.`);
          if (v.status !== "SCHEDULED") throw new ValidationError(`Visit ${v.reference} is ${v.status.toLowerCase().replace("_", " ")}; only scheduled visits can be swapped`);
        }
        const [a, b] = await Promise.all(
          sides.map(async (s) => {
            const found = await tx.visitAssignment.findFirst({ where: { visitId: s.visitId, slot: s.slot, removedAt: null }, include: { staff: { select: { displayName: true } }, visit: { select: { reference: true } } } });
            if (!found) throw new NotFoundError("A carer on one of the visits");
            return found;
          }),
        );
        if (a!.staffId === b!.staffId) throw new ValidationError("The same carer is on both visits; there is nothing to swap");
        const staffOrder = [a!.staffId, b!.staffId].sort();
        for (const id of staffOrder) await tx.$queryRaw`SELECT id FROM "StaffMember" WHERE id = ${id} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;

        // Both carers leave their own visit first, so each is checked for the other visit without their old booking.
        const now = new Date();
        const why = `Swapped: ${input.reason}`;
        for (const x of [a!, b!]) {
          await tx.visitAssignment.update({ where: { id: x.id }, data: { removedAt: now, removedById: ctx.userId, removeReason: why } });
          await tx.rotaAlert.updateMany({ where: { assignmentId: x.id, resolvedAt: null }, data: { resolvedAt: now, resolvedById: ctx.userId, resolution: "Carer swapped onto another visit" } });
        }

        const place = async (to: typeof a, from: typeof a) => {
          try {
            await assignInTx(tx, scope, ctx.userId, { visitId: to!.visitId, slot: to!.slot, staffId: from!.staffId, acceptWarnings: input.acceptWarnings }, { source: "swap" });
          } catch (e) {
            if (e instanceof EligibilityError) throw new EligibilityError(`Swap refused: ${from!.staff.displayName} cannot take ${to!.visit.reference}. ${e.message}`, e.result);
            if (isOverlapViolation(e) || e instanceof ConflictError) throw new ConflictError(`Swap refused: ${from!.staff.displayName} is already booked during ${to!.visit.reference}.`);
            throw e;
          }
        };
        await place(a, b);
        await place(b, a);

        for (const [x, y] of [[a!, b!], [b!, a!]] as const)
          await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: x.visitId, type: "SWAPPED", actorId: ctx.userId, reason: input.reason, data: { slot: x.slot, from: x.staffId, to: y.staffId, otherVisitId: y.visitId } } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.swapped", entityType: "Visit", entityId: a!.visitId, data: { first: { visitId: a!.visitId, slot: a!.slot, staffId: a!.staffId }, second: { visitId: b!.visitId, slot: b!.slot, staffId: b!.staffId }, reason: input.reason, acceptWarnings: input.acceptWarnings } }, tx);
        return { first: a!.visit.reference, second: b!.visit.reference, carers: [a!.staff.displayName, b!.staff.displayName] as const };
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000 },
    );
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("Swap refused: one of the carers has just been booked at an overlapping time. Reload and try again.");
    throw e;
  }
}

/** Visits whose carer could swap with the carer on the given visit: same day, scheduled, with a carer, in scope. */
export async function swapCandidates(ctx: Ctx, visitId: string, slot: "PRIMARY" | "SECOND" | "SHADOW") {
  const scope = await rotaScope(ctx, "rota.edit");
  const v = await db.visit.findFirst({ where: { id: visitId, ...visitWhere(scope) } });
  if (!v) throw new NotFoundError("Visit");
  const mine = await db.visitAssignment.findFirst({ where: { visitId, slot, removedAt: null }, select: { staffId: true } });
  if (!mine) return [];
  const dayStart = new Date(v.scheduledStart.getTime() - 12 * 3600_000);
  const dayEnd = new Date(v.scheduledStart.getTime() + 12 * 3600_000);
  const rows = await db.visitAssignment.findMany({
    where: {
      organisationId: scope.organisationId,
      removedAt: null,
      staffId: { not: mine.staffId },
      slot: { in: ["PRIMARY", "SECOND"] },
      visit: { ...visitWhere(scope), id: { not: visitId }, status: "SCHEDULED", scheduledStart: { gte: dayStart, lt: dayEnd } },
    },
    include: { staff: { select: { displayName: true } }, visit: { select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, lockVersion: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    orderBy: { visit: { scheduledStart: "asc" } },
    take: 200,
  });
  return rows.map((r) => ({ visitId: r.visit.id, slot: r.slot, lockVersion: r.visit.lockVersion, reference: r.visit.reference, start: r.visit.scheduledStart, end: r.visit.scheduledEnd, carer: r.staff.displayName, serviceUser: `${r.visit.serviceUser.preferredName ?? r.visit.serviceUser.firstName} ${r.visit.serviceUser.lastName}` }));
}
