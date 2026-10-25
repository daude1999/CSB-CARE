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
