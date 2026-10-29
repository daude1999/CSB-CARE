"use client";
import Link from "@/components/link";
import { useState, type ReactNode } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";

/** One area in the category explorer: the caret opens its categories, the name filters the register to the area. */
export function TreeArea({ id, label, count, href, current, defaultOpen, children }: { id: string; label: string; count: number; href: string; current: boolean; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <div className="pl-tree-row" aria-current={current ? "true" : undefined}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`tree-${id}`} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} className="flex h-[26px] w-[22px] shrink-0 items-center justify-center rounded-[4px] text-[#3a4b5e] hover:bg-black/5">
          {open ? <CaretDown size={12} weight="bold" aria-hidden="true" /> : <CaretRight size={12} weight="bold" aria-hidden="true" />}
        </button>
        <Link href={href} scroll={false} className="min-w-0 flex-1 truncate text-inherit hover:text-[#0646b1]">{label}</Link>
        <span className="pl-count">{count}</span>
      </div>
      <ul id={`tree-${id}`} hidden={!open} className="mb-1 ml-[22px] mt-0.5 space-y-px">{children}</ul>
    </li>
  );
}

/** Below desktop width the explorer folds away behind a button so the register comes first. */
export function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="pl-btn-secondary mb-3 w-full justify-between lg:hidden">
        {label}
        <CaretDown size={12} weight="bold" aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>
      <div className={`${open ? "" : "hidden"} space-y-3 lg:block`}>{children}</div>
    </>
  );
}
