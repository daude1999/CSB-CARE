"use client";
// Line tabs in the CSB board-paper style. The structure (root, list, trigger, panel)
// follows UIAble's tabs component (MIT, codedthemes/uiable), built on Radix.
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export function Tabs({ defaultValue, children, label }: { defaultValue: string; children: ReactNode; label: string }) {
  return (
    <TabsPrimitive.Root defaultValue={defaultValue} aria-label={label}>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className="-mb-px flex gap-6 overflow-x-auto border-b border-slate-300">
      {children}
    </TabsPrimitive.List>
  );
}

export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="-mb-px flex shrink-0 items-baseline gap-1.5 whitespace-nowrap border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-slate-500 transition-colors hover:text-navy-900 data-[state=active]:border-navy-900 data-[state=active]:text-navy-900 focus-visible:rounded-sm focus-visible:ring-offset-0"
    >
      {children}
      {count !== undefined ? <span className="font-mono text-xs font-normal text-slate-400">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="tab-panel pt-7 focus-visible:ring-0 focus-visible:ring-offset-0">
      {children}
    </TabsPrimitive.Content>
  );
}

/**
 * The policy page's views (Review Sheet, Policy Text, Versions, Read & Sign...): one row of line tabs with a small
 * icon, the active one underlined in the module colour (approved Compliance design, 1 Nov 2026). Only the policy page
 * uses these.
 */
export function TileTabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className="flex gap-1 overflow-x-auto rounded-t-[6px] border-b border-slate-200 bg-white px-2">
      {children}
    </TabsPrimitive.List>
  );
}

export function TileTab({ value, icon, children, count }: { value: string; icon: ReactNode; children: ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="relative -mb-px flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] border-transparent px-2.5 text-[14px] font-medium text-slate-600 transition-colors hover:text-slate-900 data-[state=active]:border-[var(--module,#1f5fd1)] data-[state=active]:text-[#0646b1] focus-visible:ring-offset-0 [&_svg]:h-[18px] [&_svg]:w-[18px]"
    >
      <span aria-hidden="true" className="flex">{icon}</span>
      {children}
      {count ? <span className="min-w-[20px] rounded-full bg-[#fde1e3] px-1.5 text-center text-[11.5px] font-semibold leading-[18px] text-[#a3242c]">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}
