/**
 * Numbered carer places on a visit. A visit needs any number of carers from 1 to MAX_CARERS; each carer fills one
 * numbered place ("Carer 1", "Carer 2", …). A shadow is extra and never counts towards the number needed.
 *
 * Storage keeps the original slot names so older visits read exactly as before: place 1 is stored as PRIMARY, place 2
 * as SECOND, places 3 and above as ADDITIONAL with their number in `position`, and a shadow as SHADOW (position 0).
 * Everywhere else in the code a place is addressed by its key: "PRIMARY", "SECOND", "C3" … "C20" or "SHADOW".
 */
import type { AssignmentSlot } from "@prisma/client";

export const MAX_CARERS = 20;

export type PlaceKey = "PRIMARY" | "SECOND" | "SHADOW" | `C${number}`;

/** The key of a stored assignment (or of slot + position as stored). */
export function placeKey(a: { slot: AssignmentSlot | string; position?: number | null }): PlaceKey {
  if (a.slot === "ADDITIONAL") return `C${a.position ?? 0}`;
  return a.slot as PlaceKey;
}

/** The number of a carer place (1, 2, 3 …); null for a shadow. */
export function placeNumber(k: PlaceKey | string): number | null {
  if (k === "PRIMARY") return 1;
  if (k === "SECOND") return 2;
  const m = /^C(\d{1,2})$/.exec(k);
  return m ? Number(m[1]) : null;
}

/** The key of carer place n (n ≥ 1). */
export function placeOf(n: number): PlaceKey {
  return n === 1 ? "PRIMARY" : n === 2 ? "SECOND" : `C${n}`;
}

/** The carer places a visit needing n carers has, in order. */
export function carerPlaces(n: number): PlaceKey[] {
  return Array.from({ length: Math.max(0, Math.min(MAX_CARERS, n)) }, (_, i) => placeOf(i + 1));
}

/** Reads a place from a form or link. Accepts the keys above and a bare number ("3"). Unknown input → null. */
export function parsePlace(raw: unknown): PlaceKey | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "PRIMARY" || s === "SECOND" || s === "SHADOW") return s;
  const n = Number(/^C?(\d{1,2})$/.exec(s)?.[1] ?? NaN);
  return Number.isInteger(n) && n >= 1 && n <= MAX_CARERS ? placeOf(n) : null;
}

/** What is stored for a place. */
export function placeData(k: PlaceKey): { slot: AssignmentSlot; position: number } {
  if (k === "SHADOW") return { slot: "SHADOW", position: 0 };
  const n = placeNumber(k)!;
  return n === 1 ? { slot: "PRIMARY", position: 1 } : n === 2 ? { slot: "SECOND", position: 2 } : { slot: "ADDITIONAL", position: n };
}

/** "Carer 1" … "Carer N", or "Shadow". */
export function placeLabel(k: PlaceKey | string): string {
  const n = placeNumber(k);
  return n ? `Carer ${n}` : "Shadow";
}

export const isCarerPlace = (a: { slot: AssignmentSlot | string }) => a.slot !== "SHADOW";

/** The carer places of a visit that nobody fills, in order. */
export function openPlaces(required: number, live: { slot: AssignmentSlot | string; position?: number | null }[]): PlaceKey[] {
  const filled = new Set(live.filter(isCarerPlace).map(placeKey));
  return carerPlaces(required).filter((k) => !filled.has(k));
}

export type Staffing = "FULL" | "PARTIAL" | "UNASSIGNED";
export const STAFFING_LABEL: Record<Staffing, string> = { FULL: "Fully staffed", PARTIAL: "Partially staffed", UNASSIGNED: "Unassigned" };

/** Fully staffed only when every needed place is filled; partly when some are; unassigned when none are. */
export function staffingOf(required: number, allocated: number): Staffing {
  if (allocated >= required) return "FULL";
  return allocated > 0 ? "PARTIAL" : "UNASSIGNED";
}

/** How a visit's carer number reads in short form: "1 carer", "Double-up", "3 carers". */
export function carersNeededLabel(n: number): string {
  return n === 1 ? "1 carer" : n === 2 ? "Double-up" : `${n} carers`;
}

/**
 * A template's preferred carer for each place, in order (place 1 first), one entry per carer needed; null = none.
 * Places 1 and 2 keep their original fields; places 3 and above come from extraPreferredStaffIds.
 */
export function preferredOf(t: { carersRequired: number; preferredStaff1Id?: string | null; preferredStaff2Id?: string | null; extraPreferredStaffIds?: string[] | null }): (string | null)[] {
  const all = [t.preferredStaff1Id || null, t.preferredStaff2Id || null, ...(t.extraPreferredStaffIds ?? []).map((x) => x || null)];
  return Array.from({ length: Math.max(1, t.carersRequired) }, (_, i) => all[i] ?? null);
}

/** The preferred carer a template names for one place. */
export function preferredFor(t: Parameters<typeof preferredOf>[0], place: PlaceKey): string | null {
  const n = placeNumber(place);
  return n ? (preferredOf(t)[n - 1] ?? null) : null;
}
