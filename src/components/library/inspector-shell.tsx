"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const CONFIRM = "You have unsaved changes in this policy. Close it and lose them?";
const INTERACTIVE = "a, button, input, select, textarea, summary, label, details, [role='menu'], [role='dialog'], [data-keep-inspector]";

/**
 * Wraps the Policy Library inspector so it closes like a side panel: Escape closes it, and so does a click on empty
 * page space outside it (never a click on a control, a menu, a dialog or the register). If anything has been typed in
 * one of its forms and not sent, the person is asked first. Closing keeps every search and filter, and the library
 * remembers it was closed, so it does not open the first policy again.
 */
export function InspectorShell({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const close = () => {
      if (dirty.current && !window.confirm(CONFIRM)) return;
      dirty.current = false;
      router.push(closeHref, { scroll: false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape belongs to whatever is open on top first: a dialog, the full-screen reader or a menu.
      if (document.querySelector("[role='dialog'], details[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !ref.current?.contains(t) && t.closest("input, textarea, select")) return;
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || ref.current?.contains(t) || t.closest(INTERACTIVE)) return;
      if (document.querySelector("[role='dialog']")) return;
      if (!t.closest("main")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [closeHref, router]);

  return (
    <div
      ref={ref}
      // React events bubble through portals, so typing in one of the inspector's dialogs counts as well.
      onInput={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("form") && t.matches("input:not([type='hidden']), textarea, select")) dirty.current = true;
      }}
      onSubmit={() => {
        dirty.current = false;
      }}
      onClickCapture={(e) => {
        // Close, Previous and Next leave the policy on screen, so they ask first too.
        if (!(e.target as HTMLElement).closest("a[data-inspector-close]")) return;
        if (dirty.current && !window.confirm(CONFIRM)) {
          e.preventDefault();
          e.stopPropagation();
        } else dirty.current = false;
      }}
    >
      {children}
    </div>
  );
}
