"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * A table body whose rows open a link when clicked anywhere that is not itself a control (a checkbox, a link, a button).
 * Each row names its link in data-href. Keyboard users reach the same place through the link inside the row.
 */
export function ClickableRows({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tbody
      className={className}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,select,label,summary,details,textarea")) return;
        const href = target.closest<HTMLElement>("tr[data-href]")?.dataset.href;
        if (href) router.push(href, { scroll: false });
      }}
    >
      {children}
    </tbody>
  );
}
