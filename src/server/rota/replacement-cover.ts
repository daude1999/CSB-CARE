import type { AssignmentSlot } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor, type EligibilityResult } from "@/server/workforce/eligibility";
import { assignInTx, EligibilityError, isOverlapViolation, lockVisit } from "./assign";
import { reasonLabel } from "./missed-calls";
import { coverChecks, findCoverView, RANK_LABEL, type CoverCheck, type FindCoverView } from "./missed-cover";
import { allocatableStaffIds, slotCandidates, suName, type Candidate } from "./queries";
import { rotaScope } from "./scope";
import { priorityOf, PRIORITY_LABEL } from "./unassigned";
import { getVisit } from "./visits";

/**
 * Find Replacement Cover: one panel and one service for the three kinds of cover, which keep their own rules.
 * - fill: an upcoming visit has an empty carer place. The booking fills that place only.
 * - replace: a carer is booked but cannot do the visit (sickness, holiday, cancellation). The booking replaces that one
 *   place; on a double-up the other carer stays.
 * - recovery: a visit was missed and its time has passed. Cover is a new linked recovery visit (missed-cover.ts); the
 *   missed visit is never rewritten.
 * Recommended and manual choices come from the same ranked list (the eligibility service decides who may be booked; the
 * match score only orders them). Every booking re-checks eligibility, the visit version and the carer place inside a
 * locked transaction. Communication with the service user is recorded separately (cover-communication.ts) and never
 * blocks a booking.
 */

export type CoverMode = "fill" | "replace" | "recovery";
export interface CoverTarget {
  mode: CoverMode;
  /** The visit (fill, replace) or the missed-call case (recovery). */
  id: string;
  slot?: AssignmentSlot;
}

export const MODE_TEXT: Record<CoverMode, { title: string; subtitle: string; review: string; confirm: string }> = {
  fill: { title: "Find Replacement Cover", subtitle: "Book an eligible care worker into the empty carer place.", review: "Review Cover", confirm: "Confirm Cover" },
  replace: { title: "Find Replacement Cover", subtitle: "Replace the booked care worker in one carer place.", review: "Review Replacement", confirm: "Confirm Replacement" },
  recovery: { title: "Find Replacement Cover", subtitle: "Arrange a recovery visit for a missed call. The missed visit stays recorded.", review: "Review Cover", confirm: "Confirm Cover" },
};

const SLOTS = ["PRIMARY", "SECOND"] as const;
export const SLOT_LABEL: Record<string, string> = { PRIMARY: "Carer 1", SECOND: "Carer 2", SHADOW: "Shadow" };

/** The panel's target from the page's query string. Pages on Missed Calls default to recovery; elsewhere to fill. */
export function coverTargetFrom(sp: Record<string, string | undefined>, fallback: CoverMode = "fill"): CoverTarget | null {
  const id = sp.cover?.trim();
  if (!id || id.length > 40) return null;
  const mode = sp.fcMode === "replace" || sp.fcMode === "recovery" || sp.fcMode === "fill" ? sp.fcMode : fallback;
  const slot = SLOTS.find((s) => s === (sp.fcSlot ?? sp.slot));
  return { mode, id, slot };
}

export interface CoverInput {
  q?: string;
  area?: string;
  all?: boolean;
  date?: string;
  time?: string;
  staffId?: string;
}

export interface CoverSummary {
  serviceUser: string;
  serviceUserId: string;
  reference: string;
  visitId: string;
  badge: { tone: "red" | "amber" | "slate"; text: string };
  rows: { k: string; v: string; strong?: boolean }[];
}

export interface Selected {
  candidate: Candidate & { areas?: string[] };
  result: EligibilityResult;
  checks: CoverCheck[];
  rank: number | null;
}

interface Base {
  target: CoverTarget;
  summary: CoverSummary;
  /** Cover can be booked now; otherwise `blocked` says why in plain words. */
  canBook: boolean;
  blocked: string | null;
  recommended: (Candidate & { areas?: string[] })[];
  list: (Candidate & { areas: string[] })[];
  areas: { id: string; name: string }[];
  selected: Selected | null;
  /** The visit whose arrangements the service user is told about, and the case, for Contact & Communication. */
  comms: { visitId: string; caseId: string | null } | null;
}

