import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fmtLondonDate, londonDate, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { myStaff } from "@/server/workforce/link";
import { queueInvestigation } from "./queue";
import { automationSwitches } from "./settings";

/**
 * Carer confirmation. When a call is missed, each carer who was booked on it and has a linked sign-in is asked, in the
 * app only, what happened. Their answer is stored as their own statement: it never records attendance, never creates
 * or approves a clock correction and never changes the case. A carer can see and answer only requests made to them,
 * worked out from their sign-in, never from anything in the request. Nothing is sent outside the platform.
 */

export const ANSWERS = ["ATTENDED_NO_CLOCK", "ARRIVED_LATE", "UNABLE_TO_ATTEND", "ACCESS_PROBLEM", "SU_CANCELLED", "PHONE_SYSTEM", "ROTA_WRONG", "OTHER"] as const;
export type Answer = (typeof ANSWERS)[number];

/** Statements per request (the first plus four further ones), and per carer per day, so the form cannot be flooded. */
export const MAX_PER_REQUEST = 5;
export const MAX_PER_DAY = 20;

export const CONFIRMATION_LABEL: Record<string, string> = {
  NOT_REQUESTED: "Not asked in the app",
  NO_LOGIN: "No sign-in: phone the carer",
  REQUESTED: "Asked, no answer yet",
  RESPONDED: "Answered",
  NO_RESPONSE: "No answer by the deadline",
  WITHDRAWN: "Request withdrawn",
};

// ── Asking ────────────────────────────────────────────────────────────────

/** Sends the in-app request to each booked carer with a linked sign-in. Idempotent: a carer is asked once per case. */
export async function requestConfirmations(caseId: string, now = new Date()) {
  const c = await db.missedCallCase.findUnique({ where: { id: caseId }, select: { id: true, organisationId: true, stage: true, scheduledStart: true, detectedAt: true } });
  if (!c || c.stage === "CLOSED") return 0;
  const sw = await automationSwitches(db, c.organisationId);
  if (!sw.confirm) return 0;
  // A carer is not asked about a visit due more than a day ago (or one found missed late, such as after the automation
  // is switched on): the office follows those up directly, and carers are not flooded with old requests.
  if (now.getTime() - c.detectedAt.getTime() > 86400000 || now.getTime() - c.scheduledStart.getTime() > 86400000) return 0;
  const pending = await db.missedCallCarerConfirmation.findMany({ where: { caseId: c.id, status: "NOT_REQUESTED" }, include: { staff: { select: { userId: true, employmentStatus: true, hrMissing: true } } } });
  let asked = 0;
  for (const p of pending) {
    const active = !!p.userIdAtDetection && p.staff.userId === p.userIdAtDetection && !["ARCHIVED", "SUSPENDED"].includes(p.staff.employmentStatus) && !p.staff.hrMissing;
    const user = active ? await db.membership.findFirst({ where: { userId: p.userIdAtDetection!, organisationId: c.organisationId, deactivatedAt: null, roles: { has: "CARER" }, user: { deactivatedAt: null } }, select: { id: true } }) : null;
    await db.$transaction(async (tx) => {
      if (!user) {
        const r = await tx.missedCallCarerConfirmation.updateMany({ where: { id: p.id, status: "NOT_REQUESTED" }, data: { status: "NO_LOGIN" } });
        if (r.count) await audit({ organisationId: c.organisationId, actorId: null, action: "rota.missed.auto.confirmation_unavailable", entityType: "MissedCallCase", entityId: c.id, data: { staffId: p.staffId } }, tx);
        return;
      }
      const due = new Date(now.getTime() + sw.confirmMinutes * 60000);
      const n = await tx.notification.upsert({
        where: { dedupeKey: `missed-confirm:${p.id}` },
        create: { organisationId: c.organisationId, userId: p.userIdAtDetection!, type: "rota.missed.confirm", title: "Action required: missed visit", body: `Our system has not recorded a clock-in for your visit at ${londonTime(c.scheduledStart)} on ${fmtLondonDate(londonDate(c.scheduledStart), { day: "numeric", month: "short" })}. Please confirm what happened.`, reason: "You were booked on this visit.", actionUrl: `/carer/missed/${p.id}`, dueAt: due, dedupeKey: `missed-confirm:${p.id}` },
        update: {},
        select: { id: true },
      });
      const r = await tx.missedCallCarerConfirmation.updateMany({ where: { id: p.id, status: "NOT_REQUESTED" }, data: { status: "REQUESTED", requestedAt: now, notificationId: n.id, responseDueAt: due } });
      if (r.count) {
        asked++;
        await audit({ organisationId: c.organisationId, actorId: null, action: "rota.missed.auto.confirmation_requested", entityType: "MissedCallCase", entityId: c.id, data: { staffId: p.staffId, dueAt: due.toISOString() } }, tx);
      }
    });
  }
  return asked;
}

