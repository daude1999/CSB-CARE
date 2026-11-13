"use client";
import type { ReactNode } from "react";
import { List } from "@phosphor-icons/react/dist/ssr";
import { useDismissableDetails } from "@/components/help-menu";

/** The record's Menu button: a popover of the record's other actions that closes on Escape, outside click or navigation. */
export function RecordMenu({ children }: { children: ReactNode }) {
  const ref = useDismissableDetails();
  return (
    <details ref={ref} className="hb-rt-menu" data-testid="record-menu">
      <summary className="hb-btn" title="More actions for this record"><List size={16} aria-hidden="true" />Menu</summary>
      <ul className="hb-rt-pop">{children}</ul>
    </details>
  );
}
