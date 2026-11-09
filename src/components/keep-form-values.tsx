"use client";

import { useEffect } from "react";

type Saved = Record<string, string[]>;

/** Field values, except hidden fields, files and anything listed in `exclude` (sensitive identifiers are never stored). */
function collect(form: HTMLFormElement, exclude: string[]): Saved {
  const out: Saved = {};
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.disabled || exclude.includes(el.name)) continue;
    if (el instanceof HTMLInputElement && (el.type === "hidden" || el.type === "file" || el.type === "password" || el.type === "submit")) continue;
    const list = (out[el.name] ??= []);
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.checked) list.push(el.value);
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.selectedOptions)) list.push(o.value);
    } else list.push(el.value);
  }
  return out;
}

function restore(form: HTMLFormElement, saved: Saved) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    const values = saved[el.name];
    if (!values) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = values.includes(el.value);
    else if (el instanceof HTMLSelectElement && el.multiple) for (const o of Array.from(el.options)) o.selected = values.includes(o.value);
    else el.value = values[0] ?? "";
    // Let any client-side logic that listens to the field (for example a scope picker) catch up.
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * Keeps what someone typed when the server sends a form back with an error. Server actions redirect back with
 * `?error=`, which used to empty every field, so one wrong NHS number meant retyping a whole record. The values live in
 * this tab's sessionStorage only between pressing Save and the answer, and are removed as soon as they are restored or
 * the save succeeds. Fields named in `exclude` (date of birth, NHS number) are never stored.
 */
export function KeepFormValues({ formId, exclude = [] }: { formId: string; exclude?: string[] }) {
  const excludeKey = exclude.join(",");
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const key = `csb-form:${formId}:${window.location.pathname}`;
    const skip = excludeKey ? excludeKey.split(",") : [];
    const settle = () => {
      try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) return;
        const failed = new URLSearchParams(window.location.search).has("error");
        window.sessionStorage.removeItem(key);
        if (!failed) return;
        const saved = JSON.parse(raw) as Saved;
        restore(form, saved);
        // A restored choice can reveal more fields (for example a branch picker); fill those once they are on screen.
        window.setTimeout(() => restore(form, saved), 50);
      } catch {
        /* storage unavailable: the form still works, it just cannot refill itself */
      }
    };
    const onSubmit = () => {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(collect(form, skip)));
      } catch {
        /* ignore */
      }
    };
    // React resets a form once its action finishes; by then the URL already says whether the save failed.
    const onReset = () => window.setTimeout(settle, 0);
    settle();
    form.addEventListener("submit", onSubmit);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("reset", onReset);
    };
  }, [formId, excludeKey]);
  return null;
}