/**
 * Run with the call sweep: notes when a carer first opens the request, sends at most the configured reminders, and at
 * the deadline tells the case's coordinator (or, with none, the coordinators and managers) once. A case already
 * escalated to the managers is not alerted again. Requests on closed cases are withdrawn.
 */
export async function checkConfirmationDeadlines(now = new Date()) {
  const open = await db.missedCallCarerConfirmation.findMany({
    where: { status: { in: ["REQUESTED", "RESPONDED", "NO_RESPONSE"] } },
    include: { case: { select: { id: true, stage: true, coordinatorId: true, escalatedAt: true, scheduledStart: true, organisationId: true } }, staff: { select: { displayName: true } } },
    take: 1000,
  });
  const result = { opened: 0, reminders: 0, overdue: 0, withdrawn: 0 };
  // When a request was first opened (the bell sets readAt). Recorded once.
  const unopened = open.filter((o) => o.notificationId && !o.notificationOpenedAt);
  if (unopened.length) {
    const seen = await db.notification.findMany({ where: { id: { in: unopened.map((o) => o.notificationId!) }, readAt: { not: null } }, select: { id: true, readAt: true } });
    for (const s of seen) {
      const r = await db.missedCallCarerConfirmation.updateMany({ where: { notificationId: s.id, notificationOpenedAt: null }, data: { notificationOpenedAt: s.readAt } });
      result.opened += r.count;
    }
  }
  const settings = new Map<string, Awaited<ReturnType<typeof automationSwitches>>>();
  for (const o of open.filter((x) => x.status === "REQUESTED")) {
    try {
      if (o.case.stage === "CLOSED") {
        const r = await db.missedCallCarerConfirmation.updateMany({ where: { id: o.id, status: "REQUESTED" }, data: { status: "WITHDRAWN" } });
        result.withdrawn += r.count;
        continue;
      }
      let sw = settings.get(o.organisationId);
      if (!sw) settings.set(o.organisationId, (sw = await automationSwitches(db, o.organisationId)));
      if (!sw.confirm) continue;
      const due = o.responseDueAt ?? new Date((o.requestedAt ?? now).getTime() + sw.confirmMinutes * 60000);
      if (now >= due) {
        await db.$transaction(async (tx) => {
          const r = await tx.missedCallCarerConfirmation.updateMany({ where: { id: o.id, status: "REQUESTED" }, data: { status: "NO_RESPONSE", overdueNotifiedAt: now } });
          if (!r.count) return;
          result.overdue++;
          await audit({ organisationId: o.organisationId, actorId: null, action: "rota.missed.auto.no_response", entityType: "MissedCallCase", entityId: o.caseId, data: { staffId: o.staffId } }, tx);
          if (o.case.escalatedAt) return;
          const to = o.case.coordinatorId ? [o.case.coordinatorId] : (await tx.membership.findMany({ where: { organisationId: o.organisationId, deactivatedAt: null, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] }, user: { deactivatedAt: null } }, select: { userId: true } })).map((m) => m.userId);
          await tx.notification.createMany({
            data: to.map((userId) => ({ organisationId: o.organisationId, userId, type: "rota.missed.noresponse", title: "A carer has not explained a missed visit", body: `${o.staff.displayName} has not answered about the missed visit at ${londonTime(o.case.scheduledStart)}. Phone them and record what you find.`, reason: o.case.coordinatorId ? "You are investigating this missed call." : "You coordinate care for this organisation.", actionUrl: `/rota/missed/${o.caseId}`, dedupeKey: `missed-noresponse:${o.id}:${userId}` })),
            skipDuplicates: true,
          });
        });
        await queueInvestigation(o.caseId, "CARER_RESPONSE", { now });
        continue;
      }
      const nextReminderAt = o.requestedAt ? o.requestedAt.getTime() + sw.reminderMinutes * 60000 * (o.remindersSent + 1) : Infinity;
      if (o.remindersSent < sw.reminders && now.getTime() >= nextReminderAt) {
        const n = o.remindersSent + 1;
        await db.$transaction(async (tx) => {
          const r = await tx.missedCallCarerConfirmation.updateMany({ where: { id: o.id, status: "REQUESTED", remindersSent: o.remindersSent }, data: { remindersSent: n, lastReminderAt: now } });
          if (!r.count || !o.userIdAtDetection) return;
          await tx.notification.createMany({ data: [{ organisationId: o.organisationId, userId: o.userIdAtDetection, type: "rota.missed.confirm", title: "Reminder: please confirm what happened on a missed visit", body: `We still need your explanation for the visit at ${londonTime(o.case.scheduledStart)}. Please answer by ${londonTime(due)}.`, reason: "You were booked on this visit.", actionUrl: `/carer/missed/${o.id}`, dueAt: due, dedupeKey: `missed-confirm-remind:${o.id}:${n}` }], skipDuplicates: true });
          await audit({ organisationId: o.organisationId, actorId: null, action: "rota.missed.auto.reminder", entityType: "MissedCallCase", entityId: o.caseId, data: { staffId: o.staffId, reminder: n } }, tx);
        });
        result.reminders++;
      }
    } catch (e) {
      logger.warn({ confirmationId: o.id, err: (e as Error).message }, "missed-call confirmation check failed");
    }
  }
  return result;
}

