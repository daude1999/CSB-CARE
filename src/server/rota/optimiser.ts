/**
 * Generate & Optimise: the pure allocation core. It is deterministic (same input, same plan) and bounded (a fixed
 * budget of checks), and it only ever chooses among carers the eligibility service has already allowed. A suitability
 * score orders allowed carers; it never turns a "not eligible" carer into an option.
 *
 * Gaps between visits are judged by a TravelTimeProvider. The only provider today is time-gap mode: a fixed minimum
 * gap between one visit's end and the next visit's start. It does not know distances or driving times, and the plan
 * says so; a routing provider can be plugged in later behind the same interface.
 */

export interface Stop {
  visitId: string;
  serviceUserId: string;
  start: Date;
  end: Date;
}

export interface TravelTimeProvider {
  /** What the coordinator is told about how gaps are judged. */
  readonly label: string;
  readonly mode: "TIME_GAP";
  /** Minutes the carer needs between `from` ending and `to` starting. */
  minutesBetween(from: Stop, to: Stop): number;
}

/** A fixed minimum gap. Visits for the same person back to back need no gap. */
export function timeGapProvider(gapMinutes: number): TravelTimeProvider {
  return {
    mode: "TIME_GAP",
    label: `Time-gap mode: at least ${gapMinutes} minutes between one visit ending and the next starting. No distances or driving times are used.`,
    minutesBetween: (from, to) => (from.serviceUserId === to.serviceUserId ? 0 : gapMinutes),
  };
}

