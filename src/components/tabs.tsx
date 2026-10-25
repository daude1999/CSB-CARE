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
