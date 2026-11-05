import { z } from "zod";
import type { OrgRole, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { FormSchema, StoredAnswers, readAnswers } from "@/lib/forms/schema";

/**
 * Filling in forms on screen (Forms PR 3). A record is started from a CSB form's current published version and keeps
 * that version for life. The workflow is DRAFT → SUBMITTED → APPROVED, with RETURNED (for correction, then
 * resubmitted) and VOIDED (with a reason). The database refuses any other move and freezes answers once submitted.
 *
 * Who sees what: the person who started a record, and the form's reviewers in the same organisation. Nobody else, so
 * a form link or address never exposes another person's answers. A reviewer cannot approve or return their own record.
 */

export const RECORD_STATUSES = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "VOIDED"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export const STATUS_LABELS: Record<RecordStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for review",
  RETURNED: "Returned for correction",
  APPROVED: "Approved",
  VOIDED: "Voided",
};

type DefinitionAccess = { completeRoles: OrgRole[]; reviewRoles: OrgRole[] };
const hasRole = (ctx: Ctx, roles: OrgRole[]) => ctx.orgRoles.some((r) => roles.includes(r));
export const canComplete = (ctx: Ctx, d: Pick<DefinitionAccess, "completeRoles">) => Boolean(ctx.organisationId) && hasRole(ctx, d.completeRoles);
export const canReview = (ctx: Ctx, d: Pick<DefinitionAccess, "reviewRoles">) => Boolean(ctx.organisationId) && hasRole(ctx, d.reviewRoles);

function requireOrg(ctx: Ctx) {
  if (!ctx.organisationId) throw new ForbiddenError("Choose an organisation first");
  return ctx.organisationId;
}

/** CSB forms (and the organisation's own) with a published version that the caller may fill in or review. */
export async function digitalForms(ctx: Ctx) {
  if (!ctx.organisationId) return [];
  const defs = await db.formDefinition.findMany({
    where: { status: "ACTIVE", currentVersionId: { not: null }, OR: [{ organisationId: null }, { organisationId: ctx.organisationId }] },
    orderBy: { ref: "asc" },
    select: { id: true, ref: true, title: true, description: true, completeRoles: true, reviewRoles: true, currentVersion: { select: { versionNumber: true, publishedAt: true } } },
  });
  return defs.map((d) => ({ ...d, canStart: canComplete(ctx, d), canReview: canReview(ctx, d) })).filter((d) => d.canStart || d.canReview);
}

/** Form references (e.g. CSB-FRM-020) the caller can start on screen, mapped to the form's id. */
export async function startableByRef(ctx: Ctx): Promise<Map<string, string>> {
  return new Map((await digitalForms(ctx)).filter((d) => d.canStart).map((d) => [d.ref, d.id]));
}

const Id = z.string().regex(/^[a-z0-9]{8,40}$/i, "That form could not be found");

async function nextReference(tx: Tx, orgId: string, ref: string) {
  const year = new Date().getUTCFullYear();
  const prefix = `${ref.replace(/^CSB-/, "")}-${year}-`;
  const n = await tx.formRecord.count({ where: { organisationId: orgId, reference: { startsWith: prefix } } });
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

/** Starts a draft from the form's current published version. */
export async function startForm(ctx: Ctx, definitionId: string) {
  const orgId = requireOrg(ctx);
  const parsed = Id.safeParse(definitionId);
  if (!parsed.success) throw new NotFoundError("Form");
  const id = parsed.data;
  const def = await db.formDefinition.findFirst({ where: { id, status: "ACTIVE", OR: [{ organisationId: null }, { organisationId: orgId }] }, include: { currentVersion: true } });
  if (!def) throw new NotFoundError("Form");
  if (!canComplete(ctx, def)) throw new ForbiddenError("You are not asked to fill in this form");
  if (!def.currentVersion || def.currentVersion.status !== "PUBLISHED") throw new ConflictError("This form has no published version yet");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const reference = await nextReference(tx, orgId, def.ref);
        const record = await tx.formRecord.create({
          data: { organisationId: orgId, definitionId: def.id, versionId: def.currentVersion!.id, reference, createdById: ctx.userId, ...(def.subjectType === "SELF" ? { subjectType: "USER", subjectId: ctx.userId } : {}) },
        });
        await tx.formRecordEvent.create({ data: { organisationId: orgId, recordId: record.id, type: "CREATED", actorId: ctx.userId, data: { version: def.currentVersion!.versionNumber } } });
        await audit({ organisationId: orgId, actorId: ctx.userId, action: "form.record.created", entityType: "FormRecord", entityId: record.id, data: { ref: def.ref, reference, version: def.currentVersion!.versionNumber } }, tx);
        return record;
      });
    } catch (e) {
      // Two people starting the same form at the same moment: take the next reference number.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new ConflictError("Could not start the form. Please try again.");
}

