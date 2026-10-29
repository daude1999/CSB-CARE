import type { RateBand } from "@prisma/client";

/**
 * Pricing for invoices and pay. Pure functions: no database access, so they are unit-tested directly.
 * Money is whole pence. A visit is priced by the band that matches its London start time; a bank-holiday band wins
 * on a bank holiday. Where several bands match, the narrowest time window wins, so a "weekday evening" band
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
