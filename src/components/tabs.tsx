"use client";
// Line tabs for CSB, built on UIAble's tabs component (MIT, codedthemes/uiable).
import type { ReactNode } from "react";
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from "@/components/uiable/tabs";

export function Tabs({ defaultValue, children, label }: { defaultValue: string; children: ReactNode; label: string }) {
  return (
    <UiTabs defaultValue={defaultValue} aria-label={label} className="flex-col gap-0">
      {children}
    </UiTabs>
  );
}

export function TabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TabsList variant="line" aria-label={label} className="h-auto! w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-slate-300 p-0">
      {children}
    </TabsList>
  );
}

export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <TabsTrigger value={value} className="flex-none rounded-none px-0 pb-2.5 pt-1 text-sm text-slate-500 after:inset-x-0 after:bottom-[-1px]! after:h-0.5 after:bg-navy-900! data-active:after:opacity-100 data-active:text-navy-900! hover:text-navy-900">
      {children}
      {count !== undefined ? <span className="font-mono text-xs font-normal text-slate-400">{count}</span> : null}
    </TabsTrigger>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent value={value} className="pt-7">
      {children}
    </TabsContent>
  );
}
