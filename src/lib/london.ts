/**
 * Calendar arithmetic for Europe/London. Visits are planned in local wall-clock time and stored as UTC instants,
 * so a 08:00 call stays at 08:00 on both sides of a clock change. Dates are "YYYY-MM-DD" strings in local time.
 */
const TZ = "Europe/London";

const partsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function parts(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) if (type !== "literal") p[type] = Number(value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Minutes London is ahead of UTC at this instant (0 in winter, 60 in summer). */
function offsetMinutes(d: Date) {
  const p = parts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

export function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** The London calendar date of an instant. */
export function londonDate(d: Date = new Date()) {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes after local midnight of an instant. */
export function londonMinute(d: Date) {
  const p = parts(d);
  return p.hour * 60 + p.minute;
}

/**
 * The UTC instant of a London wall-clock time. `minute` may exceed 1440 for visits that run past midnight.
 * In the spring-forward gap (01:00–02:00 does not exist) the time moves forward an hour; in the autumn overlap the
 * first (summer-time) occurrence is used.
 */
export function londonToUtc(date: string, minute: number): Date {
  const dayOffset = Math.floor(minute / 1440);
  const local = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + dayOffset, 0, minute - dayOffset * 1440);
  // Try both possible offsets; keep the one that maps back to the requested wall-clock time.
  for (const off of [60, 0]) {
    const guess = new Date(local - off * 60000);
    if (offsetMinutes(guess) === off) return guess;
  }
  // Spring-forward gap: use the offset in force before the change, which lands an hour later on the clock.
  return new Date(local - offsetMinutes(new Date(local - 86400000)) * 60000);
}

/** Adds whole days to a date string. */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a date string: 1 Monday … 7 Sunday. */
export function isoWeekday(date: string) {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday on or before a date. */
export function mondayOf(date: string) {
  return addDays(date, 1 - isoWeekday(date));
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** A Prisma @db.Date value for a date string, and back. */
export function dbDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}
export function fromDbDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** The cycle week (1…cycleLength) of the week starting `monday`, counted from an anchor Monday that is Week 1. */
export function cycleWeekOf(monday: string, anchorMonday: string, cycleLength: number) {
  const weeks = Math.floor(daysBetween(anchorMonday, monday) / 7);
  return (((weeks % cycleLength) + cycleLength) % cycleLength) + 1;
}

export function hhmm(minute: number) {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "08:30" → 510. Returns null for anything that is not a valid 24-hour time. */
export function parseHhmm(s: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Local time of an instant as "HH:MM". */
export function londonTime(d: Date) {
  return hhmm(londonMinute(d));
}

/** The UTC instants bounding a London calendar day (23, 24 or 25 hours long). */
export function londonDayBounds(date: string) {
  return { start: londonToUtc(date, 0), end: londonToUtc(addDays(date, 1), 0) };
}

export function fmtLondonDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
