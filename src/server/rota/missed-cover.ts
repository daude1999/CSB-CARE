import type { AssignmentSlot, MissedCallStage, Prisma, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, isIsoDate, londonDate, londonMinute, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { eligibilityFor, type EligibilityResult } from "@/server/workforce/eligibility";
import { assignInTx, EligibilityError, isOverlapViolation } from "./assign";
import { caseScope, isHighRisk, nextStage, REPLACEMENT_TYPES, requireOpen } from "./missed-calls";
import { slotCandidates, suName, type Candidate } from "./queries";
import { authorisedBranches, rotaScope, staffDirectoryWhere, type Scope } from "./scope";
import { visitReference } from "./visits";

/**
 * Find Cover for a missed call. The coordinator sees the three best carers the eligibility service allows for a
 * recovery time they choose, reviews the safety checks, and confirms. Confirming books a real, linked recovery visit
 * through the one assignment path (assignInTx), so the booking appears on every rota view. The missed visit keeps its
 * MISSED status, clock history and case: nothing about the failure is overwritten, and the case is never closed by
 * booking cover. Notifications are in-app only.
 */

type Tx = Prisma.TransactionClient;

/** Cover can be booked up to this long after the missed call's start time; after that it is a matter for the investigation. */
export const COVER_WINDOW_HOURS = 24;
/** A recovery visit can be proposed up to this far ahead. */
export const RECOVERY_AHEAD_HOURS = 48;

export const SU_INFORMED: Record<string, string> = {
  INFORMED: "Service user told",
  REPRESENTATIVE_INFORMED: "Family or representative told",
  NOT_YET: "Not told yet",
  COULD_NOT_REACH: "Tried, could not reach them",
};

const LIVE_RECOVERY: VisitStatus[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "MISSED"];

const coverCaseInclude = {
  visit: {
    select: {
      id: true, reference: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, carersRequired: true, areaId: true, serviceUserId: true, callTypeId: true,
      medicationRequired: true, rotaType: true, organisationId: true,
      callType: { select: { name: true } },
      area: { select: { name: true } },
      serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, riskLevel: true, branchId: true, areaId: true, status: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true }, take: 1 } } },
      tasks: { select: { careTaskId: true, name: true, position: true }, orderBy: { position: "asc" } },
      assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { staffId: true, slot: true, staff: { select: { displayName: true } } }, orderBy: { slot: "asc" } },
    },
  },
  covers: {
    orderBy: { confirmedAt: "asc" },
    include: {
      recoveryVisit: {
        select: {
          id: true, reference: true, status: true, date: true, scheduledStart: true, scheduledEnd: true, carersRequired: true, actualStart: true, actualEnd: true, lockVersion: true,
          assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true, slot: true, staffId: true, acknowledgedAt: true, staff: { select: { displayName: true } } }, orderBy: { slot: "asc" } },
        },
      },
    },
  },
} satisfies Prisma.MissedCallCaseInclude;
export type CoverCase = Prisma.MissedCallCaseGetPayload<{ include: typeof coverCaseInclude }>;
type RecoveryVisit = CoverCase["covers"][number]["recoveryVisit"];

// ── State ────────────────────────────────────────────────────────────────

export type CoverKind = "needed" | "partial" | "booked" | "late-arrival" | "visit-changed" | "recorded" | "closed" | "too-late";
export interface CoverState {
  kind: CoverKind;
  /** Find Cover can be used now. */
  canFind: boolean;
  /** The live recovery visit, when one has been booked. */
  recovery: RecoveryVisit | null;
  required: number;
  booked: number;
  text: string;
}

/**
 * What cover a missed call has and whether Find Cover applies. Pure, so it is tested directly. A recovery visit that was
 * later cancelled no longer counts, so cover can be found again.
 */
