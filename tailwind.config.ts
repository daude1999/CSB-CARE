import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#07142b", 900: "#0b1f3f", 800: "#12305c", 700: "#1a4178", 600: "#25548f" },
        teal: { 50: "#ecfeff", 100: "#cffafe", 400: "#22c3c9", 500: "#0fa9b0", 600: "#0b8b91", 700: "#0d6f74" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
