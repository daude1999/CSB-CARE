import type { IncidentSeverity, IncidentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { serviceUserWhere, rotaScope } from "@/server/rota/scope";

type Tx = Prisma.TransactionClient;

/**
 * Incidents and accidents. Anyone with incident.report (carers included) can report one; managers investigate and
 * close it with an outcome. A reporter without incident.manage sees only their own reports. Serious incidents and
 * safeguarding concerns alert managers in the app at once. The "may need notifying" flag is a reminder for the
 * registered manager: the platform never sends a statutory notification to CQC or the local authority itself.
 */

export const INCIDENT_CATEGORIES = ["Fall", "Injury", "Medication error", "Missed or late call", "Safeguarding concern", "Behaviour", "Property or key safe", "Health deterioration", "Complaint", "Other"] as const;
const SEVERITIES: IncidentSeverity[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

const reportSchema = z.object({
  serviceUserId: z.string().optional(),
  visitId: z.string().optional(),
  date: z.string().refine(isIsoDate, "Choose the date it happened"),
  time: z.string().refine((t) => parseHhmm(t) !== null, "Times must be like 09:00"),
  category: z.enum(INCIDENT_CATEGORIES, { message: "Choose a category" }),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"], { message: "Choose how serious it was" }),
  description: z.string().trim().min(20, "Describe what happened (at least a couple of sentences)").max(8000),
  immediateAction: z.string().trim().max(4000).optional(),
  safeguarding: z.boolean().default(false),
});
export type ReportInput = z.input<typeof reportSchema>;

async function nextReference(tx: Tx, organisationId: string) {
  const prefix = `INC-${londonDate().slice(2, 4)}${londonDate().slice(5, 7)}-`;
  const n = await tx.incident.count({ where: { organisationId, reference: { startsWith: prefix } } });
  return `${prefix}${String(n + 1).padStart(3, "0")}`;
}

async function managers(tx: Tx, organisationId: string) {
  const ms = await tx.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "COMPLIANCE_LEAD"] } }, select: { userId: true } });
  return [...new Set(ms.map((m) => m.userId))];
}

/** Which service users a reporter may name: managers and coordinators their scope; a carer only people they visit. */
export async function reportableServiceUsers(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "incident.report");
  if (hasOrgPermission(ctx, "serviceUser.view")) {
    const scope = await rotaScope(ctx, "serviceUser.view");
    return db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), status: { in: ["ASSESSMENT", "ACTIVE", "PAUSED"] } }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: [{ lastName: "asc" }] });
  }
  const staff = await db.staffMember.findFirst({ where: { organisationId, userId: ctx.userId } });
  if (!staff) return [];
  const today = londonDate();
  return db.serviceUser.findMany({ where: { organisationId, visits: { some: { publishedAt: { not: null }, date: { gte: dbDate(addDays(today, -14)), lte: dbDate(addDays(today, 7)) }, assignments: { some: { staffId: staff.id } } } } }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: [{ lastName: "asc" }] });
}

