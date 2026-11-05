"use client";
import { useEffect, useState } from "react";
import { Check, Desktop, Moon, Sun } from "@phosphor-icons/react";
import { COLOUR_MODES, modeCookie, parseMode, type ColourMode } from "@/lib/colour-mode";
import { useDismissableDetails } from "@/components/help-menu";

const ICON = { light: Sun, dark: Moon, system: Desktop } as const;

/** Applies a choice to the page straight away and remembers it for next time. */
function applyMode(mode: ColourMode) {
  const html = document.documentElement;
  html.setAttribute("data-mode-pref", mode);
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.setAttribute("data-mode", dark ? "dark" : "light");
  document.cookie = modeCookie(mode);
}

/** The choice list: Light, Dark or Match my device. Used in the top bar menu and the Overview's account menu. */
export function ColourModeOptions({ mode, onChange }: { mode: ColourMode; onChange: (mode: ColourMode) => void }) {
  return (
    <div role="group" aria-label="Appearance" data-testid="colour-mode-options">
      {COLOUR_MODES.map((m) => {
        const Icon = ICON[m.id];
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            data-testid={`colour-mode-${m.id}`}
            onClick={() => onChange(m.id)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-[#0b1530] hover:bg-slate-100"
          >
            <Icon size={18} aria-hidden="true" className="shrink-0 text-slate-600" />
            <span className="flex-1">{m.name}</span>
            {on ? <Check size={16} weight="bold" aria-hidden="true" className="text-[#1f5fd1]" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Reads and changes the person's appearance choice. Starts from the server's value so the first paint matches. */
export function useColourMode(initial: ColourMode) {
  const [mode, setMode] = useState<ColourMode>(initial);
  useEffect(() => setMode(parseMode(document.documentElement.getAttribute("data-mode-pref") ?? undefined)), []);
  return [mode, (next: ColourMode) => {
    applyMode(next);
    setMode(next);
  }] as const;
}

/** The sun / moon button in the top bar, with Light, Dark and Match my device. */
export function ColourModeMenu({ initial, dark = false }: { initial: ColourMode; dark?: boolean }) {
  const ref = useDismissableDetails();
  const [mode, change] = useColourMode(initial);
  const Icon = mode === "dark" ? Moon : mode === "system" ? Desktop : Sun;
  const label = `Appearance: ${COLOUR_MODES.find((m) => m.id === mode)?.name ?? "Light"}`;
  return (
    <details ref={ref} className="relative" data-testid="colour-mode-menu">
      <summary aria-label={label} title={label} className={`flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden ${dark ? "text-white hover:bg-white/10" : "text-[#0b1530] hover:bg-black/5"}`}>
        <Icon size={21} aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[230px] overflow-hidden rounded-[8px] border border-slate-200 bg-white py-1 shadow-lg">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Appearance</p>
        <ColourModeOptions
          mode={mode}
          onChange={(m) => {
            change(m);
            if (ref.current) ref.current.open = false;
          }}
        />
      </div>
    </details>
  );
}
