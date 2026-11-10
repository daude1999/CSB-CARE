/**
 * Time maths for the Daily Rota Board (approved redesign, 10 Nov 2026). Pure functions shared by the page (which
 * works out the day) and the board component (which draws it), so they are unit-tested without a browser.
 *
 * Minutes are minutes after midnight, Europe/London, as `londonMinute` gives them.
 */

/** A stretch of the day with no visits longer than this is folded into a narrow divider. */
export const FOLD_AFTER_MIN = 90;
/** Width of a folded stretch on the board, in pixels. */
export const FOLD_PX = 22;

export interface Segment {
  from: number;
  to: number;
  folded: boolean;
}

const floorTo = (m: number, step: number) => Math.floor(m / step) * step;
const ceilTo = (m: number, step: number) => Math.ceil(m / step) * step;

/**
 * The day as open and folded segments. The day runs from the hour before the first visit to the hour after the last
 * (07:00 to 22:00 when there are no visits). Busy times are merged; a gap between them of more than
 * FOLD_AFTER_MIN minutes is folded, keeping the half hour on either side of the visits open so they stay readable.
 */
export function daySegments(spans: { start: number; end: number }[], empty = { from: 7 * 60, to: 22 * 60 }): Segment[] {
  const valid = spans.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end)).map((s) => ({ start: s.start, end: Math.max(s.end, s.start + 1) }));
  if (!valid.length) return [{ from: empty.from, to: empty.to, folded: false }];
  valid.sort((a, b) => a.start - b.start);
  const busy: { start: number; end: number }[] = [];
  for (const s of valid) {
    const last = busy[busy.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else busy.push({ ...s });
  }
  const from = Math.max(0, floorTo(busy[0]!.start, 60));
  const to = Math.min(24 * 60, ceilTo(busy[busy.length - 1]!.end, 60));
  const out: Segment[] = [];
  let cursor = from;
  for (let i = 0; i < busy.length - 1; i++) {
    const gapStart = busy[i]!.end;
    const gapEnd = busy[i + 1]!.start;
    if (gapEnd - gapStart <= FOLD_AFTER_MIN) continue;
    const foldFrom = ceilTo(gapStart, 30);
    const foldTo = floorTo(gapEnd, 30);
    if (foldTo - foldFrom <= 0) continue;
    if (foldFrom > cursor) out.push({ from: cursor, to: foldFrom, folded: false });
    out.push({ from: foldFrom, to: foldTo, folded: true });
    cursor = foldTo;
  }
  if (to > cursor) out.push({ from: cursor, to, folded: false });
  return out;
}

/** Minutes of the day shown at full width. */
export const openMinutes = (segments: Segment[]) => segments.filter((s) => !s.folded).reduce((n, s) => n + (s.to - s.from), 0);

/**
 * A function from minute of the day to pixels, for a track of the given pixel width. Open minutes share the width
 * left after the folded dividers; a minute inside a folded stretch sits proportionally inside its divider.
 */
export function scaleFor(segments: Segment[], trackPx: number, minPxPerMin = 1.6) {
  const folds = segments.filter((s) => s.folded).length;
  const open = Math.max(1, openMinutes(segments));
  const pxPerMin = Math.max(minPxPerMin, (trackPx - folds * FOLD_PX) / open);
  const width = open * pxPerMin + folds * FOLD_PX;
  const x = (m: number) => {
    let px = 0;
    for (const s of segments) {
      const size = s.folded ? FOLD_PX : (s.to - s.from) * pxPerMin;
      if (m <= s.from) return px;
      if (m < s.to) return px + (s.folded ? ((m - s.from) / (s.to - s.from)) * FOLD_PX : (m - s.from) * pxPerMin);
      px += size;
    }
    return px;
  };
  return { x, width, pxPerMin };
}

/** Whole hours inside open segments, for the hour labels. */
export function hourMarks(segments: Segment[]) {
  const out: number[] = [];
  for (const s of segments) if (!s.folded) for (let h = ceilTo(s.from, 60); h < s.to; h += 60) out.push(h);
  return out;
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

/** "45m", "1h", "1h 15m". */
export const shortDuration = (min: number) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`);

/** Initials from a name: "Margaret Ellison" → "ME". */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

/**
 * The organisation's call rounds on the day: one per call type with visits, from its first visit's start to its last
 * visit's end, in order of the first visit. Call types have no set hours, so the visits decide the times.
 */
export function callRounds(visits: { callType: string; start: number; end: number }[]) {
  const by = new Map<string, { name: string; start: number; end: number }>();
  for (const v of visits) {
    const r = by.get(v.callType);
    if (!r) by.set(v.callType, { name: v.callType, start: v.start, end: v.end });
    else {
      r.start = Math.min(r.start, v.start);
      r.end = Math.max(r.end, v.end);
    }
  }
  return [...by.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

/** "Morning call" → "Morning"; used for the round labels above the hours. */
export const roundLabel = (name: string) => name.replace(/\s+calls?$/i, "") || name;

/** Visits stacked into lanes so overlapping visits in one row never hide each other. */
export function lanes<T extends { startMin: number; endMin: number }>(items: T[]) {
  const ends: number[] = [];
  const placed = [...items]
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
    .map((item) => {
      let lane = ends.findIndex((e) => e <= item.startMin);
      if (lane === -1) lane = ends.length;
      ends[lane] = item.endMin;
      return { item, lane };
    });
  return { placed, count: Math.max(1, ends.length) };
}
