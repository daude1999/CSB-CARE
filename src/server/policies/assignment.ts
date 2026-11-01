import type { Acknowledgement, AcknowledgementState, OrgRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { notify } from "@/server/notifications/notify";
import { memberScope } from "@/server/rota/scope";

/**
 * Policy assignment and acknowledgement (specification Appendix E).
 *
 * Rules say who must read a policy. They resolve to staff (the HR projection) and, through an explicit link, to the
 * sign-in that can actually acknowledge. Staff with no sign-in still get a row, shown as "cannot sign: no login",
 * so nobody silently drops out of the figures. Each row carries its state; every change to it is an append-only
 * AcknowledgementEvent, and once acknowledged the row's evidence is frozen by a database trigger (a correction is a new
 * row that supersedes it). One function, `ackBucket`, decides how a row is counted, and every page and export uses it.
 */

type Db = Tx | Prisma.TransactionClient;

/** The exact statement a person agrees to. It is stored on the row with the time. */
export const ACK_WORDING = "I confirm I have read this policy and know where to ask questions.";
export const ACK_NOT_TRAINING = "Acknowledging a policy is not training and does not show competence. Practical training, observed competency and supervision are recorded separately.";

export type AckBucket = "not_opened" | "opened" | "acknowledged" | "assessment_pending" | "assessment_failed" | "exempted" | "withdrawn" | "superseded";
export const BUCKET_LABEL: Record<AckBucket, string> = {
  not_opened: "Not opened",
  opened: "Opened, not acknowledged",
  acknowledged: "Acknowledged",
  assessment_pending: "Assessment required",
  assessment_failed: "Assessment failed",
  exempted: "Exempted",
  withdrawn: "Withdrawn",
  superseded: "Corrected",
};

type AckLike = Pick<Acknowledgement, "state" | "acknowledgedAt" | "openedAt" | "dueAt" | "supersededAt" | "userId">;

/** How one row counts, and whether it is overdue. The single source for every count, list and CSV. */
export function ackBucket(a: AckLike, now = new Date()): { bucket: AckBucket; overdue: boolean; outstanding: boolean; cannotSign: boolean } {
  let bucket: AckBucket;
  if (a.supersededAt) bucket = "superseded";
  else if (a.state === "WITHDRAWN") bucket = "withdrawn";
  else if (a.state === "EXEMPTED") bucket = "exempted";
  else if (a.state === "ASSESSMENT_REQUIRED") bucket = "assessment_pending";
  else if (a.state === "ASSESSMENT_FAILED") bucket = "assessment_failed";
  else if (a.state === "ACKNOWLEDGED" || a.state === "ASSESSMENT_PASSED" || a.acknowledgedAt) bucket = "acknowledged";
  else if (a.openedAt || a.state === "OPENED" || a.state === "IN_PROGRESS") bucket = "opened";
  else bucket = "not_opened";
  const outstanding = bucket === "not_opened" || bucket === "opened" || bucket === "assessment_pending" || bucket === "assessment_failed";
  return { bucket, outstanding, overdue: outstanding && !!a.dueAt && a.dueAt < now, cannotSign: !a.userId && outstanding };
}

/** Rows that are part of the current record (corrections and withdrawn rows are kept but not counted as outstanding). */
export const currentAckWhere = { supersededAt: null } satisfies Prisma.AcknowledgementWhereInput;

/** Still waiting for the person (or their assessment): the same rule as `ackBucket(...).outstanding`. */
export const outstandingAckWhere = { supersededAt: null, state: { in: ["ASSIGNED", "OPENED", "IN_PROGRESS", "ASSESSMENT_REQUIRED", "ASSESSMENT_FAILED"] } } satisfies Prisma.AcknowledgementWhereInput;

async function event(tx: Db, a: { id: string; organisationId: string }, type: string, actorId: string | null, note?: string | null, data?: Prisma.InputJsonValue) {
  await tx.acknowledgementEvent.create({ data: { organisationId: a.organisationId, acknowledgementId: a.id, type, actorId, note: note ?? null, data: data ?? undefined } });
}

// ── Which publication counts ──

/** The publication staff must have acknowledged: the latest published one that was a material change. */
export async function materialPublication(tx: Db, policyId: string) {
  return tx.policyPublication.findFirst({ where: { policyId, status: "PUBLISHED", materialRevision: true }, orderBy: { publishedAt: "desc" } });
}

// ── Rules ──

const ruleSchema = z.object({
  policyId: z.string().min(1, "Choose the policy"),
  scope: z.enum(["ORG", "BRANCH", "ROLE", "JOB_TITLE", "STAFF"]),
  branchId: z.string().optional(),
  orgRole: z.enum(["ORG_ADMIN", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD", "STAFF", "CARE_MANAGER", "CARE_COORDINATOR", "CARER", "FINANCE_OFFICER"]).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  staffMemberIds: z.array(z.string()).optional(),
  mandatory: z.boolean().default(true),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  dueDays: z.coerce.number().int().min(1, "Allow at least a day").max(180).default(14),
  requiresAssessment: z.boolean().default(false),
});
export type RuleInput = z.input<typeof ruleSchema>;

type Target = { staffMemberId: string | null; userId: string | null };

/** Everyone a rule covers today: staff in the HR projection (with their linked sign-in) and, for organisation or role rules, members without a staff record. */
async function ruleTargets(tx: Db, organisationId: string, rule: { scope: string; branchId: string | null; orgRole: OrgRole | null; jobTitle: string | null; staffMemberId: string | null }): Promise<Target[]> {
  const active: Prisma.StaffMemberWhereInput = { organisationId, hrMissing: false, employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } };
  const staff = (where: Prisma.StaffMemberWhereInput) => tx.staffMember.findMany({ where: { ...active, ...where }, select: { id: true, userId: true } });
  let out: Target[] = [];
  if (rule.scope === "ORG") out = (await staff({})).map((s) => ({ staffMemberId: s.id, userId: s.userId }));
  if (rule.scope === "BRANCH" && rule.branchId) out = (await staff({ branchId: rule.branchId })).map((s) => ({ staffMemberId: s.id, userId: s.userId }));
  if (rule.scope === "JOB_TITLE" && rule.jobTitle) out = (await staff({ jobTitle: { equals: rule.jobTitle, mode: "insensitive" } })).map((s) => ({ staffMemberId: s.id, userId: s.userId }));
  if (rule.scope === "STAFF" && rule.staffMemberId) out = (await staff({ id: rule.staffMemberId })).map((s) => ({ staffMemberId: s.id, userId: s.userId }));
  if (rule.scope === "ORG" || rule.scope === "ROLE") {
    // Office members may have no HR record; they still sign in and read policies.
    const members = await tx.membership.findMany({ where: { organisationId, user: { deactivatedAt: null }, ...(rule.scope === "ROLE" && rule.orgRole ? { roles: { has: rule.orgRole } } : {}) }, select: { userId: true } });
    const linked = new Map((await tx.staffMember.findMany({ where: { organisationId, userId: { in: members.map((m) => m.userId) } }, select: { id: true, userId: true } })).map((s) => [s.userId as string, s.id]));
    for (const m of members) if (!out.some((t) => t.userId === m.userId)) out.push({ staffMemberId: linked.get(m.userId) ?? null, userId: m.userId });
  }
  return out;
}

const targetKey = (t: Target) => (t.staffMemberId ? `s:${t.staffMemberId}` : `u:${t.userId}`);

/** Creates the rows a publication needs for the policy's active rules (or, with no rules, for every member as before). Idempotent. */
export async function assignPublication(tx: Db, publicationId: string, opts: { onlyStaffIds?: string[]; actorId?: string | null } = {}) {
  const pub = await tx.policyPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { policy: { select: { id: true, branchId: true } } } });
  if (!pub.organisationId) return 0;
  const organisationId = pub.organisationId;
  const rules = await tx.policyAssignmentRule.findMany({ where: { organisationId, policyId: pub.policyId, withdrawnAt: null }, orderBy: [{ mandatory: "desc" }, { priority: "asc" }, { createdAt: "asc" }] });
  // Rules are an explicit request to read the policy; without rules, only publications marked "staff must acknowledge" are assigned.
  if (!rules.length && !pub.requiresAcknowledgement) return 0;
  const wanted = new Map<string, Target & { ruleId: string | null; mandatory: boolean; dueAt: Date | null; requiresAssessment: boolean }>();
  const base = pub.publishedAt ?? new Date();
  if (rules.length) {
    for (const r of rules) {
      for (const t of await ruleTargets(tx, organisationId, r)) {
        const k = targetKey(t);
        if (!wanted.has(k)) wanted.set(k, { ...t, ruleId: r.id, mandatory: r.mandatory, dueAt: new Date(base.getTime() + r.dueDays * 86400_000), requiresAssessment: r.requiresAssessment });
      }
    }
  } else {
    // No rules yet: everyone in the organisation (or the policy's branch), as policies were assigned before rules existed.
    const members = await tx.membership.findMany({ where: { organisationId, user: { deactivatedAt: null }, ...(pub.policy.branchId ? { OR: [{ branchId: pub.policy.branchId }, { branchId: null }] } : {}) }, select: { userId: true } });
    const linked = new Map((await tx.staffMember.findMany({ where: { organisationId, userId: { in: members.map((m) => m.userId) } }, select: { id: true, userId: true } })).map((s) => [s.userId as string, s.id]));
    for (const m of members) wanted.set(`u:${m.userId}`, { staffMemberId: linked.get(m.userId) ?? null, userId: m.userId, ruleId: null, mandatory: true, dueAt: pub.acknowledgementDueAt, requiresAssessment: false });
  }
  // Rows made before a staff record was linked get the link now, so nobody is counted twice.
  for (const w of wanted.values()) if (w.staffMemberId && w.userId) await linkRows(tx, publicationId, w.staffMemberId, w.userId);
  const existing = await tx.acknowledgement.findMany({ where: { publicationId, supersededAt: null }, select: { staffMemberId: true, userId: true } });
  const have = new Set(existing.flatMap((e) => [e.staffMemberId ? `s:${e.staffMemberId}` : null, e.userId ? `u:${e.userId}` : null].filter((x): x is string => !!x)));
  let created = 0;
  for (const [k, w] of wanted) {
    if (have.has(k) || (w.userId && have.has(`u:${w.userId}`)) || (w.staffMemberId && have.has(`s:${w.staffMemberId}`))) continue;
    if (opts.onlyStaffIds && !(w.staffMemberId && opts.onlyStaffIds.includes(w.staffMemberId))) continue;
    const row = await tx.acknowledgement.create({ data: { publicationId, organisationId, userId: w.userId, staffMemberId: w.staffMemberId, ruleId: w.ruleId, mandatory: w.mandatory, dueAt: w.dueAt, requiresAssessment: w.requiresAssessment } });
    await event(tx, row, "ASSIGNED", opts.actorId ?? null, w.ruleId ? null : "Assigned to every member (the policy has no assignment rules)", { ruleId: w.ruleId, mandatory: w.mandatory, cannotSign: !w.userId });
    created++;
  }
  return created;
}

