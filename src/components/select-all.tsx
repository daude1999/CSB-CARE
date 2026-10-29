"use client";

/** A header checkbox that ticks every row checkbox with the given name in the given form. Works without it too: rows can be ticked one by one. */
export function SelectAll({ form, name, label = "Select all" }: { form: string; name: string; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="${name}"]`).forEach((c) => {
          c.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
