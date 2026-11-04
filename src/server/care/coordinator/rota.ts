import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { confirmServiceUserRota, previewServiceUserRota } from "@/server/rota/build";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { rankCarersMany } from "@/server/workforce/eligibility";
import { setServiceUserStatus } from "../service-users";
import { coordinatorAccess, intakeInScope } from "./intake";

/**
 * The last step of an intake: an unpublished rota built by the existing Build Rota engine (one build per week, the same
 * locks, duplicate checks, absences and carer eligibility), then allocation proposals for the open places.
 *
 *  - Only after the safety records are in place: the care package and visits saved, a care plan approved by a
 *    different person, and every risk draft reviewed with at least one active assessment.
 *  - Only a manager (care.plan.approve and rota.build) activates care and creates the visits.
 *  - Visits are never published and carers are never told from here. Proposals are suggestions; the office assigns
 *    through the usual screens, where every assignment goes through the eligibility service.
 */

export async function rotaReadiness(ctx: Ctx, intakeId: string) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const intake = await intakeInScope(db, scope, intakeId);
  const su = intake.serviceUserId ? await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId }, select: { id: true, status: true, firstName: true, lastName: true } }) : null;
  const sections = await db.careIntakeSection.findMany({ where: { intakeId }, select: { section: true, applyStatus: true, status: true } });
  const done = (k: string) => sections.find((s) => s.section === k)?.applyStatus === "DONE";
  const [activePlan, planInReview, draftRisks, activeRisks, templates, pkg] = su
    ? await Promise.all([
        db.carePlan.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" }, select: { id: true, version: true } }),
        db.carePlan.findFirst({ where: { serviceUserId: su.id, status: { in: ["DRAFT", "IN_REVIEW"] } }, select: { id: true, status: true, version: true } }),
        db.riskAssessment.count({ where: { serviceUserId: su.id, status: "DRAFT" } }),
        db.riskAssessment.count({ where: { serviceUserId: su.id, status: "ACTIVE" } }),
        db.visitTemplate.count({ where: { serviceUserId: su.id, enabled: true } }),
        db.carePackage.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" }, select: { id: true } }),
      ])
    : [null, null, 0, 0, 0, null];
  const gates = [
    { key: "person", label: "Person on record", ok: !!su && su.status !== "ENDED", detail: su ? `Status: ${su.status.toLowerCase()}` : "Save Personal details first" },
    { key: "package", label: "Care package saved", ok: !!pkg && (done("PACKAGE") || intake.mode === "EXISTING"), detail: pkg ? "Active package on record" : "Save the approved care package" },
    { key: "visits", label: "Repeating visits saved", ok: templates > 0 && (done("VISITS") || intake.mode === "EXISTING"), detail: `${templates} active template${templates === 1 ? "" : "s"}` },
    { key: "careplan", label: "Care plan approved by a different person", ok: !!activePlan, detail: activePlan ? `Version ${activePlan.version} is approved` : planInReview ? `Version ${planInReview.version} is ${planInReview.status === "DRAFT" ? "a draft: submit it on the Care tab" : "waiting for approval"}` : "No approved care plan" },
    { key: "risks", label: "Risk drafts reviewed by an assessor", ok: draftRisks === 0 && activeRisks > 0, detail: draftRisks ? `${draftRisks} draft${draftRisks === 1 ? "" : "s"} still waiting for review` : activeRisks ? `${activeRisks} active assessment${activeRisks === 1 ? "" : "s"}` : "No active risk assessment" },
  ];
  return { intake, serviceUser: su, gates, ready: gates.every((g) => g.ok), active: su?.status === "ACTIVE", canBuild: hasOrgPermission(ctx, "care.plan.approve") && hasOrgPermission(ctx, "rota.build") };
}

async function requireReady(ctx: Ctx, intakeId: string) {
  const r = await rotaReadiness(ctx, intakeId);
  if (!r.canBuild) throw new ForbiddenError("A care manager or administrator creates the rota from an intake");
  if (!r.ready) throw new ValidationError(`Not ready for the rota yet: ${r.gates.filter((g) => !g.ok).map((g) => `${g.label.toLowerCase()} (${g.detail})`).join("; ")}`);
  return r;
}

/** Moves the person from Assessment to Active so Build Rota schedules their visits. Recorded with the intake. */
export async function activateCare(ctx: Ctx, intakeId: string) {
  const r = await requireReady(ctx, intakeId);
  if (r.active) return { already: true };
  if (r.serviceUser!.status !== "ASSESSMENT" && r.serviceUser!.status !== "ENQUIRY") throw new ConflictError(`Care is ${r.serviceUser!.status.toLowerCase()}; change it on the person's profile`);
  await setServiceUserStatus(ctx, r.serviceUser!.id, "ACTIVE", `Care Coordinator intake ${r.intake.reference}: care plan approved and risks reviewed`);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.care.activated", entityType: "CareIntake", entityId: intakeId, data: { serviceUserId: r.serviceUser!.id } });
  return { already: false };
}

