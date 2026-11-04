import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isIsoDate, londonDate, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "../audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { ACTION_PRIORITIES, ACTION_TYPES, createAction } from "../compliance/audits";
import { notify } from "../notifications/notify";
import { checkBranch, isUniqueViolation, membersWithRoles, nextReference, startOfToday, type Json } from "./common";
import { linkEvidence, linksFor } from "./evidence";
import { rcaVisibleWhere } from "./visibility";
export { rcaVisibleWhere };

/**
 * Root cause analysis. An investigation looks into one or more existing records (an incident, a missed call, an audit
 * finding, a risk) without copying or replacing them: their own references stay as they are. It runs
 * New → Investigating → Awaiting review → Actions in progress → Effectiveness review → Closed, and can be reopened with
 * a recorded reason. Findings are only confirmed by a manager review by someone other than the investigator. Actions go
 * through the existing corrective-action service and are verified there by someone other than their owner. Closing an
 * investigation never closes the incidents or risks it looked into, and never changes a CQC readiness figure by itself.
 *
 * Safeguarding and other confidential investigations are "restricted": only people with rca.safeguarding and the people
 * on the case (investigator, responsible manager) see their details. Messages carry the reference and a non-sensitive
 * category only. Nothing here decides or sends a statutory notification.
 */
export const RCA_STATUS = { NEW: "New", INVESTIGATING: "Investigating", AWAITING_REVIEW: "Awaiting review", ACTIONS_IN_PROGRESS: "Actions in progress", EFFECTIVENESS_REVIEW: "Effectiveness review", CLOSED: "Closed" } as const;
export type RcaStatus = keyof typeof RCA_STATUS;
export const OPEN_RCA: RcaStatus[] = ["NEW", "INVESTIGATING", "AWAITING_REVIEW", "ACTIONS_IN_PROGRESS", "EFFECTIVENESS_REVIEW"];
export const RCA_CATEGORIES = ["Incident or accident", "Safeguarding concern", "Fall", "Medication error", "Missed or late visit", "Complaint", "Care delivery failure", "Staffing failure", "Communication failure", "Repeated service-user concern", "Audit finding", "Other significant service failure"] as const;
export const SEVERITIES = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" } as const;
export const HARM = { NONE: "No harm", POTENTIAL: "Potential harm (near miss)", LOW: "Low harm", MODERATE: "Moderate harm", SEVERE: "Severe harm", DEATH: "Death" } as const;
export const TIMELINE_KINDS = { FACT: "Fact", WITNESS: "Witness account", ASSUMPTION: "Assumption" } as const;
export const FACTOR_AREAS = { STAFF: "Staff and competency", STAFFING: "Staffing levels", COMMUNICATION: "Communication", SCHEDULING: "Scheduling", POLICY: "Policies and procedures", CARE_PLANNING: "Care planning", SYSTEMS: "Technology and systems", ENVIRONMENT: "Environment", OVERSIGHT: "Management oversight", EXTERNAL: "External factors" } as const;
export const FINDING_KINDS = { IMMEDIATE: "Immediate cause", CONTRIBUTING: "Contributing factor", SYSTEMIC: "Underlying systemic cause" } as const;
export const ESCALATIONS = {
  IMMEDIATE_SAFETY: "Immediate safety of the person and others",
  SAFEGUARDING_REFERRAL: "Safeguarding referral to the local authority",
  CQC_NOTIFICATION: "CQC statutory notification",
  DUTY_OF_CANDOUR: "Duty of candour",
  EXTERNAL_NOTIFICATION: "Other external notification (commissioner, police, NHS, insurer)",
} as const;
export const ESCALATION_DECISIONS = { DONE: "Required and done", REQUIRED_PENDING: "Required, not yet done", NOT_REQUIRED: "Considered, not required" } as const;
export const EFFECTIVENESS = { EFFECTIVE: "Effective", PARTIALLY_EFFECTIVE: "Partially effective", INEFFECTIVE: "Ineffective", AWAITING_VERIFICATION: "Awaiting verification" } as const;
export const EFFECTIVENESS_CHECKS = { notRepeated: "The problem has not happened again", trainingDone: "Relevant staff have completed any training", procedureUpdated: "Procedures were updated where needed", followUpSatisfactory: "Follow-up checks are satisfactory", residualRiskAcceptable: "The remaining risk is acceptable" } as const;
export const SOURCE_KINDS = { INCIDENT: "Incident", MISSED_CALL: "Missed call", AUDIT_FINDING: "Audit finding", RISK: "Risk" } as const;

export type TimelineEntry = { at: string; text: string; kind: keyof typeof TIMELINE_KINDS; addedBy: string };
export type Factors = Partial<Record<keyof typeof FACTOR_AREAS, { relevant: boolean; notes: string }>>;

const DONE_ACTION = ["VERIFIED", "CLOSED"];
const OPEN_ACTION = ["OPEN", "IN_PROGRESS", "COMPLETED"];
const INCIDENT_TO_CATEGORY: Record<string, (typeof RCA_CATEGORIES)[number]> = { Fall: "Fall", "Medication error": "Medication error", "Missed or late call": "Missed or late visit", "Safeguarding concern": "Safeguarding concern", Complaint: "Complaint" };

/** Serious investigations must record every escalation decision before review. */
export function isSerious(r: { severity: string; restricted: boolean; category: string }) {
  return r.severity === "HIGH" || r.severity === "CRITICAL" || r.restricted || r.category === "Safeguarding concern";
}

export const canSeeRcas = (ctx: Ctx) => hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate");

async function loadRca(ctx: Ctx, id: string) {
  const r = await db.rcaInvestigation.findFirst({ where: { id, ...rcaVisibleWhere(ctx) } });
  if (!r) throw new NotFoundError("Investigation");
  return r;
}

/** Who may work on the investigation's content: the investigator, the responsible manager, or a manager who can approve. */
function canWork(ctx: Ctx, r: { ownerId: string; managerId: string }) {
  return r.ownerId === ctx.userId || r.managerId === ctx.userId || hasOrgPermission(ctx, "rca.approve") || hasOrgPermission(ctx, "rca.create");
}
function assertWork(ctx: Ctx, r: { ownerId: string; managerId: string }) {
  if (!canWork(ctx, r)) throw new ForbiddenError("Only the investigator, the responsible manager or an authorised manager can change this investigation");
}
function assertReviewer(ctx: Ctx, r: { ownerId: string }) {
  if (!hasOrgPermission(ctx, "rca.approve")) throw new ForbiddenError("Only an authorised manager can do this");
  if (r.ownerId === ctx.userId) throw new ForbiddenError("You investigated this, so another manager must review it");
}

