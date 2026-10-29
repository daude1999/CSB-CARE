import type { Prisma, RiskLevel, RiskType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";

type Tx = Prisma.TransactionClient;

/**
 * Risk assessments for the people the organisation supports. Each has hazards, the controls carers follow, a level
 * and a review date. Reviewing updates it in place with a version check; every change is in the audit log with the
 * previous values, and an assessment that no longer applies is archived (kept), never deleted. The person's overall
 * risk level shown in lists is the highest of their active assessments.
 */

export const RISK_TYPE_LABEL: Record<RiskType, string> = {
  ENVIRONMENT: "Home environment",
  MOVING_HANDLING: "Moving and handling",
  FALLS: "Falls",
  PRESSURE_SKIN: "Pressure and skin",
  MEDICATION_SUPPORT: "Medication support",
  NUTRITION: "Eating and drinking",
  LONE_WORKING: "Lone working",
  OTHER: "Other",
};
const TYPES = Object.keys(RISK_TYPE_LABEL) as [RiskType, ...RiskType[]];
const LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

const riskSchema = z.object({
  type: z.enum(TYPES, { message: "Choose the type of risk" }),
  title: z.string().trim().min(3, "Give the assessment a title").max(160),
  hazards: z.string().trim().min(10, "Describe the hazards (at least a sentence)").max(4000),
  controls: z.string().trim().min(10, "Describe what carers do to reduce the risk").max(4000),
  level: z.enum(["LOW", "MEDIUM", "HIGH"], { message: "Choose the risk level" }),
  reviewDue: z.string().refine(isIsoDate, "Choose a review date"),
});
export type RiskInput = z.input<typeof riskSchema>;

function parse(input: RiskInput | Record<string, unknown>) {
  const p = riskSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the assessment");
  if (p.data.reviewDue <= londonDate()) throw new ValidationError("The review date must be in the future");
  if (p.data.reviewDue > addDays(londonDate(), 366)) throw new ValidationError("Review at least once a year");
  return p.data;
}

/** Keeps the person's headline risk level equal to their highest active assessment. */
async function syncRiskLevel(tx: Tx, serviceUserId: string) {
  const active = await tx.riskAssessment.findMany({ where: { serviceUserId, status: "ACTIVE" }, select: { level: true } });
  const top = LEVELS.filter((l) => active.some((a) => a.level === l)).at(-1) ?? null;
  await tx.serviceUser.update({ where: { id: serviceUserId }, data: { riskLevel: top } });
}

async function riskInScope(tx: Tx, scope: Scope, id: string) {
  const r = await tx.riskAssessment.findFirst({ where: { id, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
  if (!r) throw new NotFoundError("Risk assessment");
  return r;
}

export async function listRisks(ctx: Ctx, f: { serviceUserId?: string; type?: string; level?: string; due?: string; archived?: boolean; q?: string }) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const today = londonDate();
  const where: Prisma.RiskAssessmentWhereInput = {
    organisationId: scope.organisationId,
    serviceUser: serviceUserWhere(scope),
    status: f.archived ? "ARCHIVED" : "ACTIVE",
    ...(f.serviceUserId ? { serviceUserId: f.serviceUserId } : {}),
    ...(TYPES.includes(f.type as RiskType) ? { type: f.type as RiskType } : {}),
    ...(LEVELS.includes(f.level as RiskLevel) ? { level: f.level as RiskLevel } : {}),
    ...(f.due === "overdue" ? { reviewDue: { lt: dbDate(today) } } : f.due === "30" ? { reviewDue: { lte: dbDate(addDays(today, 30)) } } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { firstName: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  return db.riskAssessment.findMany({ where, include: { serviceUser: { select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true } } }, orderBy: [{ reviewDue: "asc" }, { level: "desc" }], take: 500 });
}

export async function getRisk(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const r = await db.riskAssessment.findFirst({ where: { id, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) }, include: { serviceUser: { select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true } } } });
  if (!r) throw new NotFoundError("Risk assessment");
  const history = await db.auditLog.findMany({ where: { organisationId: scope.organisationId, entityType: "RiskAssessment", entityId: r.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return { risk: r, history };
}

export async function createRisk(ctx: Ctx, serviceUserId: string, input: RiskInput | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  const d = parse(input);
  return db.$transaction(async (tx) => {
    const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true } });
    if (!su) throw new NotFoundError("Service user");
    const r = await tx.riskAssessment.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, type: d.type, title: d.title, hazards: d.hazards, controls: d.controls, level: d.level, reviewDue: dbDate(d.reviewDue), assessedById: ctx.userId } });
    await syncRiskLevel(tx, su.id);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "risk.created", entityType: "RiskAssessment", entityId: r.id, data: { serviceUserId: su.id, type: d.type, level: d.level } }, tx);
    return r;
  });
}

/** A review: the assessor confirms or changes the content and sets the next review date. */
export async function reviewRisk(ctx: Ctx, id: string, version: number, input: RiskInput | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  const d = parse(input);
  return db.$transaction(async (tx) => {
    const r = await riskInScope(tx, scope, id);
    if (r.status !== "ACTIVE") throw new ValidationError("An archived assessment cannot be reviewed. Create a new one.");
    const { count } = await tx.riskAssessment.updateMany({ where: { id: r.id, version }, data: { type: d.type, title: d.title, hazards: d.hazards, controls: d.controls, level: d.level, reviewDue: dbDate(d.reviewDue), assessedById: ctx.userId, assessedAt: new Date(), version: { increment: 1 } } });
    if (!count) throw new ConflictError("Someone else changed this assessment since you opened it. Reload and try again.");
    await syncRiskLevel(tx, r.serviceUserId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "risk.reviewed", entityType: "RiskAssessment", entityId: r.id, data: { previous: { type: r.type, title: r.title, hazards: r.hazards, controls: r.controls, level: r.level, reviewDue: r.reviewDue.toISOString().slice(0, 10) }, level: d.level, reviewDue: d.reviewDue } }, tx);
  });
}

export async function archiveRisk(ctx: Ctx, id: string, reason: string) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  if (reason.trim().length < 3) throw new ValidationError("Say why this no longer applies");
  return db.$transaction(async (tx) => {
    const r = await riskInScope(tx, scope, id);
    if (r.status !== "ACTIVE") throw new ValidationError("Already archived");
    await tx.riskAssessment.update({ where: { id: r.id }, data: { status: "ARCHIVED", archivedById: ctx.userId, archivedAt: new Date(), version: { increment: 1 } } });
    await syncRiskLevel(tx, r.serviceUserId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "risk.archived", entityType: "RiskAssessment", entityId: r.id, data: { reason: reason.trim() } }, tx);
  });
}
