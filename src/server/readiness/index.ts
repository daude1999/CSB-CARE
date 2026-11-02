import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, staffDirectoryWhere } from "@/server/rota/scope";
import { evaluateReadiness, type ReadinessContext, type ReadinessResult, type ReadinessStatus } from "./evaluate";
import { loadReadinessFacts } from "./facts";
import { requireHrEvidenceEditor } from "@/server/workforce/hr-record";
import { raiseReviewFlag } from "./flags";

export { raiseReviewFlag } from "./flags";

export { READINESS_LABEL, type ReadinessResult, type ReadinessStatus } from "./evaluate";

type Db = Tx | Prisma.TransactionClient;

// ── Requirements (the matrix) ──

const scopeSchema = z.object({
  kind: z.enum(["ALL", "JOB_TITLE", "BRANCH", "CARE_TASK", "SERVICE_USER"]),
  jobTitle: z.string().trim().max(120).optional(),
  branchId: z.string().optional(),
  careTaskId: z.string().optional(),
  serviceUserId: z.string().optional(),
});

const requirementSchema = z.object({
  key: z.string().trim().min(2, "Give the requirement a short key").max(60).regex(/^[a-z0-9-]+$/, "Keys use lower-case letters, digits and hyphens"),
  name: z.string().trim().min(3, "Name the requirement").max(160),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(["TRAINING", "COMPETENCY", "POLICY", "QUALIFICATION"]),
  classification: z.enum(["MANDATORY_ROLE", "AGENCY_POLICY", "CONTRACT", "RECOMMENDED"]).default("MANDATORY_ROLE"),
  sourceAuthority: z.string().trim().max(200).optional(),
  sourceRef: z.string().trim().max(500).optional(),
  sourceVersion: z.string().trim().max(80).optional(),
  requiresPractical: z.boolean().default(false),
  renewalMonths: z.coerce.number().int().min(1).max(120).optional().nullable(),
  warningDays: z.coerce.number().int().min(0).max(365).default(30),
  hardStop: z.boolean().default(true),
  exceptionAllowed: z.boolean().default(true),
  policyId: z.string().optional().nullable(),
  effectiveFrom: z.string().refine(isIsoDate, "Choose the date this takes effect"),
  scopes: z.array(scopeSchema).min(1, "Say who this applies to"),
});
export type RequirementInput = z.input<typeof requirementSchema>;

async function checkScopes(tx: Db, organisationId: string, scopes: z.output<typeof scopeSchema>[]) {
  for (const s of scopes) {
    if (s.kind === "JOB_TITLE" && !s.jobTitle) throw new ValidationError("Give the job title for that scope");
    if (s.kind === "BRANCH" && !(s.branchId && (await tx.branch.findFirst({ where: { id: s.branchId, organisationId } })))) throw new NotFoundError("Branch");
    if (s.kind === "CARE_TASK" && !(s.careTaskId && (await tx.careTask.findFirst({ where: { id: s.careTaskId, organisationId } })))) throw new NotFoundError("Care task");
    if (s.kind === "SERVICE_USER" && !(s.serviceUserId && (await tx.serviceUser.findFirst({ where: { id: s.serviceUserId, organisationId } })))) throw new NotFoundError("Service user");
  }
}

export async function listRequirements(ctx: Ctx, opts: { includeRetired?: boolean } = {}) {
  const organisationId = requireOrgPermission(ctx, "readiness.view");
  return db.readinessRequirement.findMany({ where: { organisationId, ...(opts.includeRetired ? {} : { status: "ACTIVE" }) }, include: { scopes: true, _count: { select: { records: true, assessments: true, exceptions: true } } }, orderBy: [{ status: "asc" }, { category: "asc" }, { name: "asc" }] });
}

