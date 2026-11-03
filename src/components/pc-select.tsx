"use client";
import { useState } from "react";

/**
 * A filter chip that reads "Category  All ▾" and applies itself as soon as it changes. The real <select> sits over the
 * chip, so it keeps the browser's keyboard and screen-reader behaviour; the form's Apply button covers no-script use.
 */
export function PcSelect({ name, label, options, defaultValue = "", submit = true }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string; submit?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";
  return (
    <label className="pc-select">
      <span>{label}</span>
      <b aria-hidden="true">{current}</b>
      <select
        name={name}
        aria-label={label}
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          if (submit) e.currentTarget.form?.requestSubmit();
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
