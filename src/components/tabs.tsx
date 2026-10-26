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
    <TabsPrimitive.Content value={value} className="pt-7 focus-visible:ring-0 focus-visible:ring-offset-0">
      {children}
    </TabsPrimitive.Content>
  );
}

/** Square icon tiles, as on the QCS-style policy page: the active tile fills navy. */
export function TileTabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className="flex gap-[7px] overflow-x-auto pb-1">
      {children}
    </TabsPrimitive.List>
  );
}

export function TileTab({ value, icon, children, count }: { value: string; icon: ReactNode; children: ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="relative flex h-[84px] w-[92px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-1 text-center text-[10.5px] font-medium uppercase leading-[1.2] tracking-[0.02em] text-slate-700 shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-colors hover:bg-teal-50 data-[state=active]:border-navy-900 data-[state=active]:bg-navy-900 data-[state=active]:text-white focus-visible:ring-offset-0"
    >
      <span aria-hidden="true" className="text-navy-900 [[data-state=active]>&]:text-white">{icon}</span>
      {children}
      {count ? <span className="absolute -right-1 -top-1.5 min-w-[20px] rounded-full bg-[#f06a4d] px-1 text-[10px] font-semibold leading-[18px] text-white">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}