/** Joins a person's staff record and sign-in on one publication's rows, where that does not collide with another current row. */
async function linkRows(tx: Db, publicationId: string, staffMemberId: string, userId: string) {
  const byUser = await tx.acknowledgement.findFirst({ where: { publicationId, userId, supersededAt: null } });
  const byStaff = await tx.acknowledgement.findFirst({ where: { publicationId, staffMemberId, supersededAt: null } });
  if (byUser && !byUser.staffMemberId && !byStaff) await tx.acknowledgement.update({ where: { id: byUser.id }, data: { staffMemberId } });
  if (byStaff && !byStaff.userId && !byUser && !byStaff.acknowledgedAt) await tx.acknowledgement.update({ where: { id: byStaff.id }, data: { userId } });
}

/** After a sign-in is linked to a staff record: outstanding rows for the person become signable, and older rows gain the staff link. */
export async function linkAcknowledgements(tx: Db, organisationId: string, staffMemberId: string, userId: string) {
  const pubs = await tx.acknowledgement.findMany({ where: { organisationId, supersededAt: null, OR: [{ staffMemberId }, { userId }] }, select: { publicationId: true }, distinct: ["publicationId"] });
  for (const p of pubs) await linkRows(tx, p.publicationId, staffMemberId, userId);
}

export async function createRule(ctx: Ctx, input: RuleInput) {
  const organisationId = requireOrgPermission(ctx, "signoff.manage");
  const p = ruleSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the assignment");
  const d = p.data;
  const policy = await db.policy.findFirst({ where: { id: d.policyId, organisationId, kind: "CUSTOMER" } });
  if (!policy) throw new NotFoundError("Policy");
  if (d.scope === "BRANCH" && !(d.branchId && (await db.branch.findFirst({ where: { id: d.branchId, organisationId } })))) throw new ValidationError("Choose the branch");
  if (d.scope === "ROLE" && !d.orgRole) throw new ValidationError("Choose the role");
  if (d.scope === "JOB_TITLE" && !d.jobTitle) throw new ValidationError("Give the job title");
  const staffIds = d.scope === "STAFF" ? [...new Set(d.staffMemberIds ?? [])] : [null];
  if (d.scope === "STAFF") {
    if (!staffIds.length) throw new ValidationError("Choose at least one person");
    const found = await db.staffMember.count({ where: { organisationId, id: { in: staffIds as string[] } } });
    if (found !== staffIds.length) throw new NotFoundError("Staff member");
  }
  // A branch-limited manager may only target their own branches.
  const scope = await memberScope(ctx.userId, organisationId);
  if (scope.branchIds && (d.scope === "ORG" || d.scope === "ROLE" || d.scope === "JOB_TITLE" || (d.scope === "BRANCH" && !scope.branchIds.includes(d.branchId!)))) throw new ForbiddenError("You can only assign policies to your own branches");
  return db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const staffMemberId of staffIds) {
      const rule = await tx.policyAssignmentRule.create({ data: { organisationId, policyId: policy.id, scope: d.scope, branchId: d.scope === "BRANCH" ? d.branchId : null, orgRole: d.scope === "ROLE" ? d.orgRole : null, jobTitle: d.scope === "JOB_TITLE" ? d.jobTitle : null, staffMemberId, mandatory: d.mandatory, priority: d.priority, dueDays: d.dueDays, requiresAssessment: d.requiresAssessment, ownerId: ctx.userId, createdById: ctx.userId } });
      ids.push(rule.id);
      await audit({ organisationId, actorId: ctx.userId, action: "policy.assignment.created", entityType: "PolicyAssignmentRule", entityId: rule.id, data: { policyId: policy.id, scope: d.scope } }, tx);
    }
    // Assign the current version straight away.
    const pub = await materialPublication(tx, policy.id);
    const assigned = pub ? await assignPublication(tx, pub.id, { actorId: ctx.userId }) : 0;
    return { ruleIds: ids, assigned };
  });
}

