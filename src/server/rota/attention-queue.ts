import type { MissedCallStage } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { authorisedBranches, rotaScope } from "./scope";
import { suName } from "./queries";
import { parseUnassigned, unassignedBoard, type Priority } from "./unassigned";
import { missedCallRegister, visitStatusNow } from "./missed-calls";
import { coverStates, type CoverState } from "./missed-cover";
import { outstandingCommunication } from "./cover-communication";
import { coverBoard } from "./cover";
import { EXCEPTION_KINDS, listExceptions } from "./exceptions";

/**
 * Visits Needing Attention as the office's one to-do list. Nothing here has rules of its own: the rows come from the
 * same services as the full registers (Unassigned Visits, Sickness & Holiday Cover, the Missed Calls register, the
 * Exceptions register and outstanding cover communication), with the same permissions, and are only normalised,
 * grouped by how soon they need a decision and sorted. A visit problem the register already shows under another kind
 * (a missed call, a visit left unassigned after a build) is not listed twice. The grouping and sorting are pure
 * (`groupAttention`) so they are tested directly.
 */

export type AttentionType = "unassigned" | "absent" | "missed" | "problem" | "comms";
export type AttentionGroup = "now" | "today" | "week";
export const ATTENTION_TYPES: AttentionType[] = ["unassigned", "absent", "missed", "problem", "comms"];
/** Exception kinds already in the queue under their own heading, so they are not listed again as visit problems. */
export const PROBLEM_KINDS_ELSEWHERE = new Set(["MISSED", "UNASSIGNED"]);
/** Carer-off bookings are looked for over the same week as unassigned visits. */
export const ABSENT_DAYS = 7;

/** Anything starting within this many hours, or already overdue, goes into "Act now". */
export const ACT_NOW_HOURS = 4;
/** Open missed-call cases are looked for over this many days, the Missed Calls page's default custom range. */
export const MISSED_DAYS = 30;

export const GROUP_LABEL: Record<AttentionGroup, string> = { now: `Act now · overdue or within ${ACT_NOW_HOURS} hours`, today: "Later today", week: "This week" };
export const TYPE_LABEL: Record<AttentionType, string> = { unassigned: "Unassigned", absent: "Carer off", missed: "Missed call", problem: "Visit problem", comms: "Communication" };

interface Common {
  key: string;
  id: string;
  visitId: string;
  reference: string;
  /** The visit's start (for a communication item, the visit the person is told about). */
  start: Date;
  /** The London date of the visit, YYYY-MM-DD. */
  date: string;
  serviceUser: string;
  serviceUserId: string;
  callType: string | null;
  area: string | null;
  /** The one-line reason under the name. */
  reason: string;
  warnings: string[];
  /** 0 is most pressing, within a group. */
  rank: number;
  group: AttentionGroup;
}

export interface UnassignedEntry extends Common {
  type: "unassigned";
  priority: Priority;
  why: string;
  required: number;
  filled: number;
}

export interface MissedEntry extends Common {
  type: "missed";
  carerName: string | null;
  overdue: boolean;
  highRisk: boolean;
  escalated: boolean;
  stage: MissedCallStage;
  cover: CoverState | null;
  /** The case's own stages, for the investigation checklist. */
  checks: { detectedAt: Date; informed: string | null; reasonRecorded: boolean; signedOff: boolean; submitted: boolean };
}

export interface CommsEntry extends Common {
  type: "comms";
  caseId: string | null;
  stateLabel: string;
  stateKind: string;
  owner: string;
  dueAt: Date;
  overdue: boolean;
  followUp: boolean;
}

/** A booking held by a carer who is off (or flagged after an HR change): it needs a replacement chosen by a person. */
export interface AbsentEntry extends Common {
  type: "absent";
  slot: string;
  staffId: string;
  carerName: string;
  doubleUp: boolean;
}

/** An open exception on a visit (late, not clocked out, short, medication, concern, readiness and so on). */
export interface ProblemEntry extends Common {
  type: "problem";
  kind: string;
  kindLabel: string;
  message: string;
  severity: string;
  deadline: Date | null;
  overdue: boolean;
  owner: string | null;
}

