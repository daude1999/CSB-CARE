import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { notify } from "../notifications/notify";

/**
 * The organisational risk register. A risk is scored on a 5 x 5 matrix: rating = likelihood x impact, each from 1 to 5.
 * The inherent rating is before controls; the residual rating is with the existing controls in place. Bands follow the
 * widely used 5 x 5 healthcare matrix:
 *
 *   1 to 3   Low       manage by routine procedures
 *   4 to 6   Moderate  owner monitors; review at least every 6 months
 *   8 to 12  High      management attention; mitigation actions and review at least quarterly
 *   15 to 25 Extreme   immediate senior attention; review at least monthly
 *
 * (Products 7, 13 and 14 cannot occur on a 5 x 5 grid.) Ratings are an internal management tool, never a regulatory judgement.
 * Risks, findings and corrective actions are different records: a risk may come from a finding and may have actions.
 */

export const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"] as const;
export const IMPACT = ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"] as const;

export const RISK_CATEGORIES = {
  SAFE_CARE: "Safe care and treatment",
  SAFEGUARDING: "Safeguarding",
  WORKFORCE: "Staffing and workforce",
  MEDICATION: "Medication",
  GOVERNANCE: "Governance and leadership",
  INFORMATION: "Information and data protection",
  FINANCIAL: "Financial and business continuity",
  PREMISES: "Premises, equipment and travel",
  REGULATORY: "Regulatory and legal",
  OTHER: "Other",
} as const;
export type RiskCategory = keyof typeof RISK_CATEGORIES;

export const CONTROL_EFFECTIVENESS = {
  EFFECTIVE: "Effective",
  PARTIALLY_EFFECTIVE: "Partially effective",
  INEFFECTIVE: "Not effective",
  NOT_ASSESSED: "Not yet assessed",
} as const;

export const RISK_STATUS = { OPEN: "Open", MONITORING: "Monitoring", CLOSED: "Closed" } as const;
export type RiskStatus = keyof typeof RISK_STATUS;

export type RiskBand = "LOW" | "MODERATE" | "HIGH" | "EXTREME";
export const BAND_LABEL: Record<RiskBand, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", EXTREME: "Extreme" };
/** The longest a risk in each residual band should go between reviews. */
export const REVIEW_MONTHS: Record<RiskBand, number> = { LOW: 12, MODERATE: 6, HIGH: 3, EXTREME: 1 };

export function riskRating(likelihood: number, impact: number) {
  if (![likelihood, impact].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) throw new ValidationError("Likelihood and impact are scored from 1 to 5");
  return likelihood * impact;
}

export function riskBand(score: number): RiskBand {
  if (score >= 15) return "EXTREME";
  if (score >= 8) return "HIGH";
  if (score >= 4) return "MODERATE";
  return "LOW";
}

/** A risk that is not closed and whose review date has passed. */
export function riskReviewOverdue(r: { status: string; reviewDate: Date }, now = new Date()) {
  return r.status !== "CLOSED" && r.reviewDate < now;
}

const score = z.coerce.number().int().min(1, "Score from 1 to 5").max(5, "Score from 1 to 5");
const riskSchema = z.object({
  title: z.string().trim().min(5, "Give the risk a clear title (at least 5 characters)").max(160),
  description: z.string().trim().min(10, "Describe the risk: what could happen, and why (at least 10 characters)").max(4000),
  category: z.enum(Object.keys(RISK_CATEGORIES) as [RiskCategory, ...RiskCategory[]], { message: "Choose a category" }),
  branchId: z.string().trim().max(40).optional().transform((v) => v || null),
  likelihood: score,
  impact: score,
  existingControls: z.string().trim().min(5, "Describe the controls already in place, or write \"None\"").max(4000),
  controlEffectiveness: z.enum(Object.keys(CONTROL_EFFECTIVENESS) as [keyof typeof CONTROL_EFFECTIVENESS, ...(keyof typeof CONTROL_EFFECTIVENESS)[]]).default("NOT_ASSESSED"),
  residualLikelihood: score,
  residualImpact: score,
  ownerId: z.string().trim().min(1, "Choose who owns the risk"),
  reviewDate: z.coerce.date({ message: "Give a review date" }).refine((d) => !Number.isNaN(d.getTime()), "Give a review date"),
  findingId: z.string().trim().max(40).optional().transform((v) => v || null),
});
export type RiskInput = z.input<typeof riskSchema>;

