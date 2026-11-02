"use client";

import { useEffect, useRef } from "react";

/** Every row checkbox with the given name that belongs to the given form, wherever it sits on the page. */
export function rowBoxes(form: string, name: string) {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="${name}"]`)];
}

/**
 * A header checkbox that ticks every row checkbox on the page with the given name in the given form. It shows ticked
 * only when every row is ticked, and part-ticked when some are, so it never claims a selection that is not there
 * (for example after unticking one row, or after moving to another page of results). Rows can be ticked one by one too.
 */
export function SelectAll({ form, name, label = "Select all" }: { form: string; name: string; label?: string }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => {
      const el = box.current;
      if (!el) return;
      const rows = rowBoxes(form, name);
      const ticked = rows.filter((c) => c.checked).length;
      el.checked = rows.length > 0 && ticked === rows.length;
      el.indeterminate = ticked > 0 && ticked < rows.length;
    };
    sync();
    // Rows change when the page refreshes after a bulk action or a filter, so watch the page as well as clicks.
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", sync);
    document.addEventListener("selectall:change", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", sync);
      document.removeEventListener("selectall:change", sync);
    };
  }, [form, name]);
  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={label}
      className="h-4 w-4"
      onChange={(e) => {
        const on = e.currentTarget.checked;
        rowBoxes(form, name).forEach((c) => {
          c.checked = on;
        });
        document.dispatchEvent(new Event("selectall:change"));
      }}
    />
  );
}
