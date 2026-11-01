import type { AssignmentSlot, Prisma, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, daysBetween, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { effectiveClocks } from "./attendance";
import { memberNames, suName } from "./queries";
import type { ExportCell, PdfSection } from "@/server/reports/export-files";
import { authorisedBranches, rotaScope, visitBranchClause, visitWhere, type Scope } from "./scope";

/**
 * Coverage History: a read-only report of what happened to booked visits over a past period. Every figure is worked
 * out from stored Visit, VisitAssignment, VisitClock, VisitEvent and MissedCallCase records; nothing is estimated.
 *
 * Definitions (shown on the page and in the exports):
 * - Attended: at least one clock-in in force (a corrected clock counts once, as its correction).
 * - Completed: the visit's recorded status is Completed.
 * - Without recorded attendance: due, not cancelled, and no clock-in in force. Split into Missed (recorded), Not
 *   delivered (recorded) and No record (nothing recorded either way). A missing clock is not proof nobody attended.
 * - Cancelled: the visit was cancelled. Cancelled visits are counted in the total but not in the attendance rate.
 * - Not yet due: the period includes today and the visit has not started yet.
 * Every visit falls into exactly one of Attended, Without recorded attendance, Cancelled and Not yet due, so the
 * four add up to the total. Visits are counted once whatever the number of carers; per-carer evidence is kept apart.
 * Days are Europe/London calendar days (Visit.date), so clock changes and overnight visits are counted on the day the
 * visit starts.
 */

export const RANGES = ["7", "14", "30", "90", "custom"] as const;
export const LATE_THRESHOLDS = [15, 30, 60, 120] as const;
export const DEFAULT_LATE_MIN = 30;
export const MAX_SPAN_DAYS = 92;
/** A guard so a mis-set filter can never pull an unbounded number of rows into memory. */
const MAX_VISITS = 30_000;

export const VIEWS = ["all", "attended", "completed", "uncovered", "cancelled", "reassigned", "late"] as const;
export type CoverageView = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<CoverageView, string> = {
  all: "All visits",
  attended: "Attended",
  completed: "Completed",
  uncovered: "Uncovered / No attendance",
  cancelled: "Cancelled",
  reassigned: "Reassigned",
  late: "Late reassignments",
};

export type Outcome = "ATTENDED_COMPLETED" | "ATTENDED_OPEN" | "MISSED" | "NOT_DELIVERED" | "NO_RECORD" | "NOT_DUE" | "CANCELLED";
export const OUTCOME_LABEL: Record<Outcome, string> = {
  ATTENDED_COMPLETED: "Attended · completed",
  ATTENDED_OPEN: "Attended · not completed",
  MISSED: "Missed (recorded)",
  NOT_DELIVERED: "Not delivered (recorded)",
  NO_RECORD: "No recorded attendance",
  NOT_DUE: "Not yet due",
  CANCELLED: "Cancelled",
};

export const DEFINITIONS: [string, string][] = [
  ["Total visits", "Every visit booked in the period, including visits later cancelled. Each visit counts once, however many carers it needs."],
  ["Attended", "At least one carer has a clock-in in force for the visit. A corrected clock counts once, as the correction."],
  ["Completed", "The visit's recorded status is Completed. A visit can be attended but not yet completed."],
  ["Without recorded attendance", "Due, not cancelled, and no clock-in in force. Split into Missed and Not delivered (both recorded outcomes) and No record. A missing clock is not proof that nobody attended."],
  ["Cancelled", "The visit was cancelled. Cancelled visits are in the total but left out of the attendance rate."],
  ["Not yet due", "Only when the period includes today: visits that have not started yet."],
  ["Reassigned", "A carer place on the visit was given to a different carer after it was first filled."],
  ["Late reassignment", "A reassignment saved less than the chosen threshold before the scheduled start (or after it). This is a reporting rule, not evidence that care started late."],
  ["Branch", "The service user's branch, never the carer's."],
];

// ── Pure rules (unit-tested) ────────────────────────────────────────────────

export function classify(v: { status: VisitStatus; scheduledStart: Date }, attended: boolean, now: Date): Outcome {
  if (v.status === "CANCELLED") return "CANCELLED";
  if (attended) return v.status === "COMPLETED" ? "ATTENDED_COMPLETED" : "ATTENDED_OPEN";
  if (v.status === "NOT_DELIVERED") return "NOT_DELIVERED";
  if (v.status === "MISSED") return "MISSED";
  if (v.scheduledStart > now) return "NOT_DUE";
  return "NO_RECORD";
}

export const isAttended = (o: Outcome) => o === "ATTENDED_COMPLETED" || o === "ATTENDED_OPEN";
export const isUncovered = (o: Outcome) => o === "MISSED" || o === "NOT_DELIVERED" || o === "NO_RECORD";

export interface AssignmentRow {
  id: string;
  slot: AssignmentSlot;
  staffId: string;
  assignedAt: Date;
  assignedById: string;
  removedAt: Date | null;
  removedById: string | null;
  removeReason: string | null;
}

export interface Replacement {
  slot: AssignmentSlot;
  fromStaffId: string;
  toStaffId: string;
  at: Date;
  byId: string;
  reason: string | null;
  /** Minutes between saving the replacement and the scheduled start; negative when saved after the start. */
  minutesBefore: number;
  late: boolean;
}

/**
 * What happened to the carer places on one visit, from the assignment rows (which are never deleted, only ended).
 * The original carer of a place is the first person ever assigned to it, never the current one.
 */
export function staffingHistory(rows: AssignmentRow[], scheduledStart: Date, lateMin: number) {
  const bySlot = new Map<AssignmentSlot, AssignmentRow[]>();
  for (const r of [...rows].filter((r) => r.slot !== "SHADOW").sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || a.id.localeCompare(b.id))) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const slots = (["PRIMARY", "SECOND"] as AssignmentSlot[]).filter((s) => bySlot.has(s));
  const original = slots.map((s) => bySlot.get(s)![0]!.staffId);
  const current = slots.flatMap((s) => bySlot.get(s)!.filter((r) => !r.removedAt).map((r) => r.staffId));
  const replacements: Replacement[] = [];
  let changes = 0;
  for (const s of slots) {
    const list = bySlot.get(s)!;
    changes += list.length - 1;
    if (list.at(-1)!.removedAt) changes += 1;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const next = list[i]!;
      if (prev.staffId === next.staffId) continue;
      const minutesBefore = Math.round((scheduledStart.getTime() - next.assignedAt.getTime()) / 60000);
      replacements.push({ slot: s, fromStaffId: prev.staffId, toStaffId: next.staffId, at: next.assignedAt, byId: next.assignedById, reason: prev.removeReason, minutesBefore, late: minutesBefore < lateMin });
    }
  }
  replacements.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { original, current, replacements, reassigned: replacements.length > 0, late: replacements.some((r) => r.late), changes };
}

