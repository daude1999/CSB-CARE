import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The HR Hub's prebuilt style sheet follows the platform's Light / Dark switch (`<html data-mode="dark">`).
 * Regression: its own dark tokens were keyed to `data-theme="dark"`, which the platform never sets, so in dark mode
 * only the parts drawn with shared utility classes turned dark (white table headings, dark names on dark rows).
 */
const root = process.cwd();
const built = readFileSync(path.join(root, "public", "hr", "hr-hub.css"), "utf8");
const tokens = readFileSync(path.join(root, "src", "hr", "styles", "hr-tokens.css"), "utf8");
const views = readFileSync(path.join(root, "src", "hr", "styles", "hr-views.css"), "utf8");

/** The last rule whose whole selector is `selector` (the build minifies, so a rule starts after `}`). */
function tokenBlock(selector: string) {
  const start = built.lastIndexOf(`}${selector}{`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const body = built.slice(start + selector.length + 2, built.indexOf("}", start + 1));
  return Object.fromEntries(body.split(";").filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
}

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("HR Hub dark mode", () => {
  it("switches the HR tokens with the platform's appearance, not the old HR-only switch", () => {
    expect(built).not.toMatch(/\[data-theme=("dark"|dark)\]/);
    expect(built).not.toContain("prefers-color-scheme:dark");
    const dark = tokenBlock('[data-mode="dark"] .cs');
    expect(dark["--surface"]).toBe("#151f2b");
    expect(dark["--ink"]).toBe("#eef2f7");
    expect(dark["--text"]).toBe("var(--ink)");
  });

  it("keeps light mode exactly as designed", () => {
    const light = tokenBlock(".cs");
    expect(light["--hr-head-bg"]).toBe("#f6f7f9");
    expect(light["--hr-accent"]).toBe("#c2410c");
  });

  it("gives every HR view token readable dark values", () => {
    const dark = tokenBlock('[data-mode="dark"] .cs');
    const surface = dark["--surface"]!;
    for (const ink of ["--ink", "--ink-2", "--ink-3", "--hr-head-ink", "--hr-muted", "--hr-accent-ink", "--link"]) {
      expect(contrast(dark[ink]!, surface), ink).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(dark["--hr-head-ink"]!, dark["--hr-head-bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark["--on-primary"]!, dark["--primary"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", dark["--hr-accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("hr-views.css draws neutrals and the orange accent from tokens, so both appearances follow", () => {
    const rules = views.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const hex of ["#0c1728", "#f6f7f9", "#e5e8ed", "#344054", "#667085", "#fffaf5", "#d0d5dd"]) expect(rules, hex).not.toContain(hex);
    for (const tok of ["--hr-head-bg", "--hr-row-hover", "--hr-control-bg", "--hr-accent-ink"]) expect(tokens).toContain(`${tok}:`);
  });

  it("adds the platform's generated dark twins for colours the HR Hub still hard-codes", () => {
    expect(built).toContain(':where([data-mode="dark"]) .hrv-chip{');
    // Token blocks have hand-written dark values and are never twinned.
    expect(built).not.toContain(':where([data-mode="dark"]) .cs{');
  });
});
