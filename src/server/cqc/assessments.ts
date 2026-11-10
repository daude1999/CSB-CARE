import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate } from "@/lib/london";
import { audit } from "../audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { createAction, ACTION_PRIORITIES } from "../compliance/audits";
import { notify } from "../notifications/notify";
import { assertMember, branchScope, checkBranch, isUniqueViolation, membersWithRoles, nextReference, startOfToday, type Json } from "./common";
import { activeFramework, frameworkCriteria } from "./framework";
import { linksFor } from "./evidence";
import { KEY_QUESTIONS, scoreReadiness, SCORING_METHOD, type CriterionInput, type KeyQuestion } from "./scoring";

/**
 * CQC readiness assessments: an authorised manager picks a branch and service, works through each key question's
 * assessment areas recording a result and rationale, reviews the linked evidence, raises improvement actions, and
 * submits; a different authorised person approves. Every result change is kept in the audit log with its old and new
 * values. Approving freezes the assessment and saves a dated readiness snapshot.
 */
export const ASSESSMENT_STATUS = { IN_PROGRESS: "In progress", AWAITING_APPROVAL: "Awaiting approval", APPROVED: "Approved", SUPERSEDED: "Superseded" } as const;
export const RESULTS = ["MET", "PARTIALLY_MET", "NOT_MET", "NOT_APPLICABLE"] as const;
const OPEN_ACTION = ["OPEN", "IN_PROGRESS", "COMPLETED"];

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  branchId: z.string().optional(),
  serviceTypeCode: z.string().optional(),
  periodFrom: z.string().refine(isIsoDate, "Choose the start of the assessment period"),
  periodTo: z.string().refine(isIsoDate, "Choose the end of the assessment period"),
  nextDueAt: z.string().optional(),
  copyFromId: z.string().optional(),
});

export function assessmentScopeWhere(ctx: Ctx) {
  return branchScope(ctx);
}