export interface VisitCover extends Base {
  kind: "visit";
  mode: "fill" | "replace";
  slot: AssignmentSlot | null;
  /** The other carer places the coordinator can switch to. */
  slots: { slot: AssignmentSlot; label: string; current: string | null }[];
  current: { staffId: string; name: string } | null;
  lockVersion: number;
  date: string;
  careTasks: string[];
  carersRequired: number;
  /** The carers in the other places, who stay booked. */
  others: string[];
}

export interface RecoveryCover extends Base {
  kind: "recovery";
  mode: "recovery";
  view: FindCoverView;
}

export type CoverWorkspace = VisitCover | RecoveryCover;

const MANUAL_MAX = 60;

function withAreas(list: Candidate[], areaRows: { staffId: string; area: { id: string; name: string } }[]) {
  return list.map((c) => ({ ...c, areas: areaRows.filter((a) => a.staffId === c.id).map((a) => a.area.name) }));
}

/** Everything the panel shows, for any of the three kinds of cover. Returns null when the record is not the caller's. */
export async function coverWorkspace(ctx: Ctx, target: CoverTarget, input: CoverInput = {}, now = new Date()): Promise<CoverWorkspace> {
  if (target.mode === "recovery") return recoveryWorkspace(ctx, target, input, now);
  return visitWorkspace(ctx, target, input, now);
}

async function recoveryWorkspace(ctx: Ctx, target: CoverTarget, input: CoverInput, now: Date): Promise<RecoveryCover> {
  const view = await findCoverView(ctx, target.id, input, now);
  const s = view.summary;
  const ago = s.minutesSince >= 60 ? `${Math.floor(s.minutesSince / 60)} h ${s.minutesSince % 60} min ago` : `${s.minutesSince} min ago`;
  const badge: CoverSummary["badge"] = s.highRisk ? { tone: "red", text: "High risk: arrange cover now" } : s.minutesSince <= 120 ? { tone: "amber", text: "Urgent: missed within the last 2 hours" } : { tone: "slate", text: "Standard priority" };
  const summary: CoverSummary = {
    serviceUser: s.serviceUser, serviceUserId: s.serviceUserId, reference: s.reference, visitId: s.visitId, badge,
    rows: [
      { k: "Cover type", v: "Recovery visit after a missed call" },
      { k: "Missed visit", v: `${fmtLondonDate(s.date, { weekday: "short", day: "numeric", month: "short" })} · ${londonTime(s.start)}–${londonTime(s.end)} (${s.minutes} min)` },
      { k: "Visit type", v: `${s.callType}${s.area ? ` · ${s.area}` : ""}` },
      { k: "Booked carer", v: s.original.length ? s.original.join(" and ") : "Nobody was assigned" },
      { k: "Reason", v: s.reason ? reasonLabel(s.reason) ?? s.reason : "Not recorded yet" },
      { k: "Carers needed", v: `${s.carersRequired} · ${view.still} still to cover`, strong: true },
      { k: "Missed", v: `${ago} (${s.reference})` },
    ],
  };
  const recovery = view.state.recovery;
  return {
    kind: "recovery", mode: "recovery", target, view, summary,
    canBook: view.state.canFind && !view.timeError, blocked: view.state.canFind ? view.timeError : view.state.text,
    // The missed-call view counts ranks from 1; the panel counts from 0 like the other kinds of cover.
    recommended: view.recommended, list: view.list, areas: view.areas, selected: view.selected ? { ...view.selected, rank: view.selected.rank ? view.selected.rank - 1 : null } : null,
    comms: { visitId: recovery?.id ?? s.visitId, caseId: s.caseId },
  };
}