async function loadRecord(ctx: Ctx, recordId: string) {
  const orgId = requireOrg(ctx);
  const parsed = Id.safeParse(recordId);
  if (!parsed.success) throw new NotFoundError("Form record");
  const id = parsed.data;
  const r = await db.formRecord.findFirst({ where: { id, organisationId: orgId }, include: { definition: true, version: true } });
  // Someone who may not see a record gets the same answer as for one that does not exist.
  if (!r || !(r.createdById === ctx.userId || canReview(ctx, r.definition))) throw new NotFoundError("Form record");
  return { orgId, r };
}

/** One record with its fields, answers, history and what the caller may do with it. */
export async function getFormRecord(ctx: Ctx, recordId: string) {
  const { r } = await loadRecord(ctx, recordId);
  const events = await db.formRecordEvent.findMany({ where: { recordId: r.id }, orderBy: { createdAt: "asc" } });
  const people = await db.user.findMany({ where: { id: { in: [...new Set([r.createdById, ...(r.reviewerId ? [r.reviewerId] : []), ...events.map((e) => e.actorId)])] } }, select: { id: true, name: true } });
  const schema = FormSchema.parse(r.version.schemaJson);
  const status = r.status as RecordStatus;
  const mine = r.createdById === ctx.userId;
  const reviewer = canReview(ctx, r.definition);
  return {
    record: { id: r.id, reference: r.reference, status, answers: StoredAnswers.parse(r.answers ?? {}), createdAt: r.createdAt, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, returnReason: r.returnReason, voidReason: r.voidReason, lockVersion: r.lockVersion, createdById: r.createdById, reviewerId: r.reviewerId },
    form: { id: r.definition.id, ref: r.definition.ref, title: r.definition.title, description: r.definition.description },
    version: { number: r.version.versionNumber, status: r.version.status, publishedAt: r.version.publishedAt, instructions: r.version.instructions, isCurrent: r.definition.currentVersionId === r.version.id },
    schema,
    events,
    names: new Map(people.map((u) => [u.id, u.name])),
    can: {
      edit: mine && (status === "DRAFT" || status === "RETURNED"),
      review: reviewer && !mine && status === "SUBMITTED",
      voidIt: status !== "VOIDED" && ((mine && (status === "DRAFT" || status === "RETURNED")) || reviewer),
      ownRecordReview: reviewer && mine && status === "SUBMITTED",
    },
  };
}

type RawAnswers = Record<string, string | string[] | undefined>;
const today = () => new Date().toISOString().slice(0, 10);

function fieldErrors(schema: FormSchema, errors: Record<string, string>) {
  const byKey = new Map(schema.map((f) => [f.key, f]));
  // An attestation's label is a whole sentence, so its message stands alone.
  const list = Object.entries(errors).map(([k, m]) => (byKey.get(k)?.type === "attestation" ? m : `${byKey.get(k)?.label ?? k}: ${m}`));
  return new ValidationError(list.length > 2 ? `${list.slice(0, 2).join(". ")}. And ${list.length - 2} more.` : list.join(". "));
}

