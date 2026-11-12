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
        // Colour system (owner's approved redesign, 10 Nov 2026). Each module keeps one colour, set as `--module` on
        // <main> by src/components/main-area.tsx from src/lib/portals.ts. It appears in three places on a page: the
        // header band, the main action button and the active tab. `bg-module/[.13]` gives a tint of it.
        module: {
          DEFAULT: "color-mix(in srgb, var(--module, #1f5fd1) calc(<alpha-value> * 100%), transparent)",
          // A slightly darker shade for hover on a module-colour button.
          strong: "color-mix(in srgb, color-mix(in srgb, var(--module, #1f5fd1) 84%, #000) calc(<alpha-value> * 100%), transparent)",
          policy: "#1f5fd1",
          rota: "#6b46c9",
          hr: "#c2410c",
          reporting: "#0b6f99",
          admin: "#4b5666",
        },
        // Status colours keep their meaning everywhere and never take the module colour.
        status: {
          completed: "#16a34a", "completed-bg": "#dcfce7",
          late: "#d97706",
          missed: "#dc2626",
          unassigned: "#0369d5",
          ink: "#4a5a63",
        },
        // Rota Dashboard call tiles (PR 2). Each is the tile's own status colour, chosen so the figure and percentage
        // pass WCAG AA (4.5 : 1) on the tile's 7% tint and white passes on the solid icon chip.
        tile: { completed: "#15803d", late: "#b45309", missed: "#c42b2f", unassigned: "#0a72b5" },
        // The page frame: one light grey page behind white cards, with one hairline rule colour.
        page: "#f4f6f7",
        rule: "#dfe5e8",
        ink: "#16242b",
        // ClearCare "Recommended mix" (owner's decision, 12 Nov 2026). Shell, surfaces, borders and status tints.
        cc: {
          surface: "#ffffff", muted: "#4a5a63", line: "#dfe5e8", "line-soft": "#e9eef0", control: "#c9d3d8",
          sidebar: "#e9f3f1", "sidebar-line": "#cfe3df", primary: "#0f766e", "primary-strong": "#0b5f58", brand: "#0b5f58",
          "red-bg": "#fde8e4", red: "#8c2410", "amber-bg": "#fff3d6", amber: "#7a4b00",
          "green-bg": "#e6f4f1", green: "#0b5f58", "neutral-bg": "#eef1f3", neutral: "#33424a",
        },
        // The AI CSB Coordinator launcher in the top bar.
        coordinator: { DEFAULT: "#0a4f57", strong: "#073f46" },
      },
      // 92% text and an 8% button fill keep white text at WCAG AA on every module colour (the brief's 78%, 88% and
      // 14% fall below 4.5:1 on HR, Policy and Reporting; see docs/implementation/COLOUR_SYSTEM.md).
      opacity: { 8: "0.08", 14: "0.14", 16: "0.16", 38: "0.38", 78: "0.78", 88: "0.88", 92: "0.92" },
      spacing: {
        // Module header band and its 44px icon chip; 38px tabs; the 34px top-bar launcher.
        "header-y": "16px",
        "header-x": "20px",
        "header-gap": "14px",
        chip: "44px",
        tab: "40px",
        topbar: "34px",
        "page-top": "16px",
        "page-x": "24px",
        "page-phone": "16px",
        "page-bottom": "24px",
      },
      fontSize: {
        // One text-size scale for the whole platform (the HR Hub keeps its own). Sizes only: line height stays with
        // each element, so changing a size never changes spacing. The Overview's 52px figure and the CQC rating's 34px
        // stay as written.
        // ClearCare (12 Nov 2026): 15px body, nothing below 12.5px.
        micro: "12.5px",
        caption: "13px",
        meta: "14px",
        body: "15px",
        lead: "16.5px",
        subtitle: "18px",
        title: "20px",
        heading: "22px",
        display: "24px",
        figure: "28px",
        "figure-lg": "36px",
        crumb: ["12.5px", { lineHeight: "16px", fontWeight: "500" }],
        "header-title": ["28px", { lineHeight: "34px", fontWeight: "700" }],
        "header-desc": ["15px", { lineHeight: "21px" }],
        tab: ["14.5px", { lineHeight: "20px" }],
      },
      maxWidth: { "header-desc": "78ch" },
      fontFamily: {
        sans: ["var(--font-sans)"],
        // Display face for headings and figures.
        serif: ["var(--font-display)"],
        // Small uppercase labels and eyebrows.
        label: ["var(--font-label)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: { sm: "var(--radius-sm)", DEFAULT: "var(--radius-md)", md: "var(--radius-md)", lg: "var(--radius-lg)", xl: "var(--radius-lg)", "2xl": "var(--radius-lg)", header: "14px", chip: "11px", panel: "14px", control: "10px" },
    },
  },
  plugins: [],
} satisfies Config;
