import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import postcss from "postcss";
import { COLOUR_MODES, DEFAULT_MODE, initialAppearance, modeCookie, parseMode } from "@/lib/colour-mode";

const require = createRequire(import.meta.url);
const { mapHex, parseHex, rgbToOklch } = require("../../scripts/dark-mode/colour.cjs") as {
  mapHex: (hex: string, kind: "bg" | "text" | "border" | "accent" | "shadow") => string;
  parseHex: (hex: string) => { r: number; g: number; b: number; a: number };
  rgbToOklch: (rgb: { r: number; g: number; b: number }) => { L: number; C: number; H: number };
};
const darkMode = require("../../scripts/dark-mode/postcss-dark-mode.cjs") as postcss.PluginCreator<{ src?: string }>;

const lightness = (hex: string) => rgbToOklch(parseHex(hex)).L;
const hue = (hex: string) => rgbToOklch(parseHex(hex)).H;

/** WCAG contrast ratio between two opaque hex colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const { r, g, b: bl } = parseHex(hex);
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const run = async (css: string) => (await postcss([darkMode({ src: "src/lib" })]).process(css, { from: undefined })).css;

describe("appearance choice", () => {
  it("defaults to light, so the approved design is what everyone sees until they choose", () => {
    expect(DEFAULT_MODE).toBe("light");
    expect(parseMode(undefined)).toBe("light");
    expect(parseMode("neon")).toBe("light");
    expect(COLOUR_MODES.map((m) => m.id)).toEqual(["light", "dark", "system"]);
  });
  it("renders dark only for an explicit dark choice; 'match my device' is resolved in the browser", () => {
    expect(initialAppearance("dark")).toBe("dark");
    expect(initialAppearance("light")).toBe("light");
    expect(initialAppearance("system")).toBe("light");
  });
  it("remembers the choice for a year across the whole site", () => {
    expect(modeCookie("dark")).toBe("csb-mode=dark; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});

describe("dark colour mapping", () => {
  it("turns white panels and the page canvas into dark navy surfaces, panels a step above the page", () => {
    const panel = mapHex("#ffffff", "bg");
    const page = mapHex("#f4f7fb", "bg");
    expect(lightness(panel)).toBeLessThan(0.3);
    expect(lightness(page)).toBeLessThan(lightness(panel));
    expect(hue(panel)).toBeGreaterThan(230);
    expect(hue(panel)).toBeLessThan(280);
  });
  it("turns dark ink into light ink that reads on the dark surfaces (WCAG AA)", () => {
    const panel = mapHex("#ffffff", "bg");
    for (const ink of ["#0b1530", "#0f2a4f", "#475769", "#5f7086", "#a3242c", "#1f5fd1", "#15803d"]) {
      expect(contrast(mapHex(ink, "text"), panel), ink).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the hue of coloured ink and status tints", () => {
    expect(Math.abs(hue(mapHex("#a3242c", "text")) - hue("#a3242c"))).toBeLessThan(3);
    expect(Math.abs(hue(mapHex("#fde1e3", "bg")) - hue("#fde1e3"))).toBeLessThan(3);
  });
  it("leaves light ink, dark chrome and vivid buttons recognisable", () => {
    expect(mapHex("#ffffff", "text")).toBe("#ffffff");
    expect(lightness(mapHex("#0f2a4f", "bg"))).toBeLessThan(0.3);
    expect(lightness(mapHex("#5b2bb5", "bg"))).toBeGreaterThan(0.35);
  });
  it("turns shadows black", () => {
    expect(mapHex("#0f2a4f10", "shadow")).toMatch(/^rgb\(0 0 0 \//);
  });
});

describe("dark-mode style sheet plugin", () => {
  it("adds a dark twin straight after each colour rule, with the same specificity and nothing but colours", async () => {
    const css = await run(".card { padding: 4px; background: #fff; color: #0b1530; }\n.next { color: red; }");
    expect(css).toMatch(/\.card \{ padding: 4px; background: #fff; color: #0b1530; \}\s*:where\(\[data-mode="dark"\]\) \.card \{\s*background: #\w{6};\s*color: #\w{6};?\s*\}\s*\.next/);
    expect(css).not.toMatch(/:where\(\[data-mode="dark"\]\) \.card \{[^}]*padding/);
  });
  it("gives each kind of use its own dark value of a theme colour token", async () => {
    const css = await run(".h { color: var(--navy-900); background-color: var(--navy-900); border-color: var(--slate-200); }");
    expect(css).toContain("color: var(--dk-text-navy-900)");
    expect(css).toContain("background-color: var(--dk-bg-navy-900)");
    expect(css).toContain("border-color: var(--dk-border-slate-200)");
  });
  it("defines the dark token values next to the theme's own tokens", async () => {
    const css = await run('[data-theme="care"] { --navy-900: #0f2a4f; --slate-50: #f6f8fb; }');
    expect(css).toMatch(/\[data-theme="care"\]\[data-mode="dark"\] \{[^}]*--dk-text-navy-900: #\w{6};[^}]*--dk-bg-slate-50: #\w{6}/);
  });
  it("attaches the dark condition to selectors that already start at the page root", async () => {
    const css = await run('[data-theme="care"] .btn:hover { background: #0a1c36; }\n:root .x { color: #000; }');
    expect(css).toContain('[data-theme="care"]:where([data-mode="dark"]) .btn:hover');
    expect(css).toContain(':root:where([data-mode="dark"]) .x');
  });
  it("leaves print styles, keyframes and colourless rules alone, so print-outs stay light", async () => {
    const css = await run("@media print { .p { color: #000; } }\n@keyframes k { from { background: #fff; } }\n.m { margin: 0; }");
    expect(css).not.toContain("data-mode");
  });
  it("keeps Tailwind's opacity variable on mapped colours", async () => {
    const css = await run(".bg-white { --tw-bg-opacity: 1; background-color: rgb(255 255 255 / var(--tw-bg-opacity, 1)); }");
    expect(css).toMatch(/:where\(\[data-mode="dark"\]\) \.bg-white \{\s*background-color: rgb\(\d+ \d+ \d+ \/ var\(--tw-bg-opacity, 1\)\)/);
  });
});
