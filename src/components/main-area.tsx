"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { crossesHubEdge, portalById, portalForPath } from "@/lib/portals";
import { MOTION, prefersReducedMotion } from "@/lib/motion";
import { usePendingHref } from "@/components/navigation-progress";
import { SkeletonFor } from "@/components/skeletons";

/** How long a page may take before its placeholder replaces the old page. Faster pages never show one. */
const SKELETON_AFTER_MS = 450;

/** The Policy Library and Overview draw their own full-width workspaces; the dashboard runs edge to edge; the rest sit on the grey canvas. */
type Frame = "bare" | "wide" | "canvas";
const frameFor = (path: string): Frame => (path === "/policies" || path === "/overview" ? "bare" : path === "/" ? "wide" : "canvas");
const FRAME_CLASS: Record<Frame, string> = {
  bare: "w-full min-w-0 flex-1",
  wide: "w-full min-w-0 flex-1 bg-white px-4 pb-4 pt-3",
  canvas: "w-full min-w-0 flex-1 bg-white px-4 pb-4 pt-3",
};

/**
 * The page frame, and the only part of the shell that moves when the page changes.
 *
 * Entrance: when the path changes, the content area (never the sidebar or top bar) fades up a few pixels. It runs on
 * the existing element, so nothing is remounted for it, and it keys on the path alone, so filters and other
 * query-string changes do not replay it. A first page load uses the CSS entrance on `.page-enter` instead.
 *
 * Waiting: if another page takes longer than a moment, a placeholder in that page's shape and module colour takes
 * its place. The old page is hidden, not unmounted, so anything typed in it is still there if the person stays.
 */
export function MainArea({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const main = useRef<HTMLElement>(null);
  const seen = useRef(path);
  useLayoutEffect(() => {
    if (seen.current === path) return;
    seen.current = path;
    const el = main.current;
    if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0, transform: `translateY(${MOTION.rise}px)` }, { opacity: 1, transform: "none" }], { duration: MOTION.base, easing: MOTION.easeOut });
  }, [path]);

  // The module colour only blends once the page is on screen, so a fresh load starts in the right colour.
  const [blend, setBlend] = useState(false);
  useEffect(() => setBlend(true), []);

  const pending = usePendingHref()?.split("?")[0] ?? null;
  // A page across the HR Hub's edge arrives with a full page load, which the browser shows itself.
  const leaving = pending !== null && pending !== path && !crossesHubEdge(path, pending);
  const waiting = useAfter(leaving ? pending : null, SKELETON_AFTER_MS);
  const target = waiting ?? path;

  // Each portal's pages carry its module colour (page title bars use it), so a module looks the same as its Overview tile.
  const style = { "--module": portalById(portalForPath(target)).colour } as React.CSSProperties;
  const frame = frameFor(path);
  return (
    <main ref={main} id="main-content" tabIndex={-1} data-testid="main-content" data-blend={blend ? "" : undefined} style={style} className={`page-enter outline-none ${FRAME_CLASS[waiting ? frameFor(waiting) : frame]}`}>
      {waiting ? <SkeletonFor path={waiting} canvas={frameFor(waiting) === "canvas"} /> : null}
      <div className={waiting ? "hidden" : "contents"}>{frame === "canvas" ? <div className="page-canvas">{children}</div> : children}</div>
    </main>
  );
}

/** `value`, once it has stayed the same for `ms`; null meanwhile and whenever it is null. */
function useAfter(value: string | null, ms: number): string | null {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value !== null && settled === value ? value : null;
}
