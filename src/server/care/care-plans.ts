import { createHash } from "node:crypto";
import type { CarePlan, CarePlanSection, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { myStaff } from "@/server/workforce/link";

type Tx = Prisma.TransactionClient;

/**
 * Person-centred care plans. A plan is versioned: a draft is written and edited, submitted for review, and approved
 * by a second person (never its author or submitter), at which point it replaces the previous active version.
 * Approved and superseded versions are frozen by database trigger. Carers booked to visit the person are told in
 * the app and confirm they have read the new version. Medication content is a prompt to the paper MAR only.
 */

export const PLAN_SECTIONS = [
  { key: "about_me", title: "About me", hint: "What matters to the person, their history, routines and how they like to be supported." },
  { key: "communication", title: "Communication", hint: "Hearing, sight, language, memory and how best to talk with them." },
  { key: "personal_care", title: "Personal care", hint: "Washing, dressing, continence and skin care: what they do themselves and what carers do." },
  { key: "mobility", title: "Mobility and moving", hint: "Walking, transfers, equipment and the number of carers needed. Link to the moving and handling risk assessment." },
  { key: "nutrition", title: "Eating and drinking", hint: "Meals, drinks, preferences, allergies and any swallowing guidance." },
  { key: "medication", title: "Medication support", hint: "What support the person needs with medicines and who orders them. Each medicine and its times go on the Medication tab (when medication records are switched on), where carers record every dose." },
  { key: "health", title: "Health and wellbeing", hint: "Conditions, signs to look out for, and who to contact." },
  { key: "home", title: "Home and safety", hint: "Getting in, pets, hazards and what to do in an emergency." },
  { key: "outcomes", title: "Outcomes", hint: "What the person wants to achieve and how the visits help." },
] as const;

async function suInScope(tx: Tx, scope: Scope, serviceUserId: string) {
  const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, organisationId: true, firstName: true, lastName: true, preferredName: true } });
  if (!su) throw new NotFoundError("Service user");
  return su;
}

