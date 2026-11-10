import { isCarerPlace, openPlaces, placeKey, type PlaceKey } from "@/lib/carer-places";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { londonMinute, londonTime } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { loadMatchFacts, scoreMatch } from "./matching";
import { suName, type VisitRow } from "./queries";
import { getVisit } from "./visits";

/**
 * The day by team member, shared by the Advanced Rota planner and the Daily Rota Board (approved redesign,
 * 10 Nov 2026) so both group, count and allow moves in exactly the same way. Moves themselves go through
 * `assignCarerAction` → `assignCarer`, which runs the eligibility service; nothing here changes a booking.
 */

export interface StaffDayItem {
  visit: VisitRow;
  place: PlaceKey;
  shadow: boolean;
}
export interface StaffDay {
  staffId: string;
  name: string;
  items: StaffDayItem[];
  /** Booked minutes, not counting shadows or cancelled visits. */
  minutes: number;
  /** Visits counted the same way. */
  visits: number;
  areas: Map<string, number>;
}

/** Visits still short of a carer (not cancelled), with the first open place a dragged carer would fill. */
export function needsCarer(visits: VisitRow[]) {
  return visits.filter((v) => v.flags.unassignedSlots > 0 && v.status !== "CANCELLED").map((v) => ({ visit: v, place: (openPlaces(v.carersRequired, v.assignments)[0] ?? "PRIMARY") as PlaceKey }));
}

/** One entry per team member booked on any of the visits, with their bookings. */
export function staffDay(visits: VisitRow[]): StaffDay[] {
  const by = new Map<string, StaffDay>();
  for (const v of visits) {
    for (const a of v.assignments) {
      const r = by.get(a.staffId) ?? { staffId: a.staffId, name: a.staff.displayName, items: [], minutes: 0, visits: 0, areas: new Map<string, number>() };
      const shadow = a.slot === "SHADOW";
      r.items.push({ visit: v, place: placeKey(a), shadow });
      if (v.status !== "CANCELLED" && !shadow) {
        r.minutes += (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000;
        r.visits += 1;
      }
      const area = v.area?.name ?? "No area";
      r.areas.set(area, (r.areas.get(area) ?? 0) + 1);
      by.set(a.staffId, r);
    }
  }
  return [...by.values()];
}

/** A visit can be dragged to another team member while it can still be allocated. */
export const canMove = (v: Pick<VisitRow, "status">, canEdit: boolean) => canEdit && (v.status === "SCHEDULED" || v.status === "MISSED");

/**
 * A drag that came back needing confirmation carries the move in the address (`visitId~place~staffId~lockVersion`).
 * Only a visit already on the page and a team member the caller can see are accepted.
 */
export function pendingMove(raw: string | undefined, visits: VisitRow[], staff: { id: string; displayName: string }[]) {
  const [visitId, slot, staffId, lockVersion] = (raw ?? "").split("~");
  const v = visits.find((x) => x.id === visitId);
  const st = staff.find((x) => x.id === staffId);
  if (!v || !st || !slot || !lockVersion) return null;
  return { visitId: v.id, slot, staffId: st.id, lockVersion, label: `${suName(v.serviceUser)} at ${londonTime(v.scheduledStart)}`, staff: st.displayName };
}

const OUTCOME_WORD: Record<string, string> = { DONE: "Done", NOT_DONE: "Not done", REFUSED: "Refused", UNABLE: "Unable", NOT_APPLICABLE: "Not needed", CONCERN: "Concern raised" };

export interface DrawerCarer {
  name: string;
  /** What the eligibility service decided when this carer was booked. */
  eligibility: string | null;
  /** Warnings the coordinator accepted at booking, word for word. */
  warningsAccepted: string[];
  /** A review flag on the booking (for example after an HR change). */
  review: string | null;
  /** The matching service's reasons, each with its points. */
  match: { points: number; text: string }[];
}

export interface VisitDrawer {
  id: string;
  tasks: { name: string; outcome: string | null }[];
  /** One entry per booked carer (not shadows) with something real to say; empty when there is nothing. */
  why: DrawerCarer[];
}

/**
 * What the Board's visit drawer shows beyond the block itself: the visit's care tasks and, for each booked carer,
 * "Why this carer" from what the eligibility service recorded at booking and the matching service's reasons now.
 * Scoped by `getVisit` (organisation, branches, areas and rota.view); a visit the caller may not see returns null.
 */
export async function visitDrawer(ctx: Ctx, visitId: string): Promise<VisitDrawer | null> {
  let v: Awaited<ReturnType<typeof getVisit>>;
  try {
    v = await getVisit(ctx, visitId);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
  const live = v.assignments.filter((a) => !a.removedAt && isCarerPlace(a));
  const facts = live.length ? await loadMatchFacts(db, v.organisationId, live.map((a) => a.staffId), { id: v.id, serviceUserId: v.serviceUserId, start: v.scheduledStart, end: v.scheduledEnd }) : null;
  const why: DrawerCarer[] = [];
  for (const a of live) {
    const state = a.eligibility === "ELIGIBLE" || a.eligibility === "REQUIRES_REVIEW" || a.eligibility === "NOT_ELIGIBLE" ? a.eligibility : null;
    // The match score is only meaningful for a carer the eligibility service allowed.
    const match = state && facts ? scoreMatch(state, a.staffId, { areaId: v.areaId, start: v.scheduledStart, end: v.scheduledEnd }, facts).explain : [];
    const entry: DrawerCarer = { name: a.staff.displayName, eligibility: state, warningsAccepted: a.warningsAccepted ?? [], review: a.reviewReason ?? null, match };
    if (entry.eligibility || entry.warningsAccepted.length || entry.review || entry.match.length) why.push(entry);
  }
  return {
    id: v.id,
    tasks: v.tasks.map((t) => ({ name: t.name, outcome: t.outcomes[0] ? (OUTCOME_WORD[t.outcomes[0].outcome] ?? t.outcomes[0].outcome) : null })),
    why,
  };
}

/** Minute of the day for a visit, for the board. */
export const startMinute = (v: Pick<VisitRow, "scheduledStart">) => londonMinute(v.scheduledStart);
export const durationMin = (v: Pick<VisitRow, "scheduledStart" | "scheduledEnd">) => Math.max(0, Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000));