export async function reportIncident(ctx: Ctx, input: ReportInput | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "incident.report");
  const raw = input as Record<string, unknown>;
  const p = reportSchema.safeParse({ ...raw, safeguarding: raw.safeguarding === true || raw.safeguarding === "on" });
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the report");
  const d = p.data;
  const occurredAt = londonToUtc(d.date, parseHhmm(d.time) ?? 0);
  if (occurredAt.getTime() > Date.now() + 5 * 60000) throw new ValidationError("An incident cannot be in the future");
  if (d.serviceUserId && !(await reportableServiceUsers(ctx)).some((s) => s.id === d.serviceUserId)) throw new NotFoundError("Service user");
  const staff = await db.staffMember.findFirst({ where: { organisationId, userId: ctx.userId }, select: { id: true } });
  return db.$transaction(async (tx) => {
    let visitId: string | null = null;
    if (d.visitId) {
      const v = await tx.visit.findFirst({ where: { id: d.visitId, organisationId, ...(d.serviceUserId ? { serviceUserId: d.serviceUserId } : {}) }, select: { id: true } });
      visitId = v?.id ?? null;
    }
    const inc = await tx.incident.create({ data: { organisationId, reference: await nextReference(tx, organisationId), serviceUserId: d.serviceUserId || null, staffId: staff?.id ?? null, visitId, occurredAt, category: d.category, severity: d.severity, description: d.description, immediateAction: d.immediateAction || null, safeguarding: d.safeguarding || d.category === "Safeguarding concern", reportedById: ctx.userId } });
    if (inc.safeguarding || d.severity === "HIGH" || d.severity === "CRITICAL") {
      const title = `${inc.safeguarding ? "Safeguarding concern" : `${d.severity.toLowerCase()} incident`} reported: ${inc.reference}`;
      await tx.notification.createMany({ data: (await managers(tx, organisationId)).filter((u) => u !== ctx.userId).map((userId) => ({ organisationId, userId, type: "incident.reported", title, body: `${d.category}. Open the incident to review it and decide the next steps.`, reason: "You manage incidents for this organisation.", actionUrl: `/rota/incidents/${inc.id}`, dedupeKey: `incident:${inc.id}:${userId}` })), skipDuplicates: true });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "incident.reported", entityType: "Incident", entityId: inc.id, data: { reference: inc.reference, severity: d.severity, category: d.category, safeguarding: inc.safeguarding } }, tx);
    return inc;
  });
}

function visibleWhere(ctx: Ctx, organisationId: string): Prisma.IncidentWhereInput {
  return hasOrgPermission(ctx, "incident.manage") ? { organisationId } : { organisationId, reportedById: ctx.userId };
}

export async function listIncidents(ctx: Ctx, f: { status?: string; severity?: string; safeguarding?: boolean; q?: string }) {
  const organisationId = requireOrgPermission(ctx, "incident.report");
  const status = (["OPEN", "INVESTIGATING", "CLOSED"] as IncidentStatus[]).find((s) => s === f.status);
  const severity = SEVERITIES.find((s) => s === f.severity);
  return db.incident.findMany({
    where: { ...visibleWhere(ctx, organisationId), ...(status ? { status } : f.status === "all" ? {} : { status: { not: "CLOSED" } }), ...(severity ? { severity } : {}), ...(f.safeguarding ? { safeguarding: true } : {}), ...(f.q ? { OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }] } : {}) },
    include: { serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
    orderBy: [{ occurredAt: "desc" }],
    take: 300,
  });
}

/**
 * The most recent incidents about one service user, for their record's overview. Null when the person may not see
 * incidents at all; a reporter without incident.manage sees only their own reports, as on the Incidents page. The
 * caller has already checked the service user is in the person's scope.
 */
export async function recentIncidentsFor(ctx: Ctx, serviceUserId: string, take = 4) {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "incident.report")) return null;
  return db.incident.findMany({
    where: { ...visibleWhere(ctx, ctx.organisationId), serviceUserId },
    select: { id: true, reference: true, category: true, severity: true, status: true, safeguarding: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

export async function getIncident(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "incident.report");
  const inc = await db.incident.findFirst({ where: { ...visibleWhere(ctx, organisationId), id }, include: { serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } } } });
  if (!inc) throw new NotFoundError("Incident");
  const history = await db.auditLog.findMany({ where: { organisationId, entityType: "Incident", entityId: inc.id }, orderBy: { createdAt: "asc" } });
  const visit = inc.visitId ? await db.visit.findFirst({ where: { id: inc.visitId, organisationId }, select: { id: true, reference: true, scheduledStart: true } }) : null;
  const staff = inc.staffId ? await db.staffMember.findFirst({ where: { id: inc.staffId, organisationId }, select: { id: true, displayName: true } }) : null;
  return { incident: inc, history, visit, staff };
}

async function lockIncident(tx: Tx, organisationId: string, id: string, version: number) {
  const inc = await tx.incident.findFirst({ where: { id, organisationId } });
  if (!inc) throw new NotFoundError("Incident");
  if (inc.version !== version) throw new ConflictError("Someone else updated this incident since you opened it. Reload and try again.");
  return inc;
}

