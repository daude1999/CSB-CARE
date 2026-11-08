import { baselineInstructionVersion, recordInstructionVersion } from "@/server/care/instructions";
import type { Prisma, VisitTemplate } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, fromDbDate, isIsoDate, londonDate, londonToUtc } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { assertInScope, rotaScope, serviceUserWhere, templateScopeWhere, type Scope } from "./scope";
import { MAX_CARERS, placeNumber, preferredOf, type PlaceKey } from "@/lib/carer-places";
export { preferredOf, preferredFor } from "@/lib/carer-places";

const ids = z.array(z.coerce.number().int());
export const templateSchema = z
  .object({
    serviceUserId: z.string().min(1, "Choose a service user"),
    callTypeId: z.string().min(1, "Choose a call type"),
    areaId: z.string().nullable().optional(),
    cycleWeeks: ids.refine((w) => w.length > 0 && w.every((n) => n >= 1 && n <= 4), "Choose at least one cycle week (1–4)"),
    weekdays: ids.refine((w) => w.length > 0 && w.every((n) => n >= 1 && n <= 7), "Choose at least one day"),
    startMinute: z.coerce.number().int().min(0, "Start time is required").max(1439),
    durationMin: z.coerce.number().int().min(5, "A visit lasts at least 5 minutes").max(1440, "A visit lasts at most 24 hours"),
    carersRequired: z.coerce.number({ invalid_type_error: "Enter how many carers are needed" }).int("Enter a whole number of carers").min(1, "A visit needs at least one carer").max(MAX_CARERS, `A visit can need at most ${MAX_CARERS} carers`),
    preferredStaff1Id: z.string().nullable().optional(),
    preferredStaff2Id: z.string().nullable().optional(),
    /** Preferred carers for places 3 and above, in order; "" = no preference for that place. */
    extraPreferredStaffIds: z.array(z.string().max(60)).max(MAX_CARERS - 2).default([]),
    shadowStaffId: z.string().nullable().optional(),
    timeLocked: z.boolean().default(false),
    medicationRequired: z.boolean().default(false),
    alertOnLate: z.boolean().default(true),
    rotaType: z.enum(["NORMAL", "ALTERNATE"]).default("NORMAL"),
    runRouteTemplateId: z.string().nullable().optional(),
    effectiveFrom: z.string().refine(isIsoDate, "Choose a start date"),
    effectiveTo: z.string().refine(isIsoDate).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    taskIds: z.array(z.string()).max(30).default([]),
  })
  .refine((t) => !t.effectiveTo || t.effectiveTo >= t.effectiveFrom, { message: "The end date must be after the start date", path: ["effectiveTo"] })
  .refine((t) => t.carersRequired >= 2 || !t.preferredStaff2Id, { message: "A second carer is only for visits needing two or more carers", path: ["preferredStaff2Id"] })
  .refine((t) => !t.preferredStaff1Id || t.preferredStaff1Id !== t.preferredStaff2Id, { message: "The two carers of a double-up must be different people", path: ["preferredStaff2Id"] })
  .refine((t) => { const all = preferredOf(t).filter((x): x is string => !!x); return new Set(all).size === all.length; }, { message: "Each carer place needs a different person", path: ["extraPreferredStaffIds"] })
  .refine((t) => !t.shadowStaffId || !preferredOf(t).includes(t.shadowStaffId), { message: "The shadow carer must be someone else", path: ["shadowStaffId"] });

export type TemplateInput = z.input<typeof templateSchema>;

export function parseTemplateInput(input: TemplateInput) {
  return parse(input);
}

function parse(input: TemplateInput) {
  const r = templateSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the template");
  return r.data;
}