/** The fields whose change is material: they need a reason, which is kept in the risk's history. */
const MATERIAL = ["likelihood", "impact", "residualLikelihood", "residualImpact", "controlEffectiveness", "ownerId", "branchId", "category"] as const;

function parse(input: RiskInput) {
  const p = riskSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the risk details");
  const d = p.data;
  if (d.residualLikelihood * d.residualImpact > d.likelihood * d.impact) throw new ValidationError("The residual rating (with controls) cannot be higher than the inherent rating (before controls)");
  return d;
}

/** Risks a branch-limited member may see: their branches' risks and organisation-wide ones. */
export function riskBranchWhere(ctx: Ctx): Prisma.ComplianceRiskWhereInput {
  return ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {};
}

async function checkScope(ctx: Ctx, orgId: string, d: { branchId: string | null; ownerId: string; findingId: string | null }) {
  if (d.branchId) {
    const b = await db.branch.findFirst({ where: { id: d.branchId, organisationId: orgId } });
    if (!b || (ctx.branchIds && !ctx.branchIds.includes(b.id))) throw new NotFoundError("Branch");
  } else if (ctx.branchIds) throw new ValidationError("Choose one of your branches for this risk");
  const owner = await db.membership.findUnique({ where: { userId_organisationId: { userId: d.ownerId, organisationId: orgId } } });
  if (!owner) throw new ValidationError("The owner must be a member of your organisation");
  if (d.findingId) {
    const f = await db.auditFinding.findFirst({ where: { id: d.findingId, organisationId: orgId } });
    if (!f) throw new NotFoundError("Finding");
  }
}

async function nextRef(tx: Prisma.TransactionClient, orgId: string) {
  // Serialise numbering within the organisation so two risks never take the same reference.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`risk-ref:${orgId}`}))`;
  const n = await tx.complianceRisk.count({ where: { organisationId: orgId } });
  return `R-${String(n + 1).padStart(3, "0")}`;
}