/** Each carer's own clock-in and clock-out in force. One carer's clock-in is never paired with another's clock-out. */
export function perCarerAttendance<T extends { id: string; staffId: string | null; kind: "IN" | "OUT"; at: Date; supersedesId: string | null }>(clocks: T[]) {
  const live = effectiveClocks(clocks);
  const out = new Map<string, { in: Date | null; out: Date | null; corrected: boolean }>();
  for (const c of live) {
    if (!c.staffId) continue;
    const e = out.get(c.staffId) ?? { in: null, out: null, corrected: false };
    if (c.kind === "IN") e.in = !e.in || c.at < e.in ? c.at : e.in;
    else e.out = !e.out || c.at > e.out ? c.at : e.out;
    if (c.supersedesId) e.corrected = true;
    out.set(c.staffId, e);
  }
  return out;
}

// ── Filters ─────────────────────────────────────────────────────────────────

const optId = z.string().trim().max(60).optional().transform((v) => v || undefined);
export const coverageInputSchema = z.object({
  range: z.enum(RANGES).catch("7"),
  from: z.string().optional(),
  to: z.string().optional(),
  branch: optId,
  area: optId,
  call: optId,
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  day: z.string().optional().transform((v) => (v && isIsoDate(v) ? v : undefined)),
  view: z.enum(VIEWS).catch("all"),
  late: z.coerce.number().int().catch(DEFAULT_LATE_MIN).transform((n) => (LATE_THRESHOLDS as readonly number[]).includes(n) ? n : DEFAULT_LATE_MIN),
  sort: z.enum(["date", "ref", "su", "status", "changes"]).catch("date"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).catch(1),
  per: z.coerce.number().int().catch(25).transform((n) => ([25, 50, 100].includes(n) ? n : 25)),
});
export type CoverageInput = z.input<typeof coverageInputSchema>;
export type CoverageFilters = z.output<typeof coverageInputSchema> & { from: string; to: string };

/** The reporting period. The default is the last seven complete London days, ending yesterday. */
export function coveragePeriod(range: (typeof RANGES)[number], from: string | undefined, to: string | undefined, today = londonDate()) {
  const yesterday = addDays(today, -1);
  if (range !== "custom") {
    const n = Number(range);
    return { from: addDays(yesterday, -(n - 1)), to: yesterday, partial: false };
  }
  let f = from && isIsoDate(from) ? from : addDays(yesterday, -6);
  let t = to && isIsoDate(to) ? to : yesterday;
  if (t > today) t = today;
  if (f > t) [f, t] = [t, f];
  if (daysBetween(f, t) + 1 > MAX_SPAN_DAYS) throw new ValidationError(`Choose a period of ${MAX_SPAN_DAYS} days or less`);
  return { from: f, to: t, partial: t >= today };
}