/** Creates a requirement, or a new version of one (the old version is retired, never rewritten, so history keeps its meaning). */
export async function saveRequirement(ctx: Ctx, input: RequirementInput & { id?: string }) {
  const organisationId = requireOrgPermission(ctx, "readiness.manage");
  const r = requirementSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the requirement");
  const d = r.data;
  if (d.category === "POLICY" && !d.policyId) throw new ValidationError("Choose the policy that must be acknowledged");
  if (d.category !== "POLICY") d.policyId = null;
  if (d.policyId && !(await db.policy.findFirst({ where: { id: d.policyId, organisationId } }))) throw new NotFoundError("Policy");
  return db.$transaction(async (tx) => {
    await checkScopes(tx, organisationId, d.scopes);
    const data = {
      organisationId, key: d.key, name: d.name, description: d.description || null, category: d.category, classification: d.classification,
      sourceAuthority: d.sourceAuthority || null, sourceRef: d.sourceRef || null, sourceVersion: d.sourceVersion || null,
      requiresPractical: d.requiresPractical, renewalMonths: d.renewalMonths ?? null, warningDays: d.warningDays, hardStop: d.hardStop, exceptionAllowed: d.exceptionAllowed,
      policyId: d.policyId ?? null, effectiveFrom: dbDate(d.effectiveFrom), createdById: ctx.userId,
      scopes: { create: d.scopes.map((s) => ({ kind: s.kind, jobTitle: s.kind === "JOB_TITLE" ? s.jobTitle : null, branchId: s.kind === "BRANCH" ? s.branchId : null, careTaskId: s.kind === "CARE_TASK" ? s.careTaskId : null, serviceUserId: s.kind === "SERVICE_USER" ? s.serviceUserId : null })) },
    };
    if (input.id) {
      const before = await tx.readinessRequirement.findFirst({ where: { id: input.id, organisationId, status: "ACTIVE" } });
      if (!before) throw new NotFoundError("Requirement");
      if (before.key !== d.key) throw new ValidationError("A requirement's key cannot change; create a new requirement instead");
      // New version: records and assessments of the old version still count, because they are matched by key below.
      await tx.readinessRequirement.update({ where: { id: before.id }, data: { status: "RETIRED", effectiveTo: dbDate(d.effectiveFrom) } });
      // Evidence stays attached to the version it was recorded against (those rows are immutable); the rules match
      // records by the requirement's key, so a verified record still counts for the new version.
      const next = await tx.readinessRequirement.create({ data: { ...data, version: before.version + 1, supersedesId: before.id } });
      await audit({ organisationId, actorId: ctx.userId, action: "readiness.requirement.versioned", entityType: "ReadinessRequirement", entityId: next.id, data: { key: d.key, version: next.version, supersedes: before.id } }, tx);
      // Everyone it applies to gets a look: the rule changed under them.
      await flagStaffForRequirement(tx, organisationId, next.id, `Requirement "${d.name}" changed (version ${next.version})`, ctx.userId);
      return next;
    }
    if (await tx.readinessRequirement.findFirst({ where: { organisationId, key: d.key } })) throw new ConflictError("A requirement with that key already exists");
    const created = await tx.readinessRequirement.create({ data });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.requirement.created", entityType: "ReadinessRequirement", entityId: created.id, data: { key: d.key } }, tx);
    return created;
  });
}

export async function retireRequirement(ctx: Ctx, id: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "readiness.manage");
  if (reason.trim().length < 3) throw new ValidationError("Say why this requirement is being retired");
  return db.$transaction(async (tx) => {
    const r = await tx.readinessRequirement.findFirst({ where: { id, organisationId, status: "ACTIVE" } });
    if (!r) throw new NotFoundError("Requirement");
    await tx.readinessRequirement.update({ where: { id }, data: { status: "RETIRED", effectiveTo: dbDate(londonDate()) } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.requirement.retired", entityType: "ReadinessRequirement", entityId: id, data: { reason: reason.trim() } }, tx);
  });
}

// ── Evidence: training records, verification, assessments ──

async function staffInScope(tx: Db, ctx: Ctx, staffId: string, perm: Parameters<typeof requireOrgPermission>[1]) {
  const scope = await rotaScope(ctx, perm);
  const s = await tx.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: staffId } });
  if (!s) throw new NotFoundError("Staff member");
  return { s, organisationId: scope.organisationId };
}

async function activeRequirement(tx: Db, organisationId: string, requirementId: string) {
  const r = await tx.readinessRequirement.findFirst({ where: { id: requirementId, organisationId, status: "ACTIVE" } });
  if (!r) throw new NotFoundError("Requirement");
  return r;
}