/** Withdraws a rule. Outstanding rows it created are withdrawn too unless another rule still covers the person; acknowledged evidence is never touched. */
export async function withdrawRule(ctx: Ctx, ruleId: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "signoff.manage");
  if (reason.trim().length < 3) throw new ValidationError("Say why the assignment is withdrawn");
  return db.$transaction(async (tx) => {
    const rule = await tx.policyAssignmentRule.findFirst({ where: { id: ruleId, organisationId, withdrawnAt: null } });
    if (!rule) throw new NotFoundError("Assignment");
    await tx.policyAssignmentRule.update({ where: { id: rule.id }, data: { withdrawnAt: new Date(), withdrawnById: ctx.userId, withdrawnReason: reason.trim() } });
    const others = await tx.policyAssignmentRule.findMany({ where: { organisationId, policyId: rule.policyId, withdrawnAt: null } });
    const stillCovered = new Set<string>();
    for (const o of others) for (const t of await ruleTargets(tx, organisationId, o)) stillCovered.add(targetKey(t));
    const rows = await tx.acknowledgement.findMany({ where: { ruleId: rule.id, supersededAt: null, acknowledgedAt: null, state: { in: ["ASSIGNED", "OPENED", "IN_PROGRESS"] } } });
    let withdrawn = 0;
    for (const r of rows) {
      if (stillCovered.has(r.staffMemberId ? `s:${r.staffMemberId}` : `u:${r.userId}`)) continue;
      await tx.acknowledgement.update({ where: { id: r.id }, data: { state: "WITHDRAWN", withdrawnAt: new Date(), withdrawnById: ctx.userId, withdrawnReason: reason.trim() } });
      await event(tx, r, "WITHDRAWN", ctx.userId, reason.trim());
      withdrawn++;
    }
    await audit({ organisationId, actorId: ctx.userId, action: "policy.assignment.withdrawn", entityType: "PolicyAssignmentRule", entityId: rule.id, data: { reason: reason.trim(), withdrawn } }, tx);
    return { withdrawn };
  });
}