export function parseCoverage(raw: Record<string, string | string[] | undefined>, today = londonDate()): CoverageFilters & { partial: boolean } {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const f = coverageInputSchema.parse(flat);
  const p = coveragePeriod(f.range, flat.from, flat.to, today);
  return { ...f, from: p.from, to: p.to, partial: p.partial, day: f.day && f.day >= p.from && f.day <= p.to ? f.day : undefined };
}

function coverageWhere(scope: Scope, f: Pick<CoverageFilters, "from" | "to" | "branch" | "area" | "call" | "q">, day?: string): Prisma.VisitWhereInput {
  const and: Prisma.VisitWhereInput[] = [visitWhere(scope), { date: day ? new Date(`${day}T00:00:00Z`) : { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) } }];
  if (f.branch) and.push(visitBranchClause(scope, f.branch));
  // An area outside the member's scope matches nothing; visitWhere already limits them.
  if (f.area) and.push({ areaId: f.area });
  if (f.call) and.push({ callTypeId: f.call });
  if (f.q) and.push({ OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { serviceUser: { firstName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }, { assignments: { some: { staff: { displayName: { contains: f.q, mode: "insensitive" } } } } }] });
  return { AND: and };
}

// ── Loading ─────────────────────────────────────────────────────────────────

interface Facts {
  id: string;
  reference: string;
  date: string;
  status: VisitStatus;
  scheduledStart: Date;
  branchId: string | null;
  suName: string;
  outcome: Outcome;
  reassigned: boolean;
  late: boolean;
  changes: number;
}

/** One pass over the period: three bounded queries (visits, clock-ins, assignments), no per-visit queries. */
async function loadFacts(scope: Scope, f: CoverageFilters, now: Date): Promise<Facts[]> {
  const where = coverageWhere(scope, f);
  const [visits, ins, assigns] = await Promise.all([
    db.visit.findMany({ where, select: { id: true, reference: true, date: true, status: true, scheduledStart: true, serviceUser: { select: { branchId: true, firstName: true, lastName: true, preferredName: true } } }, take: MAX_VISITS + 1 }),
    db.visitClock.findMany({ where: { organisationId: scope.organisationId, kind: "IN", visit: where }, select: { id: true, visitId: true, staffId: true, kind: true, at: true, supersedesId: true } }),
    db.visitAssignment.findMany({ where: { organisationId: scope.organisationId, slot: { not: "SHADOW" }, visit: where }, select: { id: true, visitId: true, slot: true, staffId: true, assignedAt: true, assignedById: true, removedAt: true, removedById: true, removeReason: true } }),
  ]);
  if (visits.length > MAX_VISITS) throw new ValidationError("This period holds too many visits to report at once. Choose a shorter period or one branch.");
  const attended = new Set(effectiveClocks(ins).map((c) => c.visitId));
  const byVisit = new Map<string, AssignmentRow[]>();
  for (const a of assigns) byVisit.set(a.visitId, [...(byVisit.get(a.visitId) ?? []), a]);
  return visits.map((v) => {
    const h = staffingHistory(byVisit.get(v.id) ?? [], v.scheduledStart, f.late);
    return { id: v.id, reference: v.reference, date: fromDbDate(v.date), status: v.status, scheduledStart: v.scheduledStart, branchId: v.serviceUser.branchId, suName: suName(v.serviceUser), outcome: classify(v, attended.has(v.id), now), reassigned: h.reassigned, late: h.late, changes: h.changes };
  });
}

export interface Tally {
  total: number;
  attended: number;
  completed: number;
  uncovered: number;
  missed: number;
  notDelivered: number;
  noRecord: number;
  cancelled: number;
  notDue: number;
  reassigned: number;
  late: number;
}

export function tally(rows: Pick<Facts, "outcome" | "status" | "reassigned" | "late">[]): Tally {
  const t: Tally = { total: 0, attended: 0, completed: 0, uncovered: 0, missed: 0, notDelivered: 0, noRecord: 0, cancelled: 0, notDue: 0, reassigned: 0, late: 0 };
  for (const r of rows) {
    t.total++;
    if (isAttended(r.outcome)) t.attended++;
    if (r.status === "COMPLETED") t.completed++;
    if (isUncovered(r.outcome)) t.uncovered++;
    if (r.outcome === "MISSED") t.missed++;
    if (r.outcome === "NOT_DELIVERED") t.notDelivered++;
    if (r.outcome === "NO_RECORD") t.noRecord++;
    if (r.outcome === "CANCELLED") t.cancelled++;
    if (r.outcome === "NOT_DUE") t.notDue++;
    if (r.reassigned) t.reassigned++;
    if (r.late) t.late++;
  }
  return t;
}

