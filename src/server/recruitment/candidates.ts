import type { Prisma, RecruitmentStage } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { recruitmentAccess, requireBranch, requireEdit, type RecruitmentAccess } from "./access";
import { canClose, CLOSED_STAGES, DEFAULT_REMINDERS, isOpen, manualMoves, PIPELINE, retainUntil, SCREENING_QUESTIONS, STAGE_LABEL, suggestedNextAction, type CandidateFacts } from "./model";

/**
 * Candidates for jobs, from application to "Ready for Work". Every change is scoped to the session's organisation and
 * the member's HR branches, checks the record's lock version (two people never overwrite each other), and is written
 * with its history event and audit entry in one transaction. Decisions (screening, interview, offer, closing) are
 * always recorded by a person; nothing here decides for them.
 */

type Db = Prisma.TransactionClient;

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const docs = z.array(z.string().trim().min(2).max(80)).max(20).default([]);

export const candidateSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the first name").max(60),
  lastName: z.string().trim().min(1, "Enter the last name").max(60),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address")]).optional().transform((v) => v || null),
  phone: z.string().trim().max(30).regex(/^[0-9 +()-]*$/, "Phone numbers may contain digits, spaces and + ( ) - only").optional().transform((v) => v || null),
  roleApplied: z.string().trim().min(2, "Enter the role applied for").max(100),
  branchId: z.string().min(1, "Choose the preferred branch"),
  availability: text(500),
  experience: text(1000),
  driving: z.enum(["DRIVER_WITH_CAR", "DRIVER_NO_CAR", "NON_DRIVER", "NOT_ASKED"]).default("NOT_ASKED"),
  rightToWork: z.enum(["NOT_CHECKED", "IN_PROGRESS", "VERIFIED", "NOT_ELIGIBLE"]).default("NOT_CHECKED"),
  source: text(80),
  applicationComplete: z.boolean().default(true),
  outstandingDocuments: docs,
  recruiterId: z.string().optional().transform((v) => v || null),
  nextAction: text(160),
  nextActionDue: z.string().optional().transform((v) => v || null).refine((v) => v === null || isIsoDate(v), "Enter a valid date"),
  contactConsent: z.boolean().default(false),
});
export type CandidateInput = z.input<typeof candidateSchema>;

const include = {
  screenings: { orderBy: { sentAt: "desc" } },
  interviews: { orderBy: { startsAt: "desc" } },
} satisfies Prisma.CandidateInclude;

type CandidateRow = Prisma.CandidateGetPayload<{ include: typeof include }>;

export function factsOf(c: CandidateRow): CandidateFacts {
  return {
    stage: c.stage,
    applicationComplete: c.applicationComplete,
    rightToWork: c.rightToWork,
    outstandingDocuments: c.outstandingDocuments,
    offerResponse: c.offerResponse,
    createdOn: londonDate(c.createdAt),
    stageChangedOn: londonDate(c.stageChangedAt),
    nextAction: c.nextAction,
    screenings: c.screenings.map((s) => ({ sentOn: londonDate(s.sentAt), answered: !!s.answeredAt, reviewOutcome: s.reviewOutcome })),
    interviews: c.interviews.map((i) => ({ startsAt: i.startsAt, status: i.status, outcome: i.outcome })),
    hrEmployeeId: c.hrEmployeeId,
  };
}

/** True when the next step is the candidate's, not the office's. */
export function waitingOnCandidate(f: CandidateFacts, now: Date) {
  if (f.stage === "OFFER" && f.offerResponse === "PENDING") return true;
  if (f.stage === "SCREENING" && f.screenings[0] && !f.screenings[0].answered) return true;
  if (f.stage === "INTERVIEW" && f.interviews.some((i) => i.startsAt > now && i.status === "CONFIRMED")) return true;
  return false;
}

async function owned(tx: Db | typeof db, a: RecruitmentAccess, id: string) {
  const c = await tx.candidate.findFirst({ where: { id, organisationId: a.organisationId }, include });
  if (!c || !a.branchIds.includes(c.branchId)) throw new NotFoundError("Candidate");
  return c;
}

