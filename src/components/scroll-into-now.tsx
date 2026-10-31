"use client";

import { useEffect, useRef } from "react";

/** Scrolls a wide timeline so the current time (or the first visit) is in view when the page opens. */
export function ScrollIntoNow({ children, fraction }: { children: React.ReactNode; fraction: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || fraction == null) return;
    const target = el.scrollWidth * fraction - el.clientWidth / 3;
    el.scrollLeft = Math.max(0, target);
  }, [fraction]);
  return (
    <div ref={ref} className="overflow-x-auto">
      {children}
    </div>
  );
}