async function bump(tx: Prisma.TransactionClient, r: { id: string; lockVersion: number }, expected: number | undefined, data: Prisma.RcaInvestigationUpdateManyMutationInput) {
  const { count } = await tx.rcaInvestigation.updateMany({ where: { id: r.id, lockVersion: expected ?? r.lockVersion }, data: { ...data, lockVersion: { increment: 1 } } });
  if (!count) throw new ConflictError("Someone else updated this investigation since you opened it. Reload and try again.");
}

const label = (r: { reference: string; category: string; restricted: boolean }) => (r.restricted ? `${r.reference} (restricted investigation)` : `${r.reference}: ${r.category}`);

/** In-app and email messages through the existing service: reference, non-sensitive category, action, who and when. */
async function tell(r: { id: string; organisationId: string; reference: string; category: string; restricted: boolean; dueDate: Date }, userIds: string[], kind: string, action: string, opts: { responsible?: string; due?: Date; key?: string; title?: string } = {}) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const due = opts.due ?? r.dueDate;
  const body = [`${label(r)}.`, `Action required: ${action}.`, opts.responsible ? `Responsible: ${opts.responsible}.` : "", `Due: ${due.toISOString().slice(0, 10)}.`].filter(Boolean).join(" ");
  return notify({ organisationId: r.organisationId, userIds: ids, type: `rca.${kind}`, title: opts.title ?? `${r.reference}: ${action}`, body, reason: "You are involved in this root cause analysis, or manage investigations for your organisation.", links: [{ label: "Open the investigation", url: `/compliance/cqc/rca/${r.id}` }], actionUrl: `/compliance/cqc/rca/${r.id}`, dueAt: due, dedupeKey: opts.key ?? `rca-${kind}:${r.id}` });
}

const nameOf = async (userId: string) => (await db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "Unknown";
const approvers = (organisationId: string) => membersWithRoles(organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "POLICY_APPROVER"]);

// ───────── sources

type SourceRef = { type: keyof typeof SOURCE_KINDS; id: string };
interface ResolvedSource { type: keyof typeof SOURCE_KINDS; id: string; ref: string; serviceUserId: string | null; branchId: string | null; occurredAt: Date | null; category: string | null; severity: string | null; restricted: boolean }

async function resolveSource(ctx: Ctx, organisationId: string, s: SourceRef): Promise<ResolvedSource> {
  if (s.type === "INCIDENT") {
    const i = await db.incident.findFirst({ where: { id: s.id, organisationId }, include: { serviceUser: { select: { branchId: true } } } });
    if (!i) throw new NotFoundError("Incident");
    const branchId = i.serviceUser?.branchId ?? null;
    if (branchId && ctx.branchIds && !ctx.branchIds.includes(branchId)) throw new NotFoundError("Incident");
    return { type: s.type, id: i.id, ref: i.reference, serviceUserId: i.serviceUserId, branchId, occurredAt: i.occurredAt, category: INCIDENT_TO_CATEGORY[i.category] ?? "Incident or accident", severity: i.severity, restricted: i.safeguarding };
  }
  if (s.type === "MISSED_CALL") {
    const m = await db.missedCallCase.findFirst({ where: { id: s.id, organisationId }, include: { visit: { select: { reference: true, serviceUser: { select: { branchId: true } } } } } });
    if (!m) throw new NotFoundError("Missed call");
    const branchId = m.visit.serviceUser?.branchId ?? null;
    if (branchId && ctx.branchIds && !ctx.branchIds.includes(branchId)) throw new NotFoundError("Missed call");
    return { type: s.type, id: m.id, ref: `Missed call ${m.visit.reference}`, serviceUserId: m.serviceUserId, branchId, occurredAt: m.scheduledStart, category: "Missed or late visit", severity: null, restricted: false };
  }
  if (s.type === "AUDIT_FINDING") {
    const f = await db.auditFinding.findFirst({ where: { id: s.id, organisationId }, include: { audit: { select: { title: true, branchId: true } } } });
    if (!f) throw new NotFoundError("Audit finding");
    if (f.audit.branchId && ctx.branchIds && !ctx.branchIds.includes(f.audit.branchId)) throw new NotFoundError("Audit finding");
    return { type: s.type, id: f.id, ref: `Finding: ${f.audit.title}`.slice(0, 120), serviceUserId: null, branchId: f.audit.branchId, occurredAt: f.createdAt, category: "Audit finding", severity: f.riskRating === "MEDIUM" ? "MODERATE" : f.riskRating, restricted: false };
  }
  const r = await db.complianceRisk.findFirst({ where: { id: s.id, organisationId } });
  if (!r) throw new NotFoundError("Risk");
  if (r.branchId && ctx.branchIds && !ctx.branchIds.includes(r.branchId)) throw new NotFoundError("Risk");
  return { type: "RISK", id: r.id, ref: r.ref, serviceUserId: null, branchId: r.branchId, occurredAt: r.createdAt, category: null, severity: null, restricted: false };
}

/** An open investigation already looking into this record, if any (prevents duplicate investigations). */
export async function openRcaFor(organisationId: string, type: string, id: string) {
  return db.rcaSourceLink.findFirst({ where: { organisationId, sourceType: type, sourceId: id, rca: { status: { not: "CLOSED" } } }, select: { rca: { select: { id: true, reference: true } } } });
}

/** What the New investigation form starts with when opened from an existing record. */
export async function draftFromSource(ctx: Ctx, s: SourceRef) {
  const organisationId = requireOrgPermission(ctx, "rca.create");
  const src = await resolveSource(ctx, organisationId, s);
  const existing = await openRcaFor(organisationId, s.type, s.id);
  return { source: src, existing: existing?.rca ?? null };
}

// ───────── create

const createSchema = z.object({
  title: z.string().trim().min(5, "Give the investigation a short title").max(200),
  category: z.enum(RCA_CATEGORIES, { message: "Choose a category" }),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"], { message: "Choose the severity" }),
  eventDate: z.string().refine(isIsoDate, "Choose the date of the event"),
  eventTime: z.string().optional(),
  dueDate: z.string().refine(isIsoDate, "Choose a due date"),
  ownerId: z.string().min(1, "Choose the investigator"),
  managerId: z.string().min(1, "Choose the responsible manager"),
  branchId: z.string().optional(),
  serviceUserId: z.string().optional(),
  restricted: z.boolean().default(false),
  externalRef: z.string().trim().max(120).optional(),
  sources: z.array(z.object({ type: z.enum(["INCIDENT", "MISSED_CALL", "AUDIT_FINDING", "RISK"]), id: z.string().min(1) })).max(10).default([]),
});
export type CreateRcaInput = z.input<typeof createSchema>;