async function event(tx: Db, c: { id: string; organisationId: string }, type: string, actorId: string, extra: { fromStage?: RecruitmentStage; toStage?: RecruitmentStage; data?: Prisma.InputJsonValue } = {}) {
  await tx.candidateEvent.create({ data: { organisationId: c.organisationId, candidateId: c.id, type, actorId, fromStage: extra.fromStage ?? null, toStage: extra.toStage ?? null, data: extra.data ?? {} } });
  await audit({ organisationId: c.organisationId, actorId, action: `recruitment.${type.toLowerCase()}`, entityType: "Candidate", entityId: c.id, data: { ...(extra.fromStage ? { from: extra.fromStage } : {}), ...(extra.toStage ? { to: extra.toStage } : {}) } }, tx);
}

/** Writes `data` only if nobody changed the candidate since `lockVersion` was read. */
async function bump(tx: Db, id: string, lockVersion: number, data: Prisma.CandidateUncheckedUpdateManyInput) {
  const n = await tx.candidate.updateMany({ where: { id, lockVersion }, data: { ...data, lockVersion: { increment: 1 } } });
  if (!n.count) throw new ConflictError("Someone else changed this candidate. Reload the page and try again.");
}

async function nextReference(tx: Db, organisationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate-ref:${organisationId}`}))`;
  const last = await tx.candidate.findFirst({ where: { organisationId }, orderBy: { reference: "desc" }, select: { reference: true } });
  const n = last ? Number(last.reference.replace(/\D/g, "")) + 1 : 1;
  return `CAN-${String(n).padStart(4, "0")}`;
}

async function checkRecruiter(organisationId: string, userId: string | null) {
  if (!userId) return;
  const m = await db.membership.findFirst({ where: { organisationId, userId, deactivatedAt: null }, select: { id: true } });
  if (!m) throw new ValidationError("Choose a recruiter from your organisation");
}

function parse(input: CandidateInput | Record<string, unknown>) {
  const p = candidateSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  return p.data;
}

// ── Reading ──────────────────────────────────────────────────────────────