/** Every id in a template must belong to the caller's organisation (and areas). */
export async function checkRefs(tx: Prisma.TransactionClient, scope: Scope, t: ReturnType<typeof parse>) {
  const org = scope.organisationId;
  const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: t.serviceUserId }, select: { id: true, status: true, areaId: true, organisationId: true, archivedAt: true } });
  if (!su) throw new NotFoundError("Service user");
  if (su.archivedAt) throw new ValidationError("This person is archived. Restore them before adding repeating visits.");
  if (su.status === "ENDED") throw new ValidationError("This person's care has ended");
  const ct = await tx.callType.findFirst({ where: { id: t.callTypeId, organisationId: org, active: true } });
  if (!ct) throw new NotFoundError("Call type");
  if (t.areaId) {
    const area = await tx.area.findFirst({ where: { id: t.areaId, organisationId: org } });
    assertInScope(scope, area ? { organisationId: area.organisationId, areaId: area.id } : null, "Area");
  }
  const staffIds = [...preferredOf(t), t.shadowStaffId].filter((x): x is string => !!x);
  if (staffIds.length) {
    const found = await tx.staffMember.count({ where: { organisationId: org, id: { in: staffIds }, employmentStatus: { not: "ARCHIVED" } } });
    if (found !== new Set(staffIds).size) throw new ValidationError("A preferred carer is not an active member of staff");
  }
  if (t.taskIds.length && (await tx.careTask.count({ where: { organisationId: org, id: { in: t.taskIds } } })) !== new Set(t.taskIds).size) throw new NotFoundError("Care task");
  if (t.runRouteTemplateId && !(await tx.runRouteTemplate.findFirst({ where: { id: t.runRouteTemplateId, organisationId: org } }))) throw new NotFoundError("Run route");
  return { areaId: t.areaId ?? su.areaId ?? null };
}

export function templateData(t: ReturnType<typeof parse>, areaId: string | null) {
  return data(t, areaId);
}

function data(t: ReturnType<typeof parse>, areaId: string | null) {
  return {
    serviceUserId: t.serviceUserId,
    callTypeId: t.callTypeId,
    areaId,
    cycleWeeks: [...new Set(t.cycleWeeks)].sort(),
    weekdays: [...new Set(t.weekdays)].sort(),
    startMinute: t.startMinute,
    durationMin: t.durationMin,
    carersRequired: t.carersRequired,
    preferredStaff1Id: t.preferredStaff1Id || null,
    preferredStaff2Id: t.carersRequired >= 2 ? t.preferredStaff2Id || null : null,
    // Only the places the template has; trailing empty places are not stored.
    extraPreferredStaffIds: trimTrailing(preferredOf(t).slice(2).map((x) => x ?? "")),
    shadowStaffId: t.shadowStaffId || null,
    timeLocked: t.timeLocked,
    medicationRequired: t.medicationRequired,
    alertOnLate: t.alertOnLate,
    rotaType: t.rotaType,
    runRouteTemplateId: t.runRouteTemplateId || null,
    effectiveFrom: dbDate(t.effectiveFrom),
    effectiveTo: t.effectiveTo ? dbDate(t.effectiveTo) : null,
    notes: t.notes?.trim() || null,
  };
}

