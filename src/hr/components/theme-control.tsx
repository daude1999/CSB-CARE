"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Check } from "lucide-react";

type Theme = "light" | "dark" | "system";
const choices: Theme[] = ["light", "dark", "system"];

function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem("csb-theme");
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  } catch {
    return "system";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("csb-themechange", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("csb-themechange", callback);
  };
}

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system");

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("csb-theme", theme);
    } catch {
      // The selected appearance still applies for this session.
    }
  }, [theme]);

  function select(next: Theme) {
    try {
      window.localStorage.setItem("csb-theme", next);
    } catch {
      // The app still updates the selected appearance for this session.
    }
    window.dispatchEvent(new Event("csb-themechange"));
  }

  return (
    <div className="theme-control" role="group" aria-label="Colour theme">
      <span>Appearance</span>
      <div>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={theme === choice}
            onClick={() => select(choice)}
          >
            {choice[0].toUpperCase() + choice.slice(1)}
            {theme === choice && <Check size={13} />}
          </button>
        ))}
      </div>
    </div>
  );
}
