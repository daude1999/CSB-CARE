/**
 * Light or dark appearance. Light is the approved design and the default; dark is generated from it (see
 * scripts/dark-mode). "system" follows the device's own setting. The choice is kept in a cookie for a year, so the
 * server renders the right appearance on the first paint.
 */
export const COLOUR_MODES = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "system", name: "Match my device" },
] as const;

export type ColourMode = (typeof COLOUR_MODES)[number]["id"];
export const MODE_COOKIE = "csb-mode";
export const DEFAULT_MODE: ColourMode = "light";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseMode(value: string | undefined): ColourMode {
  return COLOUR_MODES.some((m) => m.id === value) ? (value as ColourMode) : DEFAULT_MODE;
}

/** The appearance the page shows before the browser can say what the device prefers. */
export function initialAppearance(mode: ColourMode): "light" | "dark" {
  return mode === "dark" ? "dark" : "light";
}

export function modeCookie(mode: ColourMode): string {
  return `${MODE_COOKIE}=${mode}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

/**
 * Runs in <head> before the first paint. For "Match my device" it applies the device's setting, and follows it when
 * it changes, so there is no flash of the wrong appearance. Kept tiny and dependency-free on purpose.
 */
export const MODE_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var q=window.matchMedia("(prefers-color-scheme: dark)");var s=function(){if(d.getAttribute("data-mode-pref")==="system")d.setAttribute("data-mode",q.matches?"dark":"light")};s();q.addEventListener("change",s)}catch(e){}})();`;
