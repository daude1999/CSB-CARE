import type { ClockKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { raiseAlert } from "@/server/workforce/impact";
import { myStaff } from "@/server/workforce/link";
import { clockFromRequest, effectiveClocks } from "./attendance";
import { rotaScope, visitWhere } from "./scope";

/**
 * Clock correction requests: a carer who forgot to clock, or pressed the button late, asks the office to put the time
 * right. Someone other than the requester decides (database trigger too); an approval becomes an office clock entry
 * that supersedes the carer's record, so the original stays on file. Office entries made directly are recorded as
 * approved requests, so every hand-entered time has the same trail.
 */

const requestSchema = z.object({
  kind: z.enum(["IN", "OUT"], { message: "Choose clock in or clock out" }),
  date: z.string().refine(isIsoDate, "Choose the date"),
  time: z.string().refine((t) => parseHhmm(t) !== null, "Times must be like 09:00"),
  reason: z.string().trim().min(5, "Say what happened").max(1000),
});

export async function requestClockCorrection(ctx: Ctx, visitId: string, input: z.input<typeof requestSchema>) {
  const p = requestSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the request");
  const staff = await myStaff(ctx);
  const at = londonToUtc(p.data.date, parseHhmm(p.data.time) ?? 0);
  if (at.getTime() > Date.now() + 60_000) throw new ValidationError("A clock time cannot be in the future");
  return db.$transaction(async (tx) => {
    const v = await tx.visit.findFirst({ where: { id: visitId, organisationId: staff.organisationId, publishedAt: { not: null }, assignments: { some: { staffId: staff.id, removedAt: null } } } });
    if (!v) throw new NotFoundError("Visit");
    if (["CANCELLED", "NOT_DELIVERED"].includes(v.status)) throw new ValidationError("This visit was not delivered");
    if (Math.abs(at.getTime() - v.scheduledStart.getTime()) > 24 * 3600_000) throw new ValidationError("That time is more than a day away from the visit");
    const pending = await tx.clockCorrectionRequest.findFirst({ where: { visitId: v.id, staffId: staff.id, kind: p.data.kind, status: "PENDING" } });
    if (pending) throw new ConflictError("You have already asked for this correction. The office will decide it.");
    const r = await tx.clockCorrectionRequest.create({ data: { organisationId: v.organisationId, visitId: v.id, staffId: staff.id, kind: p.data.kind, requestedTime: at, reason: p.data.reason, origin: "CARER", requestedById: ctx.userId } });
    await raiseAlert(tx, { organisationId: v.organisationId, kind: "CLOCK_CORRECTION", severity: "INFO", visitId: v.id, staffId: staff.id, message: `${staff.displayName} asks to change their clock-${p.data.kind === "IN" ? "in" : "out"} on ${v.reference} to ${londonTime(at)}`, dedupeKey: `clockreq:${r.id}`, actionUrl: `/rota/visits/${v.id}#corrections` });
    await audit({ organisationId: v.organisationId, actorId: ctx.userId, action: "visit.clock.correction.requested", entityType: "Visit", entityId: v.id, data: { requestId: r.id, kind: p.data.kind, at: at.toISOString() } }, tx);
    return r;
  });
}

/** Approve (the time is recorded as an office entry) or reject (with a reason). The requester cannot decide. */
export async function decideClockCorrection(ctx: Ctx, requestId: string, decision: "APPROVED" | "REJECTED", note: string) {
  const scope = await rotaScope(ctx, "rota.clockCorrect");
  const r = await db.clockCorrectionRequest.findFirst({ where: { id: requestId, organisationId: scope.organisationId } });
  if (!r || !(await db.visit.findFirst({ where: { ...visitWhere(scope), id: r.visitId }, select: { id: true } }))) throw new NotFoundError("Correction request");
  if (r.status !== "PENDING") throw new ConflictError("This request has already been decided");
  if (r.requestedById === ctx.userId) throw new ForbiddenError("You asked for this correction, so someone else must decide it");
  if (decision === "REJECTED" && note.trim().length < 3) throw new ValidationError("Say why the request is rejected");
  return db.$transaction(async (tx) => {
    let clockId: string | null = null;
    if (decision === "APPROVED") {
      const live = effectiveClocks(await tx.visitClock.findMany({ where: { visitId: r.visitId } })).find((c) => c.staffId === r.staffId && c.kind === r.kind);
      const res = await clockFromRequest(tx, scope, r.visitId, { staffId: r.staffId, kind: r.kind, at: r.requestedTime, actorId: ctx.userId, reason: `Carer's correction request: ${r.reason}`, note: r.kind === "OUT" ? r.reason : null, supersedesId: live?.id ?? null });
      clockId = res.clock.id;
    }
    const done = await tx.clockCorrectionRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() || null, clockId } });
    if (!done.count) throw new ConflictError("This request has just been decided by someone else");
    await tx.rotaAlert.updateMany({ where: { dedupeKey: `clockreq:${r.id}`, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: decision === "APPROVED" ? "Correction approved and recorded" : `Correction rejected: ${note.trim()}` } });
    await tx.notification.createMany({ data: [{ organisationId: r.organisationId, userId: r.requestedById, type: "rota.clock.correction", title: `Your clock correction was ${decision === "APPROVED" ? "approved" : "rejected"}`, body: note.trim() || `Clock-${r.kind === "IN" ? "in" : "out"} at ${londonTime(r.requestedTime)}`, reason: "You asked for this correction.", actionUrl: "/carer", dedupeKey: `clockreq-decided:${r.id}` }], skipDuplicates: true });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: `visit.clock.correction.${decision.toLowerCase()}`, entityType: "Visit", entityId: r.visitId, data: { requestId: r.id, clockId, note: note.trim() || null } }, tx);
    return { clockId };
  });
}

/** Requests in the office's scope, pending first. With a visit, only that visit's. */
export async function listCorrectionRequests(ctx: Ctx, opts: { visitId?: string; status?: "PENDING" | "ALL" } = {}) {
  const scope = await rotaScope(ctx, "rota.view");
  return db.clockCorrectionRequest.findMany({
    where: { organisationId: scope.organisationId, visit: visitWhere(scope), ...(opts.visitId ? { visitId: opts.visitId } : {}), ...(opts.status === "ALL" ? {} : { status: "PENDING" }) },
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export const CLOCK_KIND_LABEL: Record<ClockKind, string> = { IN: "Clock in", OUT: "Clock out" };
