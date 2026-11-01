/** Visual themes. The layout is identical in every theme; only colour, type and shape change. */
export const THEMES = [
  { id: "board", name: "Board paper", source: "CSB board-paper document template" },
  { id: "care", name: "CSB blue", source: "Navy and cyan from the CSB logo, Inter type" },
  { id: "govuk", name: "GOV.UK", source: "GOV.UK Design System (alphagov/govuk-frontend)" },
  { id: "carbon", name: "IBM Carbon", source: "Carbon Design System (carbon-design-system/carbon)" },
  { id: "zinc", name: "shadcn Zinc", source: "shadcn/ui (shadcn-ui/ui)" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const THEME_COOKIE = "csb-theme";
export const DEFAULT_THEME: ThemeId = "care";

export function parseTheme(value: string | undefined): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}