const recordSchema = z.object({
  requirementId: z.string().min(1, "Choose the requirement"),
  provider: z.string().trim().max(160).optional(),
  completedAt: z.string().refine(isIsoDate, "Give the completion date"),
  expiresAt: z.string().refine((s) => !s || isIsoDate(s), "Expiry must be a date").optional(),
  result: z.string().trim().max(120).optional(),
  evidenceId: z.string().optional(),
  evidenceNote: z.string().trim().max(1000).optional(),
  assessmentType: z.string().trim().max(120).optional(),
  assessor: z.string().trim().max(160).optional(),
  supersedesId: z.string().optional(),
});

/** Records a training completion, qualification or certificate as SUBMITTED. It counts for nothing until someone else verifies it. */
export async function recordTraining(ctx: Ctx, staffId: string, input: z.input<typeof recordSchema> | Record<string, unknown>) {
  const p = recordSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the record");
  const d = p.data;
  if (d.completedAt > londonDate()) throw new ValidationError("The completion date cannot be in the future");
  if (d.expiresAt && d.expiresAt <= d.completedAt) throw new ValidationError("Expiry must be after completion");
  return db.$transaction(async (tx) => {
    const { s, organisationId } = await staffInScope(tx, ctx, staffId, "readiness.record");
    await requireHrEvidenceEditor(ctx, s);
    const req = await activeRequirement(tx, organisationId, d.requirementId);
    if (req.category === "POLICY") throw new ValidationError("Policy requirements are met by reading and acknowledging the policy, not by a record");
    if (d.evidenceId && !(await tx.evidenceDocument.findFirst({ where: { id: d.evidenceId, organisationId } }))) throw new NotFoundError("Evidence");
    if (d.supersedesId && !(await tx.staffTrainingRecord.findFirst({ where: { id: d.supersedesId, staffId: s.id, organisationId } }))) throw new NotFoundError("Record to correct");
    const row = await tx.staffTrainingRecord.create({
      data: { organisationId, staffId: s.id, requirementId: req.id, provider: d.provider || null, completedAt: dbDate(d.completedAt), expiresAt: d.expiresAt ? dbDate(d.expiresAt) : null, result: d.result || null, evidenceId: d.evidenceId || null, evidenceNote: d.evidenceNote || null, assessmentType: d.assessmentType || null, assessor: d.assessor || null, enteredById: ctx.userId, supersedesId: d.supersedesId || null },
    });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.training.recorded", entityType: "StaffTrainingRecord", entityId: row.id, data: { staffId: s.id, requirement: req.key } }, tx);
    await snapshot(tx, organisationId, s.id, "training recorded");
    return row;
  });
}

/** Verification by a second person: the person who entered a record cannot verify it. */
export async function verifyTraining(ctx: Ctx, recordId: string, decision: "VERIFIED" | "REJECTED", note: string) {
  if (decision === "REJECTED" && note.trim().length < 3) throw new ValidationError("Say why the evidence is rejected");
  return db.$transaction(async (tx) => {
    const organisationId = requireOrgPermission(ctx, "readiness.verify");
    const row = await tx.staffTrainingRecord.findFirst({ where: { id: recordId, organisationId }, include: { requirement: true } });
    if (!row) throw new NotFoundError("Record");
    const { s } = await staffInScope(tx, ctx, row.staffId, "readiness.verify");
    await requireHrEvidenceEditor(ctx, s);
    if (row.verificationStatus !== "SUBMITTED") throw new ConflictError("This record has already been decided");
    if (row.enteredById === ctx.userId) throw new ForbiddenError("Someone other than the person who entered the record must verify it");
    await tx.staffTrainingRecord.update({ where: { id: row.id }, data: { verificationStatus: decision, verifiedById: ctx.userId, verifiedAt: new Date(), verificationNote: note.trim() || null } });
    await audit({ organisationId, actorId: ctx.userId, action: `readiness.training.${decision.toLowerCase()}`, entityType: "StaffTrainingRecord", entityId: row.id, data: { staffId: row.staffId, requirement: row.requirement.key } }, tx);
    await snapshot(tx, organisationId, row.staffId, `training ${decision.toLowerCase()}`);
  });
}

const assessmentSchema = z.object({
  requirementId: z.string().min(1, "Choose the requirement"),
  careTaskId: z.string().optional(),
  method: z.enum(["OBSERVED", "SIMULATED", "DISCUSSION", "WRITTEN"]),
  observedEvidence: z.string().trim().min(10, "Describe what was observed or discussed"),
  outcome: z.enum(["COMPETENT", "COMPETENT_WITH_RESTRICTIONS", "NOT_YET_COMPETENT"]),
  restrictions: z.string().trim().max(1000).optional(),
  remedialAction: z.string().trim().max(1000).optional(),
  assessedAt: z.string().refine(isIsoDate, "Give the assessment date"),
  reviewDue: z.string().refine((s) => !s || isIsoDate(s), "Review date must be a date").optional(),
  assessorRole: z.string().trim().max(120).optional(),
});