export function coverState(
  c: { stage: MissedCallStage; replacementType: string | null; scheduledStart: Date; visit: { status: VisitStatus; carersRequired: number; actualStart: Date | null }; covers: { recoveryVisit: RecoveryVisit }[] },
  now = new Date(),
): CoverState {
  const live = [...c.covers].reverse().find((x) => LIVE_RECOVERY.includes(x.recoveryVisit.status))?.recoveryVisit ?? null;
  const required = live?.carersRequired ?? c.visit.carersRequired;
  const booked = live?.assignments.length ?? 0;
  const out = (kind: CoverKind, canFind: boolean, text: string): CoverState => ({ kind, canFind, recovery: live, required, booked, text });
  const open = c.stage === "NEW" || c.stage === "INVESTIGATING";
  if (live && booked >= required) return out("booked", false, `Cover booked: ${live.reference} at ${londonTime(live.scheduledStart)}`);
  if (live) return out("partial", open, `${booked} of ${required} carers booked on ${live.reference}`);
  if (c.visit.status === "IN_PROGRESS" || c.visit.status === "COMPLETED") return out("late-arrival", false, `The booked carer clocked in${c.visit.actualStart ? ` at ${londonTime(c.visit.actualStart)}` : ""}. Record "The booked carer arrived late" on the case.`);
  if (c.visit.status !== "MISSED") return out("visit-changed", false, `The visit is now ${c.visit.status.toLowerCase().replace("_", " ")}.`);
  if (c.replacementType && !c.covers.length) return out("recorded", false, REPLACEMENT_TYPES[c.replacementType] ?? c.replacementType);
  if (!open) return out("closed", false, c.stage === "CLOSED" ? "The case is closed." : "The case is waiting for sign-off.");
  if (c.scheduledStart.getTime() < now.getTime() - COVER_WINDOW_HOURS * 3600_000) return out("too-late", false, `More than ${COVER_WINDOW_HOURS} hours ago: record what happened on the case.`);
  return out("needed", true, "Cover needed");
}

/** Cover states for the register's rows, in one query. */
export async function coverStates(ctx: Ctx, caseIds: string[], now = new Date()) {
  const scope = await rotaScope(ctx, "rota.monitor");
  if (!caseIds.length) return new Map<string, CoverState>();
  const rows = await db.missedCallCase.findMany({ where: { ...caseScope(scope), id: { in: caseIds } }, select: { id: true, stage: true, replacementType: true, scheduledStart: true, visit: { select: { status: true, carersRequired: true, actualStart: true } }, covers: { orderBy: { confirmedAt: "asc" }, select: { recoveryVisit: coverCaseInclude.covers.include.recoveryVisit } } } });
  return new Map(rows.map((r) => [r.id, coverState(r, now)]));
}

// ── Safety checks ────────────────────────────────────────────────────────

export type CheckState = "ok" | "info" | "warn" | "fail";
export interface CoverCheck {
  label: string;
  state: CheckState;
  text: string;
}

const GROUPS: { label: string; codes: string[]; ok: (r: EligibilityResult) => { state: CheckState; text: string } }[] = [
  { label: "Employment and rota", codes: ["NOT_FOUND", "HR_MISSING", "ARCHIVED", "ONBOARDING", "NOT_STARTED", "LEFT", "NOT_CARE_ROLE", "ROTA_OFF"], ok: () => ({ state: "ok", text: "Active care worker, rota switched on" }) },
  { label: "Right to work", codes: ["RTW", "RTW_NONE"], ok: (r) => (r.compliance.rightToWork === "Up to date" ? { state: "ok", text: "Verified in HR" } : { state: "info", text: `${r.compliance.rightToWork} (not required by your Rota Settings)` }) },
  { label: "DBS check", codes: ["DBS", "DBS_NONE"], ok: (r) => (r.compliance.dbs === "Up to date" ? { state: "ok", text: "Verified in HR" } : { state: "info", text: `${r.compliance.dbs} (not required by your Rota Settings)` }) },
  { label: "Mandatory training", codes: ["TRAINING"], ok: (r) => (r.compliance.training === "None required" ? { state: "info", text: "No mandatory training is recorded as required" } : { state: "ok", text: r.compliance.training }) },
  { label: "Care competencies and readiness", codes: ["READINESS", "READINESS_PENDING", "READINESS_RESTRICTED", "READINESS_REVIEW", "RESTRICTION"], ok: (r) => (r.readiness ? { state: "ok", text: "Ready for this visit's tasks; no restrictions" } : { state: "info", text: "No readiness record to check" }) },
  { label: "Leave and availability", codes: ["ABSENCE", "ABSENCE_REQUESTED", "UNAVAILABLE", "OUTSIDE_AVAILABILITY"], ok: () => ({ state: "ok", text: "No leave or unavailability recorded for this time" }) },
  { label: "Rota clashes", codes: ["OVERLAP", "DOUBLE_UP_SAME", "BOOKED_ON_MISSED"], ok: () => ({ state: "ok", text: "None" }) },
  { label: "Weekly hours", codes: ["MAX_HOURS"], ok: () => ({ state: "ok", text: "Within their weekly limit (or no limit set)" }) },
  { label: "Service user's preferences", codes: ["BLOCKED_BY_CLIENT", "LOW_PREFERENCE", "GENDER", "GENDER_UNKNOWN"], ok: () => ({ state: "ok", text: "Reviewed: no blocks or preference conflicts" }) },
  { label: "Area", codes: ["AREA"], ok: () => ({ state: "ok", text: "No area conflict" }) },
];