export type AttentionItem = UnassignedEntry | AbsentEntry | MissedEntry | ProblemEntry | CommsEntry;

/** What the grouping needs from an item. */
export interface Groupable {
  type: AttentionType;
  start: Date;
  /** Missed calls: past the investigation deadline or a high-risk service user. Visit problems: past their deadline or
   * critical. Communication: past its due time. */
  pressing: boolean;
  /** Communication is grouped by when it is due. */
  dueAt?: Date;
}

/**
 * Which heading an item sits under. Act now: an unassigned visit or a carer-off booking starting within four hours (or
 * already started), a missed call that is past its deadline or for a high-risk service user, a visit problem past its
 * deadline or critical, or communication that is overdue. Later today: everything else dated today. This week: the rest.
 */
export function attentionGroup(it: Groupable, now: Date): AttentionGroup {
  const today = londonDate(now);
  if (it.type === "unassigned" || it.type === "absent") {
    if (it.start.getTime() - now.getTime() <= ACT_NOW_HOURS * 3600_000) return "now";
    return londonDate(it.start) === today ? "today" : "week";
  }
  if (it.pressing) return "now";
  return londonDate(it.type === "comms" && it.dueAt ? it.dueAt : it.start) === today ? "today" : "week";
}

const GROUP_ORDER: Record<AttentionGroup, number> = { now: 0, today: 1, week: 2 };

/** Groups in order (Act now, Later today, This week); within each, most pressing first, then by start time. */
export function groupAttention<T extends { group: AttentionGroup; rank: number; start: Date; reference: string }>(items: T[]): { group: AttentionGroup; items: T[] }[] {
  const sorted = [...items].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.rank - b.rank || a.start.getTime() - b.start.getTime() || a.reference.localeCompare(b.reference));
  return (["now", "today", "week"] as AttentionGroup[]).map((group) => ({ group, items: sorted.filter((i) => i.group === group) })).filter((g) => g.items.length);
}

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };

export function missedWarnings(r: { overdue: boolean; highRisk: boolean; escalatedAt: Date | null; repeatCount: number; coordinatorId: string | null }) {
  return [r.overdue ? "past investigation deadline" : null, r.highRisk ? "high-risk" : null, r.escalatedAt ? "escalated" : null, r.repeatCount ? `carer missed ${r.repeatCount} recently` : null, !r.coordinatorId ? "no coordinator" : null].filter((w): w is string => !!w);
}

/** The missed-call filters the queue uses, also used for the link to the full register. */
export function missedFilters(today = londonDate(), branch?: string) {
  return { period: "custom", from: addDays(today, -(MISSED_DAYS - 1)), to: today, stage: "open", ...(branch ? { branch } : {}) };
}

/**
 * The whole queue for the caller. Each kind of item appears only with its own permission: unassigned visits and
 * carer-off bookings with rota.view, missed calls and visit problems with rota.monitor, and outstanding communication
 * with rota.edit (as on the registers themselves).
 * `branch` narrows to one of the caller's own branches and can never widen their scope.
 */
