import type { AssignmentSlot, Prisma, RotaPlanDecision } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { assignInTx, isOverlapViolation } from "./assign";
import { optimise, timeGapProvider, type Booking, type Proposal, type SlotIn } from "./optimiser";
import { suName, visitCandidatesMany } from "./queries";
import { rotaScope, visitWhere, type Scope } from "./scope";
import { bulkVisits, updateVisitInTx } from "./visits";

/** Plans cover at most a week, so a run stays quick and a coordinator can read every change. */
export const MAX_PLAN_DAYS = 7;
export const DEFAULT_GAP_MINUTES = 10;
export const DEFAULT_MAX_SHIFT = 15;

export const planInputSchema = z.object({
  from: z.string().refine(isIsoDate, "Choose a start date"),
  days: z.coerce.number().int().min(1).max(MAX_PLAN_DAYS),
  areaId: z.string().optional().transform((v) => v || undefined),
  gapMinutes: z.coerce.number().int().min(0, "The gap cannot be negative").max(120, "Use a gap of 2 hours or less"),
  maxShiftMinutes: z.coerce.number().int().min(0).max(60, "Time adjustments are limited to an hour").refine((n) => n % 5 === 0, "Time adjustments go in steps of 5 minutes"),
  respectWeeklyLimits: z.boolean().default(true),
  /** Plan only these visits (chosen on Unassigned Visits). The dates then come from the visits themselves. */
  visitIds: z.array(z.string().min(1)).max(200).optional(),
});
export type PlanInput = z.input<typeof planInputSchema>;

export interface PlanSummary {
  openSlots: number;
  proposed: number;
  retimed: number;
  needsReview: number;
  viaSwap: number;
  unfilled: { visitId: string; slot: string; label: string; start: string; reason: string }[];
  checks: number;
  budgetSpent: boolean;
  passes: number;
  /** Set when the coordinator chose the visits to plan on Unassigned Visits. */
  chosenVisits?: number;
  ms: number;
  travelLabel: string;
}

const SLOTS: AssignmentSlot[] = ["PRIMARY", "SECOND"];

/**
 * Builds a plan for the open carer slots in a date range and saves it as a draft. Nothing on the rota changes here:
 * candidates come from the eligibility service, the pure optimiser chooses among them, and any proposed time change is
 * re-checked with the eligibility service at the new time before it is offered.
 */
/**
 * The dates for a plan of chosen visits: from the earliest (never before today) to the latest, at most a week apart.
 * Visits outside the member's scope are simply not found, so they cannot widen the plan.
 */
export async function datesForVisits(scope: Scope, visitIds: string[], today = londonDate()) {
  const visits = await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: visitIds }, status: "SCHEDULED", date: { gte: dbDate(today) } }] }, select: { date: true } });
  if (!visits.length) throw new ValidationError("Choose upcoming visits that still need a carer");
  const dates = visits.map((v) => fromDbDate(v.date)).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (days > MAX_PLAN_DAYS) throw new ValidationError(`Choose visits within ${MAX_PLAN_DAYS} days of each other`);
  return { from, days };
}

