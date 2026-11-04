"use client";

import { useEffect } from "react";

/**
 * On a narrow screen a row of tabs scrolls sideways, so the selected tab can sit out of sight. This scrolls only that
 * row (never the page) so the selected tab is in view. `label` is the row's accessible name, as given to SegmentNav.
 */
export function ActiveTabIntoView({ label }: { label: string }) {
  useEffect(() => {
    const nav = [...document.querySelectorAll<HTMLElement>("nav[aria-label]")].find((n) => n.getAttribute("aria-label") === label);
    const active = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !active) return;
    const left = active.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 16);
  });
  return null;
}