async function writeAnswers(ctx: Ctx, recordId: string, raw: RawAnswers, lockVersion: number, final: boolean) {
  const { orgId, r } = await loadRecord(ctx, recordId);
  if (r.createdById !== ctx.userId) throw new ForbiddenError("Only the person who started this form can change it");
  if (r.status !== "DRAFT" && r.status !== "RETURNED") throw new ConflictError("This form has been submitted, so its answers can no longer be changed");
  const schema = FormSchema.parse(r.version.schemaJson);
  const { answers, errors } = readAnswers(schema, raw, { final, today: today() });
  if (Object.keys(errors).length) throw fieldErrors(schema, errors);
  const before = StoredAnswers.parse(r.answers ?? {});
  const changed = [...new Set([...Object.keys(before), ...Object.keys(answers)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(answers[k]));
  const now = new Date();
  const resubmit = r.status === "RETURNED";
  return db.$transaction(async (tx) => {
    const data: Prisma.FormRecordUpdateManyMutationInput = {
      answers,
      lockVersion: { increment: 1 },
      ...(final ? { status: "SUBMITTED", submittedAt: now, returnReason: null } : {}),
    };
    // Optimistic lock: a save based on an older copy (another tab, another device) is refused, not merged.
    const u = await tx.formRecord.updateMany({ where: { id: r.id, lockVersion, status: { in: ["DRAFT", "RETURNED"] } }, data });
    if (!u.count) throw new ConflictError("This form was changed somewhere else since you opened it. Reload it to see the latest answers.");
    const type = final ? (resubmit ? "RESUBMITTED" : "SUBMITTED") : "SAVED";
    // History names the questions changed, never the answers, so it can be shown without exposing content.
    await tx.formRecordEvent.create({ data: { organisationId: orgId, recordId: r.id, type, actorId: ctx.userId, data: { changed } } });
    if (final) await audit({ organisationId: orgId, actorId: ctx.userId, action: resubmit ? "form.record.resubmitted" : "form.record.submitted", entityType: "FormRecord", entityId: r.id, data: { reference: r.reference } }, tx);
    return r.id;
  });
}

export const saveDraft = (ctx: Ctx, recordId: string, raw: RawAnswers, lockVersion: number) => writeAnswers(ctx, recordId, raw, lockVersion, false);
export const submitRecord = (ctx: Ctx, recordId: string, raw: RawAnswers, lockVersion: number) => writeAnswers(ctx, recordId, raw, lockVersion, true);

const Reason = z.string().trim().min(5, "Give a reason of at least a few words").max(1000);

async function decide(ctx: Ctx, recordId: string, lockVersion: number, decision: "APPROVED" | "RETURNED", reason?: string) {
  const { orgId, r } = await loadRecord(ctx, recordId);
  if (!canReview(ctx, r.definition)) throw new ForbiddenError("Only this form's reviewers can do that");
  if (r.createdById === ctx.userId) throw new ForbiddenError("You cannot review a form you filled in yourself. Ask another reviewer.");
  if (r.status !== "SUBMITTED") throw new ConflictError("Only a submitted form can be reviewed");
  const why = decision === "RETURNED" ? Reason.parse(reason ?? "") : null;
  return db.$transaction(async (tx) => {
    const u = await tx.formRecord.updateMany({
      where: { id: r.id, lockVersion, status: "SUBMITTED" },
      data: { status: decision, reviewerId: ctx.userId, reviewedAt: new Date(), lockVersion: { increment: 1 }, ...(why ? { returnReason: why } : {}) },
    });
    if (!u.count) throw new ConflictError("Someone else has already acted on this form. Reload it.");
    await tx.formRecordEvent.create({ data: { organisationId: orgId, recordId: r.id, type: decision, actorId: ctx.userId, note: why } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: decision === "APPROVED" ? "form.record.approved" : "form.record.returned", entityType: "FormRecord", entityId: r.id, data: { reference: r.reference } }, tx);
    return r.id;
  });
}

export const approveRecord = (ctx: Ctx, recordId: string, lockVersion: number) => decide(ctx, recordId, lockVersion, "APPROVED");
export async function returnRecord(ctx: Ctx, recordId: string, lockVersion: number, reason: string) {
  const parsed = Reason.safeParse(reason);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Give a reason");
  return decide(ctx, recordId, lockVersion, "RETURNED", parsed.data);
}

/** Voids a record with a reason. The record and its answers stay, marked void. */
export async function voidRecord(ctx: Ctx, recordId: string, reason: string) {
  const parsed = Reason.safeParse(reason);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Give a reason");
  const { orgId, r } = await loadRecord(ctx, recordId);
  const mine = r.createdById === ctx.userId;
  const allowed = r.status !== "VOIDED" && ((mine && (r.status === "DRAFT" || r.status === "RETURNED")) || canReview(ctx, r.definition));
  if (!allowed) throw new ForbiddenError("You cannot void this form");
  return db.$transaction(async (tx) => {
    const u = await tx.formRecord.updateMany({ where: { id: r.id, status: r.status }, data: { status: "VOIDED", voidReason: parsed.data, lockVersion: { increment: 1 } } });
    if (!u.count) throw new ConflictError("This form changed while you were voiding it. Reload it.");
    await tx.formRecordEvent.create({ data: { organisationId: orgId, recordId: r.id, type: "VOIDED", actorId: ctx.userId, note: parsed.data, data: { from: r.status } } });
    await audit({ organisationId: orgId, actorId: ctx.userId, action: "form.record.voided", entityType: "FormRecord", entityId: r.id, data: { reference: r.reference, from: r.status } }, tx);
    return r.id;
  });
}

/** The caller's own forms, the review queue for forms they review, and recently finished forms they may see. */
export async function formRecordLists(ctx: Ctx) {
  const orgId = requireOrg(ctx);
  const defs = await db.formDefinition.findMany({ where: { OR: [{ organisationId: null }, { organisationId: orgId }] }, select: { id: true, reviewRoles: true } });
  const reviewable = defs.filter((d) => canReview(ctx, d)).map((d) => d.id);
  const select = { id: true, reference: true, status: true, createdAt: true, updatedAt: true, submittedAt: true, reviewedAt: true, createdById: true, definition: { select: { ref: true, title: true } }, version: { select: { versionNumber: true } } } as const;
  const [mine, queue, finished] = await Promise.all([
    db.formRecord.findMany({ where: { organisationId: orgId, createdById: ctx.userId, status: { in: ["DRAFT", "SUBMITTED", "RETURNED"] } }, orderBy: { updatedAt: "desc" }, take: 100, select }),
    reviewable.length ? db.formRecord.findMany({ where: { organisationId: orgId, definitionId: { in: reviewable }, status: "SUBMITTED", createdById: { not: ctx.userId } }, orderBy: { submittedAt: "asc" }, take: 100, select }) : Promise.resolve([]),
    db.formRecord.findMany({
      where: { organisationId: orgId, status: { in: ["APPROVED", "VOIDED"] }, OR: [{ createdById: ctx.userId }, ...(reviewable.length ? [{ definitionId: { in: reviewable } }] : [])] },
      orderBy: { updatedAt: "desc" }, take: 50, select,
    }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: [...new Set([...queue, ...finished].map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return { mine, queue, finished, isReviewer: reviewable.length > 0, names: new Map(people.map((u) => [u.id, u.name])) };
}
