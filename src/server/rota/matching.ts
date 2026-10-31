import type { Prisma } from "@prisma/client";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";

/**
 * Best-match carer ranking. The shared eligibility service decides who MAY do a visit (hard rules: HR checks,
 * readiness, absence, clashes, blocked preferences). This module only orders the people it allows, with a score from
 * recorded facts and a plain explanation of every point. A score never turns a "not eligible" carer into an option.
 *
 * Weights are fixed and documented here (docs/implementation/ROTA_MATCHING_ENGINE.md). Travel is not scored: without a
 * routing provider the platform only knows the gap between bookings, which is shown as a time-gap check, never as a
 * journey time.
 */
export const MATCH_WEIGHTS = {
  /** Starting points by eligibility state. */
  eligible: 50,
  review: 25,
  /** Per visit with this service user in the last 8 weeks, up to the cap. */
  continuityPerVisit: 3,
  continuityCap: 24,
  /** The carer works in the visit's area. */
  sameArea: 10,
  /** Service user's rating of the carer, 1–5: (rating − 3) × this. */
  ratingStep: 4,
  /** Booked hours in the visit's week stay within the carer's weekly limit with this visit added. */
  withinHours: 6,
  /** This visit would take the carer over their weekly limit. */
  overHours: -15,
  /** Less than this many minutes between this visit and the carer's previous or next booking. */
  tightGapMinutes: 15,
  tightGap: -8,
} as const;

export interface MatchFacts {
  continuity: Map<string, number>;
  areas: Map<string, Set<string>>;
  ratings: Map<string, number>;
  weekMinutes: Map<string, number>;
  maxWeekly: Map<string, number | null>;
  day: Map<string, { start: Date; end: Date; visitId: string }[]>;
}

type Db = Prisma.TransactionClient | { [K in keyof Prisma.TransactionClient]: Prisma.TransactionClient[K] };

/** Loads the facts the score uses for a set of carers and one visit, in five indexed queries. */
export async function loadMatchFacts(tx: Db, organisationId: string, staffIds: string[], visit: { id?: string | null; serviceUserId: string; start: Date; end: Date }): Promise<MatchFacts> {
  const date = londonDate(visit.start);
  const weekStart = mondayOf(date);
  const [history, areas, prefs, week, profiles] = await Promise.all([
    tx.visitAssignment.groupBy({
      by: ["staffId"],
      where: { organisationId, staffId: { in: staffIds }, slot: { not: "SHADOW" }, visit: { serviceUserId: visit.serviceUserId, status: { not: "CANCELLED" }, date: { gte: dbDate(addDays(date, -56)), lt: dbDate(date) } } },
      _count: { _all: true },
    }),
    tx.staffArea.findMany({ where: { organisationId, staffId: { in: staffIds } }, select: { staffId: true, areaId: true } }),
    tx.carerPreference.findMany({ where: { organisationId, serviceUserId: visit.serviceUserId, staffId: { in: staffIds } }, select: { staffId: true, rating: true } }),
    tx.visitAssignment.findMany({
      where: { organisationId, staffId: { in: staffIds }, removedAt: null, slot: { not: "SHADOW" }, startsAt: { gte: londonToUtc(weekStart, 0), lt: londonToUtc(addDays(weekStart, 7), 0) }, visit: { status: { not: "CANCELLED" } } },
      select: { staffId: true, visitId: true, startsAt: true, endsAt: true },
    }),
    tx.rotaStaffProfile.findMany({ where: { organisationId, staffId: { in: staffIds } }, select: { staffId: true, maxWeeklyMinutes: true } }),
  ]);
  const f: MatchFacts = { continuity: new Map(), areas: new Map(), ratings: new Map(), weekMinutes: new Map(), maxWeekly: new Map(), day: new Map() };
  for (const h of history) f.continuity.set(h.staffId, h._count._all);
  for (const a of areas) f.areas.set(a.staffId, (f.areas.get(a.staffId) ?? new Set()).add(a.areaId));
  for (const p of prefs) if (p.rating != null) f.ratings.set(p.staffId, p.rating);
  for (const p of profiles) f.maxWeekly.set(p.staffId, p.maxWeeklyMinutes);
  for (const w of week) {
    if (w.visitId === visit.id) continue;
    f.weekMinutes.set(w.staffId, (f.weekMinutes.get(w.staffId) ?? 0) + (w.endsAt.getTime() - w.startsAt.getTime()) / 60000);
    if (londonDate(w.startsAt) === date) f.day.set(w.staffId, [...(f.day.get(w.staffId) ?? []), { start: w.startsAt, end: w.endsAt, visitId: w.visitId }]);
  }
  return f;
}

export interface Match {
  score: number | null;
  /** Each point with its effect, e.g. "+12 supported this person 4 times in 8 weeks". */
  explain: { points: number; text: string }[];
  continuity: number;
  weekHours: number;
}

/** Pure scoring, unit-tested directly. Not eligible means no score. */
export function scoreMatch(state: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE", staffId: string, visit: { areaId: string | null; start: Date; end: Date }, f: MatchFacts): Match {
  const W = MATCH_WEIGHTS;
  const continuity = f.continuity.get(staffId) ?? 0;
  const booked = f.weekMinutes.get(staffId) ?? 0;
  const out: Match = { score: null, explain: [], continuity, weekHours: Math.round((booked / 60) * 10) / 10 };
  if (state === "NOT_ELIGIBLE") return out;
  const add = (points: number, text: string) => out.explain.push({ points, text });
  add(state === "ELIGIBLE" ? W.eligible : W.review, state === "ELIGIBLE" ? "passes every check" : "allowed, with warnings to read");
  if (continuity) add(Math.min(continuity * W.continuityPerVisit, W.continuityCap), `supported this person ${continuity} time${continuity === 1 ? "" : "s"} in the last 8 weeks`);
  if (visit.areaId && f.areas.get(staffId)?.has(visit.areaId)) add(W.sameArea, "works in this area");
  const rating = f.ratings.get(staffId);
  if (rating != null && rating !== 3) add((rating - 3) * W.ratingStep, `service user's rating ${rating} of 5`);
  const minutes = (visit.end.getTime() - visit.start.getTime()) / 60000;
  const limit = f.maxWeekly.get(staffId);
  if (limit) {
    if (booked + minutes > limit) add(W.overHours, `would reach ${((booked + minutes) / 60).toFixed(1)} h, over their ${(limit / 60).toFixed(0)} h weekly limit`);
    else add(W.withinHours, `${((booked + minutes) / 60).toFixed(1)} of ${(limit / 60).toFixed(0)} h this week`);
  }
  const gaps = (f.day.get(staffId) ?? []).map((b) => (b.end <= visit.start ? (visit.start.getTime() - b.end.getTime()) / 60000 : b.start >= visit.end ? (b.start.getTime() - visit.end.getTime()) / 60000 : 0));
  const tight = gaps.filter((g) => g < W.tightGapMinutes);
  if (tight.length) add(W.tightGap, `only ${Math.round(Math.min(...tight))} min between this and another booking (time gap, not a travel time)`);
  out.score = Math.max(0, Math.min(100, out.explain.reduce((s, e) => s + e.points, 0)));
  return out;
}
