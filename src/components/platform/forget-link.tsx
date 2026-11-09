"use client";

import { useEffect } from "react";
import { forgetOneTimeLinkAction } from "@/app/platform-actions";

/** Clears the one-time link cookie once the link is on screen. Renders nothing. */
export function ForgetLink() {
  useEffect(() => {
    void forgetOneTimeLinkAction();
  }, []);
  return null;
}