export const listSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING", "READY", "WITHDRAWN", "UNSUCCESSFUL", "open", "closed"]).catch("open"),
  branch: z.string().max(40).optional().catch(undefined),
  recruiter: z.string().max(40).optional().catch(undefined),
  focus: z.enum(["new", "review", "offers", "ready"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export async function recruitmentBoard(ctx: Ctx, raw: Record<string, string | undefined>) {
  const a = await recruitmentAccess(ctx);
  const f = listSchema.parse(raw);
  const now = new Date();
  const today = londonDate(now);
  const branchIds = f.branch && a.branchIds.includes(f.branch) ? [f.branch] : a.branchIds;
  const all = await db.candidate.findMany({ where: { organisationId: a.organisationId, branchId: { in: branchIds } }, include, orderBy: [{ stageChangedAt: "desc" }], take: 2000 });
  const open = all.filter((c) => isOpen(c.stage));
  const facts = new Map(all.map((c) => [c.id, factsOf(c)]));
  const needsReview = (c: CandidateRow) => c.stage === "APPLIED" || (c.stage === "SCREENING" && !!c.screenings[0]?.answeredAt && !c.screenings[0]?.reviewOutcome) || (c.stage === "INTERVIEW" && c.interviews.some((i) => i.status === "COMPLETED" && !i.outcome));
  const isNew = (c: CandidateRow) => c.stage === "APPLIED" && londonDate(c.createdAt) >= addDays(today, -6);
  const offerOpen = (c: CandidateRow) => c.stage === "OFFER" && c.offerResponse === "PENDING";
  const readyForAction = (c: CandidateRow) => c.stage !== "READY" && !waitingOnCandidate(facts.get(c.id)!, now);
  const interviews = await db.candidateInterview.findMany({
    where: { organisationId: a.organisationId, candidate: { branchId: { in: branchIds } }, status: { in: ["AWAITING_CONFIRMATION", "CONFIRMED"] }, startsAt: { gte: now, lt: londonToUtc(addDays(today, 15), 0) } },
    include: { candidate: { select: { id: true, firstName: true, lastName: true, reference: true, roleApplied: true } } },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  const counts = {
    newApplications: open.filter(isNew).length,
    needsReview: open.filter(needsReview).length,
    upcomingInterviews: interviews.length,
    offersAwaiting: open.filter(offerOpen).length,
    onboarding: open.filter((c) => c.stage === "ONBOARDING").length,
    readyForAction: open.filter(readyForAction).length,
  };
  let rows = f.stage === "open" ? open : f.stage === "closed" ? all.filter((c) => !isOpen(c.stage)) : all.filter((c) => c.stage === f.stage);
  if (f.focus === "new") rows = rows.filter(isNew);
  if (f.focus === "review") rows = rows.filter(needsReview);
  if (f.focus === "offers") rows = rows.filter(offerOpen);
  if (f.focus === "ready") rows = rows.filter(readyForAction);
  if (f.recruiter) rows = rows.filter((c) => c.recruiterId === f.recruiter);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((c) => `${c.firstName} ${c.lastName} ${c.reference} ${c.roleApplied} ${c.email ?? ""}`.toLowerCase().includes(q));
  }
  const per = 25;
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const page = Math.min(f.page, pages);
  const pipeline = PIPELINE.map((s) => ({ stage: s, label: STAGE_LABEL[s], count: open.filter((c) => c.stage === s).length }));
  return {
    access: a,
    filters: f,
    counts,
    pipeline,
    interviews,
    total: rows.length,
    page,
    pages,
    rows: rows.slice((page - 1) * per, page * per).map((c) => ({ ...c, next: suggestedNextAction(facts.get(c.id)!, now), waiting: waitingOnCandidate(facts.get(c.id)!, now) })),
    /** Every open candidate grouped by stage, for the pipeline view. */
    byStage: PIPELINE.map((s) => ({ stage: s, label: STAGE_LABEL[s], items: (f.stage === "open" ? rows : open).filter((c) => c.stage === s).slice(0, 40).map((c) => ({ ...c, next: suggestedNextAction(facts.get(c.id)!, now) })) })),
    erasable: all.filter((c) => !isOpen(c.stage) && !c.anonymisedAt && c.retainUntil && fromDbDate(c.retainUntil) < today).length,
  };
}

export async function getCandidate(ctx: Ctx, id: string) {
  const a = await recruitmentAccess(ctx);
  const c = await db.candidate.findFirst({ where: { id, organisationId: a.organisationId }, include: { ...include, notes: { orderBy: { createdAt: "desc" } }, events: { orderBy: { at: "desc" }, take: 100 } } });
  if (!c || !a.branchIds.includes(c.branchId)) return null;
  return { access: a, candidate: c, facts: factsOf(c), next: suggestedNextAction(factsOf(c), new Date()) };
}

// ── Creating and editing ─────────────────────────────────────────────────

export async function createCandidate(ctx: Ctx, input: CandidateInput | Record<string, unknown>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const d = parse(input);
  requireBranch(a, d.branchId);
  await checkRecruiter(a.organisationId, d.recruiterId);
  if (d.email) {
    const dup = await db.candidate.findFirst({ where: { organisationId: a.organisationId, email: { equals: d.email, mode: "insensitive" }, stage: { notIn: CLOSED_STAGES }, anonymisedAt: null }, select: { reference: true } });
    if (dup) throw new ConflictError(`An open application with this email already exists (${dup.reference})`);
  }
  return db.$transaction(async (tx) => {
    const reference = await nextReference(tx, a.organisationId);
    const c = await tx.candidate.create({
      data: { ...d, nextActionDue: d.nextActionDue ? dbDate(d.nextActionDue) : null, consentRecordedAt: d.contactConsent ? new Date() : null, organisationId: a.organisationId, reference, createdById: ctx.userId },
    });
    await event(tx, c, "CREATED", ctx.userId, { toStage: "APPLIED" });
    return c;
  });
}

export async function updateCandidate(ctx: Ctx, id: string, lockVersion: number, input: CandidateInput | Record<string, unknown>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const d = parse(input);
  requireBranch(a, d.branchId);
  await checkRecruiter(a.organisationId, d.recruiterId);
  return db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (c.anonymisedAt) throw new ConflictError("This application's personal details were removed");
    if (c.hrEmployeeId && d.branchId !== c.branchId) throw new ValidationError("Onboarding has started: change the branch on the employee record in HR instead");
    const changed = (Object.keys(d) as (keyof typeof d)[]).filter((k) => JSON.stringify(k === "nextActionDue" ? (c.nextActionDue ? fromDbDate(c.nextActionDue) : null) : c[k]) !== JSON.stringify(d[k]));
    await bump(tx, c.id, lockVersion, { ...d, nextActionDue: d.nextActionDue ? dbDate(d.nextActionDue) : null, consentRecordedAt: d.contactConsent ? (c.consentRecordedAt ?? new Date()) : null });
    // Field names only: the values may be personal data.
    await event(tx, c, "UPDATED", ctx.userId, { data: { fields: changed } });
  });
}

export async function addNote(ctx: Ctx, id: string, note: string) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const text = note.trim();
  if (text.length < 2 || text.length > 4000) throw new ValidationError("Write a note of up to 4,000 characters");
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (c.anonymisedAt) throw new ConflictError("This application's personal details were removed");
    await tx.candidateNote.create({ data: { organisationId: c.organisationId, candidateId: c.id, text, authorId: ctx.userId } });
    await event(tx, c, "NOTE", ctx.userId);
  });
}