export interface CandidateIn {
  staffId: string;
  name: string;
  state: "ELIGIBLE" | "REQUIRES_REVIEW";
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface SlotIn {
  visitId: string;
  slot: "PRIMARY" | "SECOND";
  serviceUserId: string;
  label: string;
  start: Date;
  end: Date;
  /** The time may not change (time-locked, or another carer is already on the visit). */
  fixedTime: boolean;
  lockVersion: number;
  candidates: CandidateIn[];
}

export interface Booking extends Stop {
  /** Bookings already on the rota cannot be moved by the optimiser. */
  fixed: boolean;
}

export interface OptimiseInput {
  slots: SlotIn[];
  /** Live bookings per carer (already on the rota). */
  bookings: Map<string, Booking[]>;
  /** Minutes booked per carer per week (key `${staffId}|${monday}`), and each carer's weekly limit. */
  weekMinutes: Map<string, number>;
  maxWeekly: Map<string, number | null>;
  weekOf: (d: Date) => string;
  travel: TravelTimeProvider;
  /** Largest time adjustment, in minutes either way (0 turns it off). */
  maxShiftMinutes: number;
  respectWeeklyLimits: boolean;
  /** Upper bound on fit checks; the loop stops when it is spent. */
  budget?: number;
}

export interface Proposal {
  visitId: string;
  slot: "PRIMARY" | "SECOND";
  staffId: string;
  name: string;
  state: CandidateIn["state"];
  score: number;
  reasons: string[];
  warnings: string[];
  lockVersion: number;
  /** Set when the visit's time must move for this carer to fit. */
  retime: { fromStart: Date; fromEnd: Date; toStart: Date; toEnd: Date } | null;
  /** Filled in the improvement pass by moving another proposed booking. */
  viaSwap: boolean;
}

export interface Unfilled {
  visitId: string;
  slot: "PRIMARY" | "SECOND";
  label: string;
  start: Date;
  reason: string;
}

export interface OptimiseResult {
  proposals: Proposal[];
  unfilled: Unfilled[];
  checks: number;
  budgetSpent: boolean;
  passes: number;
}

const MIN = 60_000;
const SHIFT_STEP = 5;

interface Placed extends Booking {
  slotKey: string | null;
}

function overlapsWithGap(a: Stop, b: Stop, travel: TravelTimeProvider) {
  if (a.end <= b.start) return b.start.getTime() - a.end.getTime() < travel.minutesBetween(a, b) * MIN;
  if (b.end <= a.start) return a.start.getTime() - b.end.getTime() < travel.minutesBetween(b, a) * MIN;
  return true;
}

/** The order the shift steps are tried in: smallest change first, earlier before later. */
export function shiftSteps(max: number) {
  const out: number[] = [];
  for (let m = SHIFT_STEP; m <= max; m += SHIFT_STEP) out.push(-m, m);
  return out;
}

export function optimise(input: OptimiseInput): OptimiseResult {
  const budget = input.budget ?? 50_000;
  let checks = 0;
  const spent = () => checks >= budget;
  const placed = new Map<string, Placed[]>();
  for (const [staffId, list] of input.bookings) placed.set(staffId, list.map((b) => ({ ...b, slotKey: null })));
  const week = new Map(input.weekMinutes);
  const key = (s: Pick<SlotIn, "visitId" | "slot">) => `${s.visitId}:${s.slot}`;
  const minutes = (s: Stop) => (s.end.getTime() - s.start.getTime()) / MIN;
  const onVisit = new Map<string, Set<string>>();

  /** Who blocks this carer at this time: null when free; otherwise the clashing bookings. */
  function clashes(staffId: string, stop: Stop): Placed[] {
    checks++;
    return (placed.get(staffId) ?? []).filter((b) => b.visitId !== stop.visitId && overlapsWithGap(b, stop, input.travel));
  }
  function withinHours(staffId: string, stop: Stop, ignore = 0) {
    if (!input.respectWeeklyLimits) return true;
    const limit = input.maxWeekly.get(staffId);
    if (!limit) return true;
    return (week.get(`${staffId}|${input.weekOf(stop.start)}`) ?? 0) - ignore + minutes(stop) <= limit;
  }
  function place(s: SlotIn, staffId: string, stop: Stop) {
    placed.set(staffId, [...(placed.get(staffId) ?? []), { ...stop, fixed: false, slotKey: key(s) }]);
    const wk = `${staffId}|${input.weekOf(stop.start)}`;
    week.set(wk, (week.get(wk) ?? 0) + minutes(stop));
    onVisit.set(s.visitId, (onVisit.get(s.visitId) ?? new Set()).add(staffId));
  }
  function unplace(s: SlotIn, staffId: string, stop: Stop) {
    placed.set(staffId, (placed.get(staffId) ?? []).filter((b) => b.slotKey !== key(s)));
    const wk = `${staffId}|${input.weekOf(stop.start)}`;
    week.set(wk, (week.get(wk) ?? 0) - minutes(stop));
    onVisit.get(s.visitId)?.delete(staffId);
  }
  /** The visit's time as planned so far (a double-up's two slots move together). */
  const timeOf = new Map<string, Stop>();
  const stopFor = (s: SlotIn): Stop => timeOf.get(s.visitId) ?? { visitId: s.visitId, serviceUserId: s.serviceUserId, start: s.start, end: s.end };

  function fits(s: SlotIn, c: CandidateIn, stop: Stop) {
    if (onVisit.get(s.visitId)?.has(c.staffId)) return false;
    return withinHours(c.staffId, stop) && clashes(c.staffId, stop).length === 0;
  }

  const proposals = new Map<string, Proposal>();
  const propose = (s: SlotIn, c: CandidateIn, stop: Stop, viaSwap = false) => {
    place(s, c.staffId, stop);
    const moved = stop.start.getTime() !== s.start.getTime();
    if (moved) timeOf.set(s.visitId, stop);
    proposals.set(key(s), { visitId: s.visitId, slot: s.slot, staffId: c.staffId, name: c.name, state: c.state, score: c.score, reasons: c.reasons, warnings: c.warnings, lockVersion: s.lockVersion, retime: moved ? { fromStart: s.start, fromEnd: s.end, toStart: stop.start, toEnd: stop.end } : null, viaSwap });
  };
  /** Best-first: passing every check before needing review, then score, then name (deterministic). */
  const ranked = (s: SlotIn) => [...s.candidates].sort((a, b) => (a.state === b.state ? 0 : a.state === "ELIGIBLE" ? -1 : 1) || b.score - a.score || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));

  // Hardest first: the slots with the fewest allowed carers, then the earliest.
  const order = [...input.slots].sort((a, b) => a.candidates.length - b.candidates.length || a.start.getTime() - b.start.getTime() || key(a).localeCompare(key(b)));

