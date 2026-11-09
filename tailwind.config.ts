import type { Config } from "tailwindcss";

// Every colour, font and corner radius reads a CSS variable, so a theme
// (src/app/themes.css) can restyle the whole app without touching a page.
const scale = (name: string, steps: number[]) =>
  Object.fromEntries(steps.map((s) => [s, `color-mix(in srgb, var(--${name}-${s}) calc(<alpha-value> * 100%), transparent)`]));

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ink and dark chrome (sidebar, primary buttons).
        navy: scale("navy", [950, 900, 800, 700, 600]),
        // Signal colour: links, focus, the one thing that needs attention.
        teal: scale("teal", [50, 100, 200, 400, 500, 600, 700]),
        // Neutrals, replacing Tailwind's slate app-wide.
        slate: scale("slate", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        // Evantix Platform Admin Centre tokens (not themed: the Admin Centre is Evantix's own console).
        px: {
          ink: "#0f1b3d", body: "#26304a", muted: "#5b6478", subtle: "#7a8294", faint: "#a3abbd",
          nav: "#0f1b3d", "nav-hover": "#18244a", "nav-active": "#1f2d57", "nav-text": "#c9d1e6", "nav-muted": "#8f9bbd",
          accent: "#5b21b6", "accent-hover": "#4c1d95", "accent-strong": "#3b1a86", focus: "#7c3aed", "accent-soft": "#ede9fe", "accent-tint": "#f6f4fe",
          line: "#e3e6ee", divider: "#eef0f5", row: "#f2f3f7", bg: "#f5f6f9", field: "#f8f9fb", hover: "#f9f8fe",
          ok: "#17663a", "ok-bg": "#e7f6ed", warn: "#8a5300", "warn-bg": "#fff4d9", danger: "#a11d2b", "danger-strong": "#b42335", "danger-bg": "#fde9ea", info: "#1d4f91", "info-bg": "#eaf2fd", neutral: "#46505f", "neutral-bg": "#eef0f3",
        },
        paper: "color-mix(in srgb, var(--paper) calc(<alpha-value> * 100%), transparent)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        // Display face for headings and figures.
        serif: ["var(--font-display)"],
        // Small uppercase labels and eyebrows.
        label: ["var(--font-label)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: { sm: "var(--radius-sm)", DEFAULT: "var(--radius-md)", md: "var(--radius-md)", lg: "var(--radius-lg)", xl: "var(--radius-lg)", "2xl": "var(--radius-lg)" },
    },
  },
  plugins: [],
} satisfies Config;
