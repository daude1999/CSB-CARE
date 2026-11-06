import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, assertInScope } from "@/server/rota/scope";
import { myStaff } from "@/server/workforce/link";

/**
 * Carer instruction versions and acknowledgements (AI CSB Coordinator brief, 6 Nov 2026, phase 9).
 *
 * A repeating visit's instructions are its notes and its task list. Every change is kept as a numbered version with
 * a plain summary of what changed and the date it applies from. Changes reach future visits only, through the
 * existing "Apply to future visits" step; visits already done keep exactly what they had. Carers booked on an
 * upcoming visit of a changed template are asked to confirm they have read the new instructions, and the office
 * sees who has.
 */

type Tx = Prisma.TransactionClient;

/** What changed between two sets of instructions, in plain words; null when nothing did. */
export function instructionChange(before: { notes: string | null; tasks: string[] } | null, after: { notes: string | null; tasks: string[] }): string | null {
  if (!before) return "First instructions for this visit.";
  const added = after.tasks.filter((t) => !before.tasks.includes(t));
  const removed = before.tasks.filter((t) => !after.tasks.includes(t));
  const notes = (before.notes ?? "").trim() !== (after.notes ?? "").trim();
  const parts = [added.length ? `Task${added.length === 1 ? "" : "s"} added: ${added.join("; ")}` : null, removed.length ? `Task${removed.length === 1 ? "" : "s"} removed: ${removed.join("; ")}` : null, notes ? "Visit notes changed" : null].filter(Boolean);
  return parts.length ? `${parts.join(". ")}.`.slice(0, 2000) : null;
}

/** Records a new instruction version for a template when its notes or tasks changed (inside the caller's transaction). */
export async function recordInstructionVersion(tx: Tx, templateId: string, actorId: string) {
  const t = await tx.visitTemplate.findUniqueOrThrow({ where: { id: templateId }, select: { id: true, organisationId: true, serviceUserId: true, notes: true, tasks: { select: { careTask: { select: { name: true } } } } } });
  const now = { notes: t.notes, tasks: t.tasks.map((x) => x.careTask.name).sort() };
  const last = await tx.careInstructionVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
  const summary = instructionChange(last ? { notes: last.notes, tasks: [...last.tasks].sort() } : null, now);
  if (!summary) return null;
  const v = await tx.careInstructionVersion.create({ data: { organisationId: t.organisationId, serviceUserId: t.serviceUserId, templateId, version: (last?.version ?? 0) + 1, notes: now.notes, tasks: now.tasks, changeSummary: summary, effectiveFrom: dbDate(londonDate()), createdById: actorId } });
  if (last) await audit({ organisationId: t.organisationId, actorId, action: "template.instructions.changed", entityType: "VisitTemplate", entityId: templateId, data: { version: v.version } }, tx);
  return v;
}

/** Records the instructions as they stand as version 1 when a template has none yet (templates from before versioning). */
export async function baselineInstructionVersion(tx: Tx, templateId: string, actorId: string) {
  if (await tx.careInstructionVersion.count({ where: { templateId } })) return;
  await recordInstructionVersion(tx, templateId, actorId);
}

/** Changed instructions the signed-in carer has not yet confirmed, for repeating visits they are booked on soon. */
export async function myInstructionChanges(ctx: Ctx) {
  const staff = await myStaff(ctx);
  const today = londonDate();
  const visits = await db.visit.findMany({ where: { organisationId: staff.organisationId, publishedAt: { not: null }, templateId: { not: null }, date: { gte: dbDate(today), lte: dbDate(addDays(today, 14)) }, assignments: { some: { staffId: staff.id, removedAt: null } } }, select: { templateId: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } });
  const templateIds = [...new Set(visits.map((v) => v.templateId!))];
  if (!templateIds.length) return [];
  const versions = await db.careInstructionVersion.findMany({ where: { organisationId: staff.organisationId, templateId: { in: templateIds }, version: { gt: 1 } }, orderBy: { version: "desc" }, include: { acks: { where: { staffId: staff.id }, select: { id: true } } } });
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) if (!latest.has(v.templateId)) latest.set(v.templateId, v);
  return [...latest.values()].filter((v) => !v.acks.length).map((v) => {
    const su = visits.find((x) => x.templateId === v.templateId)!.serviceUser;
    return { id: v.id, person: `${su.preferredName ?? su.firstName} ${su.lastName}`, version: v.version, summary: v.changeSummary, effectiveFrom: fromDbDate(v.effectiveFrom), tasks: v.tasks, notes: v.notes };
  });
}

/** The carer confirms they have read a changed version. Only for a template they are booked on soon; once only. */
export async function acknowledgeInstructions(ctx: Ctx, versionId: string) {
  const staff = await myStaff(ctx);
  const mine = await myInstructionChanges(ctx);
  const v = await db.careInstructionVersion.findFirst({ where: { id: versionId, organisationId: staff.organisationId } });
  const booked = v ? await db.visit.count({ where: { organisationId: staff.organisationId, templateId: v.templateId, publishedAt: { not: null }, date: { gte: dbDate(londonDate()) }, assignments: { some: { staffId: staff.id, removedAt: null } } } }) : 0;
  if (!v || !booked) throw new NotFoundError("Instructions");
  if (!mine.some((m) => m.id === v.id) && (await db.careInstructionAck.count({ where: { versionId: v.id, staffId: staff.id } }))) return { already: true };
  await db.$transaction(async (tx) => {
    await tx.careInstructionAck.createMany({ data: [{ organisationId: staff.organisationId, versionId: v.id, staffId: staff.id, userId: ctx.userId }], skipDuplicates: true });
    await audit({ organisationId: staff.organisationId, actorId: ctx.userId, action: "template.instructions.acknowledged", entityType: "VisitTemplate", entityId: v.templateId, data: { version: v.version, staffId: staff.id } }, tx);
  });
  return { already: false };
}

/** The office's view: every version of a template's instructions, and which booked carers have confirmed each. */
export async function instructionHistory(ctx: Ctx, templateId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const t = await db.visitTemplate.findUnique({ where: { id: templateId }, include: { serviceUser: { select: { areaId: true, branchId: true } } } });
  assertInScope(scope, t, "Template");
  const versions = await db.careInstructionVersion.findMany({ where: { templateId }, orderBy: { version: "desc" }, include: { acks: { select: { staffId: true, at: true } } } });
  const booked = await db.visitAssignment.findMany({ where: { removedAt: null, visit: { templateId, publishedAt: { not: null }, date: { gte: dbDate(londonDate()) } } }, select: { staffId: true, staff: { select: { displayName: true } } } });
  const carers = new Map(booked.flatMap((b) => (b.staffId ? [[b.staffId, b.staff?.displayName ?? "Carer"] as const] : [])));
  return versions.map((v) => ({
    id: v.id, version: v.version, summary: v.changeSummary, effectiveFrom: fromDbDate(v.effectiveFrom), createdAt: v.createdAt, tasks: v.tasks, notes: v.notes,
    confirmed: v.acks.map((a) => ({ name: carers.get(a.staffId) ?? "Carer no longer booked", at: a.at })),
    waiting: v.version > 1 ? [...carers.entries()].filter(([id]) => !v.acks.some((a) => a.staffId === id)).map(([, name]) => name) : [],
  }));
}