function weeksInput(weekStart: string, weeks: number) {
  const ws = mondayOf(weekStart);
  if (ws < mondayOf(londonDate())) throw new ValidationError("Choose this week or a later week");
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) throw new ValidationError("Choose between 1 and 8 weeks");
  return { weekStart: ws, weeks };
}

export async function previewIntakeRota(ctx: Ctx, intakeId: string, weekStart: string, weeks: number) {
  const r = await requireReady(ctx, intakeId);
  if (!r.active) throw new ValidationError("Activate care first, so Build Rota includes the person");
  return previewServiceUserRota(ctx, r.serviceUser!.id, weeksInput(weekStart, weeks));
}

/** Creates the previewed visits, unpublished. If anything changed since the preview, nothing is created. */
export async function createIntakeRota(ctx: Ctx, intakeId: string, input: { weekStart: string; weeks: number; fingerprint: string }) {
  const r = await requireReady(ctx, intakeId);
  if (!r.active) throw new ValidationError("Activate care first, so Build Rota includes the person");
  const w = weeksInput(input.weekStart, input.weeks);
  const result = await confirmServiceUserRota(ctx, r.serviceUser!.id, { ...w, fingerprint: input.fingerprint, publish: false });
  const scope = await rotaScope(ctx, "rota.build");
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.rota.created", entityType: "CareIntake", entityId: intakeId, data: { serviceUserId: r.serviceUser!.id, weekStart: w.weekStart, weeks: w.weeks, visits: result.visits, builds: result.builds, unassignedSlots: result.unassignedSlots, published: 0 } });
  return result;
}

/**
 * Up to three carers per open place on the person's unpublished visits, ranked by the eligibility service (availability,
 * double bookings, travel, training and competency, DBS and right to work, restrictions, the person's preferences),
 * with continuity: carers who already visit the person come first among equals. Suggestions only.
 */
export async function staffingProposals(ctx: Ctx, intakeId: string, from = londonDate(), days = 14) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "rota.edit");
  const intake = await intakeInScope(db, scope, intakeId);
  if (!intake.serviceUserId) return [];
  const visits = await db.visit.findMany({
    where: { organisationId: scope.organisationId, serviceUserId: intake.serviceUserId, status: "SCHEDULED", date: { gte: dbDate(from), lte: dbDate(addDays(from, days)) } },
    include: { assignments: { where: { removedAt: null }, select: { staffId: true, slot: true } }, callType: { select: { name: true } }, tasks: { select: { careTaskId: true } } },
    orderBy: { scheduledStart: "asc" },
    take: 60,
  });
  const open = visits.filter((v) => v.assignments.filter((a) => a.slot !== "SHADOW").length < v.carersRequired);
  if (!open.length) return [];
  const ranked = await rankCarersMany(db, scope.organisationId, open.map((v) => ({ start: v.scheduledStart, end: v.scheduledEnd, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds: v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x), otherSlotStaffIds: v.assignments.map((a) => a.staffId) })));
  const regulars = new Set((await db.visitAssignment.findMany({ where: { organisationId: scope.organisationId, removedAt: null, visit: { serviceUserId: intake.serviceUserId, date: { gte: dbDate(addDays(from, -42)) } } }, select: { staffId: true }, distinct: ["staffId"] })).map((a) => a.staffId));
  return open.map((v, i) => {
    const options = (ranked[i] ?? [])
      .filter((x) => x.result.state !== "NOT_ELIGIBLE" && !v.assignments.some((a) => a.staffId === x.staff!.id))
      .sort((a, b) => (a.result.state === b.result.state ? Number(regulars.has(b.staff!.id)) - Number(regulars.has(a.staff!.id)) : 0))
      .slice(0, 3)
      .map((x) => ({ staffId: x.staff!.id, name: x.staff!.displayName, state: x.result.state, continuity: regulars.has(x.staff!.id), warnings: [...x.result.warnings, ...x.result.advice].map((w) => w.message).slice(0, 3) }));
    return { visitId: v.id, reference: v.reference, start: v.scheduledStart, end: v.scheduledEnd, callType: v.callType.name, open: v.carersRequired - v.assignments.filter((a) => a.slot !== "SHADOW").length, published: !!v.publishedAt, options };
  });
}
