"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const MIN_GAP_MS = 20_000;
let last = 0;

/** Asks the server to process a few queued jobs after a page loads (hosts without a worker). */
export function JobKicker() {
  const pathname = usePathname();
  useEffect(() => {
    if (Date.now() - last < MIN_GAP_MS) return;
    last = Date.now();
    void fetch("/api/jobs/kick", { method: "POST" }).catch(() => undefined);
  }, [pathname]);
  return null;
}
