/**
 * Motion tokens for the platform. The same values are declared as CSS custom properties on :root in
 * src/app/globals.css (a unit test keeps the two in step), so CSS transitions and the few script-driven
 * animations (the page entrance) share one timing system.
 */
export const MOTION = {
  /** Hover, focus and press feedback. */
  fast: 120,
  /** Menus, tabs, dialogs and the page entrance. */
  base: 200,
  /** Sidebar sections opening and closing, the module colour blend. */
  slow: 260,
  /** How far a page or popover travels as it fades in, in pixels. */
  rise: 5,
  /** Decelerating curve for things arriving on screen. */
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Symmetric curve for state changes (colour, position of the active marker). */
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/** True when the person has asked their device for reduced motion. Safe to call on the server (returns false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