/**
 * The safety checks for the review step, built only from what the eligibility service returned. A check shows green
 * only when the service actually passed it; anything it did not verify is shown as information, never as a pass.
 */
export function coverChecks(r: EligibilityResult): CoverCheck[] {
  const all = [...r.blocking.map((x) => ({ ...x, state: "fail" as const })), ...r.warnings.map((x) => ({ ...x, state: "warn" as const }))];
  const used = new Set<string>();
  const out: CoverCheck[] = GROUPS.map((g) => {
    const hits = all.filter((x) => g.codes.includes(x.code));
    hits.forEach((h) => used.add(`${h.code}|${h.message}`));
    if (!hits.length) return { label: g.label, ...g.ok(r) };
    return { label: g.label, state: hits.some((h) => h.state === "fail") ? "fail" : "warn", text: hits.map((h) => h.message).join("; ") };
  });
  const rest = all.filter((x) => !used.has(`${x.code}|${x.message}`));
  if (rest.length) out.push({ label: "Other checks", state: rest.some((h) => h.state === "fail") ? "fail" : "warn", text: rest.map((h) => h.message).join("; ") });
  const gaps = r.advice.map((a) => a.message);
  out.push(gaps.length ? { label: "Time between visits", state: "info", text: `${gaps.join("; ")}. This is a time gap, not a travel time.` } : { label: "Time between visits", state: "ok", text: "No tight gaps next to other bookings (travel time is not calculated)" });
  return out;
}

// ── The panel ────────────────────────────────────────────────────────────

export interface FindCoverInput {
  date?: string;
  time?: string;
  q?: string;
  area?: string;
  /** Search every branch the coordinator may book from, not only the service user's branch. */
  all?: boolean;
  staffId?: string;
}

/** The next quarter hour at least 15 minutes from now, in London time. */
export function defaultRecoveryTime(now = new Date()) {
  const date = londonDate(now);
  const m = Math.ceil((londonMinute(now) + 15) / 15) * 15;
  return m >= 1440 ? { date: addDays(date, 1), time: "00:00" } : { date, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
}

/** Checks a proposed recovery time and returns its start and end. The length matches the missed visit. */
export function recoveryWindow(missed: { scheduledStart: Date; scheduledEnd: Date }, date: string, time: string, now = new Date()) {
  if (!isIsoDate(date)) throw new ValidationError("Choose the recovery date");
  const m = parseHhmm(time);
  if (m === null) throw new ValidationError("The recovery time must be a time such as 14:30");
  const start = londonToUtc(date, m);
  if (start.getTime() < now.getTime() - 5 * 60_000) throw new ValidationError("The recovery visit cannot start in the past");
  if (start <= missed.scheduledStart) throw new ValidationError("The recovery visit must start after the missed visit");
  if (start.getTime() > now.getTime() + RECOVERY_AHEAD_HOURS * 3600_000) throw new ValidationError(`Choose a time within the next ${RECOVERY_AHEAD_HOURS} hours`);
  return { start, end: new Date(start.getTime() + (missed.scheduledEnd.getTime() - missed.scheduledStart.getTime())) };
}

async function loadCase(scope: Scope, caseId: string, tx: Tx | typeof db = db) {
  const c = await tx.missedCallCase.findFirst({ where: { ...caseScope(scope), id: caseId }, include: coverCaseInclude });
  if (!c) throw new NotFoundError("Missed call");
  return c;
}

/** The staff this coordinator may book for this service user: their own branches, and by default the service user's branch. */
async function poolIds(scope: Scope, branchId: string | null, all: boolean) {
  const and: Prisma.StaffMemberWhereInput[] = [{ employmentStatus: { not: "ARCHIVED" } }];
  if (!all && branchId) and.push({ OR: [{ branchId }, { branchId: null }] });
  return (await db.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, { status: "all" }), AND: and }, select: { id: true } })).map((s) => s.id);
}

/** The free carer slot on a recovery visit, or PRIMARY for a new one. */
function freeSlot(recovery: RecoveryVisit | null): AssignmentSlot {
  if (!recovery) return "PRIMARY";
  return recovery.assignments.some((a) => a.slot === "PRIMARY") ? "SECOND" : "PRIMARY";
}

