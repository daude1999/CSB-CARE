import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { staffDirectoryWhere, rotaScope } from "@/server/rota/scope";
import { myStaff } from "@/server/workforce/link";

/**
 * Mileage claims: a carer claims business miles for a day (optionally against a visit); finance or a coordinator
 * approves or rejects, never the person who submitted it. Approved claims are picked up by the next pay run.
 * Miles are what the carer states: distances are not calculated (route mapping is not built).
 */

const claimSchema = z.object({
  date: z.string().refine(isIsoDate, "Choose the date"),
  miles: z.coerce.number().positive("Miles must be more than 0").max(500, "That is more than 500 miles in a day"),
  visitId: z.string().optional(),
  reason: z.string().trim().min(3, "Say what the journey was for").max(500),
});

export async function submitMyMileage(ctx: Ctx, input: z.input<typeof claimSchema>) {
  const p = claimSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the claim");
  const staff = await myStaff(ctx);
  const today = londonDate();
  if (p.data.date > today) throw new ValidationError("You can only claim for today or earlier");
  if (p.data.date < addDays(today, -60)) throw new ValidationError("Claims must be made within 60 days");
  if (p.data.visitId && !(await db.visit.findFirst({ where: { id: p.data.visitId, organisationId: staff.organisationId, assignments: { some: { staffId: staff.id } } } }))) throw new NotFoundError("Visit");
  return db.$transaction(async (tx) => {
    const c = await tx.mileageClaim.create({ data: { organisationId: staff.organisationId, staffId: staff.id, visitId: p.data.visitId || null, date: dbDate(p.data.date), miles: Math.round(p.data.miles * 10) / 10, reason: p.data.reason, submittedById: ctx.userId } });
    await audit({ organisationId: staff.organisationId, actorId: ctx.userId, action: "finance.mileage.submitted", entityType: "MileageClaim", entityId: c.id, data: { miles: c.miles, date: p.data.date } }, tx);
    return c;
  });
}

export async function myMileage(ctx: Ctx) {
  const staff = await myStaff(ctx);
  return db.mileageClaim.findMany({ where: { organisationId: staff.organisationId, staffId: staff.id }, orderBy: { date: "desc" }, take: 30 });
}

function canDecide(ctx: Ctx) {
  return hasOrgPermission(ctx, "finance.manage") || hasOrgPermission(ctx, "finance.approve") || hasOrgPermission(ctx, "rota.edit");
}

/** Claims in the office's scope (staff in their branches), newest first. */
export async function listMileage(ctx: Ctx, f: { status?: string; from?: string; to?: string }) {
  if (!canDecide(ctx) && !hasOrgPermission(ctx, "finance.view")) throw new ForbiddenError("You do not have access to mileage claims");
  const scope = await rotaScope(ctx, hasOrgPermission(ctx, "rota.view") ? "rota.view" : "finance.view");
  const staff = await db.staffMember.findMany({ where: staffDirectoryWhere(scope, {}), select: { id: true, displayName: true } });
  const status = f.status === "APPROVED" || f.status === "REJECTED" || f.status === "ALL" ? f.status : "SUBMITTED";
  const rows = await db.mileageClaim.findMany({
    where: { organisationId: scope.organisationId, staffId: { in: staff.map((s) => s.id) }, ...(status === "ALL" ? {} : { status }), ...(f.from && isIsoDate(f.from) ? { date: { gte: dbDate(f.from), ...(f.to && isIsoDate(f.to) ? { lte: dbDate(f.to) } : {}) } } : {}) },
    orderBy: [{ date: "desc" }],
    take: 500,
  });
  return { status, rows, names: new Map(staff.map((s) => [s.id, s.displayName])) };
}

export async function decideMileage(ctx: Ctx, claimId: string, decision: "APPROVED" | "REJECTED", note: string) {
  if (!canDecide(ctx)) throw new ForbiddenError("You cannot decide mileage claims");
  const scope = await rotaScope(ctx, hasOrgPermission(ctx, "rota.view") ? "rota.view" : "finance.view");
  const c = await db.mileageClaim.findFirst({ where: { id: claimId, organisationId: scope.organisationId } });
  if (!c || !(await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, {}), id: c.staffId }, select: { id: true } }))) throw new NotFoundError("Mileage claim");
  if (c.submittedById === ctx.userId) throw new ForbiddenError("You submitted this claim, so someone else must decide it");
  if (c.status !== "SUBMITTED") throw new ConflictError("This claim has already been decided");
  if (decision === "REJECTED" && note.trim().length < 3) throw new ValidationError("Say why the claim is rejected");
  await db.$transaction(async (tx) => {
    const done = await tx.mileageClaim.updateMany({ where: { id: c.id, status: "SUBMITTED" }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() || null } });
    if (!done.count) throw new ConflictError("This claim has just been decided by someone else");
    await tx.notification.createMany({ data: [{ organisationId: c.organisationId, userId: c.submittedById, type: "finance.mileage.decided", title: `Mileage claim ${decision === "APPROVED" ? "approved" : "rejected"}`, body: note.trim() || `${c.miles} miles`, reason: "You made this claim.", actionUrl: "/carer", dedupeKey: `mileage-decided:${c.id}` }], skipDuplicates: true });
    await audit({ organisationId: c.organisationId, actorId: ctx.userId, action: `finance.mileage.${decision.toLowerCase()}`, entityType: "MileageClaim", entityId: c.id, data: { note: note.trim() || null } }, tx);
  });
}