  // Pass 1: at the booked time.
  let passes = 1;
  for (const s of order) {
    if (spent()) break;
    const stop = stopFor(s);
    const c = ranked(s).find((x) => fits(s, x, stop));
    if (c) propose(s, c, stop);
  }

  // Pass 2: small time adjustments for what is left, smallest change first. A double-up whose other slot is already
  // proposed keeps that time.
  if (input.maxShiftMinutes > 0 && !spent()) {
    passes++;
    for (const s of order) {
      if (spent()) break;
      if (proposals.has(key(s)) || s.fixedTime || timeOf.has(s.visitId) || [...proposals.values()].some((p) => p.visitId === s.visitId)) continue;
      outer: for (const shift of shiftSteps(input.maxShiftMinutes)) {
        const stop: Stop = { visitId: s.visitId, serviceUserId: s.serviceUserId, start: new Date(s.start.getTime() + shift * MIN), end: new Date(s.end.getTime() + shift * MIN) };
        for (const c of ranked(s)) {
          if (spent()) break outer;
          if (fits(s, c, stop)) {
            propose(s, c, stop);
            break outer;
          }
        }
      }
    }
  }

  // Pass 3: one-step swaps. A carer blocked only by a booking this plan proposed can take the slot if that booking
  // can go to someone else at its time.
  if (!spent()) {
    passes++;
    for (const s of order) {
      if (spent()) break;
      if (proposals.has(key(s))) continue;
      const stop = stopFor(s);
      swap: for (const c of ranked(s)) {
        if (onVisit.get(s.visitId)?.has(c.staffId) || !withinHours(c.staffId, stop)) continue;
        const block = clashes(c.staffId, stop);
        if (block.length !== 1 || block[0]!.fixed || !block[0]!.slotKey) continue;
        const otherKey = block[0]!.slotKey;
        const other = input.slots.find((x) => key(x) === otherKey);
        const prev = proposals.get(otherKey);
        if (!other || !prev || prev.retime) continue;
        const otherStop = stopFor(other);
        unplace(other, c.staffId, otherStop);
        for (const alt of ranked(other)) {
          if (spent()) break;
          if (alt.staffId === c.staffId) continue;
          if (fits(other, alt, otherStop)) {
            propose(other, alt, otherStop, true);
            if (fits(s, c, stop)) {
              propose(s, c, stop, true);
              break swap;
            }
            unplace(other, alt.staffId, otherStop);
          }
        }
        // Put the original booking back.
        if (!proposals.has(key(s))) {
          const orig = other.candidates.find((x) => x.staffId === prev.staffId)!;
          propose(other, orig, otherStop, prev.viaSwap);
        }
      }
    }
  }

  const unfilled: Unfilled[] = [];
  for (const s of order) {
    if (proposals.has(key(s))) continue;
    const reason = !s.candidates.length
      ? "No carer passes the eligibility checks for this visit"
      : input.respectWeeklyLimits && s.candidates.every((c) => !withinHours(c.staffId, stopFor(s)))
        ? "Every allowed carer would go over their weekly hours"
        : spent()
          ? "Stopped before this visit: the check budget was used up"
          : `All ${s.candidates.length} allowed carer${s.candidates.length === 1 ? " is" : "s are"} booked too close to this time${s.fixedTime || input.maxShiftMinutes === 0 ? "" : `, even moving it up to ${input.maxShiftMinutes} minutes`}`;
    unfilled.push({ visitId: s.visitId, slot: s.slot, label: s.label, start: s.start, reason });
  }
  const proposalList = order.map((s) => proposals.get(key(s))).filter((p): p is Proposal => !!p);
  proposalList.sort((a, b) => (a.retime?.toStart ?? input.slots.find((s) => s.visitId === a.visitId)!.start).getTime() - (b.retime?.toStart ?? input.slots.find((s) => s.visitId === b.visitId)!.start).getTime() || a.visitId.localeCompare(b.visitId) || a.slot.localeCompare(b.slot));
  return { proposals: proposalList, unfilled, checks, budgetSpent: spent(), passes };
}