function trimTrailing(list: string[]) {
  const out = [...list];
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** Creates one template inside a caller's transaction (used by createTemplate and by the support-plan import). */
export async function createTemplateInTx(tx: Prisma.TransactionClient, scope: Scope, userId: string, input: TemplateInput) {
  const t = parse(input);
  const { areaId } = await checkRefs(tx, scope, t);
  const created = await tx.visitTemplate.create({ data: { organisationId: scope.organisationId, createdById: userId, ...data(t, areaId), tasks: { create: t.taskIds.map((careTaskId) => ({ careTaskId })) } } });
  await audit({ organisationId: scope.organisationId, actorId: userId, action: "template.created", entityType: "VisitTemplate", entityId: created.id }, tx);
  await recordInstructionVersion(tx, created.id, userId);
  return created;
}

export async function createTemplate(ctx: Ctx, input: TemplateInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  parse(input);
  return db.$transaction((tx) => createTemplateInTx(tx, scope, ctx.userId, input));
}

export async function loadTemplate(tx: Prisma.TransactionClient, scope: Scope, id: string) {
  const t = await tx.visitTemplate.findUnique({ where: { id }, include: { serviceUser: { select: { areaId: true, branchId: true } } } });
  assertInScope(scope, t, "Template");
  return t;
}

/** Edits the pattern. Already-built visits are not touched; use previewTemplateChanges / applyTemplateChanges for those. */
export async function updateTemplate(ctx: Ctx, id: string, version: number, input: TemplateInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  const t = parse(input);
  return db.$transaction(async (tx) => {
    const before = await loadTemplate(tx, scope, id);
    if (before.version !== version) throw new ConflictError("This template changed since you opened it. Reload and try again.");
    const { areaId } = await checkRefs(tx, scope, t);
    // The instructions as they were, so the first change to a template made before versioning still counts as a change.
    await baselineInstructionVersion(tx, id, ctx.userId);
    await tx.templateTask.deleteMany({ where: { templateId: id } });
    const updated = await tx.visitTemplate.update({ where: { id }, data: { ...data(t, areaId), version: { increment: 1 }, tasks: { create: t.taskIds.map((careTaskId) => ({ careTaskId })) } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "template.updated", entityType: "VisitTemplate", entityId: id, data: { fromVersion: before.version } }, tx);
    // Changed notes or tasks become a new instruction version for carers to confirm (phase 9).
    await recordInstructionVersion(tx, id, ctx.userId);
    return updated;
  });
}

export async function setTemplatesEnabled(ctx: Ctx, templateIds: string[], enabled: boolean) {
  const scope = await rotaScope(ctx, "rota.edit");
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of templateIds) {
    try {
      await db.$transaction(async (tx) => {
        const t = await loadTemplate(tx, scope, id);
        if (t.enabled === enabled) return;
        await tx.visitTemplate.update({ where: { id }, data: { enabled, version: { increment: 1 } } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: enabled ? "template.enabled" : "template.disabled", entityType: "VisitTemplate", entityId: id }, tx);
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

export async function duplicateTemplate(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction(async (tx) => {
    const t = await tx.visitTemplate.findUnique({ where: { id }, include: { tasks: true, serviceUser: { select: { areaId: true, branchId: true } } } });
    assertInScope(scope, t, "Template");
    const { id: _id, version: _v, createdAt: _c, updatedAt: _u, tasks, serviceUser: _su, ...rest } = t;
    void _su;
    void _id;
    void _v;
    void _c;
    void _u;
    const copy = await tx.visitTemplate.create({ data: { ...rest, enabled: false, createdById: ctx.userId, tasks: { create: tasks.map((x) => ({ careTaskId: x.careTaskId })) } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "template.duplicated", entityType: "VisitTemplate", entityId: copy.id, data: { from: id } }, tx);
    return copy;
  });
}

/** Duplicate Templates: each copy starts disabled so it is never built until someone checks and enables it. */
export async function duplicateTemplates(ctx: Ctx, templateIds: string[]) {
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of [...new Set(templateIds)]) {
    try {
      await duplicateTemplate(ctx, id);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

/** Bulk time change for templates ("nudge"), validated per template. */
export async function nudgeTemplates(ctx: Ctx, templateIds: string[], minutes: number) {
  if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 240) throw new ValidationError("Move times by 1 to 240 minutes");
  const scope = await rotaScope(ctx, "rota.edit");
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of templateIds) {
    try {
      await db.$transaction(async (tx) => {
        const t = await loadTemplate(tx, scope, id);
        if (t.timeLocked) throw new ValidationError("Time is locked");
        const start = t.startMinute + minutes;
        if (start < 0 || start > 1439) throw new ValidationError("Would move the visit to another day");
        await tx.visitTemplate.update({ where: { id }, data: { startMinute: start, version: { increment: 1 } } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "template.nudged", entityType: "VisitTemplate", entityId: id, data: { minutes } }, tx);
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

export interface TemplateImpact {
  visitId: string;
  reference: string;
  date: string;
  change: string;
  apply: boolean;
  reason?: string;
}

/** The built future visits a template change would update, and those it must leave alone (changed by hand, started). */
export async function previewTemplateChanges(ctx: Ctx, templateId: string): Promise<{ template: VisitTemplate; impacts: TemplateImpact[] }> {
  const scope = await rotaScope(ctx, "rota.edit");
  const t = await loadTemplate(db, scope, templateId);
  const today = londonDate();
  const visits = await db.visit.findMany({ where: { templateId, organisationId: scope.organisationId, date: { gte: dbDate(today) } }, orderBy: { scheduledStart: "asc" }, include: { clocks: { select: { id: true }, take: 1 } } });
  const impacts: TemplateImpact[] = visits.map((v) => {
    const date = fromDbDate(v.date);
    const start = londonToUtc(date, t.startMinute);
    const end = new Date(start.getTime() + t.durationMin * 60000);
    const diffs: string[] = [];
    if (start.getTime() !== v.scheduledStart.getTime() || end.getTime() !== v.scheduledEnd.getTime()) diffs.push("times");
    if (v.callTypeId !== t.callTypeId) diffs.push("call type");
    if (v.medicationRequired !== t.medicationRequired || v.timeLocked !== t.timeLocked || v.alertOnLate !== t.alertOnLate) diffs.push("flags");
    if (v.carersRequired !== t.carersRequired) diffs.push("number of carers");
    const base = { visitId: v.id, reference: v.reference, date, change: diffs.join(", ") || "no change" };
    if (!diffs.length) return { ...base, apply: false, reason: "Already matches" };
    if (v.status !== "SCHEDULED" || v.clocks.length || v.scheduledStart <= new Date()) return { ...base, apply: false, reason: "Started or finished: history is kept" };
    if (v.manuallyChanged) return { ...base, apply: false, reason: "Changed by hand: left as it is" };
    if (v.timeLocked && diffs.includes("times")) return { ...base, apply: false, reason: "Time locked" };
    if (t.carersRequired < v.carersRequired) return { ...base, apply: false, reason: v.carersRequired === 2 && t.carersRequired === 1 ? "Reducing a double-up needs a coordinator to choose who stays" : "Reducing the number of carers needs a coordinator to choose who stays" };
    return { ...base, apply: true };
  });
  return { template: t, impacts };
}

/** Applies the template to the previewed visits, re-checking every carer at the new time. */
export async function applyTemplateChanges(ctx: Ctx, templateId: string, templateVersion: number) {
  const scope = await rotaScope(ctx, "rota.edit");
  const { template, impacts } = await previewTemplateChanges(ctx, templateId);
  if (template.version !== templateVersion) throw new ConflictError("The template changed after the preview. Preview again.");
  const { updateVisitInTx } = await import("./visits");
  const results: { reference: string; ok: boolean; message?: string }[] = [];
  for (const i of impacts.filter((x) => x.apply)) {
    try {
      await db.$transaction(async (tx) => {
        const start = londonToUtc(i.date, template.startMinute);
        await updateVisitInTx(tx, scope, ctx.userId, i.visitId, {
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + template.durationMin * 60000),
          callTypeId: template.callTypeId,
          medicationRequired: template.medicationRequired,
          timeLocked: template.timeLocked,
          alertOnLate: template.alertOnLate,
          carersRequired: template.carersRequired,
        }, { source: "template", keepAutomatic: true });
      });
      results.push({ reference: i.reference, ok: true });
    } catch (e) {
      results.push({ reference: i.reference, ok: false, message: (e as Error).message });
    }
  }
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "template.applied", entityType: "VisitTemplate", entityId: templateId, data: { applied: results.filter((r) => r.ok).length, refused: results.filter((r) => !r.ok).length } });
  return results;
}

/**
 * Moves one slot of a template to another carer (Template Planner). Refused when that carer already has a switched-on
 * template overlapping it on a shared cycle week and day. Built visits are unchanged; Build Rota re-checks everyone.
 */
export async function setTemplateCarer(ctx: Ctx, templateId: string, version: number, slot: PlaceKey, staffId: string | null) {
  const scope = await rotaScope(ctx, "rota.edit");
  return db.$transaction(async (tx) => {
    const t = await loadTemplate(tx, scope, templateId);
    if (t.version !== version) throw new ConflictError("This template changed since you opened it. Reload and try again.");
    await setCarerInTx(tx, scope, ctx.userId, t, slot, staffId);
  });
}

async function setCarerInTx(tx: Prisma.TransactionClient, scope: Scope, actorId: string, t: VisitTemplate, slot: PlaceKey, staffId: string | null) {
  const n = placeNumber(slot);
  if (n !== null && n > t.carersRequired) throw new ValidationError(t.carersRequired === 1 ? "This template needs one carer" : `This template needs ${t.carersRequired} carers`);
  const places = preferredOf(t);
  if (staffId) {
    const s = await tx.staffMember.findFirst({ where: { id: staffId, organisationId: scope.organisationId, employmentStatus: { not: "ARCHIVED" }, hrMissing: false } });
    if (!s) throw new NotFoundError("Staff member");
    const others = [...places.filter((_, i) => i + 1 !== n), slot === "SHADOW" ? null : t.shadowStaffId].filter((x): x is string => !!x);
    if (others.includes(staffId)) throw new ValidationError("This carer is already on this visit");
    const clash = await tx.visitTemplate.findFirst({
      where: {
        organisationId: scope.organisationId,
        enabled: true,
        id: { not: t.id },
        OR: [{ preferredStaff1Id: staffId }, { preferredStaff2Id: staffId }, { shadowStaffId: staffId }, { extraPreferredStaffIds: { has: staffId } }],
        cycleWeeks: { hasSome: t.cycleWeeks },
        weekdays: { hasSome: t.weekdays },
        startMinute: { lt: t.startMinute + t.durationMin },
      },
      include: { serviceUser: { select: { firstName: true, lastName: true } } },
    });
    if (clash && clash.startMinute + clash.durationMin > t.startMinute) throw new ValidationError(`${s.displayName} already has ${clash.serviceUser.firstName} ${clash.serviceUser.lastName} at an overlapping time in this pattern`);
  }
  let data: Prisma.VisitTemplateUpdateInput;
  if (n === null) data = { shadowStaffId: staffId };
  else if (n === 1) data = { preferredStaff1Id: staffId };
  else if (n === 2) data = { preferredStaff2Id: staffId };
  else {
    const extra = places.slice(2).map((x) => x ?? "");
    extra[n - 3] = staffId ?? "";
    data = { extraPreferredStaffIds: trimTrailing(extra) };
  }
  await tx.visitTemplate.update({ where: { id: t.id }, data: { ...data, version: { increment: 1 } } });
  await audit({ organisationId: scope.organisationId, actorId, action: "template.carer.changed", entityType: "VisitTemplate", entityId: t.id, data: { slot, staffId } }, tx);
}

export type TemplateBulkAction =
  | { kind: "assign"; staffId: string; slot: PlaceKey }
  | { kind: "unassign"; slot: PlaceKey }
  | { kind: "editTime"; startMinute: number }
  | { kind: "editDuration"; minutes: number }
  | { kind: "editService"; callTypeId: string }
  | { kind: "lock"; on: boolean }
  | { kind: "alert"; on: boolean }
  | { kind: "doubleUp"; carers: number };

/**
 * The Daily Templates bulk actions that change a field (OnePlan's Reassign, Unassign, Edit Time, Edit Duration, Edit
 * Service Name, Add/Remove Lock, Add/Remove Alert, Convert To Double Up, Revert To Single). Each template is checked
 * and saved on its own, so one refusal never undoes the others. Built visits are unchanged until the change is applied.
 */
export async function bulkTemplates(ctx: Ctx, templateIds: string[], action: TemplateBulkAction) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (!templateIds.length) throw new ValidationError("Select at least one template");
  if (templateIds.length > 500) throw new ValidationError("Select at most 500 templates at a time");
  if (action.kind === "editTime" && (!Number.isInteger(action.startMinute) || action.startMinute < 0 || action.startMinute > 1439)) throw new ValidationError("Enter a start time");
  if (action.kind === "editDuration" && (!Number.isInteger(action.minutes) || action.minutes < 5 || action.minutes > 1440)) throw new ValidationError("A visit lasts 5 minutes to 24 hours");
  if (action.kind === "editService" && !(await db.callType.findFirst({ where: { id: action.callTypeId, organisationId: scope.organisationId, active: true } }))) throw new NotFoundError("Service call");
  if (action.kind === "doubleUp" && (!Number.isInteger(action.carers) || action.carers < 1 || action.carers > MAX_CARERS)) throw new ValidationError(`Choose 1 to ${MAX_CARERS} carers`);
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of [...new Set(templateIds)]) {
    try {
      await db.$transaction(async (tx) => {
        const t = await loadTemplate(tx, scope, id);
        if (action.kind === "assign" || action.kind === "unassign") {
          await setCarerInTx(tx, scope, ctx.userId, t, action.slot, action.kind === "assign" ? action.staffId : null);
          return;
        }
        let patch: Prisma.VisitTemplateUpdateInput;
        switch (action.kind) {
          case "editTime":
            if (t.timeLocked) throw new ValidationError("Time is locked");
            patch = { startMinute: action.startMinute };
            break;
          case "editDuration":
            if (t.timeLocked) throw new ValidationError("Time is locked");
            patch = { durationMin: action.minutes };
            break;
          case "editService":
            patch = { callType: { connect: { id: action.callTypeId } } };
            break;
          case "lock":
            patch = { timeLocked: action.on };
            break;
          case "alert":
            patch = { alertOnLate: action.on };
            break;
          case "doubleUp":
            // Preferred carers beyond the new number are dropped from the pattern; built visits keep their carers.
            patch = { carersRequired: action.carers, ...(action.carers < 2 ? { preferredStaff2Id: null } : {}), extraPreferredStaffIds: trimTrailing(t.extraPreferredStaffIds.slice(0, Math.max(0, action.carers - 2))) };
            break;
        }
        await tx.visitTemplate.update({ where: { id }, data: { ...patch, version: { increment: 1 } } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: `template.bulk.${action.kind}`, entityType: "VisitTemplate", entityId: id, data: { ...action } }, tx);
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

export interface TemplateFilters {
  week?: number;
  day?: number;
  /** Any of these cycle weeks (Service User Profile -> Template). */
  weeks?: number[];
  /** Any of these ISO weekdays. */
  days?: number[];
  serviceUserId?: string;
  staffId?: string;
  areaId?: string;
  callTypeId?: string;
  state?: "on" | "off" | "all";
  noCarer?: boolean;
  q?: string;
}

/** Turns the Daily Templates filters into a query. Every filter narrows the caller's own scope; none can widen it. */
async function templateWhere(scope: Scope, f: TemplateFilters): Promise<Prisma.VisitTemplateWhereInput> {
  const q = f.q?.trim().slice(0, 100);
  let search: Prisma.VisitTemplateWhereInput[] = [];
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    // Staff names live on StaffMember, which a template refers to by id only.
    const staffIds = (await db.staffMember.findMany({ where: { organisationId: scope.organisationId, displayName: contains }, select: { id: true }, take: 200 })).map((s) => s.id);
    const ref = /^t-?[a-z0-9]{3,}$/i.test(q) ? q.replace(/^t-?/i, "").toLowerCase() : null;
    search = [{
      OR: [
        { serviceUser: { firstName: contains } },
        { serviceUser: { lastName: contains } },
        { serviceUser: { preferredName: contains } },
        { serviceUser: { reference: contains } },
        { callType: { name: contains } },
        ...(ref ? [{ id: { endsWith: ref } }] : []),
        ...(staffIds.length ? [{ preferredStaff1Id: { in: staffIds } }, { preferredStaff2Id: { in: staffIds } }, { extraPreferredStaffIds: { hasSome: staffIds } }] : []),
      ],
    }];
  }
  return {
    organisationId: scope.organisationId,
    AND: [
      templateScopeWhere(scope),
      ...(f.serviceUserId ? [{ serviceUserId: f.serviceUserId }] : []),
      ...(f.areaId ? [{ areaId: f.areaId }] : []),
      ...(f.callTypeId ? [{ callTypeId: f.callTypeId }] : []),
      ...(f.staffId ? [{ OR: [{ preferredStaff1Id: f.staffId }, { preferredStaff2Id: f.staffId }, { shadowStaffId: f.staffId }, { extraPreferredStaffIds: { has: f.staffId } }] }] : []),
      ...(f.week ? [{ cycleWeeks: { has: f.week } }] : []),
      ...(f.day ? [{ weekdays: { has: f.day } }] : []),
      ...(f.weeks?.length ? [{ cycleWeeks: { hasSome: f.weeks } }] : []),
      ...(f.days?.length ? [{ weekdays: { hasSome: f.days } }] : []),
      ...(f.state === "off" ? [{ enabled: false }] : f.state === "all" ? [] : [{ enabled: true }]),
      ...(f.noCarer ? [{ OR: [{ preferredStaff1Id: null }, { carersRequired: { gte: 2 }, preferredStaff2Id: null }, { id: { in: await shortExtraTemplateIds(scope.organisationId) } }] }] : []),
      ...search,
    ],
  };
}

/** Templates needing three or more carers with an empty preferred place from 3 upwards. */
async function shortExtraTemplateIds(organisationId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "VisitTemplate"
    WHERE "organisationId" = ${organisationId} AND "carersRequired" > 2
      AND cardinality(array_remove("extraPreferredStaffIds", '')) < "carersRequired" - 2`;
  return rows.map((r) => r.id);
}

const listInclude = {
  serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, riskLevel: true } },
  callType: { select: { name: true } },
  _count: { select: { tasks: true } },
} satisfies Prisma.VisitTemplateInclude;

/** Areas, run routes and carers named on a set of templates, looked up inside the caller's organisation only. */
async function decorate<T extends { areaId: string | null; runRouteTemplateId: string | null; carersRequired: number; preferredStaff1Id: string | null; preferredStaff2Id: string | null; extraPreferredStaffIds: string[]; shadowStaffId: string | null }>(organisationId: string, rows: T[]) {
  const areaIds = [...new Set(rows.map((r) => r.areaId).filter((x): x is string => !!x))];
  const routeIds = [...new Set(rows.map((r) => r.runRouteTemplateId).filter((x): x is string => !!x))];
  const staffIds = [...new Set(rows.flatMap((r) => [...preferredOf(r), r.shadowStaffId]).filter((x): x is string => !!x))];
  const [areas, routes, staff] = await Promise.all([
    areaIds.length ? db.area.findMany({ where: { organisationId, id: { in: areaIds } }, select: { id: true, name: true, colour: true } }) : [],
    routeIds.length ? db.runRouteTemplate.findMany({ where: { organisationId, id: { in: routeIds } }, select: { id: true, name: true, colour: true, textColour: true } }) : [],
    staffIds.length ? db.staffMember.findMany({ where: { organisationId, id: { in: staffIds } }, select: { id: true, displayName: true, employmentStatus: true, hrMissing: true } }) : [],
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const person = (id: string | null) => (id ? staffById.get(id) ?? { id, displayName: "Former staff", employmentStatus: "ARCHIVED" as const, hrMissing: true } : null);
  return rows.map((t) => ({
    ...t,
    area: t.areaId ? areaById.get(t.areaId) ?? null : null,
    runRoute: t.runRouteTemplateId ? routeById.get(t.runRouteTemplateId) ?? null : null,
    carer1: person(t.preferredStaff1Id),
    carer2: person(t.preferredStaff2Id),
    /** The preferred carer for every place, in order (place 1 first); null = none chosen. */
    carers: preferredOf(t).map(person),
    shadow: person(t.shadowStaffId),
  }));
}

/** The Daily Templates list: templates for one cycle week and weekday (or all), scoped to the caller's areas. */
export async function listTemplates(ctx: Ctx, f: TemplateFilters) {
  const scope = await rotaScope(ctx);
  const rows = await db.visitTemplate.findMany({
    where: await templateWhere(scope, f),
    include: listInclude,
    orderBy: [{ startMinute: "asc" }, { serviceUser: { lastName: "asc" } }],
    take: 1000,
  });
  return decorate(scope.organisationId, rows);
}

/** One page of the Daily Templates table, with the total that match, so thousands of templates never load at once. */
export async function templatePage(ctx: Ctx, f: TemplateFilters, paging: { page: number; per: number; sort?: "time" | "su"; dir?: "asc" | "desc" }) {
  const scope = await rotaScope(ctx);
  const where = await templateWhere(scope, f);
  const per = Math.min(Math.max(Math.trunc(paging.per) || 25, 1), 200);
  const total = await db.visitTemplate.count({ where });
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, Math.trunc(paging.page) || 1));
  const rows = await db.visitTemplate.findMany({
    where,
    include: listInclude,
    orderBy: paging.sort === "su"
      ? [{ serviceUser: { lastName: paging.dir ?? "asc" } }, { serviceUser: { firstName: paging.dir ?? "asc" } }, { startMinute: "asc" }, { id: "asc" }]
      : [{ startMinute: paging.dir ?? "asc" }, { serviceUser: { lastName: "asc" } }, { id: "asc" }],
    skip: (page - 1) * per,
    take: per,
  });
  return { rows: await decorate(scope.organisationId, rows), total, page, pages, per };
}

export type TemplateListRow = Awaited<ReturnType<typeof listTemplates>>[number];

/** The template reference shown to staff: the end of its id, so it is stable and searchable. */
export const templateRef = (id: string) => `T-${id.slice(-6).toUpperCase()}`;

/**
 * The Template Details panel: one template the caller may see, with plain-language warnings. Returns null when the
 * template does not exist or belongs to another organisation or area, so a changed URL shows nothing.
 */
export async function templateDetails(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx);
  const found = await db.visitTemplate.findFirst({
    where: { id, organisationId: scope.organisationId, AND: [templateScopeWhere(scope)] },
    include: { ...listInclude, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, riskLevel: true, status: true } } },
  });
  if (!found) return null;
  const [t] = await decorate(scope.organisationId, [found]);
  const today = londonDate();
  const futureVisits = await db.visit.count({ where: { organisationId: scope.organisationId, templateId: id, date: { gte: dbDate(today) }, status: "SCHEDULED" } });
  const warnings: string[] = [];
  if (!t!.enabled) warnings.push("Switched off: Build Rota skips this template until it is enabled.");
  const filled = t!.carers.filter(Boolean).length;
  const need = t!.carersRequired;
  if (filled < need) warnings.push(filled === 0 ? `No carer planned: needs ${need === 1 ? "a carer" : need === 2 ? "two carers" : `${need} carers`}.` : need === 2 ? "Double-up is missing its second carer." : `${need - filled} of ${need} carer places have no carer planned.`);
  for (const c of t!.carers) {
    if (c && (c.employmentStatus === "ARCHIVED" || c.hrMissing)) warnings.push(`${c.displayName} is no longer active in HR. Choose another carer.`);
    else if (c && c.employmentStatus === "ONBOARDING") warnings.push(`${c.displayName} is still onboarding. Build Rota checks readiness before booking them.`);
  }
  if (found.serviceUser.status === "ENDED") warnings.push("This person's care has ended.");
  else if (found.serviceUser.status === "PAUSED") warnings.push("This person's care is paused.");
  const from = fromDbDate(t!.effectiveFrom);
  const to = t!.effectiveTo ? fromDbDate(t!.effectiveTo) : null;
  if (to && to < today) warnings.push(`Ended on ${to}: no longer built.`);
  else if (from > today) warnings.push(`Starts on ${from}.`);
  return { template: t!, effectiveFrom: from, effectiveTo: to, futureVisits, warnings, serviceUserStatus: found.serviceUser.status };
}
