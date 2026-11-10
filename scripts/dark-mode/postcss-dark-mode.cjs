// PostCSS plugin: the platform's dark mode.
//
// The light design is the approved design and stays exactly as it is. Dark mode is added on top of it, so nothing a
// page already does changes and no page has to be rewritten:
//
// 1. Every rule that sets a colour gets a twin straight after it, scoped to `<html data-mode="dark">`, that sets the
//    dark-mode colour instead (colour.cjs works it out from the light colour and what it paints). The twin uses
//    `:where()`, which adds no specificity, and sits right after its original, so the cascade picks the same winner in
//    dark mode as in light mode. Only colour declarations are copied; layout, type and spacing never change.
// 2. The theme's colour tokens (`--navy-*`, `--teal-*`, `--slate-*`, `--paper`) get dark values per kind of use
//    (`--dk-bg-navy-900`, `--dk-text-navy-900`, ...), because navy is both the sidebar's background and the headings'
//    ink, and those need opposite treatment in the dark.
// 3. In the one file that asks for it (a `@dark-mode inline-colours;` line), colours that pages pass as inline styles
//    or SVG attributes (status tints, chart fills) get attribute-selector overrides, found by scanning src/.
//
// Rules inside @media print, @keyframes, @font-face and @property are left alone, so print-outs stay light.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseHex, mapRgba, mapHex, formatRgba, rgbToOklch } = require("./colour.cjs");

const DARK = '[data-mode="dark"]';
const WHERE = `:where(${DARK})`;

const TEXT_PROPS = new Set(["color", "caret-color", "-webkit-text-fill-color", "text-decoration-color", "column-rule-color"]);
const BG_PROPS = new Set(["background", "background-color", "background-image"]);
const ACCENT_PROPS = new Set(["outline", "outline-color", "accent-color", "fill", "stroke", "flood-color", "stop-color"]);
const SHADOW_PROPS = new Set(["box-shadow", "text-shadow", "--tw-shadow", "--tw-shadow-colored", "--card-shadow"]);

/** What a declaration paints, or null when it holds no colour this plugin should change. */
function kindOf(prop) {
  if (TEXT_PROPS.has(prop)) return "text";
  if (BG_PROPS.has(prop)) return "bg";
  if (prop.startsWith("border") && (prop === "border" || prop.endsWith("color") || /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/.test(prop))) return "border";
  if (ACCENT_PROPS.has(prop)) return "accent";
  if (SHADOW_PROPS.has(prop)) return "shadow";
  if (prop.startsWith("--")) {
    if (/^--tw-(ring-offset-color|gradient-(from|via|to|stops))$/.test(prop)) return "bg";
    if (/^--tw-ring-color$/.test(prop)) return "accent";
    if (prop.startsWith("--tw-") || prop.startsWith("--dk-")) return null;
    if (/(bg|surface|paper|tint|canvas|backdrop|head-bg|soft)/.test(prop)) return "bg";
    if (/(border|rule|line|divider|hairline)/.test(prop)) return "border";
    if (/(ink|text|fg|foreground)/.test(prop)) return "text";
    return "accent";
  }
  return null;
}

const TOKEN = /var\(--(navy|teal|slate)-(\d+)\)|var\(--paper\)/g;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*(var\([^()]*\)|[\d.]+%?))?\s*\)|\b(white|black)\b/g;

/** Rewrites every colour in a declaration value for a kind; returns null when the value has none. */
function mapValue(value, kind) {
  let changed = false;
  let out = value.replace(TOKEN, (m, family, step) => {
    changed = true;
    return `var(--dk-${kind === "shadow" ? "bg" : kind}-${family ? `${family}-${step}` : "paper"})`;
  });
  out = out.replace(COLOUR, (m, r, g, b, alpha, named) => {
    changed = true;
    if (m.startsWith("#")) {
      const rgba = parseHex(m);
      return rgba ? formatRgba(mapRgba(rgba, kind)) : m;
    }
    if (named) return formatRgba(mapRgba(named === "white" ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }, kind));
    // Tailwind writes opacity as `/ var(--tw-bg-opacity, 1)`: an opaque colour whose alpha the class may change.
    const numeric = alpha === undefined ? 1 : alpha.startsWith("var(") ? null : alpha.endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
    const mapped = mapRgba({ r: +r, g: +g, b: +b, a: numeric ?? 1 }, kind);
    return formatRgba(mapped, numeric === null ? alpha : undefined);
  });
  return changed && out !== value ? out : null;
}

/** Splits a selector list on top-level commas only. */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let start = 0;
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
  return out.filter(Boolean);
}

