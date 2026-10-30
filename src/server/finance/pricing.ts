import type { RateBand } from "@prisma/client";

/**
 * Pricing for invoices and pay. Pure functions: no database access, so they are unit-tested directly.
 * Money is whole pence. Hourly work is split at midnight and at band boundaries and each stretch is priced at its
 * own band (see splitWork); a per-visit band prices the visit once by its London start time. A bank-holiday band
 * wins on a bank holiday. Where several bands match, the narrowest time window wins, so a "weekday evening" band
 * overrides a "weekday all day" band.
 */

export type Band = Pick<RateBand, "label" | "weekdays" | "fromMinute" | "toMinute" | "bankHoliday" | "ratePence" | "unit" | "minimumMinutes">;

export interface Priced {
  bandLabel: string;
  ratePence: number;
  amountPence: number;
  /** The minutes charged or paid after any minimum. */
  minutes: number;
}

export function pickBand(bands: Band[], weekday: number, startMinute: number, bankHoliday: boolean): Band | null {
  if (bankHoliday) {
    const bh = bands.find((b) => b.bankHoliday);
    if (bh) return bh;
  }
  const matches = bands.filter((b) => !b.bankHoliday && b.weekdays.includes(weekday) && b.fromMinute <= startMinute && startMinute < b.toMinute);
  matches.sort((a, b) => a.toMinute - a.fromMinute - (b.toMinute - b.fromMinute));
  return matches[0] ?? null;
}

export function price(band: Band, minutes: number): Priced {
  const charged = Math.max(minutes, band.minimumMinutes ?? 0);
  const amountPence = band.unit === "PER_VISIT" ? band.ratePence : Math.round((band.ratePence * charged) / 60);
  return { bandLabel: band.label, ratePence: band.ratePence, amountPence, minutes: band.unit === "PER_VISIT" ? minutes : charged };
}

export function priceVisit(bands: Band[], v: { weekday: number; startMinute: number; minutes: number; bankHoliday: boolean }): Priced | null {
  const band = pickBand(bands, v.weekday, v.startMinute, v.bankHoliday);
  return band ? price(band, v.minutes) : null;
}

export function pounds(pence: number) {
  return (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

/** Parses "12.50" or "£12.50" into pence; null if it is not a sensible amount. */
export function parsePounds(s: string): number | null {
  const m = /^£?\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** One stretch of a visit inside one London day and one band window. */
export interface Part { date: string; weekday: number; startMinute: number; minutes: number; band: Band | null }

/**
 * Splits work that starts on `date` at `startMinute` (London) and lasts `minutes` at midnight and at every band
 * boundary, and gives each stretch the band in force at its start. So a 22:00–07:00 night is priced partly at the
 * evening or night band and partly at the next day's band, and a visit running into a bank holiday picks up the
 * bank-holiday rate only for the minutes on that day.
 */
export function splitWork(bands: Band[], date: string, startMinute: number, minutes: number, isBankHoliday: (date: string) => boolean, nextDate: (date: string) => string, weekdayOf: (date: string) => number): Part[] {
  const cuts = [...new Set([0, 1440, ...bands.flatMap((b) => [b.fromMinute, b.toMinute])])].filter((m) => m >= 0 && m <= 1440).sort((a, b) => a - b);
  const parts: Part[] = [];
  let day = date;
  let at = startMinute;
  let left = minutes;
  while (left > 0) {
    if (at >= 1440) {
      day = nextDate(day);
      at = 0;
    }
    const next = cuts.find((c) => c > at) ?? 1440;
    const len = Math.min(left, next - at);
    const weekday = weekdayOf(day);
    const band = pickBand(bands, weekday, at, isBankHoliday(day));
    const prev = parts.at(-1);
    if (prev && prev.band === band && prev.date === day && prev.startMinute + prev.minutes === at) prev.minutes += len;
    else parts.push({ date: day, weekday, startMinute: at, minutes: len, band });
    at += len;
    left -= len;
  }
  return parts;
}

/**
 * Prices split work. A per-visit band (by the start) prices the whole visit once, as before. Otherwise each stretch
 * is priced at its own band's hourly rate, and any minimum length is made up at the first band's rate. Returns null
 * when a stretch has no band, so the run lists an exception rather than guessing a rate.
 */
export function priceWork(parts: Part[], opts: { minimum?: boolean } = {}): (Priced & { split: boolean }) | null {
  const banded: { band: Band; minutes: number; date: string }[] = [];
  for (const p of parts) {
    if (!p.band) return null;
    banded.push({ band: p.band, minutes: p.minutes, date: p.date });
  }
  const first = banded[0]?.band;
  if (!first) return null;
  const minutes = banded.reduce((n, p) => n + p.minutes, 0);
  if (first.unit === "PER_VISIT") return { ...price(first, minutes), split: false };
  let amountPence = banded.reduce((n, p) => n + (p.band.ratePence * p.minutes) / 60, 0);
  const short = opts.minimum === false ? 0 : Math.max(0, (first.minimumMinutes ?? 0) - minutes);
  amountPence += (first.ratePence * short) / 60;
  const labels = [...new Set(banded.map((p) => p.band.label))];
  return { bandLabel: labels.join(" + "), ratePence: first.ratePence, amountPence: Math.round(amountPence), minutes: minutes + short, split: labels.length > 1 || new Set(parts.map((p) => p.date)).size > 1 };
}

/**
 * Splits priced work at the end of a pay period (`lastDay`, London). The minutes after midnight on the last day are
 * the tail, paid in the next period's run; a minimum length counts on the whole visit and is paid with the head.
 * Per-visit bands are not split. Returns null when part of the work has no band.
 */
export function priceAtCutOff(parts: Part[], lastDay: string) {
  const full = priceWork(parts);
  if (!full) return null;
  const tailParts = parts.filter((p) => p.date > lastDay);
  if (!tailParts.length || parts[0]?.band?.unit === "PER_VISIT") return { head: full, tail: null };
  const tail = priceWork(tailParts, { minimum: false });
  if (!tail) return null;
  return { head: { ...full, minutes: full.minutes - tail.minutes, amountPence: full.amountPence - tail.amountPence }, tail };
}
