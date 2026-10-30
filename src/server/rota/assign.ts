import { Prisma, type AssignmentSlot, type Visit } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor, type EligibilityResult } from "@/server/workforce/eligibility";
import { assertInScope, rotaScope, type Scope } from "./scope";

type Tx = Prisma.TransactionClient;

/** Row-locks a visit for the rest of the transaction and checks it belongs to the caller's organisation and areas. */
export async function lockVisit(tx: Tx, scope: Scope, visitId: string): Promise<Visit> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Visit" WHERE id = ${visitId} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Visit");
  const v = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
  assertInScope(scope, v, "Visit");
  return v;
}

/** Serialises allocation of one carer: two coordinators assigning the same person wait for each other. */
async function lockStaff(tx: Tx, organisationId: string, staffId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "StaffMember" WHERE id = ${staffId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Staff member");
}

export function describe(r: EligibilityResult) {
  return [...r.blocking, ...r.warnings].map((x) => x.message).join("; ");
}

export class EligibilityError extends ConflictError {
  constructor(
    message: string,
    public readonly result: EligibilityResult,
  ) {
    super(message);
  }
}

export interface AssignParams {
  visitId: string;
  slot: AssignmentSlot;
  staffId: string;
  /** The coordinator has read the warnings (Requires review) and allocates anyway. Recorded on the assignment. */
  acceptWarnings?: boolean;
  /** Optimistic concurrency: the visit version the coordinator was looking at. */
  lockVersion?: number;
}

/**
 * The one assignment path. Manual assignment, planner moves, bulk reassignment and the rota builder all end here,
 * inside a transaction that holds the visit and carer row locks, so the eligibility result is still true at commit.
 * The database's exclusion constraint is the final guard against double-booking.
 */
export async function assignInTx(tx: Tx, scope: Scope, actorId: string, p: AssignParams, opts: { source: string; markManual?: boolean } = { source: "manual" }) {
  const visit = await lockVisit(tx, scope, p.visitId);
  if (p.lockVersion !== undefined && p.lockVersion !== visit.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
  if (!["SCHEDULED", "MISSED"].includes(visit.status)) throw new ValidationError(`Carers cannot be changed on a ${visit.status.toLowerCase().replace("_", " ")} visit`);
  if (p.slot === "SECOND" && visit.carersRequired < 2) throw new ValidationError("This visit needs one carer. Convert it to a double-up first.");
  await lockStaff(tx, scope.organisationId, p.staffId);

  const live = await tx.visitAssignment.findMany({ where: { visitId: visit.id, removedAt: null } });
  const current = live.find((a) => a.slot === p.slot);
  if (current?.staffId === p.staffId) return current;
  const others = live.filter((a) => a.slot !== p.slot).map((a) => a.staffId);

  const careTaskIds = (await tx.visitTask.findMany({ where: { visitId: visit.id }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
  const result = await eligibilityFor(tx, scope.organisationId, { staffId: p.staffId, start: visit.scheduledStart, end: visit.scheduledEnd, slot: p.slot, visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: visit.timeLocked, careTaskIds }, { otherSlotStaffIds: others });
  if (result.state === "NOT_ELIGIBLE") throw new EligibilityError(`Cannot allocate: ${result.blocking.map((b) => b.message).join("; ")}`, result);
  if (result.state === "REQUIRES_REVIEW" && !p.acceptWarnings) throw new EligibilityError(`Needs your confirmation: ${result.warnings.map((w) => w.message).join("; ")}`, result);

  const now = new Date();
  if (current) {
    await tx.visitAssignment.update({ where: { id: current.id }, data: { removedAt: now, removedById: actorId, removeReason: `Replaced (${opts.source})` } });
    // Alerts about the replaced carer's booking (for example a review flag after sickness) are answered by replacing them.
    await tx.rotaAlert.updateMany({ where: { assignmentId: current.id, resolvedAt: null }, data: { resolvedAt: now, resolvedById: actorId, resolution: "Carer replaced on the visit" } });
  }
  try {
    const created = await tx.visitAssignment.create({
      data: {
        organisationId: scope.organisationId,
        visitId: visit.id,
        slot: p.slot,
        staffId: p.staffId,
        startsAt: visit.scheduledStart,
        endsAt: visit.scheduledEnd,
        eligibility: result.state,
        warningsAccepted: result.state === "REQUIRES_REVIEW" ? result.warnings.map((w) => w.message) : [],
        assignedById: actorId,
      },
    });
    await tx.visit.update({ where: { id: visit.id }, data: { lockVersion: { increment: 1 }, ...(opts.markManual !== false ? { manuallyChanged: true } : {}) } });
    await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: visit.id, type: current ? "REASSIGNED" : "ASSIGNED", actorId, data: { slot: p.slot, staffId: p.staffId, previousStaffId: current?.staffId ?? null, source: opts.source, eligibility: result.state, warnings: created.warningsAccepted } } });
    await audit({ organisationId: scope.organisationId, actorId, action: current ? "visit.reassigned" : "visit.assigned", entityType: "Visit", entityId: visit.id, data: { slot: p.slot, staffId: p.staffId, source: opts.source, eligibility: result.state } }, tx);
    return created;
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("This carer has just been booked for an overlapping visit. Reload and choose someone else.");
    throw e;
  }
}

export function isOverlapViolation(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  return msg.includes("visit_assignment_no_overlap") || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2004") || msg.includes("23P01");
}

export async function assignCarer(ctx: Ctx, p: AssignParams, source = "manual") {
  const scope = await rotaScope(ctx, "rota.edit");
  try {
    return await db.$transaction((tx) => assignInTx(tx, scope, ctx.userId, p, { source }), { isolationLevel: "ReadCommitted", timeout: 15_000 });
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("This carer has just been booked for an overlapping visit. Reload and choose someone else.");
    throw e;
  }
}

export async function unassignInTx(tx: Tx, scope: Scope, actorId: string, p: { visitId: string; slot: AssignmentSlot; reason: string; lockVersion?: number }) {
  const visit = await lockVisit(tx, scope, p.visitId);
  if (p.lockVersion !== undefined && p.lockVersion !== visit.lockVersion) throw new ConflictError("This visit changed since you opened it. Reload and try again.");
  if (!["SCHEDULED", "MISSED"].includes(visit.status)) throw new ValidationError("Carers can only be removed from visits that have not started");
  if (p.reason.trim().length < 3) throw new ValidationError("Give a reason for removing the carer");
  const a = await tx.visitAssignment.findFirst({ where: { visitId: visit.id, slot: p.slot, removedAt: null } });
  if (!a) throw new NotFoundError("Assignment");
  await tx.visitAssignment.update({ where: { id: a.id }, data: { removedAt: new Date(), removedById: actorId, removeReason: p.reason.trim() } });
  await tx.visit.update({ where: { id: visit.id }, data: { lockVersion: { increment: 1 }, manuallyChanged: true } });
  await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: visit.id, type: "UNASSIGNED", actorId, reason: p.reason.trim(), data: { slot: p.slot, staffId: a.staffId } } });
  await tx.rotaAlert.updateMany({ where: { assignmentId: a.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId, resolution: "Carer removed from the visit" } });
  await audit({ organisationId: scope.organisationId, actorId, action: "visit.unassigned", entityType: "Visit", entityId: visit.id, data: { slot: p.slot, staffId: a.staffId, reason: p.reason.trim() } }, tx);
}

export async function unassignCarer(ctx: Ctx, p: { visitId: string; slot: AssignmentSlot; reason: string; lockVersion?: number }) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction((tx) => unassignInTx(tx, scope, ctx.userId, p));
}