async function planInScope(tx: Tx, scope: Scope, planId: string, lock = false) {
  if (lock) await tx.$queryRaw`SELECT id FROM "CarePlan" WHERE id = ${planId} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
  const plan = await tx.carePlan.findFirst({ where: { id: planId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) }, include: { sections: { orderBy: { position: "asc" } } } });
  if (!plan) throw new NotFoundError("Care plan");
  return plan;
}

/** A fingerprint of a draft's content, so two people editing the same draft cannot silently overwrite each other. */
export function draftFingerprint(plan: Pick<CarePlan, "summary" | "reviewDue">, sections: Pick<CarePlanSection, "key" | "body" | "outcomes">[]) {
  const h = createHash("sha256");
  h.update(JSON.stringify([plan.summary ?? "", plan.reviewDue?.toISOString() ?? "", [...sections].sort((a, b) => a.key.localeCompare(b.key)).map((s) => [s.key, s.body, s.outcomes ?? ""])]));
  return h.digest("hex").slice(0, 16);
}

/** Every version for one person, newest first, with who has read the active one. */
export async function carePlansFor(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await suInScope(db, scope, serviceUserId);
  const plans = await db.carePlan.findMany({ where: { serviceUserId: su.id, organisationId: scope.organisationId }, include: { sections: { orderBy: { position: "asc" } }, acknowledgements: true }, orderBy: { version: "desc" } });
  // Carers who visit in the next fortnight are the ones who need to have read it.
  const today = londonDate();
  const visiting = await db.visitAssignment.findMany({
    where: { organisationId: scope.organisationId, removedAt: null, visit: { serviceUserId: su.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, date: { gte: dbDate(today), lte: dbDate(addDays(today, 14)) } } },
    select: { staff: { select: { id: true, displayName: true } } },
    distinct: ["staffId"],
  });
  return { serviceUser: su, plans, visitingCarers: visiting.map((v) => v.staff) };
}

/** The register: each current person with the state of their plan. */
export async function carePlanRegister(ctx: Ctx, f: { q?: string; filter?: string }) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const people = await db.serviceUser.findMany({
    where: { ...serviceUserWhere(scope), status: { in: ["ASSESSMENT", "ACTIVE", "PAUSED"] }, ...(f.q ? { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } }] } : {}) },
    select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true, status: true, area: { select: { name: true, colour: true } }, carePlans: { where: { status: { in: ["DRAFT", "IN_REVIEW", "ACTIVE"] } }, select: { id: true, version: true, status: true, reviewDue: true, approvedAt: true, _count: { select: { acknowledgements: true } } } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });
  const today = dbDate(londonDate());
  // "Read by carers" counts the carers booked in the next 14 days who have read the plan in use, out of all of them,
  // the same measure the person's care plan page shows. Two queries for the whole register, not one per person.
  const activeIds = people.flatMap((p) => p.carePlans.filter((c) => c.status === "ACTIVE").map((c) => c.id));
  const [booked, acks] = await Promise.all([
    activeIds.length
      ? db.visitAssignment.findMany({
          where: { organisationId: scope.organisationId, removedAt: null, visit: { serviceUserId: { in: people.map((p) => p.id) }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, date: { gte: today, lte: dbDate(addDays(londonDate(), 14)) } } },
          select: { staffId: true, visit: { select: { serviceUserId: true } } },
        })
      : [],
    activeIds.length ? db.carePlanAcknowledgement.findMany({ where: { organisationId: scope.organisationId, carePlanId: { in: activeIds } }, select: { carePlanId: true, staffId: true } }) : [],
  ]);
  const bookedFor = new Map<string, Set<string>>();
  for (const b of booked) {
    const set = bookedFor.get(b.visit.serviceUserId) ?? new Set<string>();
    set.add(b.staffId);
    bookedFor.set(b.visit.serviceUserId, set);
  }
  const readers = new Map<string, Set<string>>();
  for (const a of acks) readers.set(a.carePlanId, (readers.get(a.carePlanId) ?? new Set<string>()).add(a.staffId));
  const rows = people.map((p) => {
    const active = p.carePlans.find((c) => c.status === "ACTIVE") ?? null;
    const pending = p.carePlans.find((c) => c.status !== "ACTIVE") ?? null;
    const overdue = !!active?.reviewDue && active.reviewDue < today;
    const visiting = [...(bookedFor.get(p.id) ?? [])];
    const readByVisiting = active ? { read: visiting.filter((id) => readers.get(active.id)?.has(id)).length, of: visiting.length } : null;
    return { ...p, active, pending, overdue, readByVisiting };
  });
  const filtered = rows.filter((r) => (f.filter === "none" ? !r.active : f.filter === "overdue" ? r.overdue : f.filter === "review" ? r.pending?.status === "IN_REVIEW" : f.filter === "draft" ? r.pending?.status === "DRAFT" : true));
  return { rows: filtered, totals: { all: rows.length, none: rows.filter((r) => !r.active).length, overdue: rows.filter((r) => r.overdue).length, review: rows.filter((r) => r.pending?.status === "IN_REVIEW").length, draft: rows.filter((r) => r.pending?.status === "DRAFT").length } };
}

/** Starts a new draft, copied from the active version if there is one. Only one draft or review can be open at a time. */
export async function startDraft(ctx: Ctx, serviceUserId: string, opts: { sourceSummaryId?: string } = {}) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ServiceUser" WHERE id = ${serviceUserId} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
    const su = await suInScope(tx, scope, serviceUserId);
    const open = await tx.carePlan.findFirst({ where: { serviceUserId: su.id, status: { in: ["DRAFT", "IN_REVIEW"] } } });
    if (open) throw new ConflictError(`Version ${open.version} is already ${open.status === "DRAFT" ? "being drafted" : "in review"}`);
    const latest = await tx.carePlan.findFirst({ where: { serviceUserId: su.id }, orderBy: { version: "desc" } });
    const active = await tx.carePlan.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" }, include: { sections: true } });
    const plan = await tx.carePlan.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, version: (latest?.version ?? 0) + 1, summary: active?.summary ?? null, reviewDue: active?.reviewDue ?? dbDate(addDays(londonDate(), 182)), createdById: ctx.userId, sourceSummaryId: opts.sourceSummaryId ?? null } });
    await tx.carePlanSection.createMany({
      data: PLAN_SECTIONS.map((s, position) => {
        const prev = active?.sections.find((x) => x.key === s.key);
        return { carePlanId: plan.id, key: s.key, title: s.title, body: prev?.body ?? "", outcomes: prev?.outcomes ?? null, position };
      }),
    });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.draft.started", entityType: "ServiceUser", entityId: su.id, data: { carePlanId: plan.id, version: plan.version, from: active?.version ?? null, careSummaryId: opts.sourceSummaryId ?? null } }, tx);
    return plan;
  });
}

const draftSchema = z.object({
  fingerprint: z.string().min(1),
  summary: z.string().trim().max(2000),
  reviewDue: z.string().refine(isIsoDate, "Choose a review date"),
  sections: z.record(z.string(), z.object({ body: z.string().max(10000), outcomes: z.string().max(4000).optional() })),
});

export async function saveDraft(ctx: Ctx, planId: string, input: z.input<typeof draftSchema>) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  const p = draftSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the plan");
  if (p.data.reviewDue <= londonDate()) throw new ValidationError("The review date must be in the future");
  return db.$transaction(async (tx) => {
    const plan = await planInScope(tx, scope, planId, true);
    if (plan.status !== "DRAFT") throw new ValidationError("Only a draft can be edited");
    if (draftFingerprint(plan, plan.sections) !== p.data.fingerprint) throw new ConflictError("Someone else saved this draft since you opened it. Reload to see their changes.");
    await tx.carePlan.update({ where: { id: plan.id }, data: { summary: p.data.summary || null, reviewDue: dbDate(p.data.reviewDue) } });
    for (const s of plan.sections) {
      const next = p.data.sections[s.key];
      if (next && (next.body.trim() !== s.body || (next.outcomes?.trim() || null) !== s.outcomes)) await tx.carePlanSection.update({ where: { id: s.id }, data: { body: next.body.trim(), outcomes: next.outcomes?.trim() || null } });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.draft.saved", entityType: "ServiceUser", entityId: plan.serviceUserId, data: { carePlanId: plan.id, version: plan.version } }, tx);
  });
}

export async function submitPlan(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  return db.$transaction(async (tx) => {
    const plan = await planInScope(tx, scope, planId, true);
    if (plan.status !== "DRAFT") throw new ValidationError("Only a draft can be submitted");
    const empty = plan.sections.filter((s) => s.body.trim().length < 3).map((s) => s.title);
    if (!plan.summary?.trim()) throw new ValidationError("Add a summary before submitting");
    if (empty.length) throw new ValidationError(`Complete every section before submitting. Still empty: ${empty.join(", ")}`);
    await tx.carePlan.update({ where: { id: plan.id }, data: { status: "IN_REVIEW", submittedById: ctx.userId, submittedAt: new Date() } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.submitted", entityType: "ServiceUser", entityId: plan.serviceUserId, data: { carePlanId: plan.id, version: plan.version } }, tx);
  });
}

/** Sends a plan in review back to draft with the reviewer's reason. */
export async function returnPlan(ctx: Ctx, planId: string, reason: string) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  if (reason.trim().length < 3) throw new ValidationError("Say what needs changing");
  return db.$transaction(async (tx) => {
    const plan = await planInScope(tx, scope, planId, true);
    if (plan.status !== "IN_REVIEW") throw new ValidationError("Only a plan in review can be returned");
    await tx.carePlan.update({ where: { id: plan.id }, data: { status: "DRAFT", submittedById: null, submittedAt: null } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.returned", entityType: "ServiceUser", entityId: plan.serviceUserId, data: { carePlanId: plan.id, version: plan.version, reason: reason.trim() } }, tx);
  });
}

/**
 * Approves a plan in review. The approver must be a different person from whoever wrote or submitted it. The
 * previous active version is superseded in the same transaction, and carers visiting soon are asked to read it.
 */
export async function approvePlan(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "care.plan.approve");
  return db.$transaction(async (tx) => {
    const plan = await planInScope(tx, scope, planId, true);
    if (plan.status !== "IN_REVIEW") throw new ValidationError("Only a plan in review can be approved");
    if (plan.createdById === ctx.userId || plan.submittedById === ctx.userId) throw new ForbiddenError("You wrote or submitted this version, so someone else must approve it");
    const previous = await tx.carePlan.findFirst({ where: { serviceUserId: plan.serviceUserId, status: "ACTIVE" } });
    if (previous) await tx.carePlan.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    await tx.carePlan.update({ where: { id: plan.id }, data: { status: "ACTIVE", approvedById: ctx.userId, approvedAt: new Date() } });
    const today = londonDate();
    const carers = await tx.visitAssignment.findMany({
      where: { organisationId: scope.organisationId, removedAt: null, staff: { userId: { not: null } }, visit: { serviceUserId: plan.serviceUserId, status: "SCHEDULED", publishedAt: { not: null }, date: { gte: dbDate(today), lte: dbDate(addDays(today, 14)) } } },
      select: { staff: { select: { userId: true } } },
      distinct: ["staffId"],
    });
    const su = await tx.serviceUser.findUniqueOrThrow({ where: { id: plan.serviceUserId }, select: { firstName: true, lastName: true, preferredName: true } });
    const name = `${su.preferredName ?? su.firstName} ${su.lastName}`;
    await tx.notification.createMany({
      data: carers.map((c) => ({ organisationId: scope.organisationId, userId: c.staff.userId as string, type: "careplan.updated", title: `Updated care plan for ${name}`, body: `Version ${plan.version} of ${name}'s care plan is now in use. Please read it before your next visit.`, reason: "You are booked to visit this person.", actionUrl: `/carer/care-plan/${plan.serviceUserId}`, dedupeKey: `careplan:${plan.id}:${c.staff.userId}` })),
      skipDuplicates: true,
    });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.approved", entityType: "ServiceUser", entityId: plan.serviceUserId, data: { carePlanId: plan.id, version: plan.version, superseded: previous?.version ?? null, carersNotified: carers.length } }, tx);
    return { notified: carers.length };
  });
}

