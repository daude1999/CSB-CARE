import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { ORG_PERMISSIONS, hasOrgPermission, requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { serviceUserForRecords } from "@/server/care/su-documents";

/**
 * Body map review tasks: a follow-up, a request for a care plan or risk assessment review, a request for an incident
 * assessment, or a manager review. Each is assigned to one person who sees it in their notifications; it is closed
 * with an outcome. Tasks never change the care plan, the risk assessment or the incident themselves: the person doing
 * the task uses those records' own workflows and approvals.
 */

export const TASK_KINDS = {
  FOLLOW_UP: { label: "Follow-up", perm: "bodyMap.record" },
  CARE_PLAN_REVIEW: { label: "Care plan review request", perm: "care.plan.approve" },
  RISK_REVIEW: { label: "Risk assessment review request", perm: "bodyMap.review" },
  INCIDENT_ASSESSMENT: { label: "Incident assessment request", perm: "incident.manage" },
  MANAGER_REVIEW: { label: "Manager review", perm: "bodyMap.review" },
} as const satisfies Record<string, { label: string; perm: OrgPermission }>;
export type TaskKind = keyof typeof TASK_KINDS;
export const TASK_KIND_KEYS = Object.keys(TASK_KINDS) as TaskKind[];
export const isTaskKind = (k: string | null | undefined): k is TaskKind => !!k && k in TASK_KINDS;

/** Organisation members who may be given a task of this kind (by role, from the permission list). */
export async function assignablePeople(ctx: Ctx, kind: TaskKind = "MANAGER_REVIEW") {
  const organisationId = requireOrgPermission(ctx, "serviceUser.view");
  const roles = ORG_PERMISSIONS[TASK_KINDS[kind].perm] as readonly string[];
  const ms = await db.membership.findMany({ where: { organisationId, roles: { hasSome: [...roles] as never } }, select: { userId: true, roles: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  const seen = new Set<string>();
  return ms.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true))).map((m) => ({ id: m.userId, name: m.user.name, roles: m.roles as string[] }));
}

const taskSchema = z.object({
  kind: z.string().refine(isTaskKind, "Choose what kind of task this is"),
  title: z.string().trim().max(200).optional(),
  details: z.string().trim().max(2000).optional(),
  assigneeId: z.string().trim().min(1, "Choose who the task is for"),
  dueOn: z.string().refine(isIsoDate, "Choose a due date"),
});
export type TaskInput = z.input<typeof taskSchema>;

/**
 * Creates a task on an observation, optionally from a recommendation (which then becomes "Action created"). Runs in the
 * caller's transaction when given one, so the recommendation and the task change together.
 */
export async function createBodyMapTask(ctx: Ctx, observationId: string, input: TaskInput, opts: { recommendationId?: string } = {}) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.review");
  const p = taskSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the task");
  const d = p.data;
  const kind = d.kind as TaskKind;
  if (d.dueOn < londonDate()) throw new ValidationError("The due date cannot be in the past");
  const o = await db.bodyMapObservation.findFirst({ where: { id: observationId, organisationId }, select: { id: true, serviceUserId: true, category: true, region: true } });
  if (!o) throw new NotFoundError("Observation");
  const su = await serviceUserForRecords(ctx, o.serviceUserId);
  const people = await assignablePeople(ctx, kind);
  if (!people.some((x) => x.id === d.assigneeId)) throw new ValidationError(`Choose someone who can carry out a ${TASK_KINDS[kind].label.toLowerCase()}`);
  const title = d.title || `${TASK_KINDS[kind].label}: ${o.category.toLowerCase()}, ${o.region.toLowerCase()}`;
  return db.$transaction(async (tx) => {
    const task = await tx.bodyMapTask.create({ data: { organisationId, serviceUserId: su.id, observationId: o.id, recommendationId: opts.recommendationId ?? null, kind, title, details: d.details || null, assigneeId: d.assigneeId, dueOn: dbDate(d.dueOn), createdById: ctx.userId } });
    if (opts.recommendationId) {
      const r = await tx.bodyMapRecommendation.updateMany({ where: { id: opts.recommendationId, organisationId, observationId: o.id, status: { in: ["NEW", "UNDER_REVIEW", "ACCEPTED"] } }, data: { status: "ACTION_CREATED", taskId: task.id, decidedById: ctx.userId, decidedAt: new Date() } });
      if (r.count !== 1) throw new ConflictError("This recommendation has already been decided. Reload the page to see the latest.");
    }
    if (d.assigneeId !== ctx.userId) {
      await tx.notification.create({
        data: {
          organisationId, userId: d.assigneeId, type: "bodyMap.task", title: `${TASK_KINDS[kind].label} for ${su.firstName} ${su.lastName}`,
          body: `${title}. Due ${d.dueOn}.`, reason: "A manager assigned this body map task to you.",
          actionUrl: `/rota/service-users/${su.id}?tab=bodymap&obs=${o.id}&pane=followup`, dueAt: dbDate(d.dueOn), dedupeKey: `body-map-task:${task.id}`,
        },
      });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "bodyMap.taskCreated", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: su.id, taskId: task.id, kind, assigneeId: d.assigneeId, dueOn: d.dueOn, recommendationId: opts.recommendationId ?? null } as Prisma.InputJsonValue }, tx);
    return task;
  });
}

const closeSchema = z.object({ outcome: z.string().trim().min(3, "Record what was done").max(2000), done: z.boolean() });

/** The assignee or a manager closes the task with an outcome: done, or cancelled with a reason. */
export async function closeBodyMapTask(ctx: Ctx, taskId: string, version: number, input: z.input<typeof closeSchema>) {
  const organisationId = requireOrgPermission(ctx, "serviceUser.view");
  const p = closeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the outcome");
  const t = await db.bodyMapTask.findFirst({ where: { id: taskId, organisationId } });
  if (!t) throw new NotFoundError("Task");
  await serviceUserForRecords(ctx, t.serviceUserId);
  if (t.assigneeId !== ctx.userId && !hasOrgPermission(ctx, "bodyMap.review")) throw new ForbiddenError("Only the person the task is for, or a manager, can close it");
  if (!p.data.done && !hasOrgPermission(ctx, "bodyMap.review")) throw new ForbiddenError("Only a manager can cancel a task");
  await db.$transaction(async (tx) => {
    const r = await tx.bodyMapTask.updateMany({ where: { id: t.id, version, status: "OPEN" }, data: { status: p.data.done ? "DONE" : "CANCELLED", outcome: p.data.outcome, closedById: ctx.userId, closedAt: new Date(), version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("This task has already been closed or changed. Reload the page and try again.");
    await audit({ organisationId, actorId: ctx.userId, action: p.data.done ? "bodyMap.taskDone" : "bodyMap.taskCancelled", entityType: "BodyMapObservation", entityId: t.observationId, data: { serviceUserId: t.serviceUserId, taskId: t.id, kind: t.kind, outcome: p.data.outcome } }, tx);
  });
}