// ── Stages ───────────────────────────────────────────────────────────────

export async function moveStage(ctx: Ctx, id: string, lockVersion: number, to: RecruitmentStage) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (!manualMoves(c.stage).includes(to)) throw new ValidationError(`A candidate at ${STAGE_LABEL[c.stage]} cannot be moved to ${STAGE_LABEL[to]} this way`);
    await bump(tx, c.id, lockVersion, { stage: to, stageChangedAt: new Date() });
    await event(tx, c, "STAGE", ctx.userId, { fromStage: c.stage, toStage: to });
  });
}

const closeSchema = z.object({ outcome: z.enum(["WITHDRAWN", "UNSUCCESSFUL"]), reason: z.string().trim().min(3, "Give a short reason").max(300) });

/** Withdrawn or unsuccessful. The application is kept until its retention date, then its personal details may be removed. */
export async function closeCandidate(ctx: Ctx, id: string, lockVersion: number, raw: z.input<typeof closeSchema>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const p = closeSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the outcome");
  const settings = await recruitmentSettings(a.organisationId);
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (!canClose(c.stage)) throw new ValidationError(c.hrEmployeeId ? "Onboarding has started. Manage the person from their employee record in HR." : "This application is already closed");
    const today = londonDate();
    await bump(tx, c.id, lockVersion, { stage: p.data.outcome, stageChangedAt: new Date(), closedAt: new Date(), closedReason: p.data.reason, retainUntil: dbDate(retainUntil(today, settings.retentionMonths)), nextAction: null, nextActionDue: null });
    await tx.candidateInterview.updateMany({ where: { candidateId: c.id, status: { in: ["AWAITING_CONFIRMATION", "CONFIRMED"] }, startsAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
    await event(tx, c, "CLOSED", ctx.userId, { fromStage: c.stage, toStage: p.data.outcome, data: { retentionMonths: settings.retentionMonths } });
  });
}

/** Back to the stage the application was closed from. Not possible once personal details were removed. */
export async function reopenCandidate(ctx: Ctx, id: string, lockVersion: number) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (isOpen(c.stage)) throw new ValidationError("This application is open");
    if (c.anonymisedAt) throw new ConflictError("This application's personal details were removed, so it cannot be reopened");
    const closed = await tx.candidateEvent.findFirst({ where: { candidateId: c.id, type: "CLOSED" }, orderBy: { at: "desc" } });
    const back = closed?.fromStage && canClose(closed.fromStage) ? closed.fromStage : "APPLIED";
    await bump(tx, c.id, lockVersion, { stage: back, stageChangedAt: new Date(), closedAt: null, closedReason: null, retainUntil: null });
    await event(tx, c, "REOPENED", ctx.userId, { fromStage: c.stage, toStage: back });
  });
}

/**
 * Removes a closed application's personal details once its retention date has passed. The reference, role, branch,
 * stage history and dates stay for reporting; names, contact details, notes, answers and interview notes go.
 */