// ── The carer's side ──────────────────────────────────────────────────────

const OPEN_FOR_CARER = ["REQUESTED", "NO_RESPONSE", "RESPONDED"];

/** Only what the carer needs to recognise the visit: date, time, call type and the person's first name and initial. */
const carerSelect = {
  id: true, status: true, responseDueAt: true, requestedAt: true, staffId: true,
  case: { select: { stage: true, visit: { select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, callType: { select: { name: true } }, serviceUser: { select: { firstName: true, preferredName: true, lastName: true } } } } } },
  responses: { orderBy: { submittedAt: "asc" as const }, select: { id: true, answer: true, reportedArrival: true, reportedDeparture: true, careDelivered: true, unableReason: true, notifiedSomeone: true, notifiedWho: true, notifiedAt: true, attemptedAt: true, contacted: true, explanation: true, supplementsId: true, submittedAt: true } },
};

export const carerFacingName = (su: { firstName: string; preferredName: string | null; lastName: string }) => `${su.preferredName || su.firstName} ${su.lastName.slice(0, 1)}.`;

/** The signed-in carer's requests that still want an answer, and recent answered ones. */
export async function myMissedConfirmations(ctx: Ctx, now = new Date()) {
  const staff = await myStaff(ctx);
  return db.missedCallCarerConfirmation.findMany({
    where: { organisationId: staff.organisationId, staffId: staff.id, status: { in: OPEN_FOR_CARER }, case: { stage: { not: "CLOSED" } }, OR: [{ status: { in: ["REQUESTED", "NO_RESPONSE"] } }, { updatedAt: { gte: new Date(now.getTime() - 7 * 86400000) } }] },
    select: carerSelect,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function getMyConfirmation(ctx: Ctx, id: string) {
  const staff = await myStaff(ctx);
  const c = await db.missedCallCarerConfirmation.findFirst({ where: { id, organisationId: staff.organisationId, staffId: staff.id, status: { in: [...OPEN_FOR_CARER, "WITHDRAWN"] } }, select: carerSelect });
  if (!c) throw new NotFoundError("Missed visit");
  // Whether the existing clock-correction form can be used: the carer must still be on the visit, within a day of it.
  const stillBooked = !!(await db.visitAssignment.findFirst({ where: { visitId: c.case.visit.id, staffId: staff.id, removedAt: null }, select: { id: true } }));
  const correctionOpen = stillBooked && Math.abs(Date.now() - c.case.visit.scheduledStart.getTime()) < 24 * 3600000;
  const pendingCorrections = await db.clockCorrectionRequest.findMany({ where: { visitId: c.case.visit.id, staffId: staff.id, status: "PENDING" }, select: { kind: true } });
  const canAnswer = c.case.stage !== "CLOSED" && OPEN_FOR_CARER.includes(c.status) && c.responses.length < MAX_PER_REQUEST;
  return { c, canAnswer, correctionOpen, pendingKinds: pendingCorrections.map((p) => p.kind) };
}

const hhmm = z.string().trim().refine((s) => s === "" || parseHhmm(s) !== null, "Times must be like 09:05").optional();
export const responseSchema = z.object({
  answer: z.enum(ANSWERS, { message: "Choose what happened" }),
  arrival: hhmm,
  departure: hhmm,
  careDelivered: z.enum(["YES", "PARTLY", "NO"]).optional(),
  unableReason: z.enum(["SICKNESS", "TRAVEL", "OTHER"]).optional(),
  notifiedSomeone: z.enum(["yes", "no"]).optional(),
  notifiedWho: z.string().trim().max(200).optional(),
  notifiedAt: hhmm,
  attemptedAt: hhmm,
  contacted: z.string().trim().max(200).optional(),
  explanation: z.string().trim().max(2000, "Keep the explanation under 2000 characters").default(""),
  submissionKey: z.string().trim().min(8).max(80),
});
/** Raw form values; everything is checked by `responseSchema`. */
export type ResponseInput = Record<string, string | undefined>;

/** A time the carer typed, on the visit's London date (rolled to the next day for a visit that runs past midnight). */
function timeOnVisit(value: string | undefined, start: Date, label: string, now: Date) {
  if (!value) return null;
  const m = parseHhmm(value)!;
  let at = londonToUtc(londonDate(start), m);
  if (start.getTime() - at.getTime() > 12 * 3600000) at = new Date(at.getTime() + 86400000);
  if (at.getTime() > now.getTime() + 60000) throw new ValidationError(`${label} cannot be in the future`);
  if (Math.abs(at.getTime() - start.getTime()) > 24 * 3600000) throw new ValidationError(`${label} is more than a day away from the visit`);
  return at;
}

/**
 * Records the carer's statement. A second or later statement is added as a further statement pointing at the latest
 * one; nothing earlier is changed. The same submission sent twice is stored once.
 */
export async function submitCarerResponse(ctx: Ctx, confirmationId: string, input: ResponseInput, now = new Date()) {
  const p = responseSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check your answer");
  const d = p.data;
  const staff = await myStaff(ctx);
  const result = await db.$transaction(async (tx) => {
    const dup = await tx.missedCallCarerResponse.findUnique({ where: { submissionKey: d.submissionKey }, select: { id: true, confirmationId: true, staffId: true } });
    if (dup) {
      if (dup.staffId !== staff.id || dup.confirmationId !== confirmationId) throw new ValidationError("This form has expired. Open the request again.");
      return { id: dup.id, duplicate: true, caseId: null as string | null };
    }
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MissedCallCarerConfirmation" WHERE id = ${confirmationId} AND "organisationId" = ${staff.organisationId} AND "staffId" = ${staff.id} FOR UPDATE`;
    if (!rows.length) throw new NotFoundError("Missed visit");
    const c = await tx.missedCallCarerConfirmation.findUniqueOrThrow({ where: { id: confirmationId }, include: { case: { select: { id: true, stage: true, coordinatorId: true, scheduledStart: true } }, responses: { orderBy: { submittedAt: "desc" }, take: 1, select: { id: true } }, _count: { select: { responses: true } } } });
    if (c.case.stage === "CLOSED") throw new ConflictError("This missed visit has been closed by the office. Speak to your office if something is missing.");
    if (!OPEN_FOR_CARER.includes(c.status)) throw new ConflictError("This request is no longer open. Speak to your office.");
    if (!(await automationSwitches(tx, staff.organisationId)).confirm) throw new ConflictError("Your office is not taking answers in the app at the moment. Phone the office.");
    if (c._count.responses >= MAX_PER_REQUEST) throw new ConflictError(`You have already sent ${MAX_PER_REQUEST} statements about this visit. Phone the office to add more.`);
    const today = await tx.missedCallCarerResponse.count({ where: { staffId: staff.id, submittedAt: { gte: new Date(now.getTime() - 86400000) } } });
    if (today >= MAX_PER_DAY) throw new ConflictError("You have sent a lot of statements today. Phone the office.");

    const start = c.case.scheduledStart;
    const arrival = timeOnVisit(d.arrival, start, "Arrival time", now);
    const departure = timeOnVisit(d.departure, start, "Departure time", now);
    const notifiedAt = timeOnVisit(d.notifiedAt, start, "The time you told someone", now);
    const attemptedAt = timeOnVisit(d.attemptedAt, start, "The time you tried to get in", now);
    if (d.answer === "ATTENDED_NO_CLOCK" && (!arrival || !departure)) throw new ValidationError("Give the times you arrived and left");
    if (d.answer === "ATTENDED_NO_CLOCK" && !d.careDelivered) throw new ValidationError("Say what care you provided");
    if (arrival && departure && departure <= arrival) throw new ValidationError("The time you left must be after the time you arrived");
    if (d.answer === "ARRIVED_LATE" && !arrival) throw new ValidationError("Give the time you arrived");
    if (d.answer === "ARRIVED_LATE" && !d.careDelivered) throw new ValidationError("Say whether care was delivered");
    if (d.answer === "UNABLE_TO_ATTEND" && !d.unableReason) throw new ValidationError("Say why you could not attend");
    if (d.answer === "UNABLE_TO_ATTEND" && !d.notifiedSomeone) throw new ValidationError("Say whether you told anyone");
    if (d.answer === "ACCESS_PROBLEM" && d.explanation.length < 5) throw new ValidationError("Describe the access problem");
    if (["OTHER", "ROTA_WRONG", "PHONE_SYSTEM", "SU_CANCELLED"].includes(d.answer) && d.explanation.length < 5) throw new ValidationError("Tell us what happened (at least 5 characters)");

    const r = await tx.missedCallCarerResponse.create({
      data: {
        organisationId: staff.organisationId, confirmationId: c.id, staffId: staff.id, authorUserId: ctx.userId, answer: d.answer,
        reportedArrival: ["ATTENDED_NO_CLOCK", "ARRIVED_LATE"].includes(d.answer) ? arrival : null,
        reportedDeparture: d.answer === "ATTENDED_NO_CLOCK" ? departure : null,
        careDelivered: ["ATTENDED_NO_CLOCK", "ARRIVED_LATE"].includes(d.answer) ? d.careDelivered ?? null : null,
        unableReason: d.answer === "UNABLE_TO_ATTEND" ? d.unableReason ?? null : null,
        notifiedSomeone: d.answer === "UNABLE_TO_ATTEND" ? d.notifiedSomeone === "yes" : null,
        notifiedWho: d.answer === "UNABLE_TO_ATTEND" && d.notifiedSomeone === "yes" ? d.notifiedWho || null : null,
        notifiedAt: d.answer === "UNABLE_TO_ATTEND" && d.notifiedSomeone === "yes" ? notifiedAt : null,
        attemptedAt: d.answer === "ACCESS_PROBLEM" ? attemptedAt : null,
        contacted: d.answer === "ACCESS_PROBLEM" ? d.contacted || null : null,
        explanation: d.explanation,
        supplementsId: c.responses[0]?.id ?? null,
        submissionKey: d.submissionKey,
        submittedAt: now,
      },
    });
    await tx.missedCallCarerConfirmation.update({ where: { id: c.id }, data: { status: "RESPONDED" } });
    await audit({ organisationId: staff.organisationId, actorId: ctx.userId, action: c.responses.length ? "rota.missed.auto.response_supplemented" : "rota.missed.auto.response_recorded", entityType: "MissedCallCase", entityId: c.case.id, data: { responseId: r.id, staffId: staff.id, answer: d.answer } }, tx);
    if (c.case.coordinatorId) {
      await tx.notification.createMany({ data: [{ organisationId: staff.organisationId, userId: c.case.coordinatorId, type: "rota.missed.response", title: "A carer has explained a missed visit", body: `${staff.displayName} has sent ${c.responses.length ? "a further statement" : "their explanation"}. Check it against the evidence.`, reason: "You are investigating this missed call.", actionUrl: `/rota/missed/${c.case.id}`, dedupeKey: `missed-response:${r.id}` }], skipDuplicates: true });
    }
    return { id: r.id, duplicate: false, caseId: c.case.id };
  });
  if (result.caseId) await queueInvestigation(result.caseId, "CARER_RESPONSE", { now });
  return result;
}