/** Original carers cannot cover their own missed call from here: if they are on their way, it is a late arrival. */
function markOriginal(list: Candidate[], originalIds: string[]): Candidate[] {
  return list.map((c) => (originalIds.includes(c.id) ? { ...c, state: "NOT_ELIGIBLE" as const, score: null, explain: [], reasons: ["Booked on the missed visit. If they are on their way, record \"The booked carer arrived late\" on the case instead.", ...c.reasons] } : c));
}

export const RANK_LABEL = ["Best match", "Suitable", "Alternative"] as const;

/** Everything the Find Cover panel shows: the visit summary, the cover state, the top three, the manual list and, when a carer is chosen, their checks. */
export async function findCoverView(ctx: Ctx, caseId: string, input: FindCoverInput = {}, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.edit");
  const c = await loadCase(scope, caseId);
  const state = coverState(c, now);
  const su = c.visit.serviceUser;
  const originalIds = c.visit.assignments.map((a) => a.staffId);
  const branches = await authorisedBranches(scope);
  const canWiden = !!su.branchId && branches.length > 1;
  const all = !!input.all && canWiden;
  const summary = {
    caseId: c.id, lockVersion: c.lockVersion, stage: c.stage, escalatedAt: c.escalatedAt,
    serviceUser: suName(su), serviceUserId: su.id, highRisk: isHighRisk(su),
    reference: c.visit.reference, visitId: c.visit.id, date: londonDate(c.visit.scheduledStart), start: c.visit.scheduledStart, end: c.visit.scheduledEnd,
    minutes: Math.round((c.visit.scheduledEnd.getTime() - c.visit.scheduledStart.getTime()) / 60000),
    callType: c.visit.callType.name, area: c.visit.area?.name ?? null,
    original: c.visit.assignments.map((a) => a.staff.displayName),
    reason: c.reasonCode, carersRequired: c.visit.carersRequired,
    minutesSince: Math.max(0, Math.round((now.getTime() - c.visit.scheduledStart.getTime()) / 60000)),
  };
  const recovery = state.recovery;
  // A partly covered double-up keeps the time already booked; otherwise the coordinator chooses it.
  const def = defaultRecoveryTime(now);
  const date = recovery ? londonDate(recovery.scheduledStart) : input.date && isIsoDate(input.date) ? input.date : def.date;
  const time = recovery ? londonTime(recovery.scheduledStart) : input.time && parseHhmm(input.time) !== null ? input.time : def.time;
  let window: { start: Date; end: Date } | null = null;
  let timeError: string | null = null;
  if (state.canFind) {
    try {
      window = recovery ? { start: recovery.scheduledStart, end: recovery.scheduledEnd } : recoveryWindow(c.visit, date, time, now);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      timeError = e.message;
    }
  }
  const slot = freeSlot(recovery);
  const base = { c, state, summary, date, time, timeError, slot, canWiden, all, still: Math.max(0, state.required - state.booked) };
  const none = { ...base, window, recommended: [] as Candidate[], list: [] as (Candidate & { areas: string[] })[], areas: [] as { id: string; name: string }[], selected: null };
  if (!state.canFind || !window) return none;

  const careTaskIds = c.visit.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
  const pool = await poolIds(scope, su.branchId, all);
  const ranked = markOriginal(await slotCandidates(scope.organisationId, { visitId: recovery?.id ?? null, serviceUserId: su.id, areaId: c.visit.areaId, start: window.start, end: window.end, timeLocked: false, careTaskIds, otherSlotStaffIds: recovery?.assignments.map((a) => a.staffId) ?? [] }, slot, pool), originalIds);
  const ordered = ranked.sort((a, b) => (a.state === "NOT_ELIGIBLE" ? 1 : 0) - (b.state === "NOT_ELIGIBLE" ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const recommended = ordered.filter((x) => x.state !== "NOT_ELIGIBLE").slice(0, 3);
  const areaRows = await db.staffArea.findMany({ where: { organisationId: scope.organisationId, staffId: { in: ordered.map((x) => x.id) } }, select: { staffId: true, area: { select: { id: true, name: true } } } });
  const areasOf = (id: string) => areaRows.filter((a) => a.staffId === id).map((a) => a.area);
  const q = input.q?.trim().toLowerCase();
  const list = ordered
    .filter((x) => (!q || x.name.toLowerCase().includes(q) || areasOf(x.id).some((a) => a.name.toLowerCase().includes(q))) && (!input.area || areasOf(x.id).some((a) => a.id === input.area)))
    .map((x) => ({ ...x, areas: areasOf(x.id).map((a) => a.name) }));
  const areas = [...new Map(areaRows.map((a) => [a.area.id, a.area])).values()].sort((a, b) => a.name.localeCompare(b.name));

  let selected: { candidate: Candidate; result: EligibilityResult; checks: CoverCheck[]; rank: number | null } | null = null;
  if (input.staffId) {
    const cand = ordered.find((x) => x.id === input.staffId);
    if (!cand) throw new NotFoundError("Staff member");
    const result = await eligibilityFor(db, scope.organisationId, { staffId: cand.id, start: window.start, end: window.end, slot, visitId: recovery?.id ?? null, serviceUserId: su.id, areaId: c.visit.areaId, timeLocked: false, careTaskIds }, { otherSlotStaffIds: recovery?.assignments.map((a) => a.staffId) ?? [] });
    if (originalIds.includes(cand.id)) result.blocking.unshift({ code: "BOOKED_ON_MISSED", message: cand.reasons[0]! });
    const rank = recommended.findIndex((x) => x.id === cand.id);
    selected = { candidate: cand, result: { ...result, state: result.blocking.length ? "NOT_ELIGIBLE" : result.state }, checks: coverChecks(result), rank: rank >= 0 ? rank + 1 : null };
  }
  return { ...base, window, recommended, list, areas, selected };
}
export type FindCoverView = Awaited<ReturnType<typeof findCoverView>>;

// ── Confirming ───────────────────────────────────────────────────────────

const confirmSchema = z.object({
  staffId: z.string().min(1, "Choose a carer").max(40),
  date: z.string().refine(isIsoDate, "Choose the recovery date"),
  time: z.string().min(4, "Choose the recovery time").max(5),
  source: z.enum(["RECOMMENDED", "MANUAL"]),
  rank: z.number().int().min(1).max(3).optional(),
  suggested: z.array(z.string().max(40)).max(3).default([]),
  /** The warning texts the coordinator ticked as reviewed. Every current warning must be among them. */
  acknowledged: z.array(z.string().max(600)).max(40).default([]),
  warningReason: z.string().trim().max(1000).optional(),
  /** The recovery visit the coordinator was looking at ("" = none yet), so a stale panel cannot book twice. */
  seenRecoveryId: z.string().max(40).default(""),
});
export type ConfirmCoverInput = z.input<typeof confirmSchema>;

async function lockCase(tx: Tx, organisationId: string, caseId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MissedCallCase" WHERE id = ${caseId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Missed call");
}

/**
 * Books the chosen carer. Inside one transaction, holding the case row lock: the case and the missed visit are checked
 * again, the recovery visit is created (or its free slot used), and the carer is booked through assignInTx, which takes
 * the visit and carer locks and re-runs the eligibility service against current data. The exclusion constraint is the
 * last guard against double-booking.
 */
export async function confirmCover(ctx: Ctx, caseId: string, raw: ConfirmCoverInput, now = new Date()) {
  const p = confirmSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the cover details");
  const d = p.data;
  const scope = await rotaScope(ctx, "rota.edit");
  try {
    return await db.$transaction(
      async (tx) => {
        await lockCase(tx, scope.organisationId, caseId);
        const c = await loadCase(scope, caseId, tx);
        requireOpen(c);
        const state = coverState(c, now);
        if ((state.recovery?.id ?? "") !== d.seenRecoveryId) throw new ConflictError("Someone else has just booked cover for this missed call. Reopen Find Cover to see it.");
        if (!state.canFind) throw new ValidationError(state.kind === "late-arrival" ? state.text : state.kind === "booked" ? "Cover is already booked for this missed call" : `Cover cannot be booked: ${state.text}`);
        const staff = await tx.staffMember.findFirst({ where: { id: d.staffId, organisationId: scope.organisationId }, select: { id: true, displayName: true, userId: true } });
        if (!staff) throw new NotFoundError("Staff member");
        if (c.visit.assignments.some((a) => a.staffId === staff.id)) throw new ValidationError(`${staff.displayName} was booked on the missed visit. If they are on their way, record "The booked carer arrived late" on the case instead.`);

        let recovery = state.recovery;
        const window = recovery ? { start: recovery.scheduledStart, end: recovery.scheduledEnd } : recoveryWindow(c.visit, d.date, d.time, now);
        const slot = freeSlot(recovery);
        const careTaskIds = c.visit.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
        const others = recovery?.assignments.map((a) => a.staffId) ?? [];

        // Re-judge against current data before anything is written, so warnings the coordinator never saw are refused.
        const pre = await eligibilityFor(tx, scope.organisationId, { staffId: staff.id, start: window.start, end: window.end, slot, visitId: recovery?.id ?? null, serviceUserId: c.visit.serviceUserId, areaId: c.visit.areaId, timeLocked: false, careTaskIds }, { otherSlotStaffIds: others });
        if (pre.state === "NOT_ELIGIBLE") throw new EligibilityError(`${staff.displayName} can no longer cover this visit: ${pre.blocking.map((b) => b.message).join("; ")}`, pre);
        const warnings = pre.warnings.map((w) => w.message);
        const unseen = warnings.filter((w) => !d.acknowledged.includes(w));
        if (unseen.length) throw new ConflictError(`Please review ${unseen.length === 1 ? "this warning" : "these warnings"} first: ${unseen.join("; ")}`);
        if (warnings.length && (d.warningReason ?? "").length < 5) throw new ValidationError("Say why this carer is right despite the warnings (at least 5 characters)");

        if (!recovery) {
          const orig = c.visit;
          const created = await tx.visit.create({
            data: {
              organisationId: scope.organisationId,
              reference: visitReference(londonDate(window.start)),
              serviceUserId: orig.serviceUserId,
              callTypeId: orig.callTypeId,
              areaId: orig.areaId,
              date: dbDate(londonDate(window.start)),
              scheduledStart: window.start,
              scheduledEnd: window.end,
              carersRequired: orig.carersRequired,
              medicationRequired: orig.medicationRequired,
              rotaType: orig.rotaType,
              notes: `Recovery visit for missed call ${orig.reference}.`,
              manuallyChanged: true,
              publishedAt: now,
              createdById: ctx.userId,
              recoveryOfId: orig.id,
            },
          });
          if (orig.tasks.length) await tx.visitTask.createMany({ data: orig.tasks.map((t) => ({ visitId: created.id, careTaskId: t.careTaskId, name: t.name, position: t.position })) });
          await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: created.id, type: "CREATED", actorId: ctx.userId, toStatus: "SCHEDULED", data: { source: "missed-cover", recoveryOf: orig.id, caseId: c.id } } });
          await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: orig.id, type: "RECOVERY_BOOKED", actorId: ctx.userId, data: { recoveryVisitId: created.id, reference: created.reference, caseId: c.id } } });
          await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.created", entityType: "Visit", entityId: created.id, data: { source: "missed-cover", recoveryOf: orig.id } }, tx);
          recovery = { id: created.id, reference: created.reference, status: created.status, date: created.date, scheduledStart: created.scheduledStart, scheduledEnd: created.scheduledEnd, carersRequired: created.carersRequired, actualStart: null, actualEnd: null, lockVersion: created.lockVersion, assignments: [] };
        }

        const assignment = await assignInTx(tx, scope, ctx.userId, { visitId: recovery.id, slot, staffId: staff.id, acceptWarnings: warnings.length > 0 }, { source: "missed-cover" });

        // In-app only, to the carer's linked sign-in. No text, call or email is sent.
        let notifyStatus = "NO_SIGN_IN";
        let notificationId: string | null = null;
        const member = staff.userId ? await tx.membership.findFirst({ where: { organisationId: scope.organisationId, userId: staff.userId, user: { deactivatedAt: null } }, select: { userId: true } }) : null;
        if (member) {
          const n = await tx.notification.create({
            data: {
              organisationId: scope.organisationId, userId: member.userId, type: "rota.cover.booked",
              title: "You have been booked to cover a visit",
              body: `${fmtLondonDate(londonDate(window.start), { weekday: "long", day: "numeric", month: "long" })}, ${londonTime(window.start)}–${londonTime(window.end)} (${recovery.reference}). Open My Visits for the details.`,
              reason: "The office booked you to cover a missed call.", actionUrl: "/carer", dedupeKey: `missed-cover:${assignment.id}`,
            },
          });
          notifyStatus = "IN_APP";
          notificationId = n.id;
        }

        const checks = coverChecks(pre);
        const cover = await tx.missedCallCover.create({
          data: {
            organisationId: scope.organisationId, caseId: c.id, recoveryVisitId: recovery.id, slot, assignmentId: assignment.id,
            originalStaffId: c.staffId, staffId: staff.id, proposedStart: window.start, proposedEnd: window.end,
            source: d.source, recommendedRank: d.source === "RECOMMENDED" ? d.rank ?? null : null, suggestedStaffIds: d.suggested,
            eligibility: pre.state, checks: checks.map((k) => ({ label: k.label, state: k.state, text: k.text })), warningsAccepted: warnings, warningReason: warnings.length ? d.warningReason ?? null : null,
            confirmedById: ctx.userId, confirmedAt: now, notifyStatus, notificationId,
          },
        });
        await tx.missedCallCase.update({
          where: { id: c.id },
          data: {
            replacementType: "REPLACEMENT_VISIT",
            replacementStaffId: c.replacementStaffId && slot === "SECOND" ? c.replacementStaffId : staff.id,
            replacementWarnings: [...c.replacementWarnings, ...warnings],
            replacementNote: `Recovery visit ${recovery.reference} booked through Find Cover for ${fmtLondonDate(londonDate(window.start), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(window.start)}.`,
            replacementById: ctx.userId, replacementAt: now,
            stage: nextStage(c.stage),
            ...(c.coordinatorId ? {} : { coordinatorId: ctx.userId, coordinatorAssignedAt: now }),
            lockVersion: { increment: 1 },
          },
        });
        const told = notifyStatus === "IN_APP" ? "in-app notification created for the carer" : "the carer has no linked sign-in, so nobody was notified; phone them";
        await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: "system", kind: "SYSTEM", body: `Cover booked by ${ctx.userName}: ${staff.displayName} on recovery visit ${recovery.reference}, ${fmtLondonDate(londonDate(window.start), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(window.start)}–${londonTime(window.end)} (${slot === "SECOND" ? "second carer" : "first carer"}); ${told}.${warnings.length ? ` Warnings accepted: ${warnings.join("; ")}. Reason: ${d.warningReason}` : ""}` } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.cover.confirmed", entityType: "MissedCallCase", entityId: c.id, data: { coverId: cover.id, recoveryVisitId: recovery.id, slot, staffId: staff.id, originalStaffId: c.staffId, source: d.source, eligibility: pre.state, warnings, warningReason: d.warningReason ?? null, notifyStatus, start: window.start.toISOString() } }, tx);
        const bookedNow = (state.recovery?.assignments.length ?? 0) + 1;
        return { coverId: cover.id, recoveryVisitId: recovery.id, reference: recovery.reference, notifyStatus, staffName: staff.displayName, stillNeeded: Math.max(0, recovery.carersRequired - bookedNow) };
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000 },
    );
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("This carer has just been booked for an overlapping visit. Choose someone else.");
    throw e;
  }
}

