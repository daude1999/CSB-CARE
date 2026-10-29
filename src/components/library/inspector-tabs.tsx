"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

/** The inspector's views. The chosen view is kept in the address bar so a refresh or a shared link reopens it. */
export function InspectorTabs({ value, panes }: { value: string; panes: { value: string; label: string; content: ReactNode }[] }) {
  return (
    <TabsPrimitive.Root
      defaultValue={value}
      onValueChange={(v) => {
        const url = new URL(window.location.href);
        if (v === "document") url.searchParams.delete("pane");
        else url.searchParams.set("pane", v);
        window.history.replaceState(window.history.state, "", url);
      }}
      className="flex min-h-0 flex-col"
    >
      <TabsPrimitive.List aria-label="Policy views" className="flex border-b border-[#ebe8e2] px-[18px]">
        {panes.map((p) => (
          <TabsPrimitive.Trigger key={p.value} value={p.value} className="pl-insp-tab">
            {p.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {panes.map((p) => (
        <TabsPrimitive.Content key={p.value} value={p.value} className="min-h-0 focus-visible:outline-none">
          {p.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
