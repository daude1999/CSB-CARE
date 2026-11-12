"use client";
import { CalendarBlank } from "@phosphor-icons/react";

/**
 * The header band's date: the chosen day written out ("Thursday 12 November 2026") on a white pill, with the browser's
 * own date input laid invisibly over it, so a click anywhere opens the picker and keyboard users type a date as before.
 * It changes nothing about how the date is chosen: the input keeps its name and label and submits its form.
 */
export function DatePill({ value, label, name = "date" }: { value: string; label: string; name?: string }) {
  return (
    <label className="mh-date-pill">
      <span aria-hidden="true">{label}</span>
      <CalendarBlank size={19} aria-hidden="true" />
      <span className="sr-only">Date</span>
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="mh-date-input"
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            /* Older browsers open the picker themselves, or take typed input. */
          }
        }}
      />
    </label>
  );
}