/**
 * Brings one person's assignments up to date after an HR change (new starter, branch or role change): assigns the
 * current version of every policy whose rules now cover them, and withdraws outstanding rows whose rules no longer do.
 */
export async function reconcileStaffAssignments(organisationId: string, staffId: string, actorId: string | null = null) {
  return db.$transaction(async (tx) => {
    const rules = await tx.policyAssignmentRule.findMany({ where: { organisationId, withdrawnAt: null } });
    const byPolicy = new Map<string, typeof rules>();
    for (const r of rules) byPolicy.set(r.policyId, [...(byPolicy.get(r.policyId) ?? []), r]);
    let assigned = 0;
    let withdrawn = 0;
    for (const [policyId, rs] of byPolicy) {
      const pub = await materialPublication(tx, policyId);
      if (!pub) continue;
      let covered = false;
      for (const r of rs) if ((await ruleTargets(tx, organisationId, r)).some((t) => t.staffMemberId === staffId)) covered = true;
      if (covered) assigned += await assignPublication(tx, pub.id, { onlyStaffIds: [staffId], actorId });
      else {
        const open = await tx.acknowledgement.findMany({ where: { publicationId: pub.id, staffMemberId: staffId, supersededAt: null, acknowledgedAt: null, ruleId: { not: null }, state: { in: ["ASSIGNED", "OPENED", "IN_PROGRESS"] } } });
        for (const a of open) {
          await tx.acknowledgement.update({ where: { id: a.id }, data: { state: "WITHDRAWN", withdrawnAt: new Date(), withdrawnReason: "No longer covered after an HR change" } });
          await event(tx, a, "WITHDRAWN", actorId, "No longer covered after an HR change");
          withdrawn++;
        }
      }
    }
    return { assigned, withdrawn };
  });
}

// ── Staff actions ──

/** First time the person opens the policy while it is outstanding. Recorded once; opening is not acknowledgement. */
export async function markOpened(ctx: Ctx, policyId: string) {
  if (!ctx.organisationId) return null;
  const pub = await materialPublication(db, policyId);
  if (!pub) return null;
  const row = await db.acknowledgement.findFirst({ where: { publicationId: pub.id, userId: ctx.userId, organisationId: ctx.organisationId, supersededAt: null, openedAt: null, acknowledgedAt: null, state: "ASSIGNED" } });
  if (!row) return null;
  return db.$transaction(async (tx) => {
    const n = await tx.acknowledgement.updateMany({ where: { id: row.id, openedAt: null }, data: { openedAt: new Date(), state: "OPENED" } });
    if (n.count) await event(tx, row, "OPENED", ctx.userId);
    return row.id;
  });
}