// ── Afterwards ───────────────────────────────────────────────────────────

const informedSchema = z.object({ status: z.string().refine((s) => s in SU_INFORMED, "Choose whether the service user was told"), note: z.string().trim().max(300).optional() });

/** Records whether the service user or their representative has been told about the cover. Nothing is sent from here. */
export async function recordServiceUserInformed(ctx: Ctx, caseId: string, raw: z.input<typeof informedSchema>) {
  const p = informedSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  const scope = await rotaScope(ctx, "rota.edit");
  const c = await loadCase(scope, caseId);
  if (c.stage === "CLOSED") throw new ConflictError("This case is closed. Reopen it first.");
  const label = SU_INFORMED[p.data.status]!;
  const text = `${label}${p.data.note ? `: ${p.data.note}` : ""}`;
  await db.$transaction(async (tx) => {
    await tx.missedCallCase.update({ where: { id: c.id }, data: { suInformedStatus: p.data.status, suInformedNote: p.data.note || null, suInformedById: ctx.userId, suInformedAt: new Date(), clientInformed: text, lockVersion: { increment: 1 } } });
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, kind: "SYSTEM", body: `Service user communication: ${text}` } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.missed.su-informed", entityType: "MissedCallCase", entityId: c.id, data: { status: p.data.status } }, tx);
  });
}

