# Dark and light appearance

Requested by the owner on 5 Nov 2026: "the option to make it dark mode like every platform, then they can switch from
dark to light ... then back to normal".

## What people see

- A sun / moon button in the top bar on every page except the Overview opens **Appearance** with three choices:
  **Light**, **Dark** and **Match my device**. The Overview's header is approved and locked, so there the same choice
  sits inside the account menu (the person's name, top right) and the header itself is unchanged.
- The choice applies immediately and is remembered in the browser for a year (cookie `csb-mode`). The server reads the
  cookie, so the first paint is already in the right appearance; "Match my device" is resolved by a tiny script in
  `<head>` before the first paint and follows the device when it changes.
- **Light is the default and is unchanged.** Every approved screen (Overview, Rota Dashboard, Daily Rota) looks exactly
  as before in light mode. Print-outs and downloads are always light.

## How it works

The light design hard-codes many colours (about 3,900 hex values in Tailwind classes), so dark mode is generated at
build time rather than written page by page:

- `scripts/dark-mode/postcss-dark-mode.cjs` runs after Tailwind. For every rule that sets a colour it adds a twin
  straight after it, scoped to `<html data-mode="dark">` through `:where()`, so the twin has the same specificity and
  the cascade picks the same winner as in light mode. Only colour declarations are copied.
- `scripts/dark-mode/colour.cjs` maps each light colour by what it paints (background, text, border, accent, shadow) in
  OKLCH, so hue is kept: white panels become CSB-navy surfaces, dark ink becomes light ink, light status tints become
  dark tints of the same hue, vivid buttons stay vivid, shadows become black.
- Theme tokens (`--navy-*`, `--teal-*`, `--slate-*`) get per-use dark values (`--dk-bg-navy-900`, `--dk-text-navy-900`).
- Colours set as inline styles or SVG attributes in `src/` (status tints, chart fills) get attribute-selector overrides,
  generated from a scan of the source (`@dark-mode inline-colours;` in `globals.css`).
- The CSB wordmark swaps to its official on-dark version (`public/csb-logo-light.svg`).

## Limits

- The choice is per browser, not per account: signing in on another device starts in light.
- Colours added later in new code are covered automatically on the next build; a colour only built at runtime from
  data (for example an area colour chosen in settings) keeps its light value, which is fine for swatches and dots.
- The HR Hub's prebuilt style sheet (`public/hr/hr-hub.css`) is not processed; its screens rely on the platform's dark
  twins for shared utility classes.