export async function generatePlan(ctx: Ctx, raw: PlanInput | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "rota.build");
  const pre = raw as { visitIds?: unknown };
  const chosen = Array.isArray(pre.visitIds) && pre.visitIds.length ? await datesForVisits(scope, pre.visitIds.filter((x): x is string => typeof x === "string")) : null;
  const input = planInputSchema.parse(chosen ? { ...raw, ...chosen } : raw);
  const t0 = Date.now();
  const to = addDays(input.from, input.days - 1);
  const now = new Date();
  if (input.areaId && !(await db.area.findFirst({ where: { id: input.areaId, organisationId: scope.organisationId } }))) throw new NotFoundError("Area");
  if (scope.areaIds && input.areaId && !scope.areaIds.includes(input.areaId)) throw new NotFoundError("Area");

  const visits = await db.visit.findMany({
    where: { AND: [visitWhere(scope), { status: "SCHEDULED", date: { gte: dbDate(input.from), lte: dbDate(to) }, scheduledStart: { gt: now }, ...(input.areaId ? { areaId: input.areaId } : {}), ...(input.visitIds?.length ? { id: { in: input.visitIds } } : {}) }] },
    include: { serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { slot: true, staffId: true, removedAt: true } } },
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
    take: 3000,
  });
  const open = visits.flatMap((v) => SLOTS.slice(0, Math.min(2, v.carersRequired)).filter((s) => !v.assignments.some((a) => a.slot === s)).map((slot) => ({ visit: v, slot })));
  const [lead, second] = await Promise.all((["PRIMARY", "SECOND"] as const).map((slot) => visitCandidatesMany(ctx, open.filter((o) => o.slot === slot))));

  const slots: SlotIn[] = open.map(({ visit: v, slot }) => ({
    visitId: v.id,
    slot: slot as "PRIMARY" | "SECOND",
    serviceUserId: v.serviceUserId,
    label: `${suName(v.serviceUser)} · ${v.callType.name}`,
    start: v.scheduledStart,
    end: v.scheduledEnd,
    fixedTime: v.timeLocked || v.assignments.length > 0,
    lockVersion: v.lockVersion,
    candidates: ((slot === "SECOND" ? second : lead).get(v.id) ?? [])
      .filter((c) => c.state !== "NOT_ELIGIBLE" && c.score !== null)
      .map((c) => ({ staffId: c.id, name: c.name, state: c.state as "ELIGIBLE" | "REQUIRES_REVIEW", score: c.score!, reasons: c.explain.map((e) => `${e.points > 0 ? "+" : ""}${e.points} ${e.text}`), warnings: c.state === "REQUIRES_REVIEW" ? c.reasons : [] })),
  }));

  // Live bookings and weekly hours for every carer who could be chosen, across the weeks the range touches.
  const staffIds = [...new Set(slots.flatMap((s) => s.candidates.map((c) => c.staffId)))];
  const weekStart = mondayOf(input.from);
  const weekEnd = addDays(mondayOf(to), 7);
  const [booked, profiles] = await Promise.all([
    db.visitAssignment.findMany({
      where: { organisationId: scope.organisationId, staffId: { in: staffIds }, removedAt: null, slot: { not: "SHADOW" }, startsAt: { gte: londonToUtc(weekStart, 0), lt: londonToUtc(weekEnd, 0) }, visit: { status: { not: "CANCELLED" } } },
      select: { staffId: true, visitId: true, startsAt: true, endsAt: true, visit: { select: { serviceUserId: true } } },
    }),
    db.rotaStaffProfile.findMany({ where: { organisationId: scope.organisationId, staffId: { in: staffIds } }, select: { staffId: true, maxWeeklyMinutes: true } }),
  ]);
  const weekOf = (d: Date) => mondayOf(londonDate(d));
  const bookings = new Map<string, Booking[]>();
  const weekMinutes = new Map<string, number>();
  for (const b of booked) {
    bookings.set(b.staffId, [...(bookings.get(b.staffId) ?? []), { visitId: b.visitId, serviceUserId: b.visit.serviceUserId, start: b.startsAt, end: b.endsAt, fixed: true }]);
    const k = `${b.staffId}|${weekOf(b.startsAt)}`;
    weekMinutes.set(k, (weekMinutes.get(k) ?? 0) + (b.endsAt.getTime() - b.startsAt.getTime()) / 60000);
  }
  const travel = timeGapProvider(input.gapMinutes);
  const result = optimise({ slots, bookings, weekMinutes, maxWeekly: new Map(profiles.map((p) => [p.staffId, p.maxWeeklyMinutes])), weekOf, travel, maxShiftMinutes: input.maxShiftMinutes, respectWeeklyLimits: input.respectWeeklyLimits });

  // A time change is offered only if the eligibility service still allows the carer at the new time.
  const proposals: Proposal[] = [];
  const unfilled = [...result.unfilled];
  for (const p of result.proposals) {
    if (p.retime) {
      const v = visits.find((x) => x.id === p.visitId)!;
      const careTaskIds = (await db.visitTask.findMany({ where: { visitId: v.id }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
      const r = await eligibilityFor(db, scope.organisationId, { staffId: p.staffId, start: p.retime.toStart, end: p.retime.toEnd, slot: p.slot, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, timeLocked: v.timeLocked, careTaskIds });
      if (r.state === "NOT_ELIGIBLE") {
        const s = slots.find((x) => x.visitId === p.visitId && x.slot === p.slot)!;
        unfilled.push({ visitId: s.visitId, slot: s.slot, label: s.label, start: s.start, reason: `Moving the visit would fit ${p.name}, but at the new time: ${r.blocking.map((b) => b.message).join("; ")}` });
        continue;
      }
    }
    proposals.push(p);
  }

  const summary: PlanSummary = {
    openSlots: slots.length,
    proposed: proposals.length,
    retimed: proposals.filter((p) => p.retime).length,
    needsReview: proposals.filter((p) => p.state === "REQUIRES_REVIEW").length,
    viaSwap: proposals.filter((p) => p.viaSwap).length,
    unfilled: unfilled.sort((a, b) => a.start.getTime() - b.start.getTime()).map((u) => ({ ...u, start: u.start.toISOString() })),
    checks: result.checks,
    budgetSpent: result.budgetSpent,
    passes: result.passes,
    ms: Date.now() - t0,
    travelLabel: travel.label,
    ...(input.visitIds?.length ? { chosenVisits: input.visitIds.length } : {}),
  };

  return db.$transaction(async (tx) => {
    const plan = await tx.rotaPlan.create({
      data: { organisationId: scope.organisationId, fromDate: dbDate(input.from), toDate: dbDate(to), areaId: input.areaId ?? null, mode: travel.mode, gapMinutes: input.gapMinutes, maxShiftMinutes: input.maxShiftMinutes, respectWeeklyLimits: input.respectWeeklyLimits, summary: summary as unknown as Prisma.InputJsonValue, createdById: ctx.userId },
    });
    let position = 0;
    const rows: Prisma.RotaPlanChangeCreateManyInput[] = [];
    for (const p of proposals) {
      if (p.retime && !rows.some((r) => r.visitId === p.visitId && r.kind === "RETIME")) {
        rows.push({ organisationId: scope.organisationId, planId: plan.id, position: position++, visitId: p.visitId, kind: "RETIME", fromStart: p.retime.fromStart, fromEnd: p.retime.fromEnd, toStart: p.retime.toStart, toEnd: p.retime.toEnd, visitLockVersion: p.lockVersion, reasons: [`Moves the visit ${Math.round((p.retime.toStart.getTime() - p.retime.fromStart.getTime()) / 60000)} minutes so ${p.name} can do it`] });
      }
      rows.push({ organisationId: scope.organisationId, planId: plan.id, position: position++, visitId: p.visitId, kind: "ASSIGN", slot: p.slot, staffId: p.staffId, eligibility: p.state, score: p.score, reasons: [...p.reasons, ...(p.viaSwap ? ["Found by moving another proposed booking to a different carer"] : [])], warnings: p.warnings, visitLockVersion: p.lockVersion });
    }
    if (rows.length) await tx.rotaPlanChange.createMany({ data: rows });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.plan.generated", entityType: "RotaPlan", entityId: plan.id, data: { from: input.from, to, openSlots: summary.openSlots, proposed: summary.proposed, retimed: summary.retimed } }, tx);
    return plan;
  });
}

async function loadPlanRow(scope: Scope, planId: string) {
  const plan = await db.rotaPlan.findFirst({ where: { id: planId, organisationId: scope.organisationId } });
  if (!plan) throw new NotFoundError("Plan");
  return plan;
}

/** A plan with its changes, limited to the visits the member may see. */
export async function getPlan(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const plan = await loadPlanRow(scope, planId);
  const changes = await db.rotaPlanChange.findMany({ where: { planId: plan.id, organisationId: scope.organisationId }, orderBy: { position: "asc" } });
  const visible = await db.visit.findMany({
    where: { AND: [visitWhere(scope), { id: { in: [...new Set(changes.map((c) => c.visitId))] } }] },
    select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, lockVersion: true, status: true, publishedAt: true, carersRequired: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } }, area: { select: { name: true, colour: true } } },
  });
  const byId = new Map(visible.map((v) => [v.id, v]));
  const summary = plan.summary as unknown as PlanSummary;
  const openIds = new Set(
    (await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: (summary.unfilled ?? []).map((u) => u.visitId) } }] }, select: { id: true } })).map((v) => v.id),
  );
  const staff = await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: changes.map((c) => c.staffId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
  const names = new Map(staff.map((s) => [s.id, s.displayName]));
  return {
    plan,
    summary: { ...summary, unfilled: (summary.unfilled ?? []).filter((u) => openIds.has(u.visitId)) },
    changes: changes.filter((c) => byId.has(c.visitId)).map((c) => ({ ...c, visit: byId.get(c.visitId)!, staffName: c.staffId ? names.get(c.staffId) ?? "Unknown" : null, stale: byId.get(c.visitId)!.lockVersion !== c.visitLockVersion && ["PENDING", "ACCEPTED"].includes(c.decision) })),
  };
}