export async function listAssessments(ctx: Ctx, f: { branchId?: string; status?: string; assessorId?: string } = {}) {
  const organisationId = requireOrgPermission(ctx, "cqc.view");
  return db.cqcAssessment.findMany({
    where: { organisationId, AND: [assessmentScopeWhere(ctx)], ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.status && f.status in ASSESSMENT_STATUS ? { status: f.status } : {}), ...(f.assessorId ? { assessorId: f.assessorId } : {}) },
    include: { framework: { select: { version: true } }, _count: { select: { results: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
}

export async function createAssessment(ctx: Ctx, raw: z.input<typeof createSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const p = createSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the assessment details");
  const d = p.data;
  if (d.periodTo < d.periodFrom) throw new ValidationError("The period must end after it starts");
  if (d.nextDueAt && !isIsoDate(d.nextDueAt)) throw new ValidationError("Choose a valid next due date");
  const branchId = await checkBranch(ctx, organisationId, d.branchId || null);
  let serviceTypeCode: string | null = null;
  if (d.serviceTypeCode) {
    const offered = await db.branchServiceType.findFirst({ where: { serviceTypeCode: d.serviceTypeCode, branch: { organisationId, ...(branchId ? { id: branchId } : {}) } } });
    if (!offered) throw new ValidationError(branchId ? "That branch does not offer this service" : "Your organisation does not offer this service");
    serviceTypeCode = d.serviceTypeCode;
  }
  const fw = await activeFramework();
  const previous = d.copyFromId ? await db.cqcAssessment.findFirst({ where: { id: d.copyFromId, organisationId, AND: [assessmentScopeWhere(ctx)] }, include: { results: true } }) : null;
  if (d.copyFromId && !previous) throw new NotFoundError("Previous assessment");
  const branchName = branchId ? (await db.branch.findUnique({ where: { id: branchId }, select: { name: true } }))?.name : null;
  const title = d.title || `${branchName ?? "Whole organisation"} readiness ${d.periodFrom.slice(0, 7)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const reference = await nextReference(tx, "CQC", organisationId);
        const a = await tx.cqcAssessment.create({ data: { organisationId, reference, title, branchId, serviceTypeCode, frameworkId: fw.id, periodFrom: new Date(`${d.periodFrom}T00:00:00Z`), periodTo: new Date(`${d.periodTo}T00:00:00Z`), nextDueAt: d.nextDueAt ? new Date(`${d.nextDueAt}T00:00:00Z`) : null, assessorId: ctx.userId, previousId: previous?.id ?? null } });
        // A reassessment starts from the previous results (same framework only), each re-recorded under this assessment.
        if (previous && previous.frameworkId === fw.id && previous.results.length) {
          await tx.cqcAssessmentResult.createMany({ data: previous.results.map((r) => ({ organisationId, assessmentId: a.id, criterionId: r.criterionId, result: r.result, rationale: r.rationale, findings: r.findings, naReason: r.naReason, recordedById: ctx.userId })) });
        }
        await audit({ organisationId, actorId: ctx.userId, action: "cqc.assessment.created", entityType: "CqcAssessment", entityId: a.id, data: { reference, branchId, serviceTypeCode, framework: fw.version, copiedFrom: previous?.reference ?? null } }, tx);
        return a;
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
}

async function loadAssessment(ctx: Ctx, organisationId: string, id: string) {
  const a = await db.cqcAssessment.findFirst({ where: { id, organisationId, AND: [assessmentScopeWhere(ctx)] }, include: { framework: true } });
  if (!a) throw new NotFoundError("Assessment");
  return a;
}

/** Live readiness for an assessment, worked out from current records in the assessment's branch. */
export async function computeReadiness(ctx: Ctx, organisationId: string, a: { id: string; frameworkId: string; branchId: string | null }, now = new Date()) {
  const [criteria, results, links, overdue] = await Promise.all([
    frameworkCriteria(a.frameworkId),
    db.cqcAssessmentResult.findMany({ where: { assessmentId: a.id } }),
    linksFor(ctx, organisationId, { branchId: a.branchId }, now),
    db.complianceAction.groupBy({ by: ["cqcCriterionId"], where: { organisationId, cqcCriterionId: { not: null }, status: { in: OPEN_ACTION }, dueDate: { lt: startOfToday() }, cqcAssessment: { branchId: a.branchId } }, _count: { _all: true } }),
  ]);
  const resultBy = new Map(results.map((r) => [r.criterionId, r]));
  const verified = new Map<string, number>();
  for (const l of links) if (l.effective === "VERIFIED") verified.set(l.criterionId, (verified.get(l.criterionId) ?? 0) + 1);
  const overdueBy = new Map(overdue.map((o) => [o.cqcCriterionId!, o._count._all]));
  const inputs: CriterionInput[] = criteria.map((c) => ({ id: c.id, keyQuestion: c.keyQuestion as KeyQuestion, essential: c.essential, result: (resultBy.get(c.id)?.result as CriterionInput["result"]) ?? null, verifiedEvidence: verified.get(c.id) ?? 0, overdueActions: overdueBy.get(c.id) ?? 0 }));
  return { criteria, results: resultBy, links, readiness: scoreReadiness(inputs) };
}

/** One assessment with its areas, results, evidence, actions, live readiness and history. */
export async function getAssessment(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "cqc.view");
  const a = await loadAssessment(ctx, organisationId, id);
  const live = await computeReadiness(ctx, organisationId, a);
  const [actions, snapshots, history, branch] = await Promise.all([
    db.complianceAction.findMany({ where: { organisationId, cqcAssessmentId: a.id }, orderBy: { dueDate: "asc" } }),
    db.cqcReadinessSnapshot.findMany({ where: { organisationId, assessmentId: a.id }, orderBy: { takenAt: "desc" } }),
    db.auditLog.findMany({ where: { organisationId, entityType: "CqcAssessment", entityId: a.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    a.branchId ? db.branch.findUnique({ where: { id: a.branchId }, select: { name: true } }) : null,
  ]);
  const serviceType = a.serviceTypeCode ? await db.serviceType.findUnique({ where: { code: a.serviceTypeCode }, select: { name: true } }) : null;
  return {
    assessment: a,
    branchName: branch?.name ?? "Whole organisation",
    serviceName: serviceType?.name ?? "All services",
    ...live,
    actions,
    snapshots,
    history,
    canEdit: a.status === "IN_PROGRESS" && hasOrgPermission(ctx, "cqc.assess"),
    canApprove: a.status === "AWAITING_APPROVAL" && hasOrgPermission(ctx, "cqc.approve") && a.assessorId !== ctx.userId,
  };
}

const resultSchema = z.object({
  result: z.enum(RESULTS, { message: "Choose Met, Partially met, Not met or Not applicable" }),
  rationale: z.string().trim().min(10, "Give the rationale for the result (what you saw and why)").max(4000),
  findings: z.string().trim().max(4000).optional(),
  naReason: z.string().trim().max(1000).optional(),
  expectedVersion: z.coerce.number<number>().int().optional(),
});

export async function recordResult(ctx: Ctx, assessmentId: string, criterionId: string, raw: z.input<typeof resultSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const p = resultSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the result");
  const d = p.data;
  if (d.result === "NOT_APPLICABLE" && (d.naReason ?? "").length < 10) throw new ValidationError("Say why this area does not apply to this service");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  if (a.status !== "IN_PROGRESS") throw new ConflictError("This assessment is no longer in progress. Start a reassessment to change results.");
  const c = await db.cqcCriterion.findFirst({ where: { id: criterionId, frameworkId: a.frameworkId } });
  if (!c) throw new NotFoundError("Assessment area");
  return db.$transaction(async (tx) => {
    const prev = await tx.cqcAssessmentResult.findUnique({ where: { assessmentId_criterionId: { assessmentId, criterionId } } });
    if (prev && d.expectedVersion !== undefined && prev.version !== d.expectedVersion) throw new ConflictError("Someone else changed this result since you opened it. Reload to see their result.");
    const data = { result: d.result, rationale: d.rationale, findings: d.findings || null, naReason: d.result === "NOT_APPLICABLE" ? d.naReason! : null, recordedById: ctx.userId, recordedAt: new Date() };
    let row;
    if (prev) {
      const { count } = await tx.cqcAssessmentResult.updateMany({ where: { id: prev.id, version: prev.version }, data: { ...data, version: { increment: 1 } } });
      if (!count) throw new ConflictError("Someone else changed this result since you opened it. Reload to see their result.");
      row = await tx.cqcAssessmentResult.findUniqueOrThrow({ where: { id: prev.id } });
    } else {
      row = await tx.cqcAssessmentResult.create({ data: { ...data, organisationId, assessmentId, criterionId } });
    }
    await tx.cqcAssessment.update({ where: { id: a.id }, data: { lockVersion: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "cqc.result.recorded", entityType: "CqcAssessment", entityId: a.id, data: { criterion: c.code, from: prev ? { result: prev.result, rationale: prev.rationale, naReason: prev.naReason } : null, to: { result: d.result, rationale: d.rationale, naReason: data.naReason } } }, tx);
    return row;
  });
}

export async function updateAssessmentComment(ctx: Ctx, assessmentId: string, input: { managementComment: string; nextDueAt?: string }) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  if (a.status !== "IN_PROGRESS") throw new ConflictError("This assessment is no longer in progress");
  if (input.nextDueAt && !isIsoDate(input.nextDueAt)) throw new ValidationError("Choose a valid next due date");
  await db.cqcAssessment.update({ where: { id: a.id }, data: { managementComment: input.managementComment.trim().slice(0, 4000) || null, ...(input.nextDueAt ? { nextDueAt: new Date(`${input.nextDueAt}T00:00:00Z`) } : {}) } });
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.assessment.comment", entityType: "CqcAssessment", entityId: a.id, data: { from: a.managementComment, to: input.managementComment.trim() || null, nextDueAt: input.nextDueAt ?? null } });
}

export async function submitAssessment(ctx: Ctx, assessmentId: string, expectedLock?: number) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  if (a.status !== "IN_PROGRESS") throw new ConflictError("Only an assessment in progress can be submitted");
  const [criteria, results] = await Promise.all([db.cqcCriterion.count({ where: { frameworkId: a.frameworkId } }), db.cqcAssessmentResult.count({ where: { assessmentId } })]);
  if (results < criteria) throw new ValidationError(`${criteria - results} of ${criteria} areas have no result yet. Record a result (or Not applicable with a reason) for every area before submitting.`);
  const { count } = await db.cqcAssessment.updateMany({ where: { id: a.id, status: "IN_PROGRESS", ...(expectedLock !== undefined ? { lockVersion: expectedLock } : {}) }, data: { status: "AWAITING_APPROVAL", submittedAt: new Date(), returnedReason: null, lockVersion: { increment: 1 } } });
  if (!count) throw new ConflictError("The assessment changed since you opened it. Reload and check before submitting.");
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.assessment.submitted", entityType: "CqcAssessment", entityId: a.id, data: { from: "IN_PROGRESS", to: "AWAITING_APPROVAL" } });
  const approvers = (await membersWithRoles(organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "POLICY_APPROVER"])).map((m) => m.id).filter((id) => id !== ctx.userId);
  await notify({ organisationId, userIds: approvers, type: "cqc.assessment.approval", title: `${a.reference} needs approval`, body: `CQC readiness assessment ${a.reference} has been submitted for approval.`, reason: "You can approve internal CQC readiness assessments.", links: [{ label: "Open the assessment", url: `/compliance/cqc/assessments/${a.id}` }], actionUrl: `/compliance/cqc/assessments/${a.id}`, dedupeKey: `cqc-approval:${a.id}:${a.lockVersion + 1}` });
}

/** Approve (freezes it, saves a snapshot, supersedes the previous approved one for the same scope) or return with a reason. */
export async function decideAssessment(ctx: Ctx, assessmentId: string, input: { decision: "APPROVE" | "RETURN"; note: string; expectedLock?: number }) {
  const organisationId = requireOrgPermission(ctx, "cqc.approve");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  if (a.status !== "AWAITING_APPROVAL") throw new ConflictError("This assessment is not awaiting approval");
  if (a.assessorId === ctx.userId) throw new ForbiddenError("You assessed this, so another person must approve it");
  const note = input.note.trim();
  if (input.decision === "RETURN" && note.length < 5) throw new ValidationError("Say what needs to change");
  const live = input.decision === "APPROVE" ? await computeReadiness(ctx, organisationId, a) : null;
  await db.$transaction(async (tx) => {
    const { count } = await tx.cqcAssessment.updateMany({ where: { id: a.id, status: "AWAITING_APPROVAL", ...(input.expectedLock !== undefined ? { lockVersion: input.expectedLock } : {}) }, data: input.decision === "APPROVE" ? { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(), lockVersion: { increment: 1 } } : { status: "IN_PROGRESS", returnedReason: note, lockVersion: { increment: 1 } } });
    if (!count) throw new ConflictError("The assessment changed since you opened it. Reload before deciding.");
    if (input.decision === "APPROVE") {
      await tx.cqcAssessment.updateMany({ where: { organisationId, id: { not: a.id }, status: "APPROVED", branchId: a.branchId, serviceTypeCode: a.serviceTypeCode }, data: { status: "SUPERSEDED" } });
      await tx.cqcReadinessSnapshot.create({ data: snapshotData(organisationId, a, live!.readiness, ctx.userId, "Approved", live!.links.length) });
    }
    await audit({ organisationId, actorId: ctx.userId, action: input.decision === "APPROVE" ? "cqc.assessment.approved" : "cqc.assessment.returned", entityType: "CqcAssessment", entityId: a.id, data: { from: "AWAITING_APPROVAL", to: input.decision === "APPROVE" ? "APPROVED" : "IN_PROGRESS", note: note || null } }, tx);
  });
}

function snapshotData(organisationId: string, a: { id: string; branchId: string | null; serviceTypeCode: string | null; frameworkId: string }, r: ReturnType<typeof scoreReadiness>, takenById: string, reason: string, evidenceLinks: number) {
  const byQuestion = Object.fromEntries(KEY_QUESTIONS.map((k) => [k, { score: r.byQuestion[k].score, provisional: r.byQuestion[k].provisional, confidence: r.byQuestion[k].confidence, assessed: r.byQuestion[k].assessed, applicable: r.byQuestion[k].applicable, evidenceCoverage: Math.round(r.byQuestion[k].evidenceCoverage * 100) }]));
  return { organisationId, assessmentId: a.id, branchId: a.branchId, serviceTypeCode: a.serviceTypeCode, frameworkId: a.frameworkId, method: SCORING_METHOD, overall: r.overall.score, confidence: r.overall.confidence, byQuestion: byQuestion as Json, figures: { applicable: r.overall.applicable, assessed: r.overall.assessed, notApplicable: r.overall.notApplicable, evidenceCoverage: Math.round(r.overall.evidenceCoverage * 100), essentialGaps: r.criteria.filter((c) => c.essentialGap).length, evidenceLinks } as Json, reason, takenById };
}

export async function saveSnapshot(ctx: Ctx, assessmentId: string, reason = "Saved by a manager") {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  const live = await computeReadiness(ctx, organisationId, a);
  const s = await db.cqcReadinessSnapshot.create({ data: snapshotData(organisationId, a, live.readiness, ctx.userId, reason.trim().slice(0, 200) || "Saved by a manager", live.links.length) });
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.snapshot.saved", entityType: "CqcAssessment", entityId: a.id, data: { snapshotId: s.id, overall: s.overall } });
  return s;
}

/** An improvement action against one assessment area, through the existing corrective-action service. */
export async function createImprovementAction(ctx: Ctx, assessmentId: string, criterionId: string, input: { title: string; description?: string; ownerId: string; dueDate: Date; priority?: string; evidenceRequired?: string }) {
  const organisationId = requireOrgPermission(ctx, "cqc.assess");
  const a = await loadAssessment(ctx, organisationId, assessmentId);
  if (a.status === "SUPERSEDED") throw new ConflictError("This assessment has been superseded; raise actions on the current one");
  const c = await db.cqcCriterion.findFirst({ where: { id: criterionId, frameworkId: a.frameworkId } });
  if (!c) throw new NotFoundError("Assessment area");
  await assertMember(organisationId, input.ownerId, "The responsible person");
  if (input.priority && !(input.priority in ACTION_PRIORITIES)) throw new ValidationError("Choose a priority");
  const action = await createAction(ctx, { title: input.title, description: input.description, ownerId: input.ownerId, dueDate: input.dueDate, priority: input.priority || "MEDIUM", actionType: "CORRECTIVE", evidenceRequired: input.evidenceRequired, cqc: { assessmentId: a.id, criterionId: c.id, reference: `${a.reference} ${c.code}` } }, { preAuthorised: true });
  await audit({ organisationId, actorId: ctx.userId, action: "cqc.action.created", entityType: "CqcAssessment", entityId: a.id, data: { criterion: c.code, actionId: action.id } });
  return action;
}
