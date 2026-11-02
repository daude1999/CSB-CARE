"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; icon?: ReactNode };

/**
 * A small actions menu (HR "⋯" and "More" buttons): a button that opens a list of actions. Escape and a click
 * elsewhere close it, and focus returns to the button. Only real actions are listed; nothing disabled is shown as
 * if it worked.
 */
export function HxMenu({ label, trigger, items, triggerClass = "hx-icon-btn" }: { label: string; trigger: ReactNode; items: MenuItem[]; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    box.current?.querySelector<HTMLButtonElement>("ul button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="hx-menu" ref={box}>
      <button ref={button} type="button" className={triggerClass} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open ? (
        <ul className="hx-menu-list" id={id}>
          {items.map((i) => (
            <li key={i.label}>
              <button
                type="button"
                disabled={i.disabled}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
              >
                {i.icon}
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
