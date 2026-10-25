"use client";
import { useState } from "react";
import { Palette } from "@phosphor-icons/react";
import { THEMES, THEME_COOKIE, type ThemeId } from "@/lib/themes";

/** Header control for trying the visual themes. Applies instantly and remembers the choice for a year. */
export function ThemeSwitcher({ initial }: { initial: ThemeId }) {
  const [theme, setTheme] = useState(initial);
  return (
    <label className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-slate-700" title="Change the look of CSB">
      <Palette size={17} aria-hidden="true" />
      <span className="sr-only">Theme</span>
      <select
        className="cursor-pointer bg-transparent text-sm text-slate-700 focus:outline-none"
        value={theme}
        data-testid="theme-switcher"
        onChange={(e) => {
          const next = e.target.value as ThemeId;
          setTheme(next);
          document.documentElement.dataset.theme = next;
          document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        }}
      >
        {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
  );
}
