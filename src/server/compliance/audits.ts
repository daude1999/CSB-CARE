import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { notify } from "../notifications/notify";
import { storeEvidenceFile } from "./evidence";

const RESPONSES = ["MET", "PARTIALLY_MET", "NOT_MET", "NOT_APPLICABLE"] as const;
const RISK = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export async function startAudit(ctx: Ctx, templateId: string, input: { title: string; branchId?: string | null }) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const tpl = await db.auditTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || (tpl.organisationId && tpl.organisationId !== orgId)) throw new NotFoundError("Audit template");
  if (tpl.status !== "ACTIVE") throw new ConflictError("Template is not active");
  if (input.branchId) {
    const b = await db.branch.findUnique({ where: { id: input.branchId } });
    if (!b || b.organisationId !== orgId || (ctx.branchIds && !ctx.branchIds.includes(b.id))) throw new NotFoundError("Branch");
  } else if (ctx.branchIds) throw new ValidationError("Choose one of your branches for this audit");
  const a = await db.audit.create({ data: { organisationId: orgId, branchId: input.branchId ?? null, templateId, templateVersion: tpl.version, title: input.title || tpl.title, conductedById: ctx.userId } });
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "audit.started", entityType: "Audit", entityId: a.id });
  return a;
}

/** Audits a branch-limited member may see: their branches' audits and organisation-wide ones. */
export function auditBranchWhere(ctx: Ctx) {
  return ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {};
}

async function visibleAudit(ctx: Ctx, orgId: string, auditId: string) {
  const a = await db.audit.findFirst({ where: { id: auditId, organisationId: orgId, ...auditBranchWhere(ctx) } });
  if (!a) throw new NotFoundError("Audit");
  return a;
}

export async function answerQuestion(ctx: Ctx, auditId: string, questionId: string, response: string, notes?: string) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await visibleAudit(ctx, orgId, auditId);
  if (a.status !== "IN_PROGRESS") throw new ConflictError("Audit is completed");
  if (!RESPONSES.includes(response as never)) throw new ValidationError("Choose a response: met, partially met, not met or not applicable");
  const q = await db.auditQuestion.findUnique({ where: { id: questionId } });
  if (!q || q.templateId !== a.templateId) throw new NotFoundError("Question");
  const cleanNotes = notes?.trim() || null;
  // The current answer is replaced; the history of every answer is kept in AuditAnswerEvent (append-only).
  return db.$transaction(async (tx) => {
    const row = await tx.auditAnswer.upsert({ where: { auditId_questionId: { auditId, questionId } }, create: { auditId, questionId, response, notes: cleanNotes }, update: { response, notes: cleanNotes } });
    await tx.auditAnswerEvent.create({ data: { auditId, questionId, actorId: ctx.userId, response, notes: cleanNotes } });
    return row;
  });
}

export async function addFinding(ctx: Ctx, auditId: string, input: { description: string; riskRating: string; questionId?: string }) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await visibleAudit(ctx, orgId, auditId);
  if (a.status !== "IN_PROGRESS") throw new ConflictError("Findings are added while the audit is in progress");
  if (!RISK.includes(input.riskRating as never)) throw new ValidationError("Invalid risk rating");
  if (!input.description.trim()) throw new ValidationError("Describe the finding");
  if (input.questionId) {
    const q = await db.auditQuestion.findUnique({ where: { id: input.questionId } });
    if (!q || q.templateId !== a.templateId) throw new NotFoundError("Question");
  }
  const f = await db.auditFinding.create({ data: { auditId, organisationId: orgId, description: input.description.trim(), riskRating: input.riskRating, questionId: input.questionId || null } });
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "audit.finding.added", entityType: "AuditFinding", entityId: f.id, data: { auditId, riskRating: input.riskRating } });
  return f;
}

/** How far an audit has got: every question of its template must have a recorded answer before it can be completed. */
export function auditProgress(questionIds: string[], answers: { questionId: string }[]) {
  const answered = new Set(answers.map((x) => x.questionId));
  const missing = questionIds.filter((id) => !answered.has(id));
  return { total: questionIds.length, answered: questionIds.length - missing.length, missing };
}