/** The person acknowledges their own row, with the stored wording. Only they can; the row is then frozen. */
export async function acknowledgeRow(ctx: Ctx, acknowledgementId: string) {
  return db.$transaction(async (tx) => {
    const a = await tx.acknowledgement.findFirst({ where: { id: acknowledgementId, organisationId: ctx.organisationId ?? "", userId: ctx.userId } });
    if (!a) throw new NotFoundError("Acknowledgement");
    if (a.acknowledgedAt) return a;
    if (a.supersededAt || a.state === "WITHDRAWN" || a.state === "EXEMPTED") throw new ConflictError("This reading assignment is no longer open");
    const now = new Date();
    const updated = await tx.acknowledgement.update({ where: { id: a.id }, data: { acknowledgedAt: now, openedAt: a.openedAt ?? now, wording: ACK_WORDING, state: a.requiresAssessment ? "ASSESSMENT_REQUIRED" : "ACKNOWLEDGED" } });
    await event(tx, a, "ACKNOWLEDGED", ctx.userId, ACK_WORDING);
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "policy.acknowledged", entityType: "Acknowledgement", entityId: a.id }, tx);
    return updated;
  });
}

// ── Manager actions ──

async function managedRow(tx: Db, ctx: Ctx, acknowledgementId: string) {
  const organisationId = requireOrgPermission(ctx, "signoff.manage");
  const a = await tx.acknowledgement.findFirst({ where: { id: acknowledgementId, organisationId }, include: { staffMember: { select: { branchId: true } } } });
  if (!a) throw new NotFoundError("Acknowledgement");
  const scope = await memberScope(ctx.userId, organisationId);
  if (scope.branchIds && a.staffMember?.branchId && !scope.branchIds.includes(a.staffMember.branchId)) throw new NotFoundError("Acknowledgement");
  return a;
}

const assessmentSchema = z.object({
  method: z.enum(["KNOWLEDGE_CHECK", "DISCUSSION", "COMPETENCY_SIGN_OFF"]),
  score: z.coerce.number().int().min(0).max(100).optional(),
  passMark: z.coerce.number().int().min(0).max(100).optional(),
  passed: z.boolean(),
  note: z.string().trim().min(5, "Record what was checked or discussed").max(2000),
});

/** A manager records the knowledge check or discussion a designated policy needs after acknowledgement. Attempts are events. */
export async function recordAckAssessment(ctx: Ctx, acknowledgementId: string, input: z.input<typeof assessmentSchema>) {
  const p = assessmentSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the assessment");
  const d = p.data;
  if (d.score !== undefined && d.passMark !== undefined && d.passed !== d.score >= d.passMark) throw new ValidationError("The result does not match the score and pass mark");
  return db.$transaction(async (tx) => {
    const a = await managedRow(tx, ctx, acknowledgementId);
    if (a.userId === ctx.userId) throw new ForbiddenError("Nobody assesses their own understanding");
    if (a.state !== "ASSESSMENT_REQUIRED" && a.state !== "ASSESSMENT_FAILED") throw new ConflictError("This acknowledgement does not need an assessment now");
    await tx.acknowledgement.update({ where: { id: a.id }, data: { state: d.passed ? "ASSESSMENT_PASSED" : "ASSESSMENT_FAILED", assessedAt: new Date(), assessedById: ctx.userId, assessmentMethod: d.method, assessmentScore: d.score ?? null, assessmentPassMark: d.passMark ?? null, assessmentNote: d.note } });
    await event(tx, a, d.passed ? "ASSESSMENT_PASSED" : "ASSESSMENT_FAILED", ctx.userId, d.note, { method: d.method, score: d.score ?? null, passMark: d.passMark ?? null });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: `policy.assessment.${d.passed ? "passed" : "failed"}`, entityType: "Acknowledgement", entityId: a.id }, tx);
  });
}

export async function exemptRow(ctx: Ctx, acknowledgementId: string, reason: string) {
  if (reason.trim().length < 5) throw new ValidationError("Give the reason for the exemption");
  return db.$transaction(async (tx) => {
    const a = await managedRow(tx, ctx, acknowledgementId);
    if (a.acknowledgedAt || a.supersededAt || a.state === "WITHDRAWN" || a.state === "EXEMPTED") throw new ConflictError("Only an outstanding assignment can be exempted");
    await tx.acknowledgement.update({ where: { id: a.id }, data: { state: "EXEMPTED", exemptedAt: new Date(), exemptedById: ctx.userId, exemptionReason: reason.trim() } });
    await event(tx, a, "EXEMPTED", ctx.userId, reason.trim());
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "policy.acknowledgement.exempted", entityType: "Acknowledgement", entityId: a.id }, tx);
  });
}