async function visitWorkspace(ctx: Ctx, target: CoverTarget, input: CoverInput, now: Date): Promise<VisitCover> {
  const scope = await rotaScope(ctx, "rota.edit");
  const v = await getVisit(ctx, target.id);
  const live = v.assignments.filter((a) => !a.removedAt && a.slot !== "SHADOW");
  const required = Math.min(2, v.carersRequired);
  const places = SLOTS.slice(0, required);
  const occupant = (s: AssignmentSlot) => live.find((a) => a.slot === s) ?? null;
  const open = places.filter((s) => !occupant(s));
  const filled = places.filter((s) => occupant(s));
  // A fill with no empty place left, or a replace with nobody to replace, falls back to the other mode's places.
  const mode: "fill" | "replace" = target.mode === "replace" ? (filled.length ? "replace" : "fill") : open.length ? "fill" : "replace";
  const choices = mode === "fill" ? open : filled;
  const slot = choices.find((s) => s === target.slot) ?? choices[0] ?? null;
  const current = slot && mode === "replace" ? occupant(slot) : null;
  const p = priorityOf({ status: v.status, scheduledStart: v.scheduledStart, riskLevel: v.serviceUser.riskLevel }, now);
  const date = fromDbDate(v.date);
  const minutes = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  const summary: CoverSummary = {
    serviceUser: suName(v.serviceUser), serviceUserId: v.serviceUser.id, reference: v.reference, visitId: v.id,
    badge: { tone: p.priority === "URGENT" ? "red" : p.priority === "HIGH" ? "amber" : "slate", text: `${PRIORITY_LABEL[p.priority]}: ${p.why.charAt(0).toLowerCase()}${p.why.slice(1)}` },
    rows: [
      { k: "Cover type", v: mode === "fill" ? "Fill an empty carer place" : "Replace a booked care worker" },
      { k: "Visit", v: `${fmtLondonDate(date, { weekday: "short", day: "numeric", month: "short" })} · ${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)} (${minutes} min)` },
      { k: "Visit type", v: `${v.callType.name}${v.area ? ` · ${v.area.name}` : ""}` },
      { k: "Booked now", v: live.length ? live.map((a) => `${a.staff.displayName} (${SLOT_LABEL[a.slot]})`).join(", ") : "Nobody" },
      { k: "Carers needed", v: `${required}${required > 1 ? " (double-up)" : ""}` },
      ...(slot ? [{ k: mode === "fill" ? "Place to fill" : "Place to replace", v: `${SLOT_LABEL[slot]}${current ? `: ${current.staff.displayName}` : ""}`, strong: true }] : []),
    ],
  };
  const slots = choices.map((s) => ({ slot: s, label: SLOT_LABEL[s]!, current: occupant(s)?.staff.displayName ?? null }));
  let blocked: string | null = null;
  if (!["SCHEDULED", "MISSED"].includes(v.status) || v.scheduledEnd <= now) blocked = v.status === "MISSED" ? "This visit's time has passed. Cover for a missed call is a recovery visit: open it from Missed Calls." : `This visit is ${v.status.toLowerCase().replace("_", " ")}, so its carers cannot be changed here.`;
  else if (mode === "replace" && v.status !== "SCHEDULED") blocked = "Only a scheduled visit's carer can be replaced.";
  else if (!slot) blocked = "This visit has no carer place to fill or replace.";
  const base = {
    kind: "visit" as const, mode, target: { ...target, mode, slot: slot ?? undefined }, summary, slot, slots, current: current ? { staffId: current.staffId, name: current.staff.displayName } : null,
    lockVersion: v.lockVersion, date, careTasks: v.tasks.map((t) => t.name), comms: { visitId: v.id, caseId: null },
    carersRequired: required, others: live.filter((a) => a.slot !== slot).map((a) => a.staff.displayName),
  };
  if (blocked || !slot) return { ...base, canBook: false, blocked, recommended: [], list: [], areas: [], selected: null };

  const careTaskIds = v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
  const others = live.filter((a) => a.slot !== slot).map((a) => a.staffId);
  const allowed = await allocatableStaffIds(scope);
  let ranked = await slotCandidates(scope.organisationId, { visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, start: v.scheduledStart, end: v.scheduledEnd, timeLocked: v.timeLocked, careTaskIds, otherSlotStaffIds: others }, slot, allowed ?? undefined);
  // The carer being replaced is shown for clarity but can never be chosen as their own replacement.
  if (current) ranked = ranked.map((c) => (c.id === current.staffId ? { ...c, state: "NOT_ELIGIBLE" as const, score: null, explain: [], reasons: ["Booked in this place now: this is the carer you are replacing"] } : c));
  ranked.sort((a, b) => (a.state === "NOT_ELIGIBLE" ? 1 : 0) - (b.state === "NOT_ELIGIBLE" ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const areaRows = await db.staffArea.findMany({ where: { organisationId: scope.organisationId, staffId: { in: ranked.map((x) => x.id) } }, select: { staffId: true, area: { select: { id: true, name: true } } } });
  const all = withAreas(ranked, areaRows);
  const recommended = all.filter((c) => c.state !== "NOT_ELIGIBLE" && c.score !== null).slice(0, 3);
  const q = input.q?.trim().toLowerCase().slice(0, 60);
  const list = all.filter((c) => (!q || c.name.toLowerCase().includes(q) || c.areas.some((a) => a.toLowerCase().includes(q))) && (!input.area || areaRows.some((a) => a.staffId === c.id && a.area.id === input.area))).slice(0, MANUAL_MAX);
  const areas = [...new Map(areaRows.map((a) => [a.area.id, a.area])).values()].sort((a, b) => a.name.localeCompare(b.name));

  let selected: Selected | null = null;
  if (input.staffId) {
    const cand = all.find((c) => c.id === input.staffId);
    if (!cand) throw new NotFoundError("Staff member");
    // A fresh check for the review step: the same call the booking makes again inside its transaction.
    const result = await eligibilityFor(db, scope.organisationId, { staffId: cand.id, start: v.scheduledStart, end: v.scheduledEnd, slot, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, timeLocked: v.timeLocked, careTaskIds }, { otherSlotStaffIds: others });
    if (current?.staffId === cand.id) result.blocking.unshift({ code: "SAME_CARER", message: cand.reasons[0]! });
    const rank = recommended.findIndex((c) => c.id === cand.id);
    selected = { candidate: cand, result: { ...result, state: result.blocking.length ? "NOT_ELIGIBLE" : result.state }, checks: coverChecks(result), rank: rank >= 0 ? rank : null };
  }
  return { ...base, canBook: true, blocked: null, recommended, list, areas, selected };
}

/** Like coverWorkspace, but a record the caller may not see (or that no longer exists) gives the message instead. */
export async function coverWorkspaceOrMessage(ctx: Ctx, target: CoverTarget, input: CoverInput = {}, now = new Date()): Promise<CoverWorkspace | { error: string }> {
  try {
    return await coverWorkspace(ctx, target, input, now);
  } catch (e) {
    if (e instanceof AppError) return { error: e instanceof NotFoundError ? "That visit is not available to you, or no longer exists." : e.message };
    throw e;
  }
}

export { RANK_LABEL };

// ── Booking (fill and replace) ──────────────────────────────────────────

const bookSchema = z.object({
  mode: z.enum(["fill", "replace"]),
  visitId: z.string().min(1, "Choose a visit").max(40),
  slot: z.enum(["PRIMARY", "SECOND"], { message: "Choose the carer place" }),
  staffId: z.string().min(1, "Choose a carer").max(40),
  /** The visit version the coordinator reviewed. */
  lockVersion: z.coerce.number().int(),
  /** Who was in the place when the coordinator reviewed it ("" = empty). Stops two people filling the same place. */
  expectStaffId: z.string().max(40).default(""),
  source: z.enum(["RECOMMENDED", "MANUAL"]).default("MANUAL"),
  rank: z.coerce.number().int().min(0).max(2).optional(),
  /** Each warning the coordinator ticked. Every current warning must be among them. */
  acknowledged: z.array(z.string().max(600)).max(40).default([]),
  warningReason: z.string().trim().max(1000).optional(),
  /** Why the booked carer is being replaced (sickness, holiday, cancellation…). */
  replaceReason: z.string().trim().max(300).optional(),
});
type Loose<T> = { [K in keyof T]: T[K] extends string | undefined ? string | undefined : T[K] };
/** Form fields arrive as plain strings; the schema decides what is allowed. */
export type BookCoverInput = Loose<z.input<typeof bookSchema>>;

/**
 * Books the chosen carer into one place of an existing visit. In one transaction holding the visit row lock: the visit
 * version and the place's occupant must be what the coordinator reviewed, eligibility is judged again and every
 * warning must have been ticked, then the booking goes through assignInTx (which locks the carer and checks once more).
 * The database's no-overlap constraint is the last guard. A repeated submission for the same carer is not booked twice.
 */
export async function bookCover(ctx: Ctx, raw: BookCoverInput) {
  const p = bookSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the cover details");
  const d = p.data;
  if (d.mode === "replace" && (d.replaceReason ?? "").length < 3) throw new ValidationError("Say why the booked carer is being replaced");
  if (d.mode === "replace" && !d.expectStaffId) throw new ValidationError("Choose the carer place to replace");
  const scope = await rotaScope(ctx, "rota.edit");
  try {
    return await db.$transaction(
      async (tx) => {
        const visit = await lockVisit(tx, scope, d.visitId);
        if (d.slot === "SECOND" && visit.carersRequired < 2) throw new ValidationError("This visit needs one carer.");
        const live = await tx.visitAssignment.findMany({ where: { visitId: visit.id, removedAt: null }, select: { id: true, slot: true, staffId: true, staff: { select: { displayName: true } } } });
        const occupant = live.find((a) => a.slot === d.slot) ?? null;
        if (occupant?.staffId === d.staffId) return { assignmentId: occupant.id, duplicate: true };
        if ((occupant?.staffId ?? "") !== d.expectStaffId) {
          throw new ConflictError(occupant ? `Someone else has just booked ${occupant.staff.displayName} into this place. Reopen Find Cover to see the visit as it is now.` : "The carer you were replacing has just been removed by someone else. Reopen Find Cover to see the visit as it is now.");
        }
        if (visit.lockVersion !== d.lockVersion) throw new ConflictError("This visit changed since you opened Find Cover (time, carers or status). Reopen it and review again.");
        if (d.mode === "replace" && visit.status !== "SCHEDULED") throw new ValidationError("Only a scheduled visit's carer can be replaced.");
        if (d.mode === "replace" && !occupant) throw new ValidationError("There is nobody in this place to replace.");
        const staff = await tx.staffMember.findFirst({ where: { id: d.staffId, organisationId: scope.organisationId }, select: { id: true, displayName: true } });
        if (!staff) throw new NotFoundError("Staff member");
        const careTaskIds = (await tx.visitTask.findMany({ where: { visitId: visit.id }, select: { careTaskId: true } })).map((t) => t.careTaskId).filter((x): x is string => !!x);
        const pre = await eligibilityFor(tx, scope.organisationId, { staffId: staff.id, start: visit.scheduledStart, end: visit.scheduledEnd, slot: d.slot, visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: visit.timeLocked, careTaskIds }, { otherSlotStaffIds: live.filter((a) => a.slot !== d.slot && a.slot !== "SHADOW").map((a) => a.staffId) });
        if (pre.state === "NOT_ELIGIBLE") throw new EligibilityError(`${staff.displayName} can no longer be booked: ${pre.blocking.map((b) => b.message).join("; ")}`, pre);
        const warnings = pre.warnings.map((w) => w.message);
        const unseen = warnings.filter((w) => !d.acknowledged.includes(w));
        if (unseen.length) throw new ConflictError(`Something changed since you reviewed this carer. Please review ${unseen.length === 1 ? "this warning" : "these warnings"}: ${unseen.join("; ")}`);
        if (warnings.length && (d.warningReason ?? "").length < 5) throw new ValidationError("Say why this carer is right despite the warnings (at least 5 characters)");
        const source = d.mode === "fill" ? "find-cover" : "replace-cover";
        const a = await assignInTx(tx, scope, ctx.userId, { visitId: visit.id, slot: d.slot, staffId: staff.id, acceptWarnings: warnings.length > 0, acceptedWarnings: warnings }, { source, reason: d.mode === "replace" ? `Replaced through Find Cover: ${d.replaceReason}` : undefined });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.cover.booked", entityType: "Visit", entityId: visit.id, data: { mode: d.mode, slot: d.slot, staffId: staff.id, previousStaffId: occupant?.staffId ?? null, source: d.source, rank: d.rank ?? null, eligibility: pre.state, warnings, warningReason: warnings.length ? d.warningReason ?? null : null, replaceReason: d.replaceReason ?? null } }, tx);
        return { assignmentId: a.id, duplicate: false };
      },
      { isolationLevel: "ReadCommitted", timeout: 15_000 },
    );
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("This carer has just been booked for an overlapping visit. Reload and choose someone else.");
    throw e;
  }
}

/** The confirmation line after a fill or replace. Says only what is recorded. */
export async function bookedText(ctx: Ctx, assignmentId: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const a = await db.visitAssignment.findFirst({ where: { id: assignmentId, organisationId: scope.organisationId }, select: { slot: true, staff: { select: { displayName: true } }, visit: { select: { reference: true, scheduledStart: true, publishedAt: true } } } });
  if (!a) return "Cover booked";
  return `${a.staff.displayName} booked as ${SLOT_LABEL[a.slot]} on ${a.visit.reference}, ${fmtLondonDate(londonDate(a.visit.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(a.visit.scheduledStart)}.${a.visit.publishedAt ? " The visit is published, so it shows in their visits; they have not acknowledged it yet." : " The visit is not published to carers yet."} Remember to record the communication with the service user.`;
}
