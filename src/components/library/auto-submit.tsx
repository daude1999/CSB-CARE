"use client";
import type { ReactNode } from "react";

/** A filter select that applies itself as soon as it changes. The form's Apply button covers keyboard and no-script use. */
export function AutoSubmitSelect({ name, label, defaultValue, children, className = "" }: { name: string; label: string; defaultValue?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`pl-select ${className}`}>
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-full w-full cursor-pointer appearance-none bg-transparent pl-3 pr-8 text-[13px] text-[#1f2d42] focus:outline-none">
        {children}
      </select>
    </label>
  );
}