export async function createRca(ctx: Ctx, raw: CreateRcaInput) {
  const organisationId = requireOrgPermission(ctx, "rca.create");
  const p = createSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the investigation details");
  const d = p.data;
  if (d.dueDate < londonDate()) throw new ValidationError("The due date cannot be in the past");
  const eventAt = londonToUtc(d.eventDate, parseHhmm(d.eventTime || "00:00") ?? 0);
  if (eventAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("The event cannot be in the future");
  const [investigators, managers] = await Promise.all([membersWithRoles(organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "POLICY_REVIEWER"]), approvers(organisationId)]);
  if (!investigators.some((m) => m.id === d.ownerId)) throw new ValidationError("The investigator must be a member who can investigate");
  if (!managers.some((m) => m.id === d.managerId)) throw new ValidationError("The responsible manager must be a member who can approve investigations");
  const sources = await Promise.all(d.sources.map((s) => resolveSource(ctx, organisationId, s)));
  for (const s of sources) {
    const open = await openRcaFor(organisationId, s.type, s.id);
    if (open) throw new ConflictError(`${open.rca.reference} is already investigating ${s.ref}. Add to that investigation instead of starting another.`);
  }
  const first = sources[0];
  const branchId = await checkBranch(ctx, organisationId, d.branchId || first?.branchId || null);
  let serviceUserId = d.serviceUserId || first?.serviceUserId || null;
  if (serviceUserId) {
    const su = await db.serviceUser.findFirst({ where: { id: serviceUserId, organisationId }, select: { id: true, branchId: true } });
    if (!su || (su.branchId && ctx.branchIds && !ctx.branchIds.includes(su.branchId))) throw new NotFoundError("Service user");
    serviceUserId = su.id;
  }
  const restricted = d.restricted || d.category === "Safeguarding concern" || sources.some((s) => s.restricted);
  let created;
  for (let attempt = 0; ; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const reference = await nextReference(tx, "RCA", organisationId);
        const r = await tx.rcaInvestigation.create({ data: { organisationId, reference, title: d.title, branchId, serviceUserId, category: d.category, severity: d.severity, eventDate: eventAt, ownerId: d.ownerId, managerId: d.managerId, dueDate: new Date(`${d.dueDate}T00:00:00Z`), restricted, createdById: ctx.userId } });
        for (const [i, s] of sources.entries()) await tx.rcaSourceLink.create({ data: { organisationId, rcaId: r.id, sourceType: s.type, sourceId: s.id, sourceRef: s.ref, externalRef: i === 0 ? d.externalRef || null : null, addedById: ctx.userId } });
        await audit({ organisationId, actorId: ctx.userId, action: "rca.created", entityType: "RcaInvestigation", entityId: r.id, data: { reference, category: d.category, severity: d.severity, restricted, sources: sources.map((s) => ({ type: s.type, id: s.id, ref: s.ref })), ownerId: d.ownerId, managerId: d.managerId } }, tx);
        return r;
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
  const investigator = await nameOf(created.ownerId);
  if (created.ownerId !== ctx.userId) await tell(created, [created.ownerId], "assigned", "investigate and record what happened", { responsible: investigator, title: `${created.reference} assigned to you` });
  if (created.severity === "CRITICAL" || created.severity === "HIGH" || created.restricted) {
    const ids = [...(await approvers(organisationId)).map((m) => m.id), created.managerId].filter((id) => id !== ctx.userId);
    await tell(created, ids, "critical", "check immediate safety, safeguarding and notification duties now", { responsible: investigator, title: `${created.severity === "CRITICAL" ? "Critical" : created.restricted ? "Restricted" : "Serious"} investigation opened: ${created.reference}` });
  }
  return created;
}

// ───────── investigation steps

async function editable(ctx: Ctx, id: string) {
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status !== "NEW" && r.status !== "INVESTIGATING") throw new ConflictError(r.status === "CLOSED" ? "This investigation is closed. Reopen it to make changes." : "The investigation has been submitted. A manager must send it back for more investigation before it can change.");
  return r;
}

const whatSchema = z.object({
  summary: z.string().trim().min(20, "Summarise what happened (at least a couple of sentences)").max(8000),
  peopleInvolved: z.string().trim().max(2000).optional(),
  immediateImpact: z.string().trim().max(4000).optional(),
  harm: z.enum(Object.keys(HARM) as [keyof typeof HARM], { message: "Choose the level of harm" }),
  immediateActions: z.string().trim().max(4000).optional(),
  expectedLock: z.coerce.number().int().optional(),
});

