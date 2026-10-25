import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { notify } from "../notifications/notify";

const RESPONSES = ["MET", "PARTIALLY_MET", "NOT_MET", "NOT_APPLICABLE"] as const;
const RISK = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export async function startAudit(ctx: Ctx, templateId: string, input: { title: string; branchId?: string | null }) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const tpl = await db.auditTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || (tpl.organisationId && tpl.organisationId !== orgId)) throw new NotFoundError("Audit template");
  if (tpl.status !== "ACTIVE") throw new ConflictError("Template is not active");
  if (input.branchId) {
    const b = await db.branch.findUnique({ where: { id: input.branchId } });
    if (!b || b.organisationId !== orgId) throw new NotFoundError("Branch");
  }
  const a = await db.audit.create({ data: { organisationId: orgId, branchId: input.branchId ?? null, templateId, templateVersion: tpl.version, title: input.title || tpl.title, conductedById: ctx.userId } });
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "audit.started", entityType: "Audit", entityId: a.id });
  return a;
}

export async function answerQuestion(ctx: Ctx, auditId: string, questionId: string, response: string, notes?: string) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await db.audit.findUnique({ where: { id: auditId } });
  if (!a || a.organisationId !== orgId) throw new NotFoundError("Audit");
  if (a.status !== "IN_PROGRESS") throw new ConflictError("Audit is completed");
  if (!RESPONSES.includes(response as never)) throw new ValidationError("Invalid response");
  const q = await db.auditQuestion.findUnique({ where: { id: questionId } });
  if (!q || q.templateId !== a.templateId) throw new NotFoundError("Question");
  return db.auditAnswer.upsert({ where: { auditId_questionId: { auditId, questionId } }, create: { auditId, questionId, response, notes }, update: { response, notes } });
}

export async function addFinding(ctx: Ctx, auditId: string, input: { description: string; riskRating: string; questionId?: string }) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await db.audit.findUnique({ where: { id: auditId } });
  if (!a || a.organisationId !== orgId) throw new NotFoundError("Audit");
  if (!RISK.includes(input.riskRating as never)) throw new ValidationError("Invalid risk rating");
  if (!input.description.trim()) throw new ValidationError("Describe the finding");
  return db.auditFinding.create({ data: { auditId, organisationId: orgId, description: input.description, riskRating: input.riskRating, questionId: input.questionId } });
}

export async function completeAudit(ctx: Ctx, auditId: string) {
  const orgId = requireOrgPermission(ctx, "audit.conduct");
  const a = await db.audit.findUnique({ where: { id: auditId } });
  if (!a || a.organisationId !== orgId) throw new NotFoundError("Audit");
  await db.audit.update({ where: { id: auditId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "audit.completed", entityType: "Audit", entityId: auditId });
}

/** Score = share of applicable questions answered MET. Shown as an internal indicator, never as proof of compliance. */
export function auditScore(answers: { response: string }[]) {
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

export async function createAction(ctx: Ctx, input: { title: string; description?: string; ownerId: string; dueDate: Date; findingId?: string }) {
  const orgId = requireOrgPermission(ctx, "action.manage");
  const owner = await db.membership.findUnique({ where: { userId_organisationId: { userId: input.ownerId, organisationId: orgId } } });
  if (!owner) throw new ValidationError("Owner must be a member of your organisation");
  if (input.findingId) {
    const f = await db.auditFinding.findUnique({ where: { id: input.findingId } });
    if (!f || f.organisationId !== orgId) throw new NotFoundError("Finding");
  }
  const action = await db.complianceAction.create({ data: { organisationId: orgId, title: input.title, description: input.description, ownerId: input.ownerId, dueDate: input.dueDate, findingId: input.findingId, history: { create: { actorId: ctx.userId, to: "OPEN", note: "Created" } } } });
  await notify({ organisationId: orgId, userIds: [input.ownerId], type: "action.assigned", title: `Action assigned: ${input.title}`, body: input.description ?? "", reason: "You are the owner of this compliance action.", links: [{ label: "Open actions", url: "/actions" }], actionUrl: "/actions", dueAt: input.dueDate, dedupeKey: `action-assigned:${action.id}` });
  return action;
}

export async function transitionAction(ctx: Ctx, actionId: string, to: string, input: { note?: string; evidenceId?: string } = {}) {
  const action = await db.complianceAction.findUnique({ where: { id: actionId } });
  if (!action || action.organisationId !== ctx.organisationId) throw new NotFoundError("Action");
  if (!ACTION_FLOW[action.status]?.includes(to)) throw new ConflictError(`Cannot move an action from ${action.status} to ${to}`);
  const isManager = ctx.orgRoles.some((r) => r === "COMPLIANCE_LEAD" || r === "ORG_ADMIN");
  if (["VERIFIED", "CLOSED"].includes(to)) {
    if (!isManager) throw new ForbiddenError("Only a compliance lead can verify or close actions");
    if (action.ownerId === ctx.userId) throw new ForbiddenError("Action owners cannot verify their own work");
  } else if (action.ownerId !== ctx.userId && !isManager) throw new ForbiddenError();
  if (to === "COMPLETED" && !input.note?.trim()) throw new ValidationError("Describe what was done to complete the action");
  if (input.evidenceId) {
    const ev = await db.evidenceDocument.findUnique({ where: { id: input.evidenceId } });
    if (!ev || ev.organisationId !== action.organisationId) throw new NotFoundError("Evidence");
  }
  const now = new Date();
  return db.complianceAction.update({
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
}
