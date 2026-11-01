import type { AssignmentSlot, Prisma, RiskLevel, VisitStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, daysBetween, isIsoDate, londonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { deriveFlags, suName, visitListInclude, type VisitRow } from "./queries";
import { rotaScope, visitBranchClause, visitWhere } from "./scope";
import { rotaSettings } from "./settings";

/**
 * The live Unassigned Visits list: upcoming visits with at least one empty carer place, from the same Visit records as
 * the Daily Rota. A visit counts once however many places it is short; empty places are counted separately.
 *
 * Priority is a stated scheduling rule, never a colour choice:
 * - Urgent: recorded as missed and still inside its time; or starts within 2 hours (or has already started); or the
 *   service user is rated high risk and the visit starts within 24 hours.
 * - High: starts within 24 hours, or the service user is rated high risk.
 * - Normal: everything else.
 */
export const URGENT_WITHIN_MIN = 120;
export const HIGH_WITHIN_MIN = 24 * 60;
const MAX_ROWS = 2000;

export type Priority = "URGENT" | "HIGH" | "NORMAL";
export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: "Urgent", HIGH: "High", NORMAL: "Normal" };
export const PRIORITY_RULE = "Urgent: missed and still in its time, starting within 2 hours, or a high-risk service user within 24 hours. High: starting within 24 hours or a high-risk service user. Normal: everything else.";

export function priorityOf(v: { status: VisitStatus; scheduledStart: Date; riskLevel: RiskLevel | null }, now: Date): { priority: Priority; why: string } {
  const minutes = (v.scheduledStart.getTime() - now.getTime()) / 60000;
  if (v.status === "MISSED") return { priority: "URGENT", why: "Recorded as missed and still inside its time" };
  if (minutes <= 0) return { priority: "URGENT", why: "Its start time has passed" };
  if (minutes <= URGENT_WITHIN_MIN) return { priority: "URGENT", why: "Starts within 2 hours" };
  if (v.riskLevel === "HIGH" && minutes <= HIGH_WITHIN_MIN) return { priority: "URGENT", why: "High-risk service user, starts within 24 hours" };
  if (minutes <= HIGH_WITHIN_MIN) return { priority: "HIGH", why: "Starts within 24 hours" };
  if (v.riskLevel === "HIGH") return { priority: "HIGH", why: "High-risk service user" };
  return { priority: "NORMAL", why: "More than 24 hours away" };
}

/** Why a place is empty, from the visit's own records. A removal keeps its stated reason. */
export function allocationReason(v: { carersRequired: number; rotaBuildId: string | null; templateId: string | null }, live: { slot: string }[], removed: { slot: string; removeReason: string | null; removedAt: Date | null; staffName: string }[]) {
  const filled = new Set(live.filter((a) => a.slot !== "SHADOW").map((a) => a.slot));
  const open: AssignmentSlot[] = (["PRIMARY", "SECOND"] as AssignmentSlot[]).slice(0, Math.min(2, v.carersRequired)).filter((s) => !filled.has(s));
  const lastRemoved = removed.filter((r) => open.includes(r.slot as AssignmentSlot) && r.removedAt).sort((a, b) => b.removedAt!.getTime() - a.removedAt!.getTime())[0];
  if (lastRemoved) return `${lastRemoved.staffName} removed: ${lastRemoved.removeReason ?? "reason not recorded"}`;
  if (filled.size && v.carersRequired > 1) return "Second carer needed (double-up)";
  if (v.rotaBuildId || v.templateId) return v.carersRequired > 1 ? "No carers when the rota was built" : "No carer when the rota was built";
  return "New visit, not yet allocated";
}

