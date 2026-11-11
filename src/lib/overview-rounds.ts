/**
 * Today's call rounds on the Overview's Rota tile: one per call type that has visits today, in the order of its first
 * visit. Call types have no set hours, so the visits decide each round's times (as on the Daily Rota board).
 */

export type RoundState = "done" | "now" | "later" | "open";

export interface RoundVisit {
  callType: string;
  /** Minutes after London midnight. */
  start: number;
  end: number;
  status: string;
  /** True while the visit is still to be delivered and has a carer slot empty. */
  needsCarer: boolean;
}

export interface CallRound {
  name: string;
  /** "Morning call" → "Morning". */
  label: string;
  start: number;
  end: number;
  done: number;
  total: number;
  needsCarer: number;
  /**
   * done: nothing left to deliver. now: the latest round that has started and still has visits to come. later: not
   * started yet. open: started earlier and still has visits to come while a later round is under way.
   */
  state: RoundState;
}

/** Visits that are over, one way or another: nothing is left to deliver. */
const FINISHED = new Set(["COMPLETED", "NOT_DELIVERED", "MISSED"]);

export const roundName = (callType: string) => callType.replace(/\s+calls?$/i, "") || callType;

export function overviewRounds(visits: RoundVisit[], nowMinute: number): CallRound[] {
  const by = new Map<string, Omit<CallRound, "state"> & { finished: boolean }>();
  for (const v of visits) {
    let r = by.get(v.callType);
    if (!r) {
      r = { name: v.callType, label: roundName(v.callType), start: v.start, end: v.end, done: 0, total: 0, needsCarer: 0, finished: true };
      by.set(v.callType, r);
    }
    r.start = Math.min(r.start, v.start);
    r.end = Math.max(r.end, v.end);
    r.total += 1;
    if (v.status === "COMPLETED") r.done += 1;
    if (v.needsCarer) r.needsCarer += 1;
    if (!FINISHED.has(v.status)) r.finished = false;
  }
  const rounds = [...by.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const current = [...rounds].reverse().find((r) => !r.finished && r.start <= nowMinute);
  return rounds.map(({ finished, ...r }) => ({
    ...r,
    state: finished ? "done" : current && current.name === r.name ? "now" : r.start <= nowMinute ? "open" : "later",
  }));
}

/** The alert under the rounds: "1 lunch visit still needs a carer", or null when every visit is covered. */
export function coverAlert(rounds: CallRound[]): string | null {
  const short = rounds.filter((r) => r.needsCarer > 0);
  const n = short.reduce((s, r) => s + r.needsCarer, 0);
  if (!n) return null;
  const which = short.length === 1 ? `${short[0]!.label.toLowerCase()} ` : "";
  return `${n} ${which}${n === 1 ? "visit still needs" : "visits still need"} a carer`;
}

/** "Good morning" before noon, "Good afternoon" until 6pm, then "Good evening" (minutes after London midnight). */
export function greeting(minute: number) {
  return minute < 12 * 60 ? "Good morning" : minute < 18 * 60 ? "Good afternoon" : "Good evening";
}

/**
 * The Policy tile's detail line: every item when there are one or two, otherwise the two largest and "+ n more", so the
 * line is never cut off part-way through a word.
 */
export function policySummary(parts: { count: number; text: string }[]): string {
  if (parts.length <= 2) return parts.map((p) => p.text).join(", ");
  const top = [...parts].sort((a, b) => b.count - a.count).slice(0, 2);
  // Non-breaking spaces keep "+ n more" together when the line wraps.
  return `${top.map((p) => p.text).join(", ")} +\u00a0${parts.length - 2}\u00a0more`;
}
