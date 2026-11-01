"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "@/components/link";

/**
 * A right-hand slide-out panel opened by a link (its state lives in the URL, so filters and the page behind are kept).
 * `step` names what the panel is showing: when it changes, focus and scroll move to the new step's heading.
 * Escape or the backdrop goes to `closeHref`; focus moves into the panel and Tab stays inside it while it is open.
 * Full screen on a phone. Once mounted it is moved to the end of <body>, above the app shell's header and menu.
 */
export function DrawerShell({ closeHref, labelledBy, step = "", children }: { closeHref: string; labelledBy: string; step?: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Focus goes back to whatever opened the panel when it closes (not when its contents change).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const el = panel.current;
    // Focus the step's heading or error, else the panel itself (its heading is announced by aria-labelledby).
    const target = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el;
    target?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => (target && target !== el ? target.scrollIntoView({ block: "start" }) : el?.querySelector("[data-scroll]")?.scrollTo({ top: 0 })));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(closeHref, { scroll: false });
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex='0']")].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(frame);
    };
  }, [closeHref, router, mounted, step]);

  const tree = (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <Link href={closeHref} scroll={false} aria-hidden tabIndex={-1} className="absolute inset-0 bg-[#1b1340]/35" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className="relative flex h-full w-full flex-col bg-white shadow-2xl outline-none sm:w-[540px] sm:border-l sm:border-slate-200">
        {children}
      </div>
    </div>
  );
  return mounted ? createPortal(tree, document.body) : tree;
}