export async function listPlans(ctx: Ctx, take = 10) {
  const scope = await rotaScope(ctx, "rota.view");
  return db.rotaPlan.findMany({ where: { organisationId: scope.organisationId }, orderBy: { createdAt: "desc" }, take });
}

/** Accept or reject changes on a draft plan. Rejecting a time change rejects the carer change that depends on it. */
export async function decideChanges(ctx: Ctx, planId: string, changeIds: string[] | "ALL" | "ALL_CLEAN", decision: "ACCEPTED" | "REJECTED" | "PENDING") {
  const scope = await rotaScope(ctx, "rota.build");
  return db.$transaction(async (tx) => {
    const plan = await tx.rotaPlan.findFirst({ where: { id: planId, organisationId: scope.organisationId } });
    if (!plan) throw new NotFoundError("Plan");
    if (plan.status !== "DRAFT") throw new ValidationError("This plan has already been applied or discarded");
    const all = await tx.rotaPlanChange.findMany({ where: { planId, organisationId: scope.organisationId } });
    const open = all.filter((c) => ["PENDING", "ACCEPTED", "REJECTED"].includes(c.decision));
    // "ALL_CLEAN": every carer change that passes every check with no warnings, and is not on a moved visit.
    const picked =
      changeIds === "ALL" ? open : changeIds === "ALL_CLEAN" ? open.filter((c) => c.kind === "ASSIGN" && c.eligibility === "ELIGIBLE" && !all.some((d) => d.visitId === c.visitId && d.kind === "RETIME")) : open.filter((c) => changeIds.includes(c.id));
    const ids = new Set(picked.map((c) => c.id));
    // A carer change on a moved visit depends on the move: they are accepted or rejected together.
    for (const c of all) {
      if (!ids.has(c.id)) continue;
      for (const d of all) if (d.visitId === c.visitId && d.kind !== c.kind && (c.kind === "RETIME" || d.kind === "RETIME")) ids.add(d.id);
    }
    if (!ids.size) throw new ValidationError("Choose at least one change");
    const r = await tx.rotaPlanChange.updateMany({ where: { id: { in: [...ids] }, planId }, data: { decision, decidedById: ctx.userId, decidedAt: new Date() } });
    return r.count;
  });
}

