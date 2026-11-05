"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shows a follow-up question only when the answer it depends on matches (e.g. "Give details" after "Yes"). Without
 * JavaScript every question shows; the server ignores answers to questions that do not apply.
 */
export function FormConditions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const update = () => {
      for (const el of root.querySelectorAll<HTMLElement>("[data-show-field]")) {
        const field = el.dataset.showField!;
        const want = el.dataset.showEquals!;
        const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="f_${field}"]`)];
        const value = inputs.find((i) => !(i instanceof HTMLInputElement) || i.type !== "radio" || i.checked)?.value ?? "";
        const host = inputs[0]?.closest<HTMLElement>("[data-field]");
        const visible = (!host || !host.hidden) && (inputs.some((i) => i instanceof HTMLInputElement && i.type === "radio") ? inputs.some((i) => (i as HTMLInputElement).checked && i.value === want) : value === want);
        // Tailwind display classes would override the hidden attribute alone.
        el.hidden = !visible;
        el.style.display = visible ? "" : "none";
      }
    };
    update();
    root.addEventListener("change", update);
    return () => root.removeEventListener("change", update);
  }, []);
  return <div ref={ref}>{children}</div>;
}