export async function eraseCandidate(ctx: Ctx, id: string) {
  const a = await recruitmentAccess(ctx);
  if (!a.canErase) throw new ForbiddenError("Only an organisation administrator or Group HR can remove an application's personal details");
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (isOpen(c.stage)) throw new ValidationError("Close the application first");
    if (c.anonymisedAt) throw new ConflictError("Already removed");
    if (!c.retainUntil || fromDbDate(c.retainUntil) >= londonDate()) throw new ValidationError(`Keep this application until ${c.retainUntil ? fromDbDate(c.retainUntil) : "its retention date"}`);
    await tx.candidate.update({ where: { id: c.id }, data: { firstName: "Removed", lastName: "applicant", email: null, phone: null, availability: null, experience: null, closedReason: null, nextAction: null, outstandingDocuments: [], anonymisedAt: new Date(), lockVersion: { increment: 1 } } });
    await tx.candidateNote.deleteMany({ where: { candidateId: c.id } });
    await tx.candidateScreening.updateMany({ where: { candidateId: c.id }, data: { answers: [], reviewNote: null } });
    await tx.candidateInterview.updateMany({ where: { candidateId: c.id }, data: { notes: null, location: null } });
    await event(tx, c, "ERASED", ctx.userId);
  });
}

// ── Screening ────────────────────────────────────────────────────────────

/** Records that the standard questions were given to the candidate (by phone, in person or on paper). Nothing is sent. */
export async function giveScreening(ctx: Ctx, id: string, channel: string) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  if (!["PHONE", "IN_PERSON", "PAPER"].includes(channel)) throw new ValidationError("Choose how the questions were given");
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (!["APPLIED", "SCREENING"].includes(c.stage)) throw new ValidationError("Screening happens before the interview stage");
    if (c.screenings.some((s) => !s.answeredAt)) throw new ConflictError("The last screening questions have no answers yet");
    await tx.candidateScreening.create({ data: { organisationId: c.organisationId, candidateId: c.id, questions: SCREENING_QUESTIONS.map((q) => ({ ...q })), channel, sentById: ctx.userId } });
    if (c.stage === "APPLIED") {
      await tx.candidate.update({ where: { id: c.id }, data: { stage: "SCREENING", stageChangedAt: new Date(), lockVersion: { increment: 1 } } });
      await event(tx, c, "STAGE", ctx.userId, { fromStage: "APPLIED", toStage: "SCREENING" });
    }
    await event(tx, c, "SCREENING_GIVEN", ctx.userId, { data: { channel } });
  });
}

export async function recordScreeningAnswers(ctx: Ctx, screeningId: string, answers: Record<string, string>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  await db.$transaction(async (tx) => {
    const s = await tx.candidateScreening.findFirst({ where: { id: screeningId, organisationId: a.organisationId } });
    if (!s) throw new NotFoundError("Screening");
    const c = await owned(tx, a, s.candidateId);
    if (s.answeredAt) throw new ConflictError("These answers are already recorded");
    const qs = z.array(z.object({ key: z.string(), question: z.string() })).parse(s.questions);
    const out = qs.map((q) => ({ key: q.key, answer: (answers[q.key] ?? "").trim().slice(0, 2000) }));
    if (out.every((x) => !x.answer)) throw new ValidationError("Record at least one answer");
    const n = await tx.candidateScreening.updateMany({ where: { id: s.id, answeredAt: null }, data: { answers: out, answeredAt: new Date(), recordedById: ctx.userId } });
    if (!n.count) throw new ConflictError("These answers are already recorded");
    await event(tx, c, "SCREENING_ANSWERED", ctx.userId);
  });
}

/** A person decides whether to continue after reading the answers. The platform never rejects anyone. */
export async function reviewScreening(ctx: Ctx, screeningId: string, outcome: string, note: string) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  if (outcome !== "PROCEED" && outcome !== "HOLD") throw new ValidationError("Choose continue or hold");
  await db.$transaction(async (tx) => {
    const s = await tx.candidateScreening.findFirst({ where: { id: screeningId, organisationId: a.organisationId } });
    if (!s) throw new NotFoundError("Screening");
    const c = await owned(tx, a, s.candidateId);
    if (!s.answeredAt) throw new ValidationError("Record the answers first");
    await tx.candidateScreening.update({ where: { id: s.id }, data: { reviewOutcome: outcome, reviewNote: note.trim().slice(0, 1000) || null, reviewedById: ctx.userId, reviewedAt: new Date() } });
    await event(tx, c, "SCREENING_REVIEWED", ctx.userId, { data: { outcome } });
  });
}

// ── Interviews ───────────────────────────────────────────────────────────

