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

/**
 * Visits Needing Attention as one queue. Nothing here has rules of its own: the rows come from the same three services
 * as before (Unassigned Visits, the Missed Calls register and outstanding cover communication), with the same
 * permissions, and are only normalised, grouped by how soon they need a decision and sorted. The grouping and sorting
 * are pure (`groupAttention`) so they are tested directly.
 */

export type AttentionType = "unassigned" | "missed" | "comms";
export type AttentionGroup = "now" | "today" | "week";
export const ATTENTION_TYPES: AttentionType[] = ["unassigned", "missed", "comms"];

/** Anything starting within this many hours, or already overdue, goes into "Act now". */
export const ACT_NOW_HOURS = 4;
/** Open missed-call cases are looked for over this many days, the Missed Calls page's default custom range. */
export const MISSED_DAYS = 30;

export const GROUP_LABEL: Record<AttentionGroup, string> = { now: `Act now · overdue or within ${ACT_NOW_HOURS} hours`, today: "Later today", week: "This week" };
export const TYPE_LABEL: Record<AttentionType, string> = { unassigned: "Unassigned", missed: "Missed call", comms: "Communication" };

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

export type AttentionItem = UnassignedEntry | MissedEntry | CommsEntry;

/** What the grouping needs from an item. */
export interface Groupable {
  type: AttentionType;
  start: Date;
  /** Missed calls: past the investigation deadline or a high-risk service user. Communication: past its due time. */
  pressing: boolean;
  /** Communication is grouped by when it is due. */
  dueAt?: Date;
}

/**
 * Which heading an item sits under. Act now: an unassigned visit starting within four hours (or already started), a
 * missed call that is past its deadline or for a high-risk service user, or communication that is overdue. Later
 * today: everything else dated today. This week: the rest.
 */
export function attentionGroup(it: Groupable, now: Date): AttentionGroup {
  const today = londonDate(now);
  if (it.type === "unassigned") {
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
 * The whole queue for the caller. Each kind of item appears only with its own permission: unassigned visits with
 * rota.view, missed calls with rota.monitor and outstanding communication with rota.edit (as on the old page).
 * `branch` narrows to one of the caller's own branches and can never widen their scope.
 */
export async function attentionQueue(ctx: Ctx, opts: { branch?: string } = {}, now = new Date()) {
  const can = { unassigned: hasOrgPermission(ctx, "rota.view"), missed: hasOrgPermission(ctx, "rota.monitor"), comms: hasOrgPermission(ctx, "rota.edit"), edit: hasOrgPermission(ctx, "rota.edit") };
  const today = londonDate(now);
  const scope = await rotaScope(ctx, can.unassigned ? "rota.view" : "rota.monitor");
  const branches = await authorisedBranches(scope);
  const branch = opts.branch && branches.some((b) => b.id === opts.branch) ? opts.branch : undefined;
  const items: AttentionItem[] = [];
  let unassignedTotal = 0;
  let missedTotal = 0;
  let commsTotal = 0;

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
    missed: missedTotal,
    comms: commsTotal,
  };
  return { can, items, counts, branches, branch: branch ?? null, today, now };
}
export type AttentionQueue = Awaited<ReturnType<typeof attentionQueue>>;