export async function createRisk(ctx: Ctx, input: RiskInput) {
  const orgId = requireOrgPermission(ctx, "risk.manage");
  const d = parse(input);
  await checkScope(ctx, orgId, d);
  const risk = await db.$transaction(async (tx) => {
    const ref = await nextRef(tx, orgId);
    const r = await tx.complianceRisk.create({ data: { ...d, organisationId: orgId, ref, createdById: ctx.userId } });
    await tx.riskEvent.create({ data: { riskId: r.id, actorId: ctx.userId, kind: "CREATED", note: "Risk recorded", changes: { inherent: d.likelihood * d.impact, residual: d.residualLikelihood * d.residualImpact } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "risk.created", entityType: "ComplianceRisk", entityId: r.id, data: { ref, residual: d.residualLikelihood * d.residualImpact } }, tx);
    return r;
  });
  if (risk.ownerId !== ctx.userId) {
    await notify({ organisationId: orgId, userIds: [risk.ownerId], type: "risk.assigned", title: `Risk assigned: ${risk.ref} ${risk.title}`, body: risk.description.slice(0, 280), reason: "You are the owner of this risk on the risk register.", links: [{ label: "Open the risk", url: `/compliance/risks/${risk.id}` }], actionUrl: `/compliance/risks/${risk.id}`, dueAt: risk.reviewDate, dedupeKey: `risk-assigned:${risk.id}:${risk.ownerId}` });
  }
  return risk;
}

async function visibleRisk(ctx: Ctx, orgId: string, id: string) {
  const r = await db.complianceRisk.findFirst({ where: { id, organisationId: orgId, ...riskBranchWhere(ctx) } });
  if (!r) throw new NotFoundError("Risk");
  return r;
}

/** Updates a risk. A change to its scores, controls, owner or scope is material and needs a reason; every change is kept. */
export async function updateRisk(ctx: Ctx, id: string, input: RiskInput & { reason?: string; expectedUpdatedAt?: string }) {
  const orgId = requireOrgPermission(ctx, "risk.manage");
  const before = await visibleRisk(ctx, orgId, id);
  if (before.status === "CLOSED") throw new ConflictError("This risk is closed. Reopen it before changing it.");
  if (input.expectedUpdatedAt && before.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictError("Someone else changed this risk while you were editing. Reload it and try again.");
  const d = parse(input);
  await checkScope(ctx, orgId, d);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ["title", "description", "existingControls", ...MATERIAL] as const) {
    if (before[k] !== d[k]) changes[k] = { from: before[k], to: d[k] };
  }
  if (before.reviewDate.getTime() !== d.reviewDate.getTime()) changes.reviewDate = { from: before.reviewDate.toISOString().slice(0, 10), to: d.reviewDate.toISOString().slice(0, 10) };
  if (!Object.keys(changes).length) throw new ValidationError("Nothing has changed");
  const material = MATERIAL.some((k) => k in changes);
  const reason = input.reason?.trim() ?? "";
  if (material && reason.length < 5) throw new ValidationError("Say why the rating, controls, owner or scope changed. The reason is kept in the risk's history.");
  return db.$transaction(async (tx) => {
    // Optimistic concurrency: the update only applies if nobody changed the risk since it was read.
    const res = await tx.complianceRisk.updateMany({ where: { id, updatedAt: before.updatedAt }, data: { title: d.title, description: d.description, category: d.category, branchId: d.branchId, likelihood: d.likelihood, impact: d.impact, existingControls: d.existingControls, controlEffectiveness: d.controlEffectiveness, residualLikelihood: d.residualLikelihood, residualImpact: d.residualImpact, ownerId: d.ownerId, reviewDate: d.reviewDate } });
    if (res.count !== 1) throw new ConflictError("Someone else changed this risk while you were editing. Reload it and try again.");
    await tx.riskEvent.create({ data: { riskId: id, actorId: ctx.userId, kind: "UPDATED", note: reason || null, changes: changes as Prisma.InputJsonValue } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "risk.updated", entityType: "ComplianceRisk", entityId: id, data: { fields: Object.keys(changes), material } }, tx);
    return tx.complianceRisk.findUniqueOrThrow({ where: { id } });
  });
}

const reviewSchema = z.object({
  note: z.string().trim().min(10, "Record what the review found (at least 10 characters)").max(4000),
  nextReviewDate: z.coerce.date({ message: "Set the next review date" }).refine((d) => !Number.isNaN(d.getTime()), "Set the next review date"),
  status: z.enum(["OPEN", "MONITORING"]).optional(),
});

/** A management review: who looked at the risk, what they found and when it is next due. */
export async function reviewRisk(ctx: Ctx, id: string, input: z.input<typeof reviewSchema>) {
  const orgId = requireOrgPermission(ctx, "risk.manage");
  const r = await visibleRisk(ctx, orgId, id);
  if (r.status === "CLOSED") throw new ConflictError("This risk is closed. Reopen it to review it.");
  const p = reviewSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the review");
  const now = new Date();
  if (p.data.nextReviewDate <= now) throw new ValidationError("The next review date must be in the future");
  const status = p.data.status ?? r.status;
  await db.$transaction(async (tx) => {
    await tx.complianceRisk.update({ where: { id }, data: { lastReviewedAt: now, lastReviewedById: ctx.userId, reviewDate: p.data.nextReviewDate, status } });
    await tx.riskEvent.create({ data: { riskId: id, actorId: ctx.userId, kind: "REVIEWED", note: p.data.note, changes: { nextReviewDate: p.data.nextReviewDate.toISOString().slice(0, 10), ...(status !== r.status ? { status: { from: r.status, to: status } } : {}) } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "risk.reviewed", entityType: "ComplianceRisk", entityId: id, data: { status } }, tx);
  });
}

/** Closes a risk. Risks with open mitigation actions stay open: the actions are finished (or verified) first. */
export async function closeRisk(ctx: Ctx, id: string, reason: string) {
  const orgId = requireOrgPermission(ctx, "risk.manage");
  const r = await visibleRisk(ctx, orgId, id);
  if (r.status === "CLOSED") throw new ConflictError("This risk is already closed");
  if (reason.trim().length < 10) throw new ValidationError("Say why the risk can be closed (at least 10 characters)");
  const open = await db.complianceAction.count({ where: { riskId: id, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] } } });
  if (open) throw new ConflictError(`${open} mitigation action${open === 1 ? " is" : "s are"} not yet verified. Verify or close ${open === 1 ? "it" : "them"} before closing the risk.`);
  await db.$transaction(async (tx) => {
    await tx.complianceRisk.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedReason: reason.trim() } });
    await tx.riskEvent.create({ data: { riskId: id, actorId: ctx.userId, kind: "CLOSED", note: reason.trim(), changes: { status: { from: r.status, to: "CLOSED" } } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "risk.closed", entityType: "ComplianceRisk", entityId: id }, tx);
  });
}