/** An attributable correction: the original row and its events stay; a new outstanding row replaces it. */
export async function correctAcknowledgement(ctx: Ctx, acknowledgementId: string, reason: string) {
  if (reason.trim().length < 10) throw new ValidationError("Explain the correction (at least a sentence)");
  return db.$transaction(async (tx) => {
    const a = await managedRow(tx, ctx, acknowledgementId);
    if (a.supersededAt) throw new ConflictError("This record has already been corrected");
    await tx.acknowledgement.update({ where: { id: a.id }, data: { supersededAt: new Date() } });
    const next = await tx.acknowledgement.create({ data: { publicationId: a.publicationId, organisationId: a.organisationId, userId: a.userId, staffMemberId: a.staffMemberId, ruleId: a.ruleId, mandatory: a.mandatory, dueAt: a.dueAt, requiresAssessment: a.requiresAssessment, supersedesId: a.id } });
    await event(tx, a, "CORRECTED", ctx.userId, reason.trim(), { replacedBy: next.id });
    await event(tx, next, "ASSIGNED", ctx.userId, `Re-assigned after a correction: ${reason.trim()}`, { corrects: a.id });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "policy.acknowledgement.corrected", entityType: "Acknowledgement", entityId: a.id, data: { replacedBy: next.id, reason: reason.trim() } }, tx);
    return next;
  });
}

// ── Reminders and escalation ──

const DAY = 86400_000;

/**
 * Reminders before the due date and daily after it, then escalation of overdue mandatory items to the branch's
 * managers (sooner for high-priority policies). Every attempt is an event. A reminder is never treated as reading.
 */
export async function sendAcknowledgementReminders(now = new Date()) {
  const open = await db.acknowledgement.findMany({
    where: { supersededAt: null, acknowledgedAt: null, state: { in: ["ASSIGNED", "OPENED", "IN_PROGRESS"] }, dueAt: { not: null, lt: new Date(now.getTime() + 3 * DAY) } },
    include: { publication: { include: { policy: { select: { id: true, ref: true, title: true } } } }, rule: { select: { priority: true, ownerId: true } }, staffMember: { select: { displayName: true, branchId: true } }, user: { select: { name: true } } },
    take: 5000,
  });
  let sent = 0;
  let escalated = 0;
  const today = now.toISOString().slice(0, 10);
  for (const a of open) {
    const due = a.dueAt!;
    const overdue = due < now;
    if (a.userId && (!a.remindedAt || now.getTime() - a.remindedAt.getTime() >= DAY - 60_000)) {
      const n = await notify({
        organisationId: a.organisationId,
        userIds: [a.userId],
        type: overdue ? "acknowledgement.overdue" : "acknowledgement.due",
        title: `${overdue ? "Overdue" : "Due soon"}: please read ${a.publication.policy.ref} ${a.publication.policy.title}`,
        body: overdue ? `Your acknowledgement was due on ${due.toDateString()}.` : `Please read and acknowledge it by ${due.toDateString()}.`,
        reason: "You are required to read this policy.",
        links: [{ label: "Read and acknowledge", url: "/acknowledgements" }],
        actionUrl: "/acknowledgements",
        dueAt: due,
        dedupeKey: `ack-reminder:${a.id}:${today}`,
      });
      if (n) {
        await db.$transaction(async (tx) => {
          await tx.acknowledgement.update({ where: { id: a.id }, data: { remindedAt: now } });
          await event(tx, a, "REMINDED", null, "In-app notification and email queued. Delivery is not acknowledgement.", { overdue, channel: "in-app" });
        });
        sent++;
      }
    }
    const escalateAfter = (a.rule?.priority ?? 2) === 1 ? 2 : 7;
    if (overdue && a.mandatory && !a.escalatedAt && now.getTime() - due.getTime() >= escalateAfter * DAY) {
      const branchId = a.staffMember?.branchId ?? null;
      const managers = await db.membership.findMany({ where: { organisationId: a.organisationId, roles: { hasSome: ["CARE_MANAGER", "ORG_ADMIN"] }, user: { deactivatedAt: null }, ...(branchId ? { OR: [{ branches: { none: {} } }, { branches: { some: { branchId } } }] } : {}) }, select: { userId: true } });
      const to = [...new Set([...managers.map((m) => m.userId), ...(a.rule?.ownerId ? [a.rule.ownerId] : [])])].filter((u) => u !== a.userId);
      const who = a.staffMember?.displayName ?? a.user?.name ?? "A member of staff";
      await notify({
        organisationId: a.organisationId,
        userIds: to,
        type: "acknowledgement.escalated",
        title: `${who} has not acknowledged ${a.publication.policy.ref} ${a.publication.policy.title}`,
        body: `It was due on ${due.toDateString()}.${a.userId ? "" : " They have no sign-in, so they cannot acknowledge it until one is linked."} Follow up, record an exemption or agree a completion plan.`,
        reason: "You manage this person's branch or own this policy assignment.",
        links: [{ label: "Open Staff Sign-off", url: `/staff/policy/${a.publication.policy.id}` }],
        actionUrl: `/staff/policy/${a.publication.policy.id}`,
        dedupeKey: `ack-escalated:${a.id}`,
        email: false,
      });
      await db.$transaction(async (tx) => {
        await tx.acknowledgement.update({ where: { id: a.id }, data: { escalatedAt: now } });
        await event(tx, a, "ESCALATED", null, `Escalated to ${to.length} manager${to.length === 1 ? "" : "s"}`, { to });
      });
      escalated++;
    }
  }
  return { sent, escalated };
}

