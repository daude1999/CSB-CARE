"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page's server data every `seconds` while the tab is visible, and straight away when the person comes
 * back to the tab, so a live board never shows figures from before they looked away. Nothing is posted.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}