export async function attentionQueue(ctx: Ctx, opts: { branch?: string } = {}, now = new Date()) {
  const view = hasOrgPermission(ctx, "rota.view");
  const monitor = hasOrgPermission(ctx, "rota.monitor");
  const can = { unassigned: view, absent: view, missed: monitor, problem: monitor, comms: hasOrgPermission(ctx, "rota.edit"), edit: hasOrgPermission(ctx, "rota.edit") };
  const today = londonDate(now);
  const scope = await rotaScope(ctx, can.unassigned ? "rota.view" : "rota.monitor");
  const branches = await authorisedBranches(scope);
  const branch = opts.branch && branches.some((b) => b.id === opts.branch) ? opts.branch : undefined;
  const items: AttentionItem[] = [];
  let unassignedTotal = 0;
  let absentTotal = 0;
  let missedTotal = 0;
  let problemTotal = 0;
  let commsTotal = 0;
  // Branch narrowing for the kinds whose service filters by area, not branch.
  const branchVisits = async (ids: string[]) =>
    new Set((await db.visit.findMany({ where: { organisationId: scope.organisationId, id: { in: ids }, ...(branch ? { serviceUser: { branchId: branch } } : {}) }, select: { id: true } })).map((v) => v.id));

  if (can.unassigned) {
    // The same board as Unassigned Visits on "This Week": today and the next six days.
    const board = await unassignedBoard(ctx, parseUnassigned({ when: "week", ...(branch ? { branch } : {}) }, today), now);
    unassignedTotal = board.summary.visits;
    for (const it of board.all) {
      const v = it.visit;
      const required = v.carersRequired;
      const base = { type: "unassigned" as const, start: v.scheduledStart, pressing: false };
      items.push({
        ...base, key: `unassigned:${v.id}`, id: v.id, visitId: v.id, reference: v.reference, date: fromDbDate(v.date),
        serviceUser: suName(v.serviceUser), serviceUserId: v.serviceUser.id, callType: v.callType.name, area: v.area?.name ?? null,
        reason: it.reason, warnings: [], rank: PRIORITY_RANK[it.priority], group: attentionGroup(base, now),
        priority: it.priority, why: it.why, required, filled: required - it.openSlots.length,
      });
    }
  }

  if (can.absent) {
    // The same bookings as Sickness & Holiday Cover, for the same week as the unassigned visits.
    const board = await coverBoard(ctx, { from: today, days: ABSENT_DAYS }, now);
    const inBranch = await branchVisits(board.items.map((i) => i.visit.id));
    const shown = board.items.filter((i) => inBranch.has(i.visit.id));
    absentTotal = shown.length;
    for (const it of shown) {
      const v = it.visit;
      const base = { type: "absent" as const, start: v.scheduledStart, pressing: false };
      items.push({
        ...base, key: `absent:${v.id}:${it.slot}`, id: v.id, visitId: v.id, reference: v.reference, date: fromDbDate(v.date),
        serviceUser: suName(v.serviceUser), serviceUserId: v.serviceUser.id, callType: v.callType.name, area: v.area?.name ?? null,
        reason: it.reason, warnings: [], rank: v.serviceUser.riskLevel === "HIGH" ? 0 : 1, group: attentionGroup(base, now),
        slot: it.slot, staffId: it.staffId, carerName: it.staffName, doubleUp: v.carersRequired > 1,
      });
    }
  }

  if (can.missed) {
    const reg = await missedCallRegister(ctx, missedFilters(today, branch), now);
    missedTotal = reg.rows.length;
    const covers = await coverStates(ctx, reg.rows.map((r) => r.id), now);
    for (const r of reg.rows) {
      const warnings = missedWarnings(r);
      const pressing = r.overdue || r.highRisk;
      const base = { type: "missed" as const, start: r.visit.scheduledStart, pressing };
      const reason = [r.carerName ?? "No carer was booked", visitStatusNow(r.visit), ...warnings].join(" · ");
      items.push({
        ...base, key: `missed:${r.id}`, id: r.id, visitId: r.visit.id, reference: r.visit.reference, date: londonDate(r.visit.scheduledStart),
        serviceUser: r.serviceUserName, serviceUserId: r.visit.serviceUser.id, callType: r.visit.callType.name, area: r.visit.area?.name ?? null,
        reason, warnings, rank: r.overdue || r.escalatedAt ? 0 : 1, group: attentionGroup(base, now),
        carerName: r.carerName, overdue: r.overdue, highRisk: r.highRisk, escalated: !!r.escalatedAt, stage: r.stage, cover: covers.get(r.id) ?? null,
        checks: { detectedAt: r.detectedAt, informed: r.suInformedStatus ?? (r.clientInformed ? "RECORDED" : null), reasonRecorded: !!r.reasonCode, signedOff: !!r.signedOffAt, submitted: !!r.submittedAt },
      });
    }
  }

  if (can.problem) {
    // Open exceptions on visits, from the Exceptions register with its own area rules.
    const ex = await listExceptions(ctx, { state: "open" }, { take: 300 });
    // A booking already listed as "Carer off" is not listed again as an allocation to review: it is the same job.
    const absentBookings = new Set(items.filter((i): i is AbsentEntry => i.type === "absent").map((i) => `${i.visitId}:${i.staffId}`));
    const open = ex.rows.filter((r) => r.visitId && !PROBLEM_KINDS_ELSEWHERE.has(r.kind) && !(r.staffId && absentBookings.has(`${r.visitId}:${r.staffId}`)));
    const visits = new Map((await db.visit.findMany({ where: { organisationId: scope.organisationId, id: { in: open.map((r) => r.visitId as string) }, ...(branch ? { serviceUser: { branchId: branch } } : {}) }, select: { id: true, reference: true, date: true, scheduledStart: true, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } }, area: { select: { name: true } } } })).map((v) => [v.id, v]));
    for (const r of open) {
      const v = visits.get(r.visitId as string);
      if (!v) continue;
      problemTotal += 1;
      const pressing = r.overdue || r.severity === "CRITICAL";
      const base = { type: "problem" as const, start: v.scheduledStart, pressing };
      const kindLabel = EXCEPTION_KINDS[r.kind] ?? r.kind;
      const owner = r.ownerId ? ex.names.get(r.ownerId) ?? null : null;
      items.push({
        ...base, key: `problem:${r.id}`, id: r.id, visitId: v.id, reference: v.reference, date: fromDbDate(v.date),
        serviceUser: suName(v.serviceUser), serviceUserId: v.serviceUser.id, callType: v.callType.name, area: v.area?.name ?? null,
        reason: [kindLabel, owner ? `owner ${owner}` : "no owner yet", r.overdue ? "past its deadline" : null].filter(Boolean).join(" · "),
        warnings: [], rank: pressing ? 0 : 1, group: attentionGroup(base, now),
        kind: r.kind, kindLabel, message: r.message, severity: r.severity, deadline: r.deadline, overdue: r.overdue, owner,
      });
    }
  }

  if (can.comms) {
    const { items: comms, total } = await outstandingCommunication(ctx, now, 200);
    // Call type, area and branch for each visit, from the caller's own organisation.
    const visits = new Map((await db.visit.findMany({ where: { organisationId: scope.organisationId, id: { in: comms.map((c) => c.visitId) } }, select: { id: true, callType: { select: { name: true } }, area: { select: { name: true } }, serviceUser: { select: { branchId: true } } } })).map((v) => [v.id, v]));
    const shown = branch ? comms.filter((c) => visits.get(c.visitId)?.serviceUser.branchId === branch) : comms;
    commsTotal = branch ? shown.length : total;
    for (const c of shown) {
      const v = visits.get(c.visitId);
      const base = { type: "comms" as const, start: c.start, pressing: c.overdue, dueAt: c.dueAt };
      const due = `${c.state.followUp ? "follow-up due" : "due"} ${londonDate(c.dueAt) === today ? "" : `${fmtLondonDate(londonDate(c.dueAt), { day: "numeric", month: "short" })} `}${londonTime(c.dueAt)}${c.overdue ? " (overdue)" : ""}`;
      items.push({
        ...base, key: `comms:${c.visitId}`, id: c.visitId, visitId: c.visitId, reference: c.reference, date: londonDate(c.start),
        serviceUser: c.serviceUser, serviceUserId: c.serviceUserId, callType: v?.callType.name ?? null, area: v?.area?.name ?? null,
        reason: `${c.state.label} · ${due}`, warnings: [], rank: c.overdue ? 0 : 1, group: attentionGroup(base, now),
        caseId: c.caseId, stateLabel: c.state.label, stateKind: c.state.kind, owner: c.owner, dueAt: c.dueAt, overdue: c.overdue, followUp: !!c.state.followUp,
      });
    }
  }

  const counts = {
    all: items.length,
    now: items.filter((i) => i.group === "now").length,
    unassigned: unassignedTotal,
    absent: absentTotal,
    missed: missedTotal,
    problem: problemTotal,
    comms: commsTotal,
  };
  return { can, items, counts, branches, branch: branch ?? null, today, now };
}
export type AttentionQueue = Awaited<ReturnType<typeof attentionQueue>>;