/** A practical competency assessment by the signed-in assessor. Append-only; the latest one decides. */
export async function recordAssessment(ctx: Ctx, staffId: string, input: z.input<typeof assessmentSchema> | Record<string, unknown>) {
  const p = assessmentSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the assessment");
  const d = p.data;
  if (d.assessedAt > londonDate()) throw new ValidationError("The assessment date cannot be in the future");
  if (d.outcome === "COMPETENT_WITH_RESTRICTIONS" && !d.restrictions) throw new ValidationError("Describe the restrictions");
  if (d.outcome === "NOT_YET_COMPETENT" && !d.remedialAction) throw new ValidationError("Say what happens next for someone not yet competent");
  return db.$transaction(async (tx) => {
    const { s, organisationId } = await staffInScope(tx, ctx, staffId, "readiness.verify");
    await requireHrEvidenceEditor(ctx, s);
    const req = await activeRequirement(tx, organisationId, d.requirementId);
    if (s.userId === ctx.userId) throw new ForbiddenError("Nobody assesses their own competence");
    const row = await tx.competencyAssessment.create({
      data: { organisationId, staffId: s.id, requirementId: req.id, careTaskId: d.careTaskId || null, method: d.method, observedEvidence: d.observedEvidence, assessorId: ctx.userId, assessorRole: d.assessorRole || null, outcome: d.outcome, restrictions: d.restrictions || null, remedialAction: d.remedialAction || null, assessedAt: dbDate(d.assessedAt), reviewDue: d.reviewDue ? dbDate(d.reviewDue) : null },
    });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.assessment.recorded", entityType: "CompetencyAssessment", entityId: row.id, data: { staffId: s.id, requirement: req.key, outcome: d.outcome } }, tx);
    await snapshot(tx, organisationId, s.id, "competency assessed");
    return row;
  });
}

// ── Restrictions, exceptions, review flags ──

const restrictionSchema = z.object({
  kind: z.enum(["TASK", "SERVICE_USER", "GENERAL"]),
  careTaskId: z.string().optional(),
  serviceUserId: z.string().optional(),
  reason: z.string().trim().min(5, "Give the reason for the restriction"),
  startsAt: z.string().refine(isIsoDate, "Give the start date"),
  endsAt: z.string().refine((s) => !s || isIsoDate(s), "End must be a date").optional(),
});