/** Attended share of the visits that were due and not cancelled; null when there were none. */
export const attendanceRate = (t: Tally) => (t.total - t.cancelled - t.notDue > 0 ? Math.round((t.attended / (t.total - t.cancelled - t.notDue)) * 1000) / 10 : null);

function matchesView(r: Facts, view: CoverageView) {
  switch (view) {
    case "attended":
      return isAttended(r.outcome);
    case "completed":
      return r.status === "COMPLETED";
    case "uncovered":
      return isUncovered(r.outcome);
    case "cancelled":
      return r.outcome === "CANCELLED";
    case "reassigned":
      return r.reassigned;
    case "late":
      return r.late;
    default:
      return true;
  }
}

const SORTERS: Record<CoverageFilters["sort"], (a: Facts, b: Facts) => number> = {
  date: (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  ref: (a, b) => a.reference.localeCompare(b.reference),
  su: (a, b) => a.suName.localeCompare(b.suName),
  status: (a, b) => OUTCOME_LABEL[a.outcome].localeCompare(OUTCOME_LABEL[b.outcome]),
  changes: (a, b) => a.changes - b.changes,
};

const detailSelect = {
  id: true,
  reference: true,
  date: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  carersRequired: true,
  cancelReason: true,
  notDeliveredReason: true,
  serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, branch: { select: { name: true } } } },
  area: { select: { name: true } },
  callType: { select: { name: true } },
  assignments: { where: { slot: { not: "SHADOW" } }, select: { id: true, slot: true, staffId: true, assignedAt: true, assignedById: true, removedAt: true, removedById: true, removeReason: true, acknowledgedAt: true, staff: { select: { displayName: true } } } },
  clocks: { select: { id: true, staffId: true, kind: true, at: true, supersedesId: true, method: true } },
  missedCallCase: { select: { id: true, stage: true, escalatedAt: true, outcome: true, replacementType: true } },
} satisfies Prisma.VisitSelect;

type DetailVisit = Prisma.VisitGetPayload<{ select: typeof detailSelect }>;

export interface CoverageRow {
  id: string;
  reference: string;
  date: string;
  serviceUser: string;
  serviceUserId: string;
  branch: string;
  area: string;
  serviceCall: string;
  scheduled: string;
  start: Date;
  end: Date;
  carersRequired: number;
  original: string[];
  current: string[];
  attendance: { name: string; in: string | null; out: string | null; corrected: boolean }[];
  actualIn: string | null;
  actualOut: string | null;
  durationMin: number | null;
  reassigned: boolean;
  late: boolean;
  lastReplacement: { from: string; to: string; at: Date; by: string; reason: string; minutesBefore: number } | null;
  changes: number;
  acknowledged: string;
  outcome: Outcome;
  status: VisitStatus;
  investigation: { id: string; stage: string; escalated: boolean } | null;
}

function toRow(v: DetailVisit, lateMin: number, now: Date, names: Map<string, string>): CoverageRow {
  const staffName = new Map(v.assignments.map((a) => [a.staffId, a.staff.displayName]));
  const who = (id: string) => staffName.get(id) ?? "Former staff member";
  const h = staffingHistory(v.assignments, v.scheduledStart, lateMin);
  const per = perCarerAttendance(v.clocks);
  const attendance = [...per.entries()].map(([id, e]) => ({ name: who(id), in: e.in ? londonTime(e.in) : null, out: e.out ? londonTime(e.out) : null, corrected: e.corrected }));
  const ins = [...per.values()].map((e) => e.in).filter((d): d is Date => !!d);
  const outs = [...per.values()].map((e) => e.out).filter((d): d is Date => !!d);
  // The visit's span is earliest clock-in to latest clock-out, and only once every carer who clocked in clocked out.
  const allOut = per.size > 0 && [...per.values()].every((e) => !e.in || e.out);
  const first = ins.length ? new Date(Math.min(...ins.map((d) => d.getTime()))) : null;
  const last = allOut && outs.length ? new Date(Math.max(...outs.map((d) => d.getTime()))) : null;
  const live = v.assignments.filter((a) => !a.removedAt);
  const lr = h.replacements.at(-1);
  return {
    id: v.id,
    reference: v.reference,
    date: fromDbDate(v.date),
    serviceUser: suName(v.serviceUser),
    serviceUserId: v.serviceUser.id,
    branch: v.serviceUser.branch?.name ?? "No branch",
    area: v.area?.name ?? "No area",
    serviceCall: v.callType.name,
    scheduled: `${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)}`,
    start: v.scheduledStart,
    end: v.scheduledEnd,
    carersRequired: v.carersRequired,
    original: h.original.map(who),
    current: h.current.map(who),
    attendance,
    actualIn: first ? londonTime(first) : null,
    actualOut: last ? londonTime(last) : null,
    durationMin: first && last ? Math.round((last.getTime() - first.getTime()) / 60000) : null,
    reassigned: h.reassigned,
    late: h.late,
    lastReplacement: lr ? { from: who(lr.fromStaffId), to: who(lr.toStaffId), at: lr.at, by: names.get(lr.byId) ?? "Not recorded", reason: lr.reason ?? "Not recorded", minutesBefore: lr.minutesBefore } : null,
    changes: h.changes,
    acknowledged: !live.length ? "—" : live.every((a) => a.acknowledgedAt) ? "Yes" : live.some((a) => a.acknowledgedAt) ? "Partly" : "Not recorded",
    outcome: classify(v, ins.length > 0, now),
    status: v.status,
    investigation: v.missedCallCase ? { id: v.missedCallCase.id, stage: v.missedCallCase.stage, escalated: !!v.missedCallCase.escalatedAt } : null,
  };
}

