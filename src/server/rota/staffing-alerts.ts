import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { coverBoard } from "./cover";
import { OPEN_STAGES } from "./missed-calls";
import { visitWhere, rotaScope } from "./scope";
import { parseUnassigned, unassignedBoard } from "./unassigned";

/**
 * "Coming up": staffing problems the office can fix before they happen, for the Rota Dashboard. Each alert is a count
 * from the same service as the screen its button opens (Unassigned Visits, Sickness & holiday cover, Daily Rota review,
 * Missed Calls), so the number on the dashboard is the number on the next screen. These are database rules, not AI.
 */
export interface StaffingAlert {
  key: string;
  tone: "red" | "amber" | "blue";
  count: number;
  text: string;
  why: string;
  action: string;
  href: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function staffingAlerts(ctx: Ctx, opts: { date?: string; branchId?: string } = {}, now = new Date()): Promise<StaffingAlert[]> {
  const scope = await rotaScope(ctx, "rota.view");
  const today = londonDate(now);
  const base = opts.date && opts.date >= today ? opts.date : today;
  const tomorrow = addDays(base, 1);
  const branch = opts.branchId && (!scope.branchIds || scope.branchIds.includes(opts.branchId)) ? opts.branchId : undefined;
  const keep = branch ? `&branch=${branch}` : "";
  const out: StaffingAlert[] = [];

  // 1–2. Visits short of a carer on the day after, and double-ups still missing their second carer (next two days).
  const [next, twoDays] = await Promise.all([
    unassignedBoard(ctx, parseUnassigned({ when: "custom", from: tomorrow, to: tomorrow, branch }, today), now),
    unassignedBoard(ctx, parseUnassigned({ when: "custom", from: base, to: tomorrow, branch, staffing: "partial" }, today), now),
  ]);
  if (next.summary.visits) {
    const label = tomorrow === addDays(today, 1) ? "tomorrow" : `on ${tomorrow}`;
    out.push({ key: "unassigned", tone: "red", count: next.summary.visits, text: `${next.summary.visits} ${plural(next.summary.visits, "visit", "visits")} ${label} still ${plural(next.summary.visits, "needs", "need")} a care worker`, why: `${next.summary.slots} empty carer ${plural(next.summary.slots, "place", "places")}; ${next.summary.urgent} urgent by the Unassigned Visits priority rule.`, action: "Find Cover", href: tomorrow === addDays(today, 1) ? `/rota/unassigned?when=tomorrow${keep}` : `/rota/unassigned?when=custom&from=${tomorrow}&to=${tomorrow}${keep}` });
  }
  if (twoDays.summary.visits) {
    out.push({ key: "second", tone: "amber", count: twoDays.summary.visits, text: `${twoDays.summary.visits} double-up ${plural(twoDays.summary.visits, "visit has", "visits have")} only one carer booked`, why: "These visits need two carers. Counted for the chosen day and the day after.", action: "Find Second Carer", href: `/rota/unassigned?when=custom&from=${base}&to=${tomorrow}&staffing=partial${keep}` });
  }

  // 3. Bookings with a carer who is off (approved or requested absence) or whose booking HR flagged for review.
  const cover = await coverBoard(ctx, { from: base, days: 2 }, now);
  const inBranch = branch ? new Set((await db.visit.findMany({ where: { id: { in: cover.items.map((i) => i.visit.id) }, area: { branchId: branch } }, select: { id: true } })).map((v) => v.id)) : null;
  const coverItems = inBranch ? cover.items.filter((i) => inBranch.has(i.visit.id)) : cover.items;
  if (coverItems.length) {
    const visits = new Set(coverItems.map((i) => i.visit.id)).size;
    out.push({ key: "absence", tone: "red", count: visits, text: `${visits} ${plural(visits, "visit is", "visits are")} booked with a carer who is off or needs review`, why: "From approved or requested holiday and sickness, and bookings flagged after an HR change. Nothing has been reassigned.", action: "Arrange Cover", href: `/rota/cover?from=${base}&days=2` });
  }

  // 4. Open missed-call investigations still without a replacement decision.
  const missed = await db.missedCallCase.count({ where: { organisationId: scope.organisationId, stage: { in: OPEN_STAGES }, replacementType: null, ...(scope.areaIds ? { areaId: { in: scope.areaIds } } : {}), ...(branch ? { visit: { area: { branchId: branch } } } : {}) } });
  if (missed) out.push({ key: "missed", tone: "red", count: missed, text: `${missed} missed ${plural(missed, "call has", "calls have")} no replacement or decision recorded`, why: "Open Missed Calls cases where nobody has recorded a replacement visit or why none was needed.", action: "Open Missed Calls", href: "/rota/missed" });

  // 5. Carers booked beyond their own weekly hours limit this week (limits set on each team member's rota profile).
  const wk = mondayOf(base);
  const limited = await db.rotaStaffProfile.findMany({ where: { organisationId: scope.organisationId, maxWeeklyMinutes: { not: null }, ...(branch ? { staff: { branchId: branch } } : scope.branchIds ? { staff: { branchId: { in: scope.branchIds } } } : {}) }, select: { staffId: true, maxWeeklyMinutes: true } });
  if (limited.length) {
    const minutes = await bookedMinutes(scope.organisationId, limited.map((l) => l.staffId), wk);
    const over = limited.filter((l) => (minutes.get(l.staffId) ?? 0) > (l.maxWeeklyMinutes ?? Infinity)).length;
    if (over) out.push({ key: "hours", tone: "amber", count: over, text: `${over} ${plural(over, "carer is", "carers are")} booked over their weekly hours limit`, why: `Booked time in the week of ${wk} compared with the limit on each person's rota profile.`, action: "Review Hours", href: `/rota/reports?report=people&from=${wk}&to=${addDays(wk, 6)}` });
  }

  // 6. Today's bookings flagged for review (HR or absence changes) — the Daily Rota's own review view.
  const review = await db.visit.count({ where: { AND: [visitWhere(scope), { date: dbDate(base), status: { not: "CANCELLED" }, assignments: { some: { removedAt: null, reviewReason: { not: null } } }, ...(branch ? { area: { branchId: branch } } : {}) }] } });
  if (review) out.push({ key: "review", tone: "amber", count: review, text: `${review} ${plural(review, "booking", "bookings")} on this day ${plural(review, "needs", "need")} checking after a staff change`, why: "Flagged automatically when HR, readiness or absence records change. The carer stays booked until you decide.", action: "Review Bookings", href: `/rota/visits?date=${base}&view=review${keep}` });

  return out;
}

async function bookedMinutes(organisationId: string, staffIds: string[], monday: string) {
  const rows = await db.visitAssignment.findMany({ where: { organisationId, staffId: { in: staffIds }, removedAt: null, slot: { not: "SHADOW" }, startsAt: { gte: londonToUtc(monday, 0), lt: londonToUtc(addDays(monday, 7), 0) }, visit: { status: { not: "CANCELLED" } } }, select: { staffId: true, startsAt: true, endsAt: true } });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.staffId, (m.get(r.staffId) ?? 0) + (r.endsAt.getTime() - r.startsAt.getTime()) / 60000);
  return m;
}