export interface CoverFact {
  label: string;
  done: boolean;
  text: string;
}

/** The separate facts after cover is booked, each from its own record. Nothing here is a single "resolved" flag. */
export async function coverRecord(ctx: Ctx, caseId: string) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const c = await loadCase(scope, caseId);
  const notes = await db.notification.findMany({ where: { id: { in: c.covers.map((x) => x.notificationId).filter((x): x is string => !!x) } }, select: { id: true, readAt: true } });
  const people = [...new Set([...c.covers.flatMap((x) => [...x.suggestedStaffIds, x.staffId]), ...(c.staffId ? [c.staffId] : [])])];
  const staff = new Map((await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: people } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...c.covers.map((x) => x.confirmedById), c.suInformedById ?? "", c.signedOffById ?? ""].filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const when = (d: Date) => `${fmtLondonDate(londonDate(d), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(d)}`;
  const covers = c.covers.map((x) => {
    const a = x.recoveryVisit.assignments.find((y) => y.id === x.assignmentId) ?? null;
    return { ...x, staffName: staff.get(x.staffId) ?? "Former staff member", confirmedBy: users.get(x.confirmedById) ?? "A member", stillBooked: !!a, acknowledgedAt: a?.acknowledgedAt ?? null, notificationReadAt: notes.find((n) => n.id === x.notificationId)?.readAt ?? null };
  });
  const live = covers.filter((x) => LIVE_RECOVERY.includes(x.recoveryVisit.status));
  const rv = live.at(-1)?.recoveryVisit ?? null;
  const facts: CoverFact[] = [
    { label: "Cover suggested", done: covers.length > 0, text: covers[0]?.suggestedStaffIds.length ? `Top ${covers[0].suggestedStaffIds.length} shown: ${covers[0].suggestedStaffIds.map((id) => staff.get(id) ?? "former staff").join(", ")}` : covers.length ? "Chosen by staff search" : "Not yet" },
    { label: "Cover confirmed", done: live.length > 0, text: live.length ? live.map((x) => `${x.staffName} by ${x.confirmedBy}, ${when(x.confirmedAt)}`).join("; ") : "Not yet" },
    { label: "Carer notified", done: live.some((x) => x.notifyStatus === "IN_APP"), text: live.length ? live.map((x) => (x.notifyStatus === "IN_APP" ? `${x.staffName}: in-app notification created${x.notificationReadAt ? `, opened ${when(x.notificationReadAt)}` : ", not opened yet"}` : `${x.staffName}: not notified (no linked sign-in), phone them`)).join("; ") : "Not yet" },
    { label: "Carer accepted", done: live.length > 0 && live.every((x) => !!x.acknowledgedAt), text: live.length ? live.map((x) => `${x.staffName}: ${x.acknowledgedAt ? `acknowledged in My Visits ${when(x.acknowledgedAt)}` : "not acknowledged yet"}`).join("; ") : "Not yet" },
    { label: "Recovery care started", done: !!rv?.actualStart, text: rv?.actualStart ? `Clocked in ${when(rv.actualStart)}` : "Not yet" },
    { label: "Recovery care delivered", done: rv?.status === "COMPLETED", text: rv?.status === "COMPLETED" ? `Completed${rv.actualEnd ? ` ${when(rv.actualEnd)}` : ""}` : rv?.status === "MISSED" ? "The recovery visit was itself missed" : "Not yet" },
    { label: "Service user informed", done: c.suInformedStatus === "INFORMED" || c.suInformedStatus === "REPRESENTATIVE_INFORMED", text: c.suInformedStatus ? `${SU_INFORMED[c.suInformedStatus]}${c.suInformedNote ? `: ${c.suInformedNote}` : ""} (${users.get(c.suInformedById ?? "") ?? "a member"}, ${when(c.suInformedAt!)})` : "Not recorded yet" },
    { label: "Investigation signed off", done: c.stage === "CLOSED", text: c.stage === "CLOSED" ? `Signed off by ${users.get(c.signedOffById ?? "") ?? "a manager"}` : "Not yet: the investigation stays open until a manager signs it off" },
  ];
  return { c, covers, recovery: rv, facts, originalName: c.staffId ? staff.get(c.staffId) ?? "Former staff member" : null, canWork: hasOrgPermission(ctx, "rota.edit") };
}

/** For the visit page: the missed visit a recovery visit covers, or the recovery visits booked for a missed visit. */
export async function recoveryLinks(ctx: Ctx, visitId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const v = await db.visit.findFirst({ where: { id: visitId, organisationId: scope.organisationId }, select: { recoveryOf: { select: { id: true, reference: true, missedCallCase: { select: { id: true } } } }, recoveries: { select: { id: true, reference: true, status: true, scheduledStart: true } }, missedCallCase: { select: { id: true } } } });
  if (!v) throw new NotFoundError("Visit");
  return v;
}
