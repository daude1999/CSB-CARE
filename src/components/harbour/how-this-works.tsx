"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Lightbulb } from "@phosphor-icons/react";

/** The browser-storage key for one person's dismissal of one page's tip. */
export function tipKey(userId: string, page: string): string {
  return `csb:tip:${userId}:${page}`;
}

/**
 * "How this page works": a short plain-English tip under a module page's header, dismissed with "Got it". The platform
 * has no per-person preference store, so the dismissal is remembered in this browser only, per person and per page
 * (it comes back on another device, which does no harm). It renders on the server, so the tip is never missing for
 * someone whose browser blocks storage; it simply stays.
 */
export function HowThisWorks({ userId, page, children }: { userId: string; page: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const key = tipKey(userId, page);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(key) === "1");
    } catch {
      // Storage blocked: keep the tip.
    }
  }, [key]);
  if (hidden) return null;
  return (
    <aside className="hb-tip" aria-label="How this page works" data-testid="how-this-works">
      <Lightbulb size={18} aria-hidden="true" />
      <p><b>How this page works.</b> {children}</p>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            // Storage blocked: hidden for this visit only.
          }
        }}
      >
        Got it
      </button>
    </aside>
  );
}
