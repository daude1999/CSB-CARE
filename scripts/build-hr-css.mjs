// Builds public/hr/hr-hub.css, the HR Hub's style sheet, from src/hr/styles.
// The HR Hub was built with Tailwind 4 while the rest of the platform uses Tailwind 3, so its CSS is compiled
// separately and served as a plain file that only HR & Workforce pages load.
//
// The HR Hub's screens sit inside the platform's sidebar and top bar, so after compiling, every rule of the HR Hub's
// own (unlayered) CSS is confined to the HR Hub's root element, `.cs` (see scopeToHub below). Tailwind's own layers
// are left alone: unlayered platform CSS always wins over them.
//
// Usage: node scripts/build-hr-css.mjs <folder whose node_modules has postcss and @tailwindcss/postcss v4>
// (for example the standalone CSB HR Hub folder). Commit the regenerated file.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const toolchain = process.argv[2];
if (!toolchain) throw new Error("Pass the folder that has Tailwind 4 installed");
const require = createRequire(path.join(path.resolve(toolchain), "package.json"));
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");

const root = process.cwd();
const styles = path.join(root, "src", "hr", "styles");
// The HR Hub uses the platform's own typeface, Inter Variable, which the root layout already loads on every page,
// so the HR style sheet ships no fonts of its own.
const fonts = "";
const tailwindCss = require.resolve("tailwindcss/index.css").replaceAll("\\", "/");
const source = [fonts, ...["globals.css", "hr-tokens.css", "hr-hub.css", "hr-embed.css", "hr-views.css"].map((f) => readFileSync(path.join(styles, f), "utf8"))]
  .join("\n")
  .replace('@import "tailwindcss";', `@import "${tailwindCss}";`);
// The platform's dark mode (scripts/dark-mode) runs last, exactly as it does for the platform's own CSS, so every
// colour the HR Hub hard-codes gets the same dark twin as the rest of the platform.
const darkMode = createRequire(import.meta.url)("./dark-mode/postcss-dark-mode.cjs");
const compiled = await postcss([tailwind({ base: path.join(root, "src", "hr"), optimize: { minify: true } }), scopeToHub()]).process(source, { from: path.join(styles, "globals.css") });
// A second pass, so the dark-mode plugin sees the finished, scoped rules (PostCSS runs every plugin's `Once` before
// any `Rule` visitor).
const result = await postcss([skipForDarkMode(), darkMode()]).process(compiled.css, { from: undefined });
/**
 * Confines the HR Hub's own rules to its root element so they never reach the platform's sidebar, top bar or other
 * pages, and keeps their specificity so the HR Hub's screens look exactly as before:
 * - design tokens move from `:root` to `.cs`, so they never replace the platform's tokens of the same name;
 * - the HR Hub's own dark tokens follow the platform's appearance switch (`<html data-mode="dark">`, which already
 *   resolves "Match my device"), so its separate automatic `prefers-color-scheme` block is dropped;
 * - `html`/`body` rules apply to the HR Hub's root instead, and element rules (`a`, `h1`, `table`, ...) to elements
 *   inside it, through `:where(.cs)`, which adds no specificity;
 * - `main` becomes `.h-content`, because the platform already provides the page's one main landmark.
 */
function scopeToHub() {
  const ROOT = ":where(.cs)";
  const inLayerOrKeyframes = (node) => {
    for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && (p.name === "layer" || /keyframes$/.test(p.name))) return true;
    return false;
  };
  // Splits a selector list on top-level commas only, so ":is(a, b)" stays whole.
  const split = (list) => {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) {
        out.push(list.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(list.slice(start).trim());
    return out;
  };
  const DARK_MODE = '[data-mode="dark"]';
  const scope = (sel) => {
    if (sel.startsWith(':root:not([data-theme="light"])') || sel.startsWith(":root:not([data-theme=light])")) return null;
    // The HR Hub's dark theme was switched by `data-theme="dark"`; in the platform the switch is `data-mode="dark"`
    // (data-theme names the platform's colour theme, such as "care").
    if (/^:root\[data-theme=("dark"|dark)\]/.test(sel)) return sel.replace(/^:root\[data-theme=("dark"|dark)\](\S*)/, (_, _q, rest) => `${DARK_MODE}${rest} .cs`);
    if (/^\[data-theme=("dark"|dark)\]/.test(sel)) return sel.replace(/^\[data-theme=("dark"|dark)\]/, DARK_MODE);
    if (sel.startsWith(":root")) return sel.replace(/^:root(\S*)/, (_, rest) => (rest ? `${rest} .cs` : ".cs"));
    if (/^(html|body)(?![\w-])/.test(sel)) return sel.replace(/^(html|body)(?![\w-])/, ROOT);
    sel = sel.replace(/(^|[\s>+~(])main(?![\w-])/g, "$1:where(.h-content)");
    if (/^[.#\[]/.test(sel) || sel.startsWith(":where(")) return sel;
    return `${ROOT} ${sel}`;
  };
  return {
    postcssPlugin: "scope-to-hub",
    Rule(rule) {
      if (rule.__scoped || inLayerOrKeyframes(rule)) return;
      rule.__scoped = true;
      const selectors = split(rule.selector).map(scope).filter((s) => s !== null);
      if (!selectors.length) {
        const parent = rule.parent;
        rule.remove();
        if (parent && parent.type === "atrule" && !parent.nodes.length) parent.remove();
      }
      else rule.selector = selectors.join(",");
    },
  };
}
scopeToHub.postcss = true;

/**
 * Rules the platform's dark-mode plugin must leave alone: the token blocks (the HR Hub has its own dark token values,
 * hr-tokens.css), rules already written for dark mode, and Tailwind's theme layer (its `--color-*` values are shared by
 * text and background utilities, so they cannot be mapped one way; the platform's own utilities cover those classes).
 */
function skipForDarkMode() {
  const inThemeLayer = (node) => {
    for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "layer" && /\btheme\b/.test(p.params)) return true;
    return false;
  };
  return {
    postcssPlugin: "hr-skip-for-dark-mode",
    Once(css) {
      css.walkRules((rule) => {
        const tokensOnly = rule.nodes.every((d) => d.type !== "decl" || d.prop.startsWith("--"));
        if (inThemeLayer(rule) || rule.selector.includes("[data-mode=") || (tokensOnly && /(^|,)\s*(\[data-mode="dark"\] )?\.cs(,|$)/.test(rule.selector))) rule.__csbDark = true;
      });
    },
  };
}
skipForDarkMode.postcss = true;

mkdirSync(path.join(root, "public", "hr"), { recursive: true });
writeFileSync(path.join(root, "public", "hr", "hr-hub.css"), `/* Generated by scripts/build-hr-css.mjs from src/hr/styles. Do not edit. */\n${result.css}`);
console.log(`public/hr/hr-hub.css: ${(result.css.length / 1024).toFixed(0)} KB`);