async function detailRows(scope: Scope, ids: string[], lateMin: number, now: Date, ctx: Ctx) {
  if (!ids.length) return [];
  const visits = await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: ids } }] }, select: detailSelect });
  const names = await memberNames(ctx, visits.flatMap((v) => v.assignments.map((a) => a.assignedById)));
  const byId = new Map(visits.map((v) => [v.id, toRow(v, lateMin, now, names)]));
  return ids.map((id) => byId.get(id)).filter((r): r is CoverageRow => !!r);
}

/** Who may compare branches: managers with rota permission across more than one branch. */
export function canCompareBranches(ctx: Ctx) {
  return hasOrgPermission(ctx, "rota.settings") || hasOrgPermission(ctx, "rota.missed.signoff");
}

export async function coverageReport(ctx: Ctx, f: CoverageFilters, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.view");
  const [facts, branches] = await Promise.all([loadFacts(scope, f, now), authorisedBranches(scope)]);
  const summary = tally(facts);
  const days: { date: string; t: Tally }[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push({ date: d, t: tally(facts.filter((x) => x.date === d)) });
  const compare = canCompareBranches(ctx) && branches.length > 1
    ? [...branches.map((b) => ({ id: b.id as string | null, name: b.name, t: tally(facts.filter((x) => x.branchId === b.id)) })), ...(facts.some((x) => !x.branchId) ? [{ id: null, name: "No branch recorded", t: tally(facts.filter((x) => !x.branchId)) }] : [])]
    : null;
  const filtered = facts.filter((x) => (!f.day || x.date === f.day) && matchesView(x, f.view));
  const dir = f.dir === "asc" ? 1 : -1;
  filtered.sort((a, b) => dir * SORTERS[f.sort](a, b) || a.scheduledStart.getTime() - b.scheduledStart.getTime() || a.reference.localeCompare(b.reference));
  const pages = Math.max(1, Math.ceil(filtered.length / f.per));
  const page = Math.min(f.page, pages);
  const rows = await detailRows(scope, filtered.slice((page - 1) * f.per, page * f.per).map((x) => x.id), f.late, now, ctx);
  return { summary, days, compare, rows, matched: filtered.length, page, pages, branches };
}

// ── Replacement history for one visit (opened on demand) ──────────────────────

export interface TimelineItem {
  at: Date;
  title: string;
  detail: string | null;
  actor: string;
  tone: "staff" | "clock" | "status" | "alert" | "info";
}

const EVENT_TITLE: Record<string, string> = { CREATED: "Visit created", EDITED: "Visit changed", PUBLISHED: "Published to carers", TASKS: "Care tasks recorded", NOTE: "Note added" };
const SLOT_WORD: Record<string, string> = { PRIMARY: "carer 1", SECOND: "carer 2" };

/**
 * The visit's history in time order, built only from stored records: assignments (with who assigned and removed and
 * why), review flags, acknowledgements, events, every clock row (including those later corrected) and the missed-call
 * case. Anything not recorded is shown as "Not recorded"; nothing is inferred.
 */
export async function coverageTimeline(ctx: Ctx, visitId: string, lateMin = DEFAULT_LATE_MIN) {
  const scope = await rotaScope(ctx, "rota.view");
  const v = await db.visit.findFirst({
    where: { AND: [visitWhere(scope), { id: visitId }] },
    select: {
      ...detailSelect,
      assignments: { select: { id: true, slot: true, staffId: true, assignedAt: true, assignedById: true, removedAt: true, removedById: true, removeReason: true, acknowledgedAt: true, reviewReason: true, reviewFlaggedAt: true, warningsAccepted: true, staff: { select: { displayName: true } } } },
      events: { select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, reason: true, data: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      clocks: { select: { id: true, staffId: true, kind: true, at: true, supersedesId: true, method: true, reason: true, recordedById: true, createdAt: true } },
      missedCallCase: { select: { id: true, stage: true, detectedAt: true, escalatedAt: true, escalatedById: true, escalationNote: true, replacementType: true, replacementStaffId: true, replacementAt: true, replacementById: true, outcome: true, signedOffAt: true, signedOffById: true } },
    },
  });
  if (!v) throw new NotFoundError("Visit");
  const names = await memberNames(ctx, [...v.assignments.flatMap((a) => [a.assignedById, a.removedById]), ...v.events.map((e) => e.actorId), ...v.clocks.map((c) => c.recordedById), v.missedCallCase?.escalatedById, v.missedCallCase?.replacementById, v.missedCallCase?.signedOffById]);
  const staffIds = [...new Set([...v.clocks.map((c) => c.staffId), v.missedCallCase?.replacementStaffId].filter((x): x is string => !!x))];
  const staff = new Map((await db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: staffIds } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  for (const a of v.assignments) staff.set(a.staffId, a.staff.displayName);
  const person = (id: string | null | undefined) => (id ? staff.get(id) ?? "Former staff member" : "Not recorded");
  const actor = (id: string | null | undefined) => (id ? names.get(id) ?? "Former member" : "System");

  const items: TimelineItem[] = [];
  const superseded = new Set(v.clocks.map((c) => c.supersedesId).filter((x): x is string => !!x));
  const rows = [...v.assignments].filter((a) => a.slot !== "SHADOW").sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  const seenSlot = new Set<string>();
  for (const a of rows) {
    const first = !seenSlot.has(a.slot);
    seenSlot.add(a.slot);
    items.push({ at: a.assignedAt, title: `${first ? "Assigned" : "Replacement assigned"}: ${a.staff.displayName} (${SLOT_WORD[a.slot] ?? a.slot.toLowerCase()})`, detail: a.warningsAccepted.length ? `Warnings accepted: ${a.warningsAccepted.join("; ")}` : null, actor: actor(a.assignedById), tone: "staff" });
    if (a.reviewFlaggedAt) items.push({ at: a.reviewFlaggedAt, title: `Flagged for review: ${a.staff.displayName}`, detail: a.reviewReason ?? "Reason not recorded", actor: "System", tone: "alert" });
    if (a.acknowledgedAt) items.push({ at: a.acknowledgedAt, title: `${a.staff.displayName} acknowledged the visit`, detail: null, actor: a.staff.displayName, tone: "info" });
    if (a.removedAt) items.push({ at: a.removedAt, title: `${a.staff.displayName} removed from the visit`, detail: a.removeReason ?? "Reason not recorded", actor: actor(a.removedById), tone: "staff" });
  }
  for (const e of v.events) {
    if (["ASSIGNED", "REASSIGNED", "UNASSIGNED", "CLOCK"].includes(e.type)) continue;
    if (e.type === "STATUS") items.push({ at: e.createdAt, title: `Status: ${e.fromStatus ? `${e.fromStatus.toLowerCase().replace("_", " ")} → ` : ""}${(e.toStatus ?? "").toLowerCase().replace("_", " ")}`, detail: e.reason, actor: actor(e.actorId), tone: "status" });
    else if (e.type === "SWAPPED") items.push({ at: e.createdAt, title: "Carers swapped with another visit", detail: e.reason, actor: actor(e.actorId), tone: "staff" });
    else items.push({ at: e.createdAt, title: EVENT_TITLE[e.type] ?? e.type.charAt(0) + e.type.slice(1).toLowerCase().replace(/_/g, " "), detail: e.reason, actor: actor(e.actorId), tone: "info" });
  }
  for (const c of [...v.clocks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const word = c.kind === "IN" ? "clocked in" : "clocked out";
    const how = c.method === "OFFICE" ? " (entered by the office)" : c.method === "APP" ? "" : ` (${c.method.toLowerCase()})`;
    items.push({
      at: c.at,
      title: `${person(c.staffId)} ${word} at ${londonTime(c.at)}${how}${superseded.has(c.id) ? " — later corrected" : ""}`,
      detail: c.supersedesId ? `Correction: ${c.reason ?? "reason not recorded"}` : c.reason,
      actor: actor(c.recordedById),
      tone: superseded.has(c.id) ? "info" : "clock",
    });
  }
  const m = v.missedCallCase;
  if (m) {
    items.push({ at: m.detectedAt, title: "Missed call investigation opened", detail: `Stage: ${m.stage.toLowerCase().replace(/_/g, " ")}`, actor: "System", tone: "alert" });
    if (m.replacementAt) items.push({ at: m.replacementAt, title: `Replacement care recorded${m.replacementStaffId ? `: ${person(m.replacementStaffId)}` : ""}`, detail: m.replacementType ? m.replacementType.toLowerCase().replace(/_/g, " ") : null, actor: actor(m.replacementById), tone: "staff" });
    if (m.escalatedAt) items.push({ at: m.escalatedAt, title: "Escalated", detail: m.escalationNote, actor: actor(m.escalatedById), tone: "alert" });
    if (m.signedOffAt) items.push({ at: m.signedOffAt, title: "Investigation signed off", detail: m.outcome, actor: actor(m.signedOffById), tone: "status" });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  const row = toRow({ ...v, assignments: v.assignments.filter((a) => a.slot !== "SHADOW") }, lateMin, new Date(), names);
  return { row, items, missedCaseId: m?.id ?? null };
}

// ── Exports ─────────────────────────────────────────────────────────────────

export function periodLabel(f: Pick<CoverageFilters, "from" | "to">, partial: boolean) {
  const fmt = (d: string) => fmtLondonDate(d, { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(f.from)} to ${fmt(f.to)}${partial ? " (today is a partial day)" : ""}`;
}

const EXPORT_ROW_CAP = 5000;
const fmtDay = (d: string) => fmtLondonDate(d, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const dash = (s: string | null | undefined) => s || "—";

function exportVisitRow(r: CoverageRow, late: number) {
  return [
    r.reference,
    fmtDay(r.date),
    r.serviceUser,
    r.branch,
    r.area,
    r.serviceCall,
    r.scheduled,
    r.original.join(", ") || "None assigned",
    r.attendance.filter((a) => a.in).map((a) => a.name).join(", ") || "No clock-in recorded",
    r.attendance.map((a) => `${a.name}: in ${a.in ?? "—"}, out ${a.out ?? "—"}${a.corrected ? " (corrected)" : ""}`).join("; ") || "—",
    dash(r.actualIn),
    dash(r.actualOut),
    r.durationMin === null ? "—" : r.durationMin,
    r.reassigned ? "Yes" : "No",
    r.lastReplacement ? `${r.lastReplacement.from} → ${r.lastReplacement.to}` : "—",
    r.lastReplacement?.reason ?? "—",
    r.lastReplacement?.by ?? "—",
    r.lastReplacement ? `${fmtLondonDate(londonDate(r.lastReplacement.at), { day: "2-digit", month: "2-digit", year: "numeric" })} ${londonTime(r.lastReplacement.at)}` : "—",
    r.lastReplacement ? r.lastReplacement.minutesBefore : "—",
    r.late ? `Yes (under ${late} min)` : "No",
    r.changes,
    r.acknowledged,
    OUTCOME_LABEL[r.outcome],
    r.investigation ? `Missed-call case (${r.investigation.stage.toLowerCase().replace(/_/g, " ")}${r.investigation.escalated ? ", escalated" : ""})` : "—",
  ];
}

const VISIT_COLUMNS = ["Ref", "Date", "Service user", "Branch", "Area", "Service call", "Scheduled", "Original carer(s)", "Attended by", "Per-carer clocks", "Clock in", "Clock out", "Minutes", "Reassigned", "Latest change", "Reassignment reason", "Authorised by", "Reassigned at", "Minutes before start", "Late reassignment", "Staffing changes", "Acknowledged", "Outcome", "Investigation"];

/** Excel or PDF of the Coverage History, under the same scope and filters as the page. */
export async function exportCoverage(ctx: Ctx, raw: Record<string, string | string[] | undefined>, format: "xlsx" | "pdf") {
  const f = parseCoverage(raw);
  const scope = await rotaScope(ctx, "rota.view");
  const now = new Date();
  const [facts, branches, org] = await Promise.all([loadFacts(scope, f, now), authorisedBranches(scope), db.organisation.findUnique({ where: { id: scope.organisationId }, select: { name: true } })]);
  const branchName = f.branch ? branches.find((b) => b.id === f.branch)?.name ?? "No branch" : scope.branchIds ? branches.map((b) => b.name).join(", ") : "All branches";
  const s = tally(facts);
  const filtered = facts.filter((x) => (!f.day || x.date === f.day) && matchesView(x, f.view)).sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime() || a.reference.localeCompare(b.reference));
  const rows = await detailRows(scope, filtered.slice(0, EXPORT_ROW_CAP).map((x) => x.id), f.late, now, ctx);
  const generated = `${fmtLondonDate(londonDate(now), { day: "numeric", month: "long", year: "numeric" })} ${londonTime(now)}`;
  const filtersText = [f.view !== "all" ? VIEW_LABEL[f.view] : null, f.day ? `day ${fmtDay(f.day)}` : null, f.q ? `search “${f.q}”` : null, f.area ? "one area" : null, f.call ? "one service call" : null].filter(Boolean).join(", ");
  const subtitle = `${org?.name ?? ""} · ${branchName} · ${periodLabel(f, f.partial)}${filtersText ? ` · ${filtersText}` : ""} · generated ${generated}`;
  const rate = attendanceRate(s);
  const summary: [string, ExportCell][] = [
    ["Total visits", s.total],
    ["Attended", s.attended],
    ["Completed", s.completed],
    ["Without recorded attendance", s.uncovered],
    ["Cancelled", s.cancelled],
    ["Attendance rate (due, not cancelled)", rate === null ? "n/a" : `${rate}%`],
  ];
  const fullSummary: [string, ExportCell][] = [...summary, ["Missed (recorded)", s.missed], ["Not delivered (recorded)", s.notDelivered], ["No record either way", s.noRecord], ["Not yet due", s.notDue], ["Reassigned", s.reassigned], [`Late reassignments (under ${f.late} min)`, s.late]];
  const dayRows: ExportCell[][] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
    const t = tally(facts.filter((x) => x.date === d));
    dayRows.push([fmtDay(d), t.total, t.attended, t.completed, t.uncovered, t.cancelled, t.notDue, t.reassigned]);
  }
  const dayCols = ["Day", "Scheduled", "Attended", "Completed", "Without recorded attendance", "Cancelled", "Not yet due", "Reassigned"];
  const title = "Visit Coverage History";
  const capNote = filtered.length > EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} of ${filtered.length} visits. Narrow the filters for the rest.` : "";
  const stamp = `${f.from}-to-${f.to}`;
  if (format === "xlsx") {
    const { toXlsxBook } = await import("@/server/reports/export-files");
    const body = await toXlsxBook([
      { sheet: "Summary", title, subtitle, summary: fullSummary, columns: ["Term", "Definition"], rows: DEFINITIONS },
      { sheet: "Daily", title: "Daily visit coverage", subtitle, columns: dayCols, rows: dayRows },
      { sheet: "Visits", title: "Visit records", subtitle: capNote || subtitle, columns: VISIT_COLUMNS, rows: rows.map((r) => exportVisitRow(r, f.late)) },
    ]);
    return { body, name: `visit-coverage-${stamp}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
  const { toPdfReport } = await import("@/server/reports/export-files");
  const unresolved = rows.filter((r) => isUncovered(r.outcome)).slice(0, 300);
  const body = await toPdfReport({
    title,
    subtitle,
    sections: [
      { heading: "Coverage summary", note: "Each visit counts once. Attended + Without recorded attendance + Cancelled + Not yet due = Total.", summary },
      { heading: "Breakdown", summary: fullSummary.slice(6) },
      { heading: "Daily visit coverage", table: { columns: dayCols, rows: dayRows, widths: [2, 1, 1, 1, 1.6, 1, 1, 1] } },
      {
        heading: "Key unresolved visits",
        note: `Visits without recorded attendance${unresolved.length === 300 ? " (first 300)" : ""}. A missing clock is not proof that nobody attended.`,
        table: { columns: ["Ref", "Date", "Service user", "Scheduled", "Assigned carer(s)", "Reassignments", "Outcome", "Investigation"], rows: unresolved.map((r) => [r.reference, fmtDay(r.date), r.serviceUser, r.scheduled, r.current.join(", ") || r.original.join(", ") || "None", r.changes, OUTCOME_LABEL[r.outcome], r.investigation ? `${r.investigation.stage.toLowerCase().replace(/_/g, " ")}${r.investigation.escalated ? ", escalated" : ""}` : "—"]), widths: [1.2, 1.4, 2, 1.2, 2.2, 1, 1.8, 1.6] },
        empty: "None in this period.",
      },
      ...(f.view === "late" || s.late
        ? [{ heading: `Late reassignments (saved under ${f.late} minutes before the start)`, table: { columns: ["Ref", "Date", "Service user", "Scheduled", "Original", "Replacement", "Reassigned at", "Minutes before", "Outcome"], rows: rows.filter((r) => r.late && r.lastReplacement).slice(0, 300).map((r) => [r.reference, fmtDay(r.date), r.serviceUser, r.scheduled, r.lastReplacement!.from, r.lastReplacement!.to, londonTime(r.lastReplacement!.at), r.lastReplacement!.minutesBefore, OUTCOME_LABEL[r.outcome]]), widths: [1.1, 1.4, 2, 1.1, 1.6, 1.6, 1, 1, 1.6] }, empty: "None in the rows exported." } satisfies PdfSection]
        : []),
      { heading: "Report definitions", definitions: DEFINITIONS, note: capNote || undefined },
    ],
  });
  return { body, name: `visit-coverage-${stamp}.pdf`, type: "application/pdf" };
}