/** Scopes one selector to dark mode without changing its specificity. */
function darkSelector(sel) {
  // Selectors that already start at the root element attach the condition to it.
  const root = sel.match(/^(:root|html|\[data-theme=(?:"[^"]*"|[^\]]*)\])((?:\[[^\]]*\]|:(?!where|is|not)[\w-]+)*)/);
  if (root) return root[0] + WHERE + sel.slice(root[0].length);
  return `${WHERE} ${sel}`;
}

function insideSkippedAtRule(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type !== "atrule") continue;
    if (/keyframes$/.test(p.name) || p.name === "font-face" || p.name === "property" || p.name === "page") return true;
    if (p.name === "media" && /\bprint\b/.test(p.params) && !/\bscreen\b/.test(p.params)) return true;
  }
  return false;
}

/** The dark values of the theme tokens, per kind, plus the tokens themselves for CSS that uses them indirectly. */
function tokenRule(rule, postcss) {
  const decls = [];
  rule.walkDecls(/^--(navy|teal|slate)-\d+$|^--paper$/, (d) => {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(d.value.trim())) return;
    const name = d.prop.slice(2);
    const hex = d.value.trim();
    for (const kind of ["bg", "text", "border", "accent"]) decls.push([`--dk-${kind}-${name}`, mapHex(hex, kind)]);
    const [family, step] = name.split("-");
    const base = family === "teal" ? "accent" : family === "navy" || family === "paper" ? "bg" : +step <= 100 ? "bg" : +step <= 300 ? "border" : "text";
    decls.push([d.prop, mapHex(hex, base)]);
  });
  if (!decls.length) return null;
  const selector = splitSelectors(rule.selector).map(darkSelector).join(", ").replaceAll(WHERE, DARK);
  const out = postcss.rule({ selector });
  for (const [prop, value] of decls) out.append(postcss.decl({ prop, value }));
  return out;
}

/** Inline-style and SVG-attribute colours used in the source, as attribute-selector overrides. */
function inlineColourRules(srcDir, postcss) {
  const hexes = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "hr" || !dir.endsWith("src")) walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name) && !full.includes(`${path.sep}server${path.sep}`)) {
        const text = fs.readFileSync(full, "utf8");
        // Colours outside Tailwind's bracket classes: constants, props and attributes.
        for (const m of text.matchAll(/(?<!\[)["'`]#([0-9a-fA-F]{6})["'`]/g)) hexes.add(m[1].toLowerCase());
      }
    }
  };
  walk(srcDir);
  const rules = [];
  const rgbText = (hex) => {
    const { r, g, b } = parseHex(hex);
    return `rgb(${r}, ${g}, ${b})`;
  };
  for (const h of [...hexes].sort()) {
    const hex = `#${h}`;
    const { L, C } = rgbToOklch(parseHex(hex));
    const sels = (prop) => [`${prop}:${hex}`, `${prop}: ${hex}`, `${prop}: ${rgbText(hex)}`].map((s) => `${WHERE} [style*="${s}" i]`);
    // Light tints painted as inline backgrounds become dark tints; vivid swatches, dots and route colours stay.
    if (L > 0.8) rules.push([[...sels("background"), ...sels("background-color")], "background-color", mapHex(hex, "bg")]);
    // Dark or mid ink set inline becomes readable ink. `[style^=...]` and `;color` avoid matching background-color.
    if (L < 0.62) {
      const colourSels = [`color:${hex}`, `color: ${hex}`, `color: ${rgbText(hex)}`].flatMap((s) => [`${WHERE} [style^="${s}" i]`, `${WHERE} [style*=";${s}" i]`, `${WHERE} [style*="; ${s}" i]`]);
      rules.push([colourSels, "color", mapHex(hex, "text")]);
    }
    // SVG presentation attributes (chart bars, the body map, illustrations).
    if (L > 0.8 || L < 0.45 || C < 0.06) {
      rules.push([[`${WHERE} [fill="${hex}" i]`], "fill", mapHex(hex, L > 0.8 ? "bg" : "accent")]);
      rules.push([[`${WHERE} [stroke="${hex}" i]`], "stroke", mapHex(hex, L > 0.8 ? "bg" : "accent")]);
    }
  }
  return rules.map(([selectors, prop, value]) => {
    const rule = postcss.rule({ selector: selectors.join(",\n") });
    rule.append(postcss.decl({ prop, value, important: prop !== "fill" && prop !== "stroke" }));
    return rule;
  });
}

/** @type {import("postcss").PluginCreator<{ src?: string }>} */
const plugin = (opts = {}) => ({
  postcssPlugin: "csb-dark-mode",
  Once(root, { postcss, result }) {
    root.walkAtRules("dark-mode", (at) => {
      const src = path.resolve(opts.src ?? "src");
      if (at.params.trim() === "inline-colours") {
        at.replaceWith(inlineColourRules(src, postcss));
        result.messages.push({ type: "dir-dependency", plugin: "csb-dark-mode", dir: src, glob: "**/*.{ts,tsx}", parent: result.opts.from });
      } else at.remove();
    });

    const rules = [];
    root.walkRules((rule) => {
      // A rule that already names the dark switch was written for night mode by hand, so it is left as written.
      if (!rule.__csbDark && !insideSkippedAtRule(rule) && !rule.selector.includes("[data-mode=")) rules.push(rule);
    });
    for (const rule of rules) {
      // Theme token blocks get their dark token values.
      if (/^(:root|\[data-theme=)/.test(rule.selector)) {
        const tokens = tokenRule(rule, postcss);
        if (tokens) {
          tokens.__csbDark = true;
          rule.after(tokens);
        }
      }
      const decls = [];
      rule.each((d) => {
        if (d.type !== "decl") return;
        if (/^--(navy|teal|slate)-\d+$|^--paper$/.test(d.prop)) return;
        const kind = kindOf(d.prop);
        if (!kind) return;
        const value = mapValue(d.value, kind);
        if (value !== null) decls.push(postcss.decl({ prop: d.prop, value, important: d.important }));
      });
      if (!decls.length) continue;
      const twin = postcss.rule({ selector: splitSelectors(rule.selector).map(darkSelector).join(", ") });
      twin.__csbDark = true;
      twin.append(...decls);
      rule.after(twin);
    }
  },
});
plugin.postcss = true;

module.exports = plugin;
module.exports.mapValue = mapValue;
module.exports.darkSelector = darkSelector;