/** Manager triage: severity, safeguarding and the "may need notifying" reminder, with a note. */
export async function triageIncident(ctx: Ctx, id: string, version: number, input: { severity: string; safeguarding: boolean; notifiable: boolean; note: string }) {
  const organisationId = requireOrgPermission(ctx, "incident.manage");
  const severity = SEVERITIES.find((s) => s === input.severity);
  if (!severity) throw new ValidationError("Choose the severity");
  if (input.note.trim().length < 3) throw new ValidationError("Add a note explaining the change");
  return db.$transaction(async (tx) => {
    const inc = await lockIncident(tx, organisationId, id, version);
    if (inc.status === "CLOSED") throw new ValidationError("Reopen the incident before changing it");
    const { count } = await tx.incident.updateMany({ where: { id: inc.id, version }, data: { severity, safeguarding: input.safeguarding, notifiable: input.notifiable, status: inc.status === "OPEN" ? "INVESTIGATING" : inc.status, investigatorId: inc.investigatorId ?? ctx.userId, version: { increment: 1 } } });
    if (!count) throw new ConflictError("Someone else updated this incident since you opened it. Reload and try again.");
    await audit({ organisationId, actorId: ctx.userId, action: "incident.triaged", entityType: "Incident", entityId: inc.id, data: { from: { severity: inc.severity, safeguarding: inc.safeguarding, notifiable: inc.notifiable }, to: { severity, safeguarding: input.safeguarding, notifiable: input.notifiable }, note: input.note.trim() } }, tx);
  });
}

export async function addIncidentNote(ctx: Ctx, id: string, note: string) {
  const organisationId = requireOrgPermission(ctx, "incident.manage");
  if (note.trim().length < 3) throw new ValidationError("Write the note");
  const inc = await db.incident.findFirst({ where: { id, organisationId }, select: { id: true } });
  if (!inc) throw new NotFoundError("Incident");
  await audit({ organisationId, actorId: ctx.userId, action: "incident.note", entityType: "Incident", entityId: inc.id, data: { note: note.trim().slice(0, 4000) } });
}

/** Closing needs a written outcome, and a notifiable incident needs the manager to confirm the notification was dealt with. */
export async function closeIncident(ctx: Ctx, id: string, version: number, outcome: string, notificationHandled: boolean) {
  const organisationId = requireOrgPermission(ctx, "incident.manage");
  if (outcome.trim().length < 20) throw new ValidationError("Record the outcome and any lessons learned (at least a couple of sentences)");
  return db.$transaction(async (tx) => {
    const inc = await lockIncident(tx, organisationId, id, version);
    if (inc.status === "CLOSED") throw new ValidationError("Already closed");
    if (inc.notifiable && !notificationHandled) throw new ValidationError("This incident is marked as possibly notifiable. Confirm the notification has been made or was not needed.");
    if (inc.reportedById === ctx.userId && inc.severity !== "LOW" && inc.severity !== "MODERATE") throw new ForbiddenError("You reported this serious incident, so another manager must close it");
    await tx.incident.update({ where: { id: inc.id }, data: { status: "CLOSED", outcome: outcome.trim(), closedById: ctx.userId, closedAt: new Date(), version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "incident.closed", entityType: "Incident", entityId: inc.id, data: { notificationHandled } }, tx);
  });
}

export async function reopenIncident(ctx: Ctx, id: string, version: number, reason: string) {
  const organisationId = requireOrgPermission(ctx, "incident.manage");
  if (reason.trim().length < 3) throw new ValidationError("Say why it is being reopened");
  return db.$transaction(async (tx) => {
    const inc = await lockIncident(tx, organisationId, id, version);
    if (inc.status !== "CLOSED") throw new ValidationError("Only a closed incident can be reopened");
    await tx.incident.update({ where: { id: inc.id }, data: { status: "INVESTIGATING", closedById: null, closedAt: null, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "incident.reopened", entityType: "Incident", entityId: inc.id, data: { reason: reason.trim(), previousOutcome: inc.outcome } }, tx);
  });
}