export async function reopenRisk(ctx: Ctx, id: string, reason: string) {
  const orgId = requireOrgPermission(ctx, "risk.manage");
  const r = await visibleRisk(ctx, orgId, id);
  if (r.status !== "CLOSED") throw new ConflictError("This risk is not closed");
  if (reason.trim().length < 5) throw new ValidationError("Say why the risk is being reopened");
  await db.$transaction(async (tx) => {
    await tx.complianceRisk.update({ where: { id }, data: { status: "OPEN", closedAt: null, closedReason: null } });
    await tx.riskEvent.create({ data: { riskId: id, actorId: ctx.userId, kind: "REOPENED", note: reason.trim(), changes: { status: { from: "CLOSED", to: "OPEN" } } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "risk.reopened", entityType: "ComplianceRisk", entityId: id }, tx);
  });
}

export interface RiskFilters { q?: string; status?: string; band?: string; category?: string; branch?: string; owner?: string; overdue?: boolean }

export function parseRiskFilters(sp: Record<string, string | undefined>): RiskFilters {
  const pick = (v: string | undefined, allowed: readonly string[]) => (v && allowed.includes(v) ? v : undefined);
  return {
    q: sp.q?.trim().slice(0, 100) || undefined,
    status: pick(sp.status, ["OPEN", "MONITORING", "CLOSED", "ALL"]),
    band: pick(sp.band, ["LOW", "MODERATE", "HIGH", "EXTREME", "HIGH_PLUS"]),
    category: pick(sp.category, Object.keys(RISK_CATEGORIES)),
    branch: sp.branch && /^[a-z0-9]{8,40}$/i.test(sp.branch) ? sp.branch : undefined,
    owner: sp.owner && /^[a-z0-9]{8,40}$/i.test(sp.owner) ? sp.owner : undefined,
    overdue: sp.overdue === "1",
  };
}

/** The register as the caller may see it, newest first within the highest residual rating. */
export async function listRisks(ctx: Ctx, f: RiskFilters = {}, now = new Date()) {
  const orgId = requireOrgPermission(ctx, "risk.view");
  const rows = await db.complianceRisk.findMany({
    where: {
      organisationId: orgId,
      ...riskBranchWhere(ctx),
      ...(f.status === "ALL" ? {} : f.status ? { status: f.status } : { status: { not: "CLOSED" } }),
      ...(f.category ? { category: f.category } : {}),
      ...(f.branch ? { branchId: f.branch } : {}),
      ...(f.owner ? { ownerId: f.owner } : {}),
      ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { ref: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    include: { actions: { select: { id: true, status: true, dueDate: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows
    .map((r) => {
      const inherent = r.likelihood * r.impact;
      const residual = r.residualLikelihood * r.residualImpact;
      return { ...r, inherent, residual, band: riskBand(residual), overdue: riskReviewOverdue(r, now), openActions: r.actions.filter((a) => ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(a.status)).length };
    })
    .filter((r) => (!f.band || r.band === f.band || (f.band === "HIGH_PLUS" && (r.band === "HIGH" || r.band === "EXTREME"))) && (!f.overdue || r.overdue))
    .sort((a, b) => b.residual - a.residual);
}

export async function getRisk(ctx: Ctx, id: string) {
  const orgId = requireOrgPermission(ctx, "risk.view");
  const r = await db.complianceRisk.findFirst({
    where: { id, organisationId: orgId, ...riskBranchWhere(ctx) },
    include: { events: { orderBy: { createdAt: "asc" } }, actions: { orderBy: { dueDate: "asc" } } },
  });
  if (!r) throw new NotFoundError("Risk");
  const finding = r.findingId ? await db.auditFinding.findFirst({ where: { id: r.findingId, organisationId: orgId }, include: { audit: { select: { id: true, title: true } } } }) : null;
  return { ...r, inherent: r.likelihood * r.impact, residual: r.residualLikelihood * r.residualImpact, finding };
}