export async function completeAudit(ctx: Ctx, auditId: string) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await db.audit.findFirst({ where: { id: auditId, organisationId: orgId, ...auditBranchWhere(ctx) }, include: { answers: { select: { questionId: true } }, template: { select: { questions: { select: { id: true } } } } } });
  if (!a) throw new NotFoundError("Audit");
  if (a.status !== "IN_PROGRESS") throw new ConflictError("Audit is already completed");
  const progress = auditProgress(a.template.questions.map((q) => q.id), a.answers);
  if (progress.missing.length) {
    throw new ValidationError(`${progress.missing.length} of ${progress.total} question${progress.total === 1 ? "" : "s"} ${progress.missing.length === 1 ? "has" : "have"} no answer. Every question needs a recorded answer (or "not applicable") before the audit can be completed.`);
  }
  await db.$transaction(async (tx) => {
    await tx.audit.update({ where: { id: auditId }, data: { status: "COMPLETED", completedAt: new Date(), completedById: ctx.userId } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "audit.completed", entityType: "Audit", entityId: auditId, data: { answered: progress.answered, total: progress.total } }, tx);
  });
}

/**
 * Score = share of applicable questions answered MET (partially met counts half). Not scored while any question is
 * unanswered: an unanswered question is never treated as met. Shown as an internal indicator, never as proof of compliance.
 */
export function auditScore(answers: { response: string }[], totalQuestions?: number) {
  if (totalQuestions !== undefined && answers.length < totalQuestions) return null;
  const applicable = answers.filter((a) => a.response !== "NOT_APPLICABLE");
  if (!applicable.length) return null;
  const pts = applicable.reduce((n, a) => n + (a.response === "MET" ? 1 : a.response === "PARTIALLY_MET" ? 0.5 : 0), 0);
  return Math.round((pts / applicable.length) * 100);
}

export const ACTION_FLOW: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["VERIFIED", "IN_PROGRESS"],
  VERIFIED: ["CLOSED"],
  CLOSED: [],
};