export interface ApplyResult {
  applied: number;
  failed: number;
  visitIds: string[];
}

/**
 * Applies the accepted changes, each visit in its own transaction through the normal paths (updateVisitInTx for a
 * time change, assignInTx for a carer), so every eligibility, scope and double-booking rule runs again at the moment of
 * change. A visit that changed since the plan was made is left alone and reported.
 */
export async function applyPlan(ctx: Ctx, planId: string): Promise<ApplyResult> {
  const scope = await rotaScope(ctx, "rota.build");
  const plan = await loadPlanRow(scope, planId);
  if (plan.status !== "DRAFT") throw new ValidationError("This plan has already been applied or discarded");
  const claimed = await db.rotaPlan.updateMany({ where: { id: plan.id, status: "DRAFT" }, data: { status: "APPLIED", appliedById: ctx.userId, appliedAt: new Date() } });
  if (!claimed.count) throw new ConflictError("Someone else applied or discarded this plan just now");
  const accepted = await db.rotaPlanChange.findMany({ where: { planId: plan.id, decision: "ACCEPTED" }, orderBy: { position: "asc" } });
  const byVisit = new Map<string, typeof accepted>();
  for (const c of accepted) byVisit.set(c.visitId, [...(byVisit.get(c.visitId) ?? []), c]);

  const out: ApplyResult = { applied: 0, failed: 0, visitIds: [] };
  for (const [visitId, list] of byVisit) {
    const outcomes = new Map<string, { decision: RotaPlanDecision; outcome: string }>();
    try {
      await db.$transaction(
        async (tx) => {
          let lockVersion: number | undefined = list[0]!.visitLockVersion;
          for (const c of list.sort((a, b) => (a.kind === "RETIME" ? -1 : b.kind === "RETIME" ? 1 : a.position - b.position))) {
            if (c.kind === "RETIME") {
              await updateVisitInTx(tx, scope, ctx.userId, visitId, { scheduledStart: c.toStart!, scheduledEnd: c.toEnd! }, { source: "optimiser", lockVersion });
            } else {
              await assignInTx(tx, scope, ctx.userId, { visitId, slot: c.slot!, staffId: c.staffId!, acceptWarnings: c.eligibility === "REQUIRES_REVIEW", lockVersion }, { source: "optimiser" });
            }
            lockVersion = undefined; // the visit is now row-locked by this transaction
            outcomes.set(c.id, { decision: "APPLIED", outcome: c.kind === "RETIME" ? "Time changed" : "Carer booked" });
          }
        },
        { timeout: 20_000 },
      );
      out.applied += list.length;
      out.visitIds.push(visitId);
    } catch (e) {
      const msg = isOverlapViolation(e) ? "The carer was booked elsewhere at this time after the plan was made" : e instanceof AppError ? e.message : "Could not be applied. The error has been logged.";
      if (!isOverlapViolation(e) && !(e instanceof AppError)) logger.error({ err: (e as Error).message }, "rota plan change failed");
      for (const c of list) outcomes.set(c.id, { decision: "FAILED", outcome: msg });
      out.failed += list.length;
    }
    for (const [id, o] of outcomes) await db.rotaPlanChange.update({ where: { id }, data: o });
  }
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.plan.applied", entityType: "RotaPlan", entityId: plan.id, data: { applied: out.applied, failed: out.failed } });
  return out;
}