export async function saveWhatHappened(ctx: Ctx, id: string, raw: z.input<typeof whatSchema>) {
  const p = whatSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  const d = p.data;
  const r = await editable(ctx, id);
  await db.$transaction(async (tx) => {
    await bump(tx, r, d.expectedLock, { summary: d.summary, peopleInvolved: d.peopleInvolved || null, immediateImpact: d.immediateImpact || null, harm: d.harm, immediateActions: d.immediateActions || null, status: "INVESTIGATING" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.what-happened.saved", entityType: "RcaInvestigation", entityId: r.id, data: { from: { summary: r.summary, harm: r.harm, immediateActions: r.immediateActions, status: r.status }, to: { summary: d.summary, harm: d.harm, immediateActions: d.immediateActions ?? null, status: "INVESTIGATING" } } }, tx);
  });
}

export async function addTimelineEntry(ctx: Ctx, id: string, input: { date: string; time: string; text: string; kind: string }) {
  if (!isIsoDate(input.date) || parseHhmm(input.time) === null) throw new ValidationError("Give the date and time (like 09:00)");
  if (input.text.trim().length < 3) throw new ValidationError("Describe the timeline entry");
  if (!(input.kind in TIMELINE_KINDS)) throw new ValidationError("Say whether this is a fact, a witness account or an assumption");
  const r = await editable(ctx, id);
  const entry: TimelineEntry = { at: londonToUtc(input.date, parseHhmm(input.time)!).toISOString(), text: input.text.trim().slice(0, 2000), kind: input.kind as TimelineEntry["kind"], addedBy: ctx.userId };
  const timeline = [...(r.timeline as unknown as TimelineEntry[]), entry].sort((a, b) => a.at.localeCompare(b.at));
  await db.$transaction(async (tx) => {
    await bump(tx, r, undefined, { timeline: timeline as unknown as Json, status: "INVESTIGATING" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.timeline.added", entityType: "RcaInvestigation", entityId: r.id, data: entry as unknown as Json }, tx);
  });
}

export async function removeTimelineEntry(ctx: Ctx, id: string, at: string, text: string) {
  const r = await editable(ctx, id);
  const timeline = r.timeline as unknown as TimelineEntry[];
  const idx = timeline.findIndex((e) => e.at === at && e.text === text);
  if (idx < 0) throw new NotFoundError("Timeline entry");
  const removed = timeline[idx]!;
  await db.$transaction(async (tx) => {
    await bump(tx, r, undefined, { timeline: timeline.filter((_, i) => i !== idx) as unknown as Json });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.timeline.removed", entityType: "RcaInvestigation", entityId: r.id, data: removed as unknown as Json }, tx);
  });
}

export async function saveFactors(ctx: Ctx, id: string, input: { factors: Factors; fiveWhys: string[]; causeEffectNotes?: string; expectedLock?: number }) {
  const r = await editable(ctx, id);
  const factors: Factors = {};
  for (const k of Object.keys(FACTOR_AREAS) as (keyof typeof FACTOR_AREAS)[]) {
    const f = input.factors[k];
    if (f && (f.relevant || f.notes.trim())) factors[k] = { relevant: Boolean(f.relevant), notes: f.notes.trim().slice(0, 4000) };
  }
  const whys = input.fiveWhys.map((w) => w.trim().slice(0, 1000)).filter(Boolean).slice(0, 5);
  await db.$transaction(async (tx) => {
    await bump(tx, r, input.expectedLock, { factors: factors as Json, fiveWhys: whys, causeEffectNotes: input.causeEffectNotes?.trim() || null, status: "INVESTIGATING" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.factors.saved", entityType: "RcaInvestigation", entityId: r.id, data: { from: { factors: r.factors, fiveWhys: r.fiveWhys }, to: { factors, fiveWhys: whys } } as Json }, tx);
  });
}

export async function saveConclusions(ctx: Ctx, id: string, input: { immediateCause?: string; underlyingCauses?: string; uncertainties?: string; conclusions?: string; expectedLock?: number }) {
  const r = await editable(ctx, id);
  const clean = (s?: string) => s?.trim().slice(0, 6000) || null;
  const to = { immediateCause: clean(input.immediateCause), underlyingCauses: clean(input.underlyingCauses), uncertainties: clean(input.uncertainties), conclusions: clean(input.conclusions) };
  await db.$transaction(async (tx) => {
    await bump(tx, r, input.expectedLock, { ...to, status: "INVESTIGATING" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.conclusions.saved", entityType: "RcaInvestigation", entityId: r.id, data: { from: { immediateCause: r.immediateCause, underlyingCauses: r.underlyingCauses, uncertainties: r.uncertainties, conclusions: r.conclusions }, to } }, tx);
  });
}

export async function addFinding(ctx: Ctx, id: string, input: { kind: string; factorArea?: string; text: string; evidence: string }) {
  if (!(input.kind in FINDING_KINDS)) throw new ValidationError("Choose the kind of finding");
  if (input.factorArea && !(input.factorArea in FACTOR_AREAS)) throw new ValidationError("Choose a factor area");
  if (input.text.trim().length < 10) throw new ValidationError("Describe the finding");
  if (input.evidence.trim().length < 10) throw new ValidationError("Say what evidence supports this finding");
  const r = await editable(ctx, id);
  const f = await db.$transaction(async (tx) => {
    const f = await tx.rcaFinding.create({ data: { organisationId: r.organisationId, rcaId: r.id, kind: input.kind, factorArea: input.factorArea || null, text: input.text.trim().slice(0, 4000), evidence: input.evidence.trim().slice(0, 4000), createdById: ctx.userId } });
    await bump(tx, r, undefined, { status: "INVESTIGATING" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.finding.added", entityType: "RcaInvestigation", entityId: r.id, data: { findingId: f.id, kind: input.kind, text: f.text } }, tx);
    return f;
  });
  return f;
}

export async function addSource(ctx: Ctx, id: string, s: SourceRef & { externalRef?: string }) {
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status === "CLOSED") throw new ConflictError("Reopen the investigation before linking more records");
  const src = await resolveSource(ctx, r.organisationId, s);
  const open = await openRcaFor(r.organisationId, s.type, s.id);
  if (open) throw new ConflictError(open.rca.id === r.id ? "Already linked" : `${open.rca.reference} is already investigating ${src.ref}`);
  await db.rcaSourceLink.create({ data: { organisationId: r.organisationId, rcaId: r.id, sourceType: src.type, sourceId: src.id, sourceRef: src.ref, externalRef: s.externalRef?.trim() || null, addedById: ctx.userId } });
  await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.source.linked", entityType: "RcaInvestigation", entityId: r.id, data: { type: src.type, id: src.id, ref: src.ref } });
}

/**
 * Records a manager's decision on one escalation question. Allowed at any stage before closure so the investigation
 * never holds up immediate safeguarding or notification steps. The platform never makes or sends the notification.
 */
export async function recordEscalation(ctx: Ctx, id: string, input: { kind: string; decision: string; rationale: string; externalRef?: string; notifiedOn?: string }) {
  if (!(input.kind in ESCALATIONS)) throw new ValidationError("Choose the escalation question");
  if (!(input.decision in ESCALATION_DECISIONS)) throw new ValidationError("Choose the decision");
  if (input.rationale.trim().length < 10) throw new ValidationError("Record the reasons for the decision");
  if (input.notifiedOn && !isIsoDate(input.notifiedOn)) throw new ValidationError("Choose a valid notification date");
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status === "CLOSED") throw new ConflictError("Reopen the investigation to change escalation decisions");
  const prev = await db.rcaEscalation.findUnique({ where: { rcaId_kind: { rcaId: r.id, kind: input.kind } } });
  const data = { decision: input.decision, rationale: input.rationale.trim().slice(0, 4000), externalRef: input.externalRef?.trim() || null, notifiedAt: input.notifiedOn ? new Date(`${input.notifiedOn}T00:00:00Z`) : null, decidedById: ctx.userId, decidedAt: new Date() };
  await db.$transaction(async (tx) => {
    await tx.rcaEscalation.upsert({ where: { rcaId_kind: { rcaId: r.id, kind: input.kind } }, create: { ...data, organisationId: r.organisationId, rcaId: r.id, kind: input.kind }, update: data });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.escalation.recorded", entityType: "RcaInvestigation", entityId: r.id, data: { kind: input.kind, from: prev ? { decision: prev.decision, rationale: prev.rationale, externalRef: prev.externalRef } : null, to: { decision: data.decision, rationale: data.rationale, externalRef: data.externalRef } } }, tx);
  });
}

// ───────── actions

export async function addRcaAction(ctx: Ctx, id: string, input: { title: string; description?: string; ownerId: string; dueDate: Date; actionType: string; priority: string; evidenceRequired: string; findingId?: string }) {
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status === "CLOSED") throw new ConflictError("Reopen the investigation before adding actions");
  if (r.status === "AWAITING_REVIEW") throw new ConflictError("The investigation is with a manager for review");
  if (!(input.actionType in ACTION_TYPES)) throw new ValidationError("Choose corrective or preventative");
  if (!(input.priority in ACTION_PRIORITIES)) throw new ValidationError("Choose a priority");
  if (input.evidenceRequired.trim().length < 5) throw new ValidationError("Say what evidence will show the action is done");
  if (input.dueDate < startOfToday()) throw new ValidationError("The due date cannot be in the past");
  if (input.findingId && !(await db.rcaFinding.findFirst({ where: { id: input.findingId, rcaId: r.id } }))) throw new NotFoundError("Finding");
  // The RCA finding goes on the action's rcaFindingId; findingId on an action means an audit finding.
  const action = await createAction(ctx, { title: input.title, description: input.description, ownerId: input.ownerId, dueDate: input.dueDate, actionType: input.actionType, priority: input.priority, evidenceRequired: input.evidenceRequired, rca: { id: r.id, reference: r.reference, findingId: input.findingId || undefined } }, { preAuthorised: true });
  await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.action.added", entityType: "RcaInvestigation", entityId: r.id, data: { actionId: action.id, actionType: input.actionType, ownerId: input.ownerId, due: input.dueDate.toISOString().slice(0, 10) } });
  return action;
}

// ───────── review, effectiveness, closure

async function snapshotOf(rcaId: string) {
  const r = await db.rcaInvestigation.findUniqueOrThrow({ where: { id: rcaId }, include: { findings: true, escalations: true, actions: { select: { id: true, title: true, status: true, dueDate: true, actionType: true, ownerId: true } } } });
  return JSON.parse(JSON.stringify(r)) as Json;
}

export function submissionGaps(r: { summary: string | null; timeline: unknown; conclusions: string | null; severity: string; restricted: boolean; category: string }, findings: number, actions: number, escalationKinds: string[]) {
  const gaps: string[] = [];
  if (!r.summary) gaps.push("Record what happened (step 1)");
  if (!(r.timeline as unknown[]).length) gaps.push("Add at least one timeline entry");
  if (!findings) gaps.push("Record at least one root cause finding with its evidence");
  if (!r.conclusions) gaps.push("Write the investigator's conclusions");
  if (!actions) gaps.push("Allocate at least one corrective or preventative action");
  if (isSerious(r)) {
    const missing = Object.keys(ESCALATIONS).filter((k) => !escalationKinds.includes(k));
    if (missing.length) gaps.push(`Record the escalation decisions (${missing.length} still to consider)`);
  }
  return gaps;
}

export async function submitForReview(ctx: Ctx, id: string, expectedLock?: number) {
  const r = await editable(ctx, id);
  const [findings, actions, escalations] = await Promise.all([db.rcaFinding.count({ where: { rcaId: r.id } }), db.complianceAction.count({ where: { rcaId: r.id } }), db.rcaEscalation.findMany({ where: { rcaId: r.id }, select: { kind: true } })]);
  const gaps = submissionGaps(r, findings, actions, escalations.map((e) => e.kind));
  if (gaps.length) throw new ValidationError(`Not ready for review: ${gaps.join("; ")}.`);
  await db.$transaction(async (tx) => {
    await bump(tx, r, expectedLock, { status: "AWAITING_REVIEW" });
    await tx.rcaReview.create({ data: { organisationId: r.organisationId, rcaId: r.id, stage: "SUBMISSION", decision: "SUBMITTED", note: "Submitted for management review", reviewerId: ctx.userId, snapshot: await snapshotOf(r.id) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.submitted", entityType: "RcaInvestigation", entityId: r.id, data: { from: r.status, to: "AWAITING_REVIEW" } }, tx);
  });
  const reviewers = [r.managerId, ...(await approvers(r.organisationId)).map((m) => m.id)].filter((u) => u !== r.ownerId && u !== ctx.userId);
  await tell(r, reviewers, "review", "review the investigation and approve the findings and action plan", { responsible: await nameOf(r.managerId), key: `rca-review:${r.id}:${r.lockVersion + 1}`, title: `${r.reference} needs management approval` });
}

export async function managerReview(ctx: Ctx, id: string, input: { decision: "APPROVE" | "MORE_INVESTIGATION"; note: string; confirmFindingIds: string[]; expectedLock?: number }) {
  const r = await loadRca(ctx, id);
  assertReviewer(ctx, r);
  if (r.status !== "AWAITING_REVIEW") throw new ConflictError("This investigation is not awaiting review");
  const note = input.note.trim();
  if (note.length < 10) throw new ValidationError("Record your review comments");
  const findings = await db.rcaFinding.findMany({ where: { rcaId: r.id } });
  const confirm = new Set(input.confirmFindingIds.filter((fid) => findings.some((f) => f.id === fid)));
  if (input.decision === "APPROVE" && !confirm.size) throw new ValidationError("Confirm at least one finding that the evidence supports, or ask for more investigation");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await bump(tx, r, input.expectedLock, { status: input.decision === "APPROVE" ? "ACTIONS_IN_PROGRESS" : "INVESTIGATING" });
    if (input.decision === "APPROVE") {
      for (const f of findings) await tx.rcaFinding.update({ where: { id: f.id }, data: confirm.has(f.id) ? { status: "CONFIRMED", confirmedById: ctx.userId, confirmedAt: now } : { status: "NOT_SUPPORTED", confirmedById: ctx.userId, confirmedAt: now } });
    }
    await tx.rcaReview.create({ data: { organisationId: r.organisationId, rcaId: r.id, stage: "MANAGER_REVIEW", decision: input.decision === "APPROVE" ? "APPROVED" : "MORE_INVESTIGATION", note, checks: { confirmed: [...confirm] }, reviewerId: ctx.userId, snapshot: await snapshotOf(r.id) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: input.decision === "APPROVE" ? "rca.approved" : "rca.returned", entityType: "RcaInvestigation", entityId: r.id, data: { from: "AWAITING_REVIEW", to: input.decision === "APPROVE" ? "ACTIONS_IN_PROGRESS" : "INVESTIGATING", note, confirmed: [...confirm] } }, tx);
  });
  await tell(r, [r.ownerId], input.decision === "APPROVE" ? "approved" : "returned", input.decision === "APPROVE" ? "complete the agreed actions" : "carry out the further investigation the manager asked for", { responsible: await nameOf(r.ownerId), key: `rca-decision:${r.id}:${r.lockVersion + 1}` });
}

async function actionState(rcaId: string) {
  const actions = await db.complianceAction.findMany({ where: { rcaId }, select: { id: true, status: true, dueDate: true, title: true } });
  return { actions, total: actions.length, done: actions.filter((a) => DONE_ACTION.includes(a.status)).length, open: actions.filter((a) => OPEN_ACTION.includes(a.status)) };
}

/** When every action has been independently verified, the investigation moves on to its effectiveness review. */
export async function startEffectivenessReview(ctx: Ctx, id: string) {
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status !== "ACTIONS_IN_PROGRESS") throw new ConflictError("The investigation is not at the actions stage");
  const s = await actionState(r.id);
  if (!s.total || s.done < s.total) throw new ConflictError(`${s.total - s.done} action${s.total - s.done === 1 ? " is" : "s are"} not yet verified. Each action must be completed and verified by someone other than its owner first.`);
  await db.$transaction(async (tx) => {
    await bump(tx, r, undefined, { status: "EFFECTIVENESS_REVIEW" });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.effectiveness.due", entityType: "RcaInvestigation", entityId: r.id, data: { from: r.status, to: "EFFECTIVENESS_REVIEW" } }, tx);
  });
  await tell(r, [r.managerId], "effectiveness", "check whether the improvements worked", { responsible: await nameOf(r.managerId), key: `rca-effectiveness:${r.id}:${r.reopenCount}:${s.total}` });
}

export async function effectivenessReview(ctx: Ctx, id: string, input: { decision: string; note: string; checks: Partial<Record<keyof typeof EFFECTIVENESS_CHECKS, boolean>>; expectedLock?: number }) {
  const r = await loadRca(ctx, id);
  assertReviewer(ctx, r);
  if (r.status !== "EFFECTIVENESS_REVIEW") throw new ConflictError("The investigation is not at the effectiveness review stage");
  if (!(input.decision in EFFECTIVENESS)) throw new ValidationError("Choose whether the improvements were effective");
  const note = input.note.trim();
  if (note.length < 10) throw new ValidationError("Record what you checked and what you found");
  const checks = Object.fromEntries(Object.keys(EFFECTIVENESS_CHECKS).map((k) => [k, Boolean(input.checks[k as keyof typeof EFFECTIVENESS_CHECKS])]));
  if (input.decision === "EFFECTIVE" && Object.values(checks).some((v) => !v)) throw new ValidationError("Effective needs every check confirmed. Choose Partially effective if any check is not met.");
  const back = input.decision === "INEFFECTIVE" || input.decision === "PARTIALLY_EFFECTIVE";
  await db.$transaction(async (tx) => {
    await bump(tx, r, input.expectedLock, { status: back ? "ACTIONS_IN_PROGRESS" : "EFFECTIVENESS_REVIEW" });
    await tx.rcaReview.create({ data: { organisationId: r.organisationId, rcaId: r.id, stage: "EFFECTIVENESS", decision: input.decision, note, checks, reviewerId: ctx.userId, snapshot: await snapshotOf(r.id) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.effectiveness.reviewed", entityType: "RcaInvestigation", entityId: r.id, data: { decision: input.decision, checks, note, from: r.status, to: back ? "ACTIONS_IN_PROGRESS" : "EFFECTIVENESS_REVIEW" } }, tx);
  });
  if (back) await tell(r, [r.ownerId, r.managerId], "further-action", "review why the improvements did not fully work and add further actions", { responsible: await nameOf(r.managerId), key: `rca-ineffective:${r.id}:${r.lockVersion + 1}` });
}

export async function closeRca(ctx: Ctx, id: string, input: { note: string; exception?: boolean; exceptionReason?: string; expectedLock?: number }) {
  const r = await loadRca(ctx, id);
  assertReviewer(ctx, r);
  if (r.status === "CLOSED") throw new ConflictError("Already closed");
  const note = input.note.trim();
  if (note.length < 20) throw new ValidationError("Record the closure decision and the lessons learned (at least a couple of sentences)");
  const approved = await db.rcaReview.findFirst({ where: { rcaId: r.id, stage: "MANAGER_REVIEW", decision: "APPROVED" } });
  if (!approved || !["ACTIONS_IN_PROGRESS", "EFFECTIVENESS_REVIEW"].includes(r.status)) throw new ConflictError("The findings and action plan must be approved by a manager before the investigation can close");
  const latestEff = await db.rcaReview.findFirst({ where: { rcaId: r.id, stage: "EFFECTIVENESS", createdAt: { gte: approved.createdAt } }, orderBy: { createdAt: "desc" } });
  const s = await actionState(r.id);
  const normal = r.status === "EFFECTIVENESS_REVIEW" && latestEff?.decision === "EFFECTIVE" && s.open.length === 0;
  if (!normal) {
    if (!input.exception) throw new ValidationError(s.open.length ? `${s.open.length} action${s.open.length === 1 ? " is" : "s are"} still open. Close only as an approved exception, keeping those actions and their due dates.` : "The improvements have not been reviewed as effective. Close only as an approved exception.");
    if ((input.exceptionReason ?? "").trim().length < 20) throw new ValidationError("Explain why the investigation can close as an exception (at least a couple of sentences)");
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    await bump(tx, r, input.expectedLock, { status: "CLOSED", closedAt: now, closedById: ctx.userId, closureNote: note, closureException: !normal, exceptionReason: normal ? null : input.exceptionReason!.trim() });
    await tx.rcaReview.create({ data: { organisationId: r.organisationId, rcaId: r.id, stage: "CLOSURE", decision: normal ? "CLOSED" : "CLOSED_BY_EXCEPTION", note: normal ? note : `${note}\n\nException: ${input.exceptionReason!.trim()}`, checks: { openActions: s.open.map((a) => ({ id: a.id, title: a.title, status: a.status, due: a.dueDate.toISOString().slice(0, 10) })) }, reviewerId: ctx.userId, snapshot: await snapshotOf(r.id) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: normal ? "rca.closed" : "rca.closed.exception", entityType: "RcaInvestigation", entityId: r.id, data: { from: r.status, to: "CLOSED", openActionsKept: s.open.length } }, tx);
  });
}

export async function reopenRca(ctx: Ctx, id: string, reason: string) {
  const r = await loadRca(ctx, id);
  if (!hasOrgPermission(ctx, "rca.approve") && !hasOrgPermission(ctx, "rca.create")) throw new ForbiddenError("Only a manager can reopen an investigation");
  if (r.status !== "CLOSED") throw new ConflictError("Only a closed investigation can be reopened");
  if (reason.trim().length < 10) throw new ValidationError("Say why the investigation is being reopened");
  await db.$transaction(async (tx) => {
    await bump(tx, r, undefined, { status: "INVESTIGATING", closedAt: null, closedById: null, reopenCount: { increment: 1 } });
    await tx.rcaReview.create({ data: { organisationId: r.organisationId, rcaId: r.id, stage: "REOPEN", decision: "REOPENED", note: reason.trim(), reviewerId: ctx.userId, snapshot: await snapshotOf(r.id) } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.reopened", entityType: "RcaInvestigation", entityId: r.id, data: { from: "CLOSED", to: "INVESTIGATING", reason: reason.trim(), previousClosure: r.closureNote } }, tx);
  });
  await tell(r, [r.ownerId, r.managerId].filter((u) => u !== ctx.userId), "reopened", "continue the reopened investigation", { responsible: await nameOf(r.ownerId), key: `rca-reopened:${r.id}:${r.reopenCount + 1}` });
}

/** Offers the investigation as evidence for CQC assessment areas; a reviewer verifies it separately. */
export async function linkRcaToCqc(ctx: Ctx, id: string, criterionIds: string[], note?: string) {
  const r = await loadRca(ctx, id);
  if (!criterionIds.length) throw new ValidationError("Choose at least one assessment area");
  for (const criterionId of criterionIds) await linkEvidence(ctx, { criterionId, sourceType: "RCA", sourceId: r.id, note });
}

// ───────── reading

export interface RcaFilters { branch?: string; service?: string; from?: string; to?: string; severity?: string; category?: string; status?: string; owner?: string; serviceUser?: string; q?: string }

export function parseRcaFilters(sp: Record<string, string | undefined>): RcaFilters {
  const pick = (k: string) => (sp[k] ? sp[k]!.slice(0, 100) : undefined);
  return { branch: pick("branch"), service: pick("service"), from: sp.from && isIsoDate(sp.from) ? sp.from : undefined, to: sp.to && isIsoDate(sp.to) ? sp.to : undefined, severity: pick("severity"), category: pick("category"), status: pick("status"), owner: pick("owner"), serviceUser: pick("serviceUser"), q: pick("q") };
}

async function filterWhere(ctx: Ctx, organisationId: string, f: RcaFilters): Promise<Prisma.RcaInvestigationWhereInput> {
  const and: Prisma.RcaInvestigationWhereInput[] = [];
  if (f.branch) and.push({ branchId: f.branch });
  // A service filter keeps investigations in branches that offer the service (organisation-wide ones stay visible).
  if (f.service) and.push({ OR: [{ branchId: null }, { branchId: { in: await serviceBranches(organisationId, f.service) } }] });
  if (f.from) and.push({ eventDate: { gte: new Date(`${f.from}T00:00:00Z`) } });
  if (f.to) and.push({ eventDate: { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } });
  if (f.severity && f.severity in SEVERITIES) and.push({ severity: f.severity });
  if (f.category && (RCA_CATEGORIES as readonly string[]).includes(f.category)) and.push({ category: f.category });
  if (f.status === "OPEN") and.push({ status: { in: OPEN_RCA } });
  else if (f.status === "OVERDUE") and.push({ status: { in: OPEN_RCA }, dueDate: { lt: startOfToday() } });
  else if (f.status === "CRITICAL") and.push({ status: { in: OPEN_RCA }, severity: "CRITICAL" });
  else if (f.status && f.status in RCA_STATUS) and.push({ status: f.status });
  if (f.owner) and.push({ OR: [{ ownerId: f.owner }, { managerId: f.owner }] });
  if (f.serviceUser && hasOrgPermission(ctx, "serviceUser.view")) and.push({ serviceUserId: f.serviceUser });
  if (f.q) and.push({ OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }, { sources: { some: { OR: [{ sourceRef: { contains: f.q, mode: "insensitive" } }, { externalRef: { contains: f.q, mode: "insensitive" } }] } } }] });
  return { AND: and };
}

async function serviceBranches(organisationId: string, code: string) {
  return (await db.branchServiceType.findMany({ where: { serviceTypeCode: code, branch: { organisationId } }, select: { branchId: true } })).map((b) => b.branchId);
}

export async function listRcas(ctx: Ctx, f: RcaFilters = {}) {
  const base = rcaVisibleWhere(ctx);
  const where = await filterWhere(ctx, base.organisationId as string, f);
  const rows = await db.rcaInvestigation.findMany({ where: { AND: [base, where] }, include: { sources: { select: { sourceType: true, sourceRef: true, externalRef: true } }, _count: { select: { actions: true } } }, orderBy: [{ openedAt: "desc" }], take: 300 });
  const seeRestricted = hasOrgPermission(ctx, "rca.safeguarding");
  const today = startOfToday();
  return rows.map((r) => {
    const hidden = r.restricted && !seeRestricted && r.ownerId !== ctx.userId && r.managerId !== ctx.userId;
    return { ...r, title: hidden ? "Restricted investigation" : r.title, overdue: r.status !== "CLOSED" && r.dueDate < today, hidden };
  });
}

/** The RCA tab's figures, from the investigations the caller may see. */
export async function rcaDashboard(ctx: Ctx, f: RcaFilters = {}) {
  const rows = await listRcas(ctx, { ...f, status: undefined });
  const open = rows.filter((r) => r.status !== "CLOSED");
  const ids = rows.map((r) => r.id);
  const [actions] = await Promise.all([ids.length ? db.complianceAction.findMany({ where: { rcaId: { in: ids } }, select: { rcaId: true, status: true, dueDate: true } }) : Promise.resolve([])]);
  const byRca = new Map<string, { total: number; done: number }>();
  for (const a of actions) {
    const s = byRca.get(a.rcaId!) ?? { total: 0, done: 0 };
    s.total++;
    if (DONE_ACTION.includes(a.status)) s.done++;
    byRca.set(a.rcaId!, s);
  }
  const effectivenessDue = rows.filter((r) => r.status === "EFFECTIVENESS_REVIEW" || (r.status === "ACTIONS_IN_PROGRESS" && (byRca.get(r.id)?.total ?? 0) > 0 && byRca.get(r.id)!.done === byRca.get(r.id)!.total)).length;
  const since = new Date(Date.now() - 365 * 86_400_000);
  const themes = new Map<string, number>();
  for (const r of rows) if (r.eventDate >= since) themes.set(r.category, (themes.get(r.category) ?? 0) + 1);
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === "NEW").length,
    investigating: rows.filter((r) => r.status === "INVESTIGATING").length,
    awaitingReview: rows.filter((r) => r.status === "AWAITING_REVIEW").length,
    closed: rows.filter((r) => r.status === "CLOSED").length,
    overdue: open.filter((r) => r.overdue).length,
    critical: open.filter((r) => r.severity === "CRITICAL").length,
    actionsOutstanding: actions.filter((a) => OPEN_ACTION.includes(a.status)).length,
    effectivenessDue,
    themes: [...themes.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]),
  };
}

/** One investigation with everything a manager needs on one screen. */
export async function getRca(ctx: Ctx, id: string) {
  const r = await loadRca(ctx, id);
  const organisationId = r.organisationId;
  const [sources, findings, reviews, escalations, actions, evidence, history, notifications, cqcLinks, serviceUser, branch] = await Promise.all([
    db.rcaSourceLink.findMany({ where: { rcaId: r.id }, orderBy: { createdAt: "asc" } }),
    db.rcaFinding.findMany({ where: { rcaId: r.id }, orderBy: { createdAt: "asc" } }),
    db.rcaReview.findMany({ where: { rcaId: r.id }, orderBy: { createdAt: "asc" }, select: { id: true, stage: true, decision: true, note: true, checks: true, reviewerId: true, createdAt: true } }),
    db.rcaEscalation.findMany({ where: { rcaId: r.id } }),
    db.complianceAction.findMany({ where: { rcaId: r.id }, orderBy: { dueDate: "asc" } }),
    hasOrgPermission(ctx, "evidence.read") || canWork(ctx, r) ? db.evidenceDocument.findMany({ where: { organisationId, linkedType: "RCA", linkedId: r.id }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, description: true, scanStatus: true, createdAt: true } }) : Promise.resolve([]),
    db.auditLog.findMany({ where: { organisationId, entityType: "RcaInvestigation", entityId: r.id }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.notification.findMany({ where: { organisationId, actionUrl: `/compliance/cqc/rca/${r.id}` }, select: { id: true, type: true, title: true, userId: true, createdAt: true, readAt: true, deliveries: { select: { channel: true, status: true, attempts: true, sentAt: true } } }, orderBy: { createdAt: "desc" } }),
    hasOrgPermission(ctx, "cqc.view") ? linksFor(ctx, organisationId, { sourceType: "RCA", sourceId: r.id }) : Promise.resolve([]),
    r.serviceUserId && hasOrgPermission(ctx, "serviceUser.view") ? db.serviceUser.findFirst({ where: { id: r.serviceUserId, organisationId }, select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true } }) : Promise.resolve(null),
    r.branchId ? db.branch.findUnique({ where: { id: r.branchId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  // The linked incidents and missed calls, shown inside the investigation so nobody has to search for them.
  const incidentIds = sources.filter((s) => s.sourceType === "INCIDENT").map((s) => s.sourceId);
  const missedIds = sources.filter((s) => s.sourceType === "MISSED_CALL").map((s) => s.sourceId);
  const [incidents, missed] = await Promise.all([
    incidentIds.length ? db.incident.findMany({ where: { organisationId, id: { in: incidentIds } }, select: { id: true, reference: true, category: true, severity: true, status: true, occurredAt: true, description: true, immediateAction: true, peopleNotified: true, safeguarding: true, notifiable: true, outcome: true } }) : Promise.resolve([]),
    missedIds.length ? db.missedCallCase.findMany({ where: { organisationId, id: { in: missedIds } }, select: { id: true, scheduledStart: true, stage: true, reasonCode: true, reasonDetail: true, findings: true, outcome: true, preventable: true, signedOffAt: true, visit: { select: { reference: true } } } }) : Promise.resolve([]),
  ]);
  const userIds = [...new Set([r.ownerId, r.managerId, r.createdById, r.closedById, ...reviews.map((x) => x.reviewerId), ...escalations.map((e) => e.decidedById), ...actions.map((a) => a.ownerId), ...history.map((h) => h.actorId), ...notifications.map((n) => n.userId)].filter((x): x is string => Boolean(x)))];
  const names = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const st = await actionState(r.id);
  const escalationKinds = escalations.map((e) => e.kind);
  return {
    rca: r,
    serviceUser,
    branchName: branch?.name ?? "Whole organisation",
    sources,
    incidents,
    missed,
    findings,
    reviews,
    escalations,
    actions,
    evidence,
    history,
    notifications,
    cqcLinks,
    names,
    serious: isSerious(r),
    gaps: submissionGaps(r, findings.length, actions.length, escalationKinds),
    actionsDone: st.done,
    actionsTotal: st.total,
    overdue: r.status !== "CLOSED" && r.dueDate < startOfToday(),
    can: {
      work: canWork(ctx, r) && (r.status === "NEW" || r.status === "INVESTIGATING"),
      escalate: canWork(ctx, r) && r.status !== "CLOSED",
      addActions: canWork(ctx, r) && !["CLOSED", "AWAITING_REVIEW"].includes(r.status),
      review: r.status === "AWAITING_REVIEW" && hasOrgPermission(ctx, "rca.approve") && r.ownerId !== ctx.userId,
      startEffectiveness: canWork(ctx, r) && r.status === "ACTIONS_IN_PROGRESS" && st.total > 0 && st.done === st.total,
      effectiveness: r.status === "EFFECTIVENESS_REVIEW" && hasOrgPermission(ctx, "rca.approve") && r.ownerId !== ctx.userId,
      close: ["ACTIONS_IN_PROGRESS", "EFFECTIVENESS_REVIEW"].includes(r.status) && hasOrgPermission(ctx, "rca.approve") && r.ownerId !== ctx.userId,
      reopen: r.status === "CLOSED" && (hasOrgPermission(ctx, "rca.approve") || hasOrgPermission(ctx, "rca.create")),
      linkCqc: hasOrgPermission(ctx, "cqc.assess"),
      uploadEvidence: hasOrgPermission(ctx, "evidence.upload") && r.status !== "CLOSED",
    },
  };
}

export async function rcaPeople(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "rca.create");
  const [investigators, managers] = await Promise.all([membersWithRoles(organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "POLICY_REVIEWER"]), approvers(organisationId)]);
  return { investigators, managers };
}

/** Attaches a file to the investigation through the Evidence Library's checks (type, size, malware scan). */
export async function attachRcaEvidence(ctx: Ctx, id: string, file: { name: string; type: string; bytes: Buffer }, description?: string) {
  const r = await loadRca(ctx, id);
  assertWork(ctx, r);
  if (r.status === "CLOSED") throw new ConflictError("Reopen the investigation before adding evidence");
  const { storeEvidenceFile } = await import("../compliance/evidence");
  const doc = await storeEvidenceFile(r.organisationId, ctx.userId, file, { description: description?.trim() || `Evidence for ${r.reference}`, linkedType: "RCA", linkedId: r.id });
  await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "rca.evidence.added", entityType: "RcaInvestigation", entityId: r.id, data: { evidenceId: doc.id, filename: doc.filename } });
  return doc;
}
