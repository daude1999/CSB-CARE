"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** A small disclosure menu that closes on Escape or a click elsewhere. Items are ordinary links, buttons or forms. */
export function Menu({ label, trigger, children, align = "right", opens = "down", className = "", summaryClassName = "pl-icon-btn", showLabel = false }: { label: string; trigger: ReactNode; children: ReactNode; align?: "left" | "right"; opens?: "down" | "up"; className?: string; summaryClassName?: string; showLabel?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) {
        d.open = false;
        if (e instanceof KeyboardEvent) d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className={`relative ${className}`}>
      <summary aria-label={showLabel ? undefined : label} title={showLabel ? undefined : label} className={`${summaryClassName} list-none [&::-webkit-details-marker]:hidden`}>{trigger}</summary>
      <div className={`absolute z-30 ${opens === "up" ? "bottom-full mb-1" : "mt-1"} min-w-[200px] rounded-[8px] border border-[#e7e4de] bg-white py-1 shadow-[0_12px_32px_rgb(11_21_48/0.14)] ${align === "right" ? "right-0" : "left-0"}`}>
        {children}
      </div>
    </details>
  );
}
