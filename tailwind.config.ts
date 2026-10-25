import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Charcoal "ink" from the CSB wordmark.
        navy: { 950: "#121314", 900: "#1a1b1d", 800: "#242528", 700: "#313236", 600: "#43454a" },
        // CSB cyan. Reserved for signal: links, focus, the one thing that needs attention.
        teal: { 50: "#ecf9fd", 100: "#d2f1f9", 200: "#a6e3f2", 400: "#3ec1e0", 500: "#22a9cb", 600: "#178aa8", 700: "#136f88" },
        // Warm paper neutrals, replacing Tailwind's cool slate app-wide so every page
        // picks up the board-paper tone without per-page edits.
        slate: { 50: "#f7f6f2", 100: "#efede7", 200: "#e3e0d7", 300: "#cfcbbf", 400: "#a29d91", 500: "#76726a", 600: "#58554f", 700: "#41403b", 800: "#2c2b28", 900: "#1d1c1a", 950: "#10100f" },
        paper: "#f4f2ec",
      },
      fontFamily: {
        sans: ["\"IBM Plex Sans\"", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["\"Source Serif 4 Variable\"", "Georgia", "Cambria", "serif"],
        mono: ["\"IBM Plex Mono\"", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xl: "0.5rem", "2xl": "0.625rem" },
    },
  },
  plugins: [],
} satisfies Config;
