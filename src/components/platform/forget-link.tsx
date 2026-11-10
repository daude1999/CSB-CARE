"use client";

import { useEffect } from "react";

/** Clears the one-time link cookie once the link is on screen, without rendering the page again. Renders nothing. */
export function ForgetLink() {
  useEffect(() => {
    void fetch("/api/platform/one-time-link", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
  }, []);
  return null;
}
