"use client";

import { useState } from "react";

/** Copies a telephone number or address to the clipboard. Says so for screen readers; never dials or sends. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2500);
  };
  return (
    <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="inline-flex h-7 items-center rounded-[6px] border border-[#d0d5dd] bg-white px-2 text-[12.5px] font-medium text-[#344054] hover:border-[#5b2bb5] hover:text-[#4b2f9a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b2bb5]">
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
}