export const WHEN = ["today", "tomorrow", "week", "custom"] as const;
const optId = z.string().trim().max(60).optional().transform((v) => v || undefined);
export const unassignedInputSchema = z.object({
  when: z.enum(WHEN).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Older links: ?from=YYYY-MM-DD&days=N. */
  days: z.coerce.number().int().min(1).max(28).optional().catch(undefined),
  branch: optId,
  area: optId,
  call: optId,
  su: optId,
  carer: optId,
  priority: z.enum(["URGENT", "HIGH", "NORMAL"]).optional().catch(undefined),
  staffing: z.enum(["none", "partial"]).optional().catch(undefined),
  carers: z.enum(["single", "double"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  sort: z.enum(["priority", "ref", "su", "date", "duration", "carers", "call", "area"]).catch("priority"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).catch(1),
  per: z.coerce.number().int().catch(25).transform((n) => ([25, 50, 100].includes(n) ? n : 25)),
});
export type UnassignedFilters = z.output<typeof unassignedInputSchema> & { when: (typeof WHEN)[number]; from: string; to: string };

export function parseUnassigned(raw: Record<string, string | string[] | undefined>, today = londonDate()): UnassignedFilters {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const f = unassignedInputSchema.parse(flat);
  let when = f.when ?? (f.from || f.days ? "custom" : "today");
  let from = today;
  let to = today;
  if (when === "tomorrow") from = to = addDays(today, 1);
  else if (when === "week") to = addDays(today, 6);
  else if (when === "custom") {
    from = f.from && isIsoDate(f.from) ? f.from : today;
    to = f.to && isIsoDate(f.to) ? f.to : addDays(from, (f.days ?? 1) - 1);
    if (to < from) [from, to] = [to, from];
    if (daysBetween(from, to) > 27) to = addDays(from, 27);
    if (from === today && to === today) when = "today";
  }
  return { ...f, when, from, to };
}

export interface UnassignedItem {
  visit: VisitRow;
  priority: Priority;
  why: string;
  reason: string;
  openSlots: AssignmentSlot[];
}

const SORTS: Record<UnassignedFilters["sort"], (a: UnassignedItem, b: UnassignedItem) => number> = {
  priority: (a, b) => ["URGENT", "HIGH", "NORMAL"].indexOf(a.priority) - ["URGENT", "HIGH", "NORMAL"].indexOf(b.priority),
  ref: (a, b) => a.visit.reference.localeCompare(b.visit.reference),
  su: (a, b) => suName(a.visit.serviceUser).localeCompare(suName(b.visit.serviceUser)),
  date: (a, b) => a.visit.scheduledStart.getTime() - b.visit.scheduledStart.getTime(),
  duration: (a, b) => a.visit.scheduledEnd.getTime() - a.visit.scheduledStart.getTime() - (b.visit.scheduledEnd.getTime() - b.visit.scheduledStart.getTime()),
  carers: (a, b) => a.openSlots.length - b.openSlots.length,
  call: (a, b) => a.visit.callType.name.localeCompare(b.visit.callType.name),
  area: (a, b) => (a.visit.area?.name ?? "").localeCompare(b.visit.area?.name ?? ""),
};

/** Ids of visits short of a carer in a date range, worked out in the database so the list is never cut short. */
async function shortVisitIds(organisationId: string, from: string, to: string, now: Date) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT v.id FROM "Visit" v
    WHERE v."organisationId" = ${organisationId}
      AND v.date >= ${from}::date AND v.date <= ${to}::date
      AND v.status IN ('SCHEDULED', 'MISSED')
      AND v."scheduledEnd" > ${now}
      AND (SELECT count(*) FROM "VisitAssignment" a WHERE a."visitId" = v.id AND a."removedAt" IS NULL AND a.slot <> 'SHADOW') < LEAST(v."carersRequired", 2)
    ORDER BY v."scheduledStart", v.reference
    LIMIT ${MAX_ROWS + 1}`;
  return rows.map((r) => r.id);
}

export async function unassignedBoard(ctx: Ctx, f: UnassignedFilters, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.view");
  const settings = await rotaSettings(db, scope.organisationId);
  const ids = await shortVisitIds(scope.organisationId, f.from, f.to, now);
  const and: Prisma.VisitWhereInput[] = [visitWhere(scope), { id: { in: ids.slice(0, MAX_ROWS) } }];
  if (f.branch) and.push(visitBranchClause(scope, f.branch));
  if (f.area) and.push({ areaId: f.area });
  if (f.call) and.push({ callTypeId: f.call });
  if (f.su) and.push({ serviceUserId: f.su });
  if (f.carer) and.push({ assignments: { some: { staffId: f.carer, removedAt: null } } });
  if (f.q) and.push({ OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { serviceUser: { firstName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { reference: { contains: f.q, mode: "insensitive" } } }] });
  const visits = ids.length ? await db.visit.findMany({ where: { AND: and }, include: visitListInclude, orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }] }) : [];
  const removed = visits.length
    ? await db.visitAssignment.findMany({ where: { visitId: { in: visits.map((v) => v.id) }, removedAt: { not: null }, slot: { not: "SHADOW" } }, select: { visitId: true, slot: true, removeReason: true, removedAt: true, staff: { select: { displayName: true } } } })
    : [];
  let items: UnassignedItem[] = visits.map((v) => {
    const row: VisitRow = { ...v, flags: deriveFlags(v, settings, now) };
    const p = priorityOf({ status: v.status, scheduledStart: v.scheduledStart, riskLevel: v.serviceUser.riskLevel }, now);
    const filled = new Set(v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.slot));
    const openSlots = (["PRIMARY", "SECOND"] as AssignmentSlot[]).slice(0, Math.min(2, v.carersRequired)).filter((s) => !filled.has(s));
    const reason = allocationReason(v, v.assignments, removed.filter((r) => r.visitId === v.id).map((r) => ({ ...r, staffName: r.staff.displayName })));
    return { visit: row, priority: p.priority, why: p.why, reason, openSlots };
  });
  if (f.priority) items = items.filter((i) => i.priority === f.priority);
  if (f.staffing) items = items.filter((i) => (f.staffing === "none" ? i.openSlots.length === Math.min(2, i.visit.carersRequired) : i.openSlots.length < Math.min(2, i.visit.carersRequired)));
  if (f.carers) items = items.filter((i) => (f.carers === "double" ? i.visit.carersRequired > 1 : i.visit.carersRequired === 1));
  const dir = f.dir === "desc" ? -1 : 1;
  items.sort((a, b) => dir * SORTS[f.sort](a, b) || a.visit.scheduledStart.getTime() - b.visit.scheduledStart.getTime() || a.visit.reference.localeCompare(b.visit.reference));
  const summary = {
    visits: items.length,
    urgent: items.filter((i) => i.priority === "URGENT").length,
    partial: items.filter((i) => i.openSlots.length < Math.min(2, i.visit.carersRequired)).length,
    slots: items.reduce((n, i) => n + i.openSlots.length, 0),
  };
  const pages = Math.max(1, Math.ceil(items.length / f.per));
  const page = Math.min(f.page, pages);
  return { items: items.slice((page - 1) * f.per, page * f.per), all: items, summary, page, pages, truncated: ids.length > MAX_ROWS };
}

/** How many visits are short of a carer over the next seven days (for the empty-today hint). */
export async function shortCountAhead(ctx: Ctx, today = londonDate(), now = new Date()) {
  const scope = await rotaScope(ctx, "rota.view");
  const ids = await shortVisitIds(scope.organisationId, today, addDays(today, 6), now);
  if (!ids.length) return 0;
  return db.visit.count({ where: { AND: [visitWhere(scope), { id: { in: ids.slice(0, MAX_ROWS) } }] } });
}
