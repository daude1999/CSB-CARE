// Colour maths for the platform's dark mode (see postcss-dark-mode.cjs).
//
// Every colour in the light design is mapped to a dark-mode colour by what it paints: a page or panel background
// becomes a dark navy surface, dark ink becomes light ink, a hairline border becomes a dark hairline, and a saturated
// accent keeps its hue at a brightness that reads on a dark surface. The maths runs in OKLCH, so hue is preserved and
// lightness is perceptual. Pure functions, no dependencies.
"use strict";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "#abc", "#aabbcc" or "#aabbccdd" → { r, g, b, a } with r, g, b in 0..255 and a in 0..1. */
function parseHex(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const toLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklch({ r, g, b }) {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

function oklchToRgbRaw({ L, C, H }) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB, lowering chroma until the colour fits the sRGB gamut. */
function oklchToRgb(lch) {
  let { C } = lch;
  for (let i = 0; i < 30; i++) {
    const lin = oklchToRgbRaw({ ...lch, C });
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return lin.map((v) => Math.round(clamp(fromLinear(clamp(v, 0, 1)), 0, 255)));
    C *= 0.9;
  }
  return oklchToRgbRaw({ ...lch, C: 0 }).map((v) => Math.round(clamp(fromLinear(clamp(v, 0, 1)), 0, 255)));
}

// The dark surfaces take the navy of the CSB logo as their tint, so neutral greys become CSB navy rather than grey.
const NAVY_HUE = 255;
const NAVY_TINT = 0.028;

/**
 * Maps one opaque colour for one kind of use. Kinds:
 * - "bg": backgrounds. Light surfaces become dark navy surfaces (white panels sit a step above the page), light tints
 *   become dark tints of the same hue, vivid fills (buttons, badges with white text) stay vivid, dark fills stay dark.
 * - "text": ink. Dark ink becomes light ink, coloured ink keeps its hue at a readable brightness, light ink stays.
 * - "border": hairlines become dark hairlines; heavy dark rules and saturated accents become light enough to see.
 * - "accent": icons, chart marks, focus rings. Saturated colours keep hue and sit in a mid-bright band; neutrals flip.
 */
function mapLch({ L, C, H }, kind) {
  const neutral = C < 0.03;
  const tint = (l, c = C) => (neutral ? { L: l, C: NAVY_TINT, H: NAVY_HUE } : { L: l, C: Math.min(c * 1.25, 0.1), H });
  switch (kind) {
    case "bg": {
      if (L >= 0.995) return { L: 0.235, C: NAVY_TINT, H: NAVY_HUE }; // white panels and cards
      if (!neutral && C >= 0.09 && L > 0.4 && L < 0.74) return { L: L - 0.07, C, H }; // vivid fills
      if (L > 0.55) return tint(0.19 + (1 - L) * 0.4); // page canvas, light tints, hover greys
      return { L: L * 0.72, C: neutral ? Math.max(C, NAVY_TINT * L * 2) : C, H: neutral && C < 0.005 ? NAVY_HUE : H }; // dark chrome stays dark
    }
    case "text": {
      const l = Math.max(L, 0.95 - L * 0.5);
      return { L: l, C: neutral ? Math.min(C, 0.02) : C, H };
    }
    case "border": {
      if (!neutral && C >= 0.08) return { L: clamp(L, 0.6, 0.78), C, H };
      if (L > 0.55) return tint(0.29 + (1 - L) * 0.45, C);
      return { L: 0.82 - L * 0.4, C: Math.min(C, 0.03), H };
    }
    case "accent": {
      if (!neutral && C >= 0.06) return { L: clamp(L, 0.62, 0.84), C, H };
      if (L > 0.6) return tint(0.3 + (1 - L) * 0.45, C);
      return { L: 0.92 - L * 0.5, C, H };
    }
    default:
      return { L, C, H };
  }
}

/**
 * Maps { r, g, b, a } for a kind and returns { r, g, b, a }. See-through colours are overlays: a faint dark wash
 * (hover tints like black at 5%) turns into the same faint light wash, a light wash stays, and heavier dark washes
 * (dialog backdrops) stay as they are. Shadows keep their geometry and become black.
 */
function mapRgba(rgba, kind) {
  const lch = rgbToOklch(rgba);
  if (kind === "shadow") return { r: 0, g: 0, b: 0, a: rgba.a < 1 ? clamp(rgba.a * 2.5, 0, 0.6) : 0.5 };
  // Mostly opaque colours (frosted sticky bars, `bg-white/90`) are surfaces, so they are mapped like opaque ones.
  if (rgba.a < 0.6 && kind !== "text") {
    if (lch.L >= 0.5 || rgba.a >= 0.3) return rgba;
    if (lch.C < 0.05) return { r: 255, g: 255, b: 255, a: rgba.a * 1.4 };
  }
  const [r, g, b] = oklchToRgb(mapLch(lch, kind));
  return { r, g, b, a: rgba.a };
}

const hex2 = (n) => n.toString(16).padStart(2, "0");
function formatRgba({ r, g, b, a }, alphaText) {
  if (alphaText !== undefined) return `rgb(${r} ${g} ${b} / ${alphaText})`;
  if (a >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgb(${r} ${g} ${b} / ${Number(a.toFixed(3))})`;
}

/** Maps a hex colour string for a kind; returns a hex (or rgb with alpha) string. */
function mapHex(hex, kind) {
  const rgba = parseHex(hex);
  return rgba ? formatRgba(mapRgba(rgba, kind)) : hex;
}

module.exports = { parseHex, rgbToOklch, oklchToRgb, mapRgba, mapHex, formatRgba };