const interviewSchema = z.object({
  date: z.string().refine(isIsoDate, "Choose the interview date"),
  time: z.string().refine((t) => parseHhmm(t) !== null, "Enter the time as HH:MM"),
  durationMin: z.coerce.number().int().min(10).max(480).default(45),
  location: z.string().trim().max(160).optional().transform((v) => v || null),
  interviewerId: z.string().min(1, "Choose the interviewer"),
});

/** Books an interview inside the platform's own calendar. No external calendar is connected, so no invitation is sent. */
export async function scheduleInterview(ctx: Ctx, id: string, raw: z.input<typeof interviewSchema>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const p = interviewSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the interview");
  const startsAt = londonToUtc(p.data.date, parseHhmm(p.data.time)!);
  if (startsAt.getTime() < Date.now() - 60_000) throw new ValidationError("The interview time has already passed");
  await checkRecruiter(a.organisationId, p.data.interviewerId);
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (!["APPLIED", "SCREENING", "INTERVIEW"].includes(c.stage)) throw new ValidationError("Interviews are booked before an offer is made");
    const clash = await tx.candidateInterview.findFirst({ where: { organisationId: a.organisationId, interviewerId: p.data.interviewerId, status: { in: ["AWAITING_CONFIRMATION", "CONFIRMED"] }, startsAt: { lt: new Date(startsAt.getTime() + p.data.durationMin * 60_000), gt: new Date(startsAt.getTime() - 480 * 60_000) } } });
    if (clash && clash.startsAt.getTime() + clash.durationMin * 60_000 > startsAt.getTime()) throw new ConflictError("The interviewer already has an interview at that time");
    await tx.candidateInterview.create({ data: { organisationId: c.organisationId, candidateId: c.id, startsAt, durationMin: p.data.durationMin, location: p.data.location, interviewerId: p.data.interviewerId, createdById: ctx.userId } });
    if (c.stage !== "INTERVIEW") {
      await tx.candidate.update({ where: { id: c.id }, data: { stage: "INTERVIEW", stageChangedAt: new Date(), lockVersion: { increment: 1 } } });
      await event(tx, c, "STAGE", ctx.userId, { fromStage: c.stage, toStage: "INTERVIEW" });
    }
    await event(tx, c, "INTERVIEW_BOOKED", ctx.userId, { data: { startsAt: startsAt.toISOString() } });
  });
}

const interviewUpdate = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("decline") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("outcome"), outcome: z.enum(["PASSED", "NOT_PASSED"], { message: "Choose the outcome" }), notes: z.string().trim().min(3, "Write the interview notes").max(4000) }),
]);

export async function updateInterview(ctx: Ctx, interviewId: string, raw: z.input<typeof interviewUpdate>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const p = interviewUpdate.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the interview");
  await db.$transaction(async (tx) => {
    const i = await tx.candidateInterview.findFirst({ where: { id: interviewId, organisationId: a.organisationId } });
    if (!i) throw new NotFoundError("Interview");
    const c = await owned(tx, a, i.candidateId);
    const live = i.status === "AWAITING_CONFIRMATION" || i.status === "CONFIRMED";
    const set = (data: Prisma.CandidateInterviewUpdateManyMutationInput, from: string[]) =>
      tx.candidateInterview.updateMany({ where: { id: i.id, status: { in: from as never } }, data }).then((n) => {
        if (!n.count) throw new ConflictError("This interview changed. Reload the page.");
      });
    switch (p.data.action) {
      case "confirm":
        if (i.status !== "AWAITING_CONFIRMATION") throw new ValidationError("Only an unconfirmed interview can be confirmed");
        await set({ status: "CONFIRMED", confirmedAt: new Date() }, ["AWAITING_CONFIRMATION"]);
        break;
      case "decline":
      case "cancel":
        if (!live) throw new ValidationError("This interview is no longer booked");
        await set({ status: p.data.action === "decline" ? "DECLINED" : "CANCELLED" }, ["AWAITING_CONFIRMATION", "CONFIRMED"]);
        break;
      case "no_show":
        if (!live || i.startsAt > new Date()) throw new ValidationError("Record a non-attendance after the interview time");
        await set({ status: "NO_SHOW" }, ["AWAITING_CONFIRMATION", "CONFIRMED"]);
        break;
      case "outcome":
        if (i.startsAt > new Date()) throw new ValidationError("Record the outcome after the interview has taken place");
        if (!live && i.status !== "COMPLETED") throw new ValidationError("This interview did not take place");
        if (i.outcome) throw new ConflictError("The outcome is already recorded");
        await set({ status: "COMPLETED", outcome: p.data.outcome, notes: p.data.notes, outcomeAt: new Date() }, ["AWAITING_CONFIRMATION", "CONFIRMED", "COMPLETED"]);
        break;
    }
    await event(tx, c, `INTERVIEW_${p.data.action.toUpperCase()}`, ctx.userId, p.data.action === "outcome" ? { data: { outcome: p.data.outcome } } : {});
  });
}

