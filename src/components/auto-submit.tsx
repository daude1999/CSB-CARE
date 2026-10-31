"use client";
import type { ReactNode } from "react";

/** A GET form that submits itself when one of its controls changes (a date or a branch), with a button for no-JS use. */
export function AutoSubmitForm({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <form method="get" className={className} aria-label={label} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
      <noscript>
        <button className="btn-secondary">Go</button>
      </noscript>
    </form>
  );
}