// ── Reading for pages and exports ──

export interface SignoffFilters { branch?: string; role?: string; policy?: string; status?: AckBucket | "overdue" | "cannot_sign"; dueBefore?: string; q?: string }

/** Every current row in the caller's scope, with its bucket. Pages, counts and the CSV all start from this. */
export async function signoffRows(ctx: Ctx, f: SignoffFilters = {}) {
  const organisationId = requireOrgPermission(ctx, "staff.view");
  const scope = await memberScope(ctx.userId, organisationId);
  const and: Prisma.AcknowledgementWhereInput[] = [];
  if (scope.branchIds) and.push({ OR: [{ staffMember: { branchId: { in: scope.branchIds } } }, { staffMember: { branchId: null } }, { staffMemberId: null }] });
  if (f.branch) and.push({ staffMember: { branchId: f.branch } });
  if (f.role) and.push({ staffMember: { jobTitle: { equals: f.role, mode: "insensitive" } } });
  if (f.dueBefore) and.push({ dueAt: { lte: new Date(`${f.dueBefore}T23:59:59Z`) } });
  const where: Prisma.AcknowledgementWhereInput = { organisationId, ...currentAckWhere, publication: { status: "PUBLISHED", ...(f.policy ? { policyId: f.policy } : {}) }, ...(and.length ? { AND: and } : {}) };
  const rows = await db.acknowledgement.findMany({
    where,
    include: {
      publication: { select: { id: true, policyId: true, materialRevision: true, publishedAt: true, policy: { select: { id: true, ref: true, title: true } }, version: { select: { label: true } } } },
      staffMember: { select: { id: true, displayName: true, jobTitle: true, branch: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      rule: { select: { id: true, scope: true, jobTitle: true, orgRole: true, priority: true } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 20000,
  });
  const now = new Date();
  const q = f.q?.trim().toLowerCase();
  return rows
    .map((r) => ({ ...r, b: ackBucket(r, now), person: r.staffMember?.displayName ?? r.user?.name ?? "Unknown" }))
    .filter((r) => !q || r.person.toLowerCase().includes(q) || r.publication.policy.ref.toLowerCase().includes(q) || r.publication.policy.title.toLowerCase().includes(q))
    .filter((r) => !f.status || (f.status === "overdue" ? r.b.overdue : f.status === "cannot_sign" ? r.b.cannotSign : r.b.bucket === f.status));
}

export type SignoffRow = Awaited<ReturnType<typeof signoffRows>>[number];

export function signoffCounts(rows: SignoffRow[]) {
  const c: Record<Exclude<AckBucket, "superseded">, number> & { total: number; outstanding: number; overdue: number; cannotSign: number } = { total: 0, outstanding: 0, overdue: 0, cannotSign: 0, not_opened: 0, opened: 0, acknowledged: 0, assessment_pending: 0, assessment_failed: 0, exempted: 0, withdrawn: 0 };
  for (const r of rows) {
    if (r.b.bucket === "superseded") continue;
    c[r.b.bucket]++;
    if (r.b.bucket !== "withdrawn") c.total++;
    if (r.b.outstanding) c.outstanding++;
    if (r.b.overdue) c.overdue++;
    if (r.b.cannotSign) c.cannotSign++;
  }
  // Completion: acknowledged out of everyone still required to read (exempted and withdrawn rows are not required).
  const required = c.total - c.exempted;
  return { ...c, completion: required ? Math.round((c.acknowledged / required) * 100) : null };
}

/**
 * Sign-off status grouped by branch or by job title, from the same rows as the counts. Completion is acknowledged out
 * of everyone still required to read (exempted and withdrawn rows are left out of the denominator).
 */
export function signoffByGroup(rows: SignoffRow[], by: "branch" | "role") {
  const groups = new Map<string, SignoffRow[]>();
  for (const r of rows) {
    if (r.b.bucket === "superseded" || r.b.bucket === "withdrawn") continue;
    const key = by === "branch" ? (r.staffMember?.branch?.name ?? "No branch recorded") : (r.staffMember?.jobTitle || "Office member (no HR record)");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([name, rs]) => {
      const acknowledged = rs.filter((r) => r.b.bucket === "acknowledged").length;
      const required = rs.filter((r) => r.b.bucket !== "exempted").length;
      return { name, assigned: rs.length, acknowledged, outstanding: rs.filter((r) => r.b.outstanding).length, overdue: rs.filter((r) => r.b.overdue).length, cannotSign: rs.filter((r) => r.b.cannotSign).length, completion: required ? Math.round((acknowledged / required) * 100) : null };
    })
    .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
}

/** The evidence export: one line per row with version, scope, state, timestamps, wording, reminders, escalations and exemptions. Audited. */
export async function signoffCsv(ctx: Ctx, f: SignoffFilters) {
  const rows = await signoffRows(ctx, f);
  const events = await db.acknowledgementEvent.findMany({ where: { acknowledgementId: { in: rows.map((r) => r.id) } }, select: { acknowledgementId: true, type: true } });
  const count = (id: string, type: string) => events.filter((e) => e.acknowledgementId === id && e.type === type).length;
  const d = (x: Date | null | undefined) => (x ? x.toISOString() : "");
  const columns = ["Staff member", "Sign-in", "Job title", "Branch", "Policy", "Version", "Material revision", "Assigned by", "Mandatory", "State", "Overdue", "Assigned", "Due", "First opened", "Acknowledged", "Wording", "Assessment", "Reminders", "Escalated", "Exemption", "Withdrawn"];
  const out = rows.map((r) => [
    r.person, r.user?.email ?? "No sign-in: cannot sign", r.staffMember?.jobTitle ?? "", r.staffMember?.branch?.name ?? "",
    `${r.publication.policy.ref} ${r.publication.policy.title}`, r.publication.version.label, r.publication.materialRevision ? "Yes" : "No",
    r.rule ? `${r.rule.scope}${r.rule.jobTitle ? `: ${r.rule.jobTitle}` : r.rule.orgRole ? `: ${r.rule.orgRole}` : ""}` : "All members (no rules)", r.mandatory ? "Yes" : "No",
    BUCKET_LABEL[r.b.bucket], r.b.overdue ? "Yes" : "No", d(r.createdAt), d(r.dueAt), d(r.openedAt), d(r.acknowledgedAt), r.wording ?? "",
    r.assessedAt ? `${r.state === "ASSESSMENT_PASSED" ? "Passed" : "Failed"} ${d(r.assessedAt)}${r.assessmentScore !== null ? ` (${r.assessmentScore}/${r.assessmentPassMark ?? "?"})` : ""}` : r.requiresAssessment ? "Required" : "",
    count(r.id, "REMINDED"), d(r.escalatedAt), r.exemptedAt ? `${d(r.exemptedAt)}: ${r.exemptionReason ?? ""}` : "", r.withdrawnAt ? `${d(r.withdrawnAt)}: ${r.withdrawnReason ?? ""}` : "",
  ]);
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "signoff.exported", entityType: "Organisation", entityId: ctx.organisationId ?? "", data: { rows: out.length, filters: { ...f } } });
  return { columns, rows: out };
}

const BUCKETS = ["not_opened", "opened", "acknowledged", "assessment_pending", "assessment_failed", "exempted", "withdrawn", "overdue", "cannot_sign"] as const;

/** Reads the filters from a query string; anything unrecognised is ignored rather than trusted. */
export function parseSignoffFilters(sp: Record<string, string | undefined>): SignoffFilters {
  const status = BUCKETS.find((b) => b === sp.status);
  const date = sp.dueBefore && /^\d{4}-\d{2}-\d{2}$/.test(sp.dueBefore) ? sp.dueBefore : undefined;
  return { branch: sp.branch || undefined, role: sp.role || undefined, policy: sp.policy || undefined, status, dueBefore: date, q: sp.q?.slice(0, 100) || undefined };
}

/** Branches, job titles and policies for the filter bar, limited to the caller's scope. */
export async function signoffLookups(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "staff.view");
  const scope = await memberScope(ctx.userId, organisationId);
  const [branches, titles, policies] = await Promise.all([
    db.branch.findMany({ where: { organisationId, ...(scope.branchIds ? { id: { in: scope.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.staffMember.findMany({ where: { organisationId, hrMissing: false }, select: { jobTitle: true }, distinct: ["jobTitle"], orderBy: { jobTitle: "asc" } }),
    db.policy.findMany({ where: { organisationId, kind: "CUSTOMER", currentPublishedVersionId: { not: null } }, select: { id: true, ref: true, title: true }, orderBy: { ref: "asc" } }),
  ]);
  return { branches, roles: titles.map((t) => t.jobTitle).filter(Boolean), policies };
}

/** One acknowledgement's events, oldest first, for the timeline. */
export async function ackTimeline(ctx: Ctx, acknowledgementIds: string[]) {
  const organisationId = requireOrgPermission(ctx, "staff.view");
  return db.acknowledgementEvent.findMany({ where: { organisationId, acknowledgementId: { in: acknowledgementIds } }, orderBy: { at: "asc" } });
}

export const canManageSignoff = (ctx: Ctx) => hasOrgPermission(ctx, "signoff.manage");
export type { AcknowledgementState };