// ── Offer ────────────────────────────────────────────────────────────────

/** An offer needs an interview a person recorded as passed. */
export async function makeOffer(ctx: Ctx, id: string, lockVersion: number) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (c.stage !== "INTERVIEW") throw new ValidationError("An offer follows the interview stage");
    if (!c.interviews.some((i) => i.outcome === "PASSED")) throw new ValidationError("Record a passed interview before making an offer");
    if (c.rightToWork === "NOT_ELIGIBLE") throw new ValidationError("This candidate has no right to work in the UK");
    await bump(tx, c.id, lockVersion, { stage: "OFFER", stageChangedAt: new Date(), offerMadeAt: new Date(), offerResponse: "PENDING", offerRespondedAt: null });
    await event(tx, c, "OFFER_MADE", ctx.userId, { fromStage: c.stage, toStage: "OFFER" });
  });
}

export async function recordOfferResponse(ctx: Ctx, id: string, lockVersion: number, response: string) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  if (response !== "ACCEPTED" && response !== "DECLINED") throw new ValidationError("Choose accepted or declined");
  await db.$transaction(async (tx) => {
    const c = await owned(tx, a, id);
    if (c.stage !== "OFFER" || c.offerResponse !== "PENDING") throw new ValidationError("There is no offer waiting for an answer");
    await bump(tx, c.id, lockVersion, { offerResponse: response, offerRespondedAt: new Date() });
    await event(tx, c, response === "ACCEPTED" ? "OFFER_ACCEPTED" : "OFFER_DECLINED", ctx.userId);
  });
}

// ── Settings ─────────────────────────────────────────────────────────────

export async function recruitmentSettings(organisationId: string) {
  const s = await db.recruitmentSettings.findUnique({ where: { organisationId } });
  return s ?? { organisationId, ...DEFAULT_REMINDERS, retentionMonths: 6, updatedById: null, updatedAt: null };
}

const settingsSchema = z.object({
  remindersOn: z.boolean(),
  incompleteAfterDays: z.coerce.number().int().min(1).max(60),
  screeningAfterDays: z.coerce.number().int().min(1).max(60),
  interviewConfirmHours: z.coerce.number().int().min(1).max(168),
  referencesAfterDays: z.coerce.number().int().min(1).max(60),
  onboardingDocsAfterDays: z.coerce.number().int().min(1).max(60),
  trainingAfterDays: z.coerce.number().int().min(1).max(90),
  retentionMonths: z.coerce.number().int().min(1, "Keep applications for at least a month").max(24, "Keep applications for no more than 24 months"),
});

export async function saveRecruitmentSettings(ctx: Ctx, raw: z.input<typeof settingsSchema> | Record<string, unknown>) {
  const a = await recruitmentAccess(ctx);
  if (a.hrUser.role !== "Organisation Admin" && a.hrUser.role !== "Group HR") throw new ForbiddenError("Only an organisation administrator or Group HR can change recruitment settings");
  const p = settingsSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the settings");
  await db.$transaction(async (tx) => {
    await tx.recruitmentSettings.upsert({ where: { organisationId: a.organisationId }, create: { organisationId: a.organisationId, ...p.data, updatedById: ctx.userId }, update: { ...p.data, updatedById: ctx.userId } });
    await audit({ organisationId: a.organisationId, actorId: ctx.userId, action: "recruitment.settings.updated", entityType: "Organisation", entityId: a.organisationId, data: p.data }, tx);
  });
}

export { owned as ownedCandidate, event as candidateEvent, bump as bumpCandidate };
