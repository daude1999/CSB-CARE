import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { effectiveClocks } from "@/server/rota/attendance";
import { rotaScope, visitWhere } from "@/server/rota/scope";
import { raiseAlert } from "@/server/workforce/impact";
import { myStaff } from "@/server/workforce/link";

/**
 * What happened on a visit, recorded by the carer who was there: the outcome of each planned task and notes. Both are
 * append-only (database triggers); a carer records each task once, and only on their own visit after clocking in.
 * A concern note raises an in-app alert for the office. Doses are recorded separately (src/server/care/medication.ts).
 */

export const NOTE_CATEGORIES = { GENERAL: "General note", HANDOVER: "Handover for the next carer", CONCERN: "Concern for the office" } as const;
/** How each kind of note reads in lists, including the notes written at clock-out. */
export const NOTE_LABEL: Record<string, string> = { GENERAL: "Note", HANDOVER: "Handover", CONCERN: "Concern", SHORT_VISIT: "Short visit note", CLOCK_OUT: "Clock-out note" };
export const OUTCOME_LABEL = { DONE: "Done", NOT_DONE: "Not done", REFUSED: "Refused" } as const;

const outcomesSchema = z.array(z.object({
  visitTaskId: z.string().min(1),
  outcome: z.enum(["DONE", "NOT_DONE", "REFUSED"]),
  note: z.string().trim().max(1000).optional(),
})).min(1, "Record at least one task");

/** The carer records task outcomes on their own visit. Refused or not done needs a reason. */
export async function recordTaskOutcomes(ctx: Ctx, visitId: string, input: z.input<typeof outcomesSchema>) {
  const p = outcomesSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the tasks");
  for (const o of p.data) if (o.outcome !== "DONE" && !o.note) throw new ValidationError("Say why a task was not done or was refused");
  const staff = await myStaff(ctx);
  return db.$transaction(async (tx) => {
    const v = await tx.visit.findFirst({ where: { id: visitId, organisationId: staff.organisationId, publishedAt: { not: null }, assignments: { some: { staffId: staff.id, removedAt: null } } }, include: { tasks: true, clocks: { where: { staffId: staff.id } } } });
    if (!v) throw new NotFoundError("Visit");
    if (!effectiveClocks(v.clocks).some((c) => c.kind === "IN")) throw new ValidationError("Clock in before recording tasks");
    if (["CANCELLED", "NOT_DELIVERED"].includes(v.status)) throw new ConflictError("This visit was not delivered");
    const already = new Set((await tx.visitTaskOutcome.findMany({ where: { visitId: v.id, staffId: staff.id }, select: { visitTaskId: true } })).map((x) => x.visitTaskId));
    let recorded = 0;
    for (const o of p.data) {
      if (!v.tasks.some((t) => t.id === o.visitTaskId)) throw new NotFoundError("Task");
      if (already.has(o.visitTaskId)) continue; // one outcome per task per carer; the first one stands
      await tx.visitTaskOutcome.create({ data: { organisationId: v.organisationId, visitId: v.id, visitTaskId: o.visitTaskId, outcome: o.outcome, note: o.note || null, staffId: staff.id, recordedById: ctx.userId } });
      recorded++;
    }
    if (!recorded) throw new ConflictError("These tasks are already recorded");
    await tx.visitEvent.create({ data: { organisationId: v.organisationId, visitId: v.id, type: "TASKS", actorId: ctx.userId, data: { staffId: staff.id, recorded } } });
    await audit({ organisationId: v.organisationId, actorId: ctx.userId, action: "visit.tasks.recorded", entityType: "Visit", entityId: v.id, data: { recorded } }, tx);
    return { recorded };
  });
}

const noteSchema = z.object({
  text: z.string().trim().min(3, "Write the note").max(4000),
  category: z.enum(["GENERAL", "HANDOVER", "CONCERN"]).default("GENERAL"),
});

/** A note on a visit, by its carer or by the office (rota.edit, in scope). Concerns alert the office in-app. */
export async function addVisitNote(ctx: Ctx, visitId: string, input: z.input<typeof noteSchema>) {
  const p = noteSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the note");
  const office = hasOrgPermission(ctx, "rota.edit");
  let staffId: string | null = null;
  let where: Prisma.VisitWhereInput;
  if (office) {
    where = { ...visitWhere(await rotaScope(ctx, "rota.edit")), id: visitId };
  } else {
    if (!hasOrgPermission(ctx, "visit.own")) throw new ForbiddenError("You cannot add notes to visits");
    const staff = await myStaff(ctx);
    staffId = staff.id;
    where = { id: visitId, organisationId: staff.organisationId, publishedAt: { not: null }, assignments: { some: { staffId: staff.id, removedAt: null } } };
  }
  return db.$transaction(async (tx) => {
    const v = await tx.visit.findFirst({ where, select: { id: true, organisationId: true, reference: true } });
    if (!v) throw new NotFoundError("Visit");
    const note = await tx.visitNote.create({ data: { organisationId: v.organisationId, visitId: v.id, authorUserId: ctx.userId, staffId, category: p.data.category, text: p.data.text } });
    if (p.data.category === "CONCERN") {
      await raiseAlert(tx, { organisationId: v.organisationId, kind: "CONCERN", severity: "WARNING", visitId: v.id, staffId, message: `Concern noted on ${v.reference} by ${ctx.userName}: ${p.data.text.slice(0, 160)}`, dedupeKey: `concern:${note.id}`, actionUrl: `/rota/visits/${v.id}` });
    }
    await audit({ organisationId: v.organisationId, actorId: ctx.userId, action: "visit.note.added", entityType: "Visit", entityId: v.id, data: { category: p.data.category } }, tx);
    return note;
  });
}

/** Notes written in a time range (when they were written, as the dashboard counts them), in the office's scope, newest first. */
export async function listVisitNotes(ctx: Ctx, f: { from: Date; to: Date; category?: string; q?: string }) {
  const scope = await rotaScope(ctx, "rota.view");
  const category = f.category && f.category in NOTE_LABEL ? f.category : undefined;
  return db.visitNote.findMany({
    where: { organisationId: scope.organisationId, createdAt: { gte: f.from, lt: f.to }, visit: visitWhere(scope), ...(category ? { category } : {}), ...(f.q ? { text: { contains: f.q, mode: "insensitive" } } : {}) },
    include: { visit: { select: { id: true, reference: true, scheduledStart: true, area: { select: { name: true } }, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}