/** Throws away an unsubmitted draft. Submitted and approved versions can never be deleted. */
export async function discardDraft(ctx: Ctx, planId: string) {
  const scope = await rotaScope(ctx, "care.plan.edit");
  return db.$transaction(async (tx) => {
    const plan = await planInScope(tx, scope, planId, true);
    if (plan.status !== "DRAFT") throw new ValidationError("Only a draft can be discarded");
    await tx.carePlan.delete({ where: { id: plan.id } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "careplan.draft.discarded", entityType: "ServiceUser", entityId: plan.serviceUserId, data: { version: plan.version } }, tx);
  });
}

/**
 * The carer's read-only view of someone they visit: the active plan and active risk assessments. Only for people
 * they are booked to see within the organisation's carer window; anyone else looks like a missing record.
 */
export async function carerCarePlan(ctx: Ctx, serviceUserId: string) {
  const staff = await myStaff(ctx);
  const settings = await rotaSettings(db, staff.organisationId);
  const today = londonDate();
  const booked = await db.visitAssignment.findFirst({ where: { staffId: staff.id, removedAt: null, visit: { organisationId: staff.organisationId, serviceUserId, publishedAt: { not: null }, date: { gte: dbDate(addDays(today, -settings.carerDaysBack)), lte: dbDate(addDays(today, settings.carerDaysForward)) } } } });
  if (!booked) throw new NotFoundError("Care plan");
  const [su, plan, risks] = await Promise.all([
    db.serviceUser.findUniqueOrThrow({ where: { id: serviceUserId }, select: { id: true, firstName: true, lastName: true, preferredName: true, accessNotes: true } }),
    db.carePlan.findFirst({ where: { serviceUserId, organisationId: staff.organisationId, status: "ACTIVE" }, include: { sections: { orderBy: { position: "asc" } }, acknowledgements: { where: { staffId: staff.id } } } }),
    db.riskAssessment.findMany({ where: { serviceUserId, organisationId: staff.organisationId, status: "ACTIVE" }, orderBy: [{ level: "desc" }, { title: "asc" }], select: { id: true, title: true, type: true, level: true, hazards: true, controls: true } }),
  ]);
  return { staff, serviceUser: su, plan, risks };
}

export async function acknowledgePlan(ctx: Ctx, serviceUserId: string, planId: string) {
  const { staff, plan } = await carerCarePlan(ctx, serviceUserId);
  if (!plan || plan.id !== planId) throw new ConflictError("This care plan has changed. Read the current version.");
  if (plan.acknowledgements.length) return false;
  return db.$transaction(async (tx) => {
    await tx.carePlanAcknowledgement.create({ data: { organisationId: staff.organisationId, carePlanId: plan.id, staffId: staff.id, userId: ctx.userId } });
    await audit({ organisationId: staff.organisationId, actorId: ctx.userId, action: "careplan.acknowledged", entityType: "ServiceUser", entityId: serviceUserId, data: { carePlanId: plan.id, version: plan.version, staffId: staff.id } }, tx);
    return true;
  });
}
