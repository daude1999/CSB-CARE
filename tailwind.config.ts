import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#0f1114", 900: "#16181c", 800: "#1f2328", 700: "#2b3036", 600: "#3a4048" },
        teal: { 50: "#ecf9fd", 100: "#d2f1f9", 200: "#a6e3f2", 400: "#3ec1e0", 500: "#22a9cb", 600: "#178aa8", 700: "#136f88" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