export async function createAction(ctx: Ctx, input: { title: string; description?: string; ownerId: string; dueDate: Date; findingId?: string; riskId?: string }) {
  const orgId = requireOrgPermission(ctx, "action.manage");
  if (input.title.trim().length < 3) throw new ValidationError("Give the action a title");
  if (!(input.dueDate instanceof Date) || Number.isNaN(input.dueDate.getTime())) throw new ValidationError("Give the action a due date");
  const owner = await db.membership.findUnique({ where: { userId_organisationId: { userId: input.ownerId, organisationId: orgId } } });
  if (!owner) throw new ValidationError("Owner must be a member of your organisation");
  if (input.findingId) {
    const f = await db.auditFinding.findUnique({ where: { id: input.findingId } });
    if (!f || f.organisationId !== orgId) throw new NotFoundError("Finding");
  }
  if (input.riskId) {
    const r = await db.complianceRisk.findFirst({ where: { id: input.riskId, organisationId: orgId } });
    if (!r) throw new NotFoundError("Risk");
    if (r.status === "CLOSED") throw new ConflictError("This risk is closed. Reopen it before adding actions.");
  }
  const action = await db.$transaction(async (tx) => {
    const a = await tx.complianceAction.create({ data: { organisationId: orgId, title: input.title.trim(), description: input.description, ownerId: input.ownerId, dueDate: input.dueDate, findingId: input.findingId, riskId: input.riskId, history: { create: { actorId: ctx.userId, to: "OPEN", note: "Created" } } } });
    if (input.riskId) await tx.riskEvent.create({ data: { riskId: input.riskId, actorId: ctx.userId, kind: "UPDATED", note: `Mitigation action added: ${a.title}`, changes: { actionId: a.id } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "action.created", entityType: "ComplianceAction", entityId: a.id, data: { findingId: input.findingId ?? null, riskId: input.riskId ?? null } }, tx);
    return a;
  });
  await notify({ organisationId: orgId, userIds: [input.ownerId], type: "action.assigned", title: `Action assigned: ${input.title}`, body: input.description ?? "", reason: "You are the owner of this compliance action.", links: [{ label: "Open the action", url: `/actions/${action.id}` }], actionUrl: `/actions/${action.id}`, dueAt: input.dueDate, dedupeKey: `action-assigned:${action.id}` });
  return action;
}

/** Whether the caller may work on an action: its owner, or a compliance lead or organisation admin. */
function canWorkOn(ctx: Ctx, action: { ownerId: string }) {
  return action.ownerId === ctx.userId || ctx.orgRoles.some((r) => r === "COMPLIANCE_LEAD" || r === "ORG_ADMIN");
}

/**
 * Attaches a file to an action from the action itself, so the owner never has to upload it elsewhere and find it
 * again. The owner may attach evidence to their own action even without the general evidence-upload permission;
 * the file goes through the same type, size and malware checks as every other upload.
 */
export async function attachActionEvidence(ctx: Ctx, actionId: string, file: { name: string; type: string; bytes: Buffer }, description?: string) {
  if (!ctx.organisationId) throw new NotFoundError("Action");
  const action = await db.complianceAction.findFirst({ where: { id: actionId, organisationId: ctx.organisationId } });
  if (!action) throw new NotFoundError("Action");
  if (!canWorkOn(ctx, action)) throw new ForbiddenError("Only the action's owner or a compliance lead can add evidence to it");
  if (action.status === "CLOSED") throw new ConflictError("This action is closed");
  return storeEvidenceFile(ctx.organisationId, ctx.userId, file, { description: description?.trim() || `Evidence for action: ${action.title}`, linkedType: "ACTION", linkedId: action.id });
}

/** One action with where it came from (audit, question, finding, risk), its history, evidence and verification. */
export async function actionDetail(ctx: Ctx, actionId: string) {
  if (!ctx.organisationId) throw new NotFoundError("Action");
  const orgId = ctx.organisationId;
  const isManager = ctx.orgRoles.some((r) => r === "COMPLIANCE_LEAD" || r === "ORG_ADMIN");
  const a = await db.complianceAction.findFirst({
    where: { id: actionId, organisationId: orgId, ...(isManager || ctx.orgRoles.includes("CARE_MANAGER") ? {} : { ownerId: ctx.userId }) },
    include: {
      history: { orderBy: { createdAt: "asc" } },
      finding: { include: { audit: { select: { id: true, title: true, branchId: true, status: true, completedAt: true } } } },
      risk: { select: { id: true, ref: true, title: true, status: true, residualLikelihood: true, residualImpact: true } },
    },
  });
  if (!a) throw new NotFoundError("Action");
  // A branch-limited member only sees actions from their branches' audits (or organisation-wide ones).
  if (ctx.branchIds && a.finding?.audit.branchId && !ctx.branchIds.includes(a.finding.audit.branchId)) throw new NotFoundError("Action");
  const question = a.finding?.questionId ? await db.auditQuestion.findUnique({ where: { id: a.finding.questionId }, select: { id: true, text: true, position: true } }) : null;
  const evidence = await db.evidenceDocument.findMany({ where: { organisationId: orgId, OR: [{ linkedType: "ACTION", linkedId: a.id }, ...(a.completionEvidenceId ? [{ id: a.completionEvidenceId }] : [])] }, orderBy: { createdAt: "asc" } });
  return { ...a, question, evidence, canWork: canWorkOn(ctx, a), canVerify: isManager && a.ownerId !== ctx.userId };
}

export async function transitionAction(ctx: Ctx, actionId: string, to: string, input: { note?: string; evidenceId?: string } = {}) {
  const action = await db.complianceAction.findUnique({ where: { id: actionId } });
  if (!action || action.organisationId !== ctx.organisationId) throw new NotFoundError("Action");
  if (!ACTION_FLOW[action.status]?.includes(to)) throw new ConflictError(`Cannot move an action from ${action.status} to ${to}`);
  const isManager = ctx.orgRoles.some((r) => r === "COMPLIANCE_LEAD" || r === "ORG_ADMIN");
  if (to === "CLOSED" && action.status !== "VERIFIED") throw new ConflictError("An action is closed only after it has been verified");
  if (["VERIFIED", "CLOSED"].includes(to)) {
    if (!isManager) throw new ForbiddenError("Only a compliance lead can verify or close actions");
    if (action.ownerId === ctx.userId) throw new ForbiddenError("Action owners cannot verify their own work");
  } else if (action.ownerId !== ctx.userId && !isManager) throw new ForbiddenError();
  if (to === "COMPLETED" && !input.note?.trim()) throw new ValidationError("Describe what was done to complete the action");
  if (to === "VERIFIED" && !input.note?.trim()) throw new ValidationError("Record what you checked to verify the action (for example the evidence or records seen)");
  if (input.evidenceId) {
    const ev = await db.evidenceDocument.findUnique({ where: { id: input.evidenceId } });
    if (!ev || ev.organisationId !== action.organisationId) throw new NotFoundError("Evidence");
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.complianceAction.update({
      where: { id: actionId },
      data: {
        status: to,
        completionNote: to === "COMPLETED" ? input.note : undefined,
        completionEvidenceId: input.evidenceId ?? undefined,
        completedAt: to === "COMPLETED" ? now : undefined,
        verifiedById: to === "VERIFIED" ? ctx.userId : undefined,
        verifiedAt: to === "VERIFIED" ? now : undefined,
        closedAt: to === "CLOSED" ? now : undefined,
        history: { create: { actorId: ctx.userId, from: action.status, to, note: input.note } },
      },
    });
    await audit({ organisationId: action.organisationId, actorId: ctx.userId, action: `action.${to.toLowerCase()}`, entityType: "ComplianceAction", entityId: actionId, data: { from: action.status, to } }, tx);
    return updated;
  });
}