export async function addRestriction(ctx: Ctx, staffId: string, input: z.input<typeof restrictionSchema> | Record<string, unknown>) {
  const p = restrictionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the restriction");
  const d = p.data;
  if (d.kind === "TASK" && !d.careTaskId) throw new ValidationError("Choose the task");
  if (d.kind === "SERVICE_USER" && !d.serviceUserId) throw new ValidationError("Choose the person");
  return db.$transaction(async (tx) => {
    const { s, organisationId } = await staffInScope(tx, ctx, staffId, "readiness.verify");
    if (d.careTaskId && !(await tx.careTask.findFirst({ where: { id: d.careTaskId, organisationId } }))) throw new NotFoundError("Care task");
    if (d.serviceUserId && !(await tx.serviceUser.findFirst({ where: { id: d.serviceUserId, organisationId } }))) throw new NotFoundError("Service user");
    const row = await tx.staffRestriction.create({ data: { organisationId, staffId: s.id, kind: d.kind, careTaskId: d.kind === "TASK" ? d.careTaskId : null, serviceUserId: d.kind === "SERVICE_USER" ? d.serviceUserId : null, reason: d.reason, startsAt: dbDate(d.startsAt), endsAt: d.endsAt ? dbDate(d.endsAt) : null, createdById: ctx.userId } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.restriction.added", entityType: "StaffRestriction", entityId: row.id, data: { staffId: s.id, kind: d.kind } }, tx);
    await snapshot(tx, organisationId, s.id, "restriction added");
    return row;
  });
}

export async function liftRestriction(ctx: Ctx, restrictionId: string, reason: string) {
  if (reason.trim().length < 3) throw new ValidationError("Say why the restriction is lifted");
  return db.$transaction(async (tx) => {
    const organisationId = requireOrgPermission(ctx, "readiness.verify");
    const row = await tx.staffRestriction.findFirst({ where: { id: restrictionId, organisationId, liftedAt: null } });
    if (!row) throw new NotFoundError("Restriction");
    await staffInScope(tx, ctx, row.staffId, "readiness.verify");
    await tx.staffRestriction.update({ where: { id: row.id }, data: { liftedAt: new Date(), liftedById: ctx.userId, liftedReason: reason.trim() } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.restriction.lifted", entityType: "StaffRestriction", entityId: row.id, data: { staffId: row.staffId } }, tx);
    await snapshot(tx, organisationId, row.staffId, "restriction lifted");
  });
}

const exceptionSchema = z.object({
  requirementId: z.string().min(1, "Choose the requirement"),
  reason: z.string().trim().min(10, "Explain the operational reason"),
  compensatingControls: z.string().trim().min(10, "Describe the compensating controls (supervision, shadowing, limits)"),
  expiresAt: z.string().refine(isIsoDate, "Give the expiry date"),
});

/** A manager's time-limited exception. Refused for requirements that do not allow one, and never longer than 90 days. */
export async function grantException(ctx: Ctx, staffId: string, input: z.input<typeof exceptionSchema> | Record<string, unknown>) {
  const p = exceptionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the exception");
  const d = p.data;
  const today = londonDate();
  if (d.expiresAt <= today) throw new ValidationError("The exception must expire in the future");
  const limit = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 90)).toISOString().slice(0, 10);
  if (d.expiresAt > limit) throw new ValidationError("An exception lasts at most 90 days; review it and grant again if still needed");
  return db.$transaction(async (tx) => {
    const { s, organisationId } = await staffInScope(tx, ctx, staffId, "readiness.exception");
    const req = await activeRequirement(tx, organisationId, d.requirementId);
    if (!req.exceptionAllowed) throw new ForbiddenError(`"${req.name}" does not allow exceptions`);
    if (await tx.readinessException.findFirst({ where: { staffId: s.id, requirementId: req.id, revokedAt: null, expiresAt: { gte: dbDate(today) } } })) throw new ConflictError("An exception for this requirement is already in force");
    const row = await tx.readinessException.create({ data: { organisationId, staffId: s.id, requirementId: req.id, reason: d.reason, compensatingControls: d.compensatingControls, approvedById: ctx.userId, expiresAt: dbDate(d.expiresAt) } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.exception.granted", entityType: "ReadinessException", entityId: row.id, data: { staffId: s.id, requirement: req.key, expiresAt: d.expiresAt } }, tx);
    await snapshot(tx, organisationId, s.id, "exception granted");
    return row;
  });
}

export async function revokeException(ctx: Ctx, exceptionId: string, reason: string) {
  if (reason.trim().length < 3) throw new ValidationError("Say why the exception is revoked");
  return db.$transaction(async (tx) => {
    const organisationId = requireOrgPermission(ctx, "readiness.exception");
    const row = await tx.readinessException.findFirst({ where: { id: exceptionId, organisationId, revokedAt: null } });
    if (!row) throw new NotFoundError("Exception");
    await tx.readinessException.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedById: ctx.userId, revokedReason: reason.trim() } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.exception.revoked", entityType: "ReadinessException", entityId: row.id, data: { staffId: row.staffId } }, tx);
    await snapshot(tx, organisationId, row.staffId, "exception revoked");
  });
}

export async function raiseReview(ctx: Ctx, staffId: string, reason: string) {
  if (reason.trim().length < 5) throw new ValidationError("Say what needs reviewing");
  return db.$transaction(async (tx) => {
    const { s, organisationId } = await staffInScope(tx, ctx, staffId, "readiness.verify");
    const f = await raiseReviewFlag(tx, organisationId, s.id, reason.trim(), ctx.userId);
    await snapshot(tx, organisationId, s.id, "review raised");
    return f;
  });
}

export async function clearReview(ctx: Ctx, flagId: string, outcome: string) {
  if (outcome.trim().length < 5) throw new ValidationError("Record the outcome of the review");
  return db.$transaction(async (tx) => {
    const organisationId = requireOrgPermission(ctx, "readiness.verify");
    const f = await tx.staffReadinessFlag.findFirst({ where: { id: flagId, organisationId, clearedAt: null } });
    if (!f) throw new NotFoundError("Review");
    await staffInScope(tx, ctx, f.staffId, "readiness.verify");
    await tx.staffReadinessFlag.update({ where: { id: f.id }, data: { clearedAt: new Date(), clearedById: ctx.userId, outcome: outcome.trim() } });
    await audit({ organisationId, actorId: ctx.userId, action: "readiness.review.cleared", entityType: "StaffReadinessFlag", entityId: f.id, data: { staffId: f.staffId } }, tx);
    await snapshot(tx, organisationId, f.staffId, "review cleared");
  });
}

async function flagStaffForRequirement(tx: Db, organisationId: string, requirementId: string, reason: string, actorId: string | null) {
  const { facts, staff } = await loadReadinessFacts(tx, organisationId, (await tx.staffMember.findMany({ where: { organisationId, hrMissing: false, employmentStatus: { not: "ARCHIVED" } }, select: { id: true } })).map((s) => s.id));
  const req = facts.requirements.find((r) => r.id === requirementId);
  if (!req) return;
  const date = londonDate();
  for (const s of staff) {
    const applies = req.scopes.some((sc) => sc.kind === "ALL" || (sc.kind === "JOB_TITLE" && sc.jobTitle?.toLowerCase() === s.jobTitle.toLowerCase()) || (sc.kind === "BRANCH" && sc.branchId === s.branchId));
    if (applies && (iso(req.effectiveFrom) ?? "") <= date) await raiseReviewFlag(tx, organisationId, s.id, reason, actorId);
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ── Evaluation, snapshots and queues ──

/** Readiness for one or more people, evaluated now from the evidence. Server-internal (callers have authorised). */
export async function readinessFor(tx: Db, organisationId: string, staffIds: string[], context: Partial<ReadinessContext> = {}): Promise<Map<string, ReadinessResult>> {
  const { facts, staff } = await loadReadinessFacts(tx, organisationId, staffIds);
  const ctx: ReadinessContext = { date: context.date ?? londonDate(), careTaskIds: context.careTaskIds, serviceUserId: context.serviceUserId };
  return new Map(staff.map((s) => [s.id, evaluateReadiness(facts, s, ctx)]));
}

/** Writes a dated snapshot so the history of a person's status can be shown and dashboards reconcile with it. */
export async function snapshot(tx: Db, organisationId: string, staffId: string, trigger: string) {
  const r = (await readinessFor(tx, organisationId, [staffId])).get(staffId);
  if (!r) return null;
  return tx.staffReadinessSnapshot.create({ data: { organisationId, staffId, status: r.status, components: r.components.map((c) => ({ key: c.key, state: c.state, taskLevel: c.taskLevel })) as Prisma.InputJsonValue, reasons: r.reasons as Prisma.InputJsonValue, trigger } });
}

/** One person's readiness with evidence, for their profile page. Evidence detail needs readiness.evidence. */
export async function staffReadiness(ctx: Ctx, staffId: string) {
  const { s, organisationId } = await staffInScope(db, ctx, staffId, "readiness.view");
  const result = (await readinessFor(db, organisationId, [s.id])).get(s.id)!;
  const showEvidence = hasOrgPermission(ctx, "readiness.evidence");
  const [records, assessments, restrictions, exceptions, flags, history] = await Promise.all([
    showEvidence ? db.staffTrainingRecord.findMany({ where: { staffId: s.id }, include: { requirement: { select: { name: true, key: true } } }, orderBy: { createdAt: "desc" } }) : [],
    showEvidence ? db.competencyAssessment.findMany({ where: { staffId: s.id }, include: { requirement: { select: { name: true, key: true } } }, orderBy: { assessedAt: "desc" } }) : [],
    db.staffRestriction.findMany({ where: { staffId: s.id }, orderBy: { createdAt: "desc" } }),
    db.readinessException.findMany({ where: { staffId: s.id }, include: { requirement: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.staffReadinessFlag.findMany({ where: { staffId: s.id }, orderBy: { raisedAt: "desc" } }),
    db.staffReadinessSnapshot.findMany({ where: { staffId: s.id }, orderBy: { evaluatedAt: "desc" }, take: 20 }),
  ]);
  const userIds = [...new Set([...records.flatMap((r) => [r.enteredById, r.verifiedById]), ...assessments.map((a) => a.assessorId), ...exceptions.map((e) => e.approvedById), ...flags.flatMap((f) => [f.raisedById, f.clearedById]), ...restrictions.flatMap((r) => [r.createdById, r.liftedById])].filter((x): x is string => !!x))];
  const names = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { staff: s, result: showEvidence ? result : { ...result, components: result.components.map((c) => ({ ...c, evidence: [] })) }, records, assessments, restrictions, exceptions, flags, history, names, showEvidence };
}

/** The manager's queue: every active staff member in scope with their status, for filtering and counts. */
export async function readinessQueue(ctx: Ctx, f: { status?: string; branch?: string; q?: string; dueWithin?: number } = {}) {
  const scope = await rotaScope(ctx, "readiness.view");
  const where = staffDirectoryWhere(scope, { q: f.q });
  const staff = await db.staffMember.findMany({ where: { ...where, ...(f.branch ? { branchId: f.branch } : {}) }, select: { id: true, displayName: true, jobTitle: true, branchId: true, branch: { select: { name: true } }, userId: true }, orderBy: { displayName: "asc" } });
  const results = await readinessFor(db, scope.organisationId, staff.map((s) => s.id));
  const today = londonDate();
  const rows = staff.map((s) => {
    const r = results.get(s.id)!;
    const dueSoon = r.components.filter((c) => c.state === "DUE_SOON").map((c) => ({ name: c.name, dueDate: c.dueDate }));
    return { ...s, result: r, dueSoon };
  });
  const counts: Record<ReadinessStatus, number> = { READY: 0, READY_WITH_RESTRICTIONS: 0, NOT_READY: 0, PENDING_VERIFICATION: 0, REVIEW_REQUIRED: 0 };
  for (const r of rows) counts[r.result.status]++;
  const filtered = rows.filter((r) => (!f.status || r.result.status === f.status) && (!f.dueWithin || r.dueSoon.length > 0));
  const pendingRecords = await db.staffTrainingRecord.count({ where: { organisationId: scope.organisationId, verificationStatus: "SUBMITTED", staffId: { in: staff.map((s) => s.id) } } });
  return { rows: filtered, counts, total: rows.length, pendingRecords, today };
}

/** Evidence pack for one person as CSV rows (inspector-ready): every component with its evidence and verifier. */
export async function staffEvidenceRows(ctx: Ctx, staffId: string): Promise<{ columns: string[]; rows: (string | number)[][] }> {
  requireOrgPermission(ctx, "readiness.evidence");
  const r = await staffReadiness(ctx, staffId);
  const rows: (string | number)[][] = [];
  for (const c of r.result.components) {
    if (!c.evidence.length) rows.push([r.staff.displayName, r.staff.jobTitle, c.category, c.name, c.state, c.message, c.dueDate ?? "", "", "", ""]);
    for (const e of c.evidence) rows.push([r.staff.displayName, r.staff.jobTitle, c.category, c.name, c.state, c.message, c.dueDate ?? "", e.kind, e.summary, e.verifiedBy ?? ""]);
  }
  for (const x of r.restrictions.filter((x) => !x.liftedAt)) rows.push([r.staff.displayName, r.staff.jobTitle, "RESTRICTION", x.kind, "ACTIVE", x.reason, iso(x.endsAt) ?? "", "RESTRICTION", `From ${iso(x.startsAt)}`, r.names.get(x.createdById) ?? ""]);
  await audit({ organisationId: r.staff.organisationId, actorId: ctx.userId, action: "readiness.evidence.exported", entityType: "StaffMember", entityId: r.staff.id, data: { rows: rows.length } });
  return { columns: ["Staff member", "Job title", "Category", "Requirement", "State", "Detail", "Due", "Evidence", "Evidence detail", "Verified or approved by"], rows };
}

/** Training evidence waiting for a second person, for the people in the caller's scope. */
export async function pendingVerifications(ctx: Ctx, take = 50) {
  const scope = await rotaScope(ctx, "readiness.view");
  return db.staffTrainingRecord.findMany({
    where: { organisationId: scope.organisationId, verificationStatus: "SUBMITTED", staff: staffDirectoryWhere(scope, {}) },
    include: { staff: { select: { id: true, displayName: true } }, requirement: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take,
  });
}