export async function discardPlan(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "rota.build");
  const plan = await loadPlanRow(scope, planId);
  const r = await db.rotaPlan.updateMany({ where: { id: plan.id, status: "DRAFT" }, data: { status: "DISCARDED", discardedById: ctx.userId, discardedAt: new Date() } });
  if (!r.count) throw new ValidationError("This plan has already been applied or discarded");
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.plan.discarded", entityType: "RotaPlan", entityId: plan.id });
}

/** Publishes the draft visits an applied plan touched, so carers see them. */
export async function publishPlanVisits(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "rota.build");
  const plan = await loadPlanRow(scope, planId);
  if (plan.status !== "APPLIED") throw new ValidationError("Apply the plan before publishing");
  const ids = [...new Set((await db.rotaPlanChange.findMany({ where: { planId: plan.id, decision: "APPLIED" }, select: { visitId: true } })).map((c) => c.visitId))];
  const drafts = await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: ids }, publishedAt: null, status: "SCHEDULED" }] }, select: { id: true } });
  if (!drafts.length) return { published: 0, failed: 0 };
  const r = await bulkVisits(ctx, drafts.map((d) => d.id), { kind: "publish" });
  return { published: r.filter((x) => x.ok).length, failed: r.filter((x) => !x.ok).length };
}

/** The plan's date range as ISO dates, for display. */
export function planRange(plan: { fromDate: Date; toDate: Date }) {
  return { from: fromDbDate(plan.fromDate), to: fromDbDate(plan.toDate) };
}
