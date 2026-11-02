/**
 * Where the person is in this tab's history of platform pages, so the header's Back and Forward buttons only offer a
 * direction that leads to another platform page. Pure functions; the browser wiring is in components/history-nav.tsx.
 *
 * Each history entry the platform creates is tagged with its position (`idx`) in `history.state`. `max` is the
 * furthest position forward that is known to be a platform page. Back is available when idx > 0; Forward when
 * idx < max. Nothing here reads `history.length`, which counts other sites' pages too.
 */
export interface NavPos {
  idx: number;
  max: number;
}

/** The key added to `history.state` beside Next.js's own fields. */
export const STATE_KEY = "__csbNav";

/** How the page was reached. "traverse" is Back/Forward inside the app without a page load. */
export type Arrival = "traverse" | "reload" | "back_forward" | "navigate";

/** A new entry: the old forward entries are gone, so Forward has nowhere to go. */
export function afterPush(p: NavPos | null): NavPos {
  const idx = p ? p.idx + 1 : 0;
  return { idx, max: idx };
}

/**
 * The position after arriving at an entry.
 * - stateIdx: the position tagged on the entry, or null when it has none (a page the platform did not tag).
 * - prev: the position before (kept in session storage across full page loads), or null.
 * - lastSeen: the position of the last platform page shown in this tab before a full page load, or null.
 * - fromApp: a full page load that started from a platform page in this tab (an HR Hub link, a plain form).
 * Returns null when the position is unknown; both buttons are then disabled rather than guessing.
 */
export function arrive(how: Arrival, stateIdx: number | null, prev: NavPos | null, lastSeen: number | null, fromApp: boolean): NavPos | null {
  if (stateIdx !== null && stateIdx >= 0) {
    const known = Math.max(prev?.max ?? stateIdx, stateIdx);
    // Back to a platform page from another site: what lies forward is that site, not ours.
    if (how === "back_forward" && lastSeen === stateIdx) return { idx: stateIdx, max: stateIdx };
    return { idx: stateIdx, max: known };
  }
  if (how === "traverse") return null;
  if (how === "navigate" && fromApp && lastSeen !== null) return afterPush({ idx: lastSeen, max: lastSeen });
  // A direct link, a bookmark, an address typed in, or a page reached from another site: nothing to go back to here.
  return { idx: 0, max: 0 };
}

export const canBack = (p: NavPos | null) => !!p && p.idx > 0;
export const canForward = (p: NavPos | null) => !!p && p.idx < p.max;

/** Reads the position tagged on a history state object, if any. */
export function idxOf(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const v = (state as Record<string, unknown>)[STATE_KEY];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Parses a stored position, ignoring anything malformed. */
export function parsePos(raw: string | null): NavPos | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { idx, max } = v as Record<string, unknown>;
    return typeof idx === "number" && typeof max === "number" && idx >= 0 && max >= idx ? { idx, max } : null;
  } catch {
    return null;
  }
}
