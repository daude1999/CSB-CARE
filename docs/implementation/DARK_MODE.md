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

- A rule whose selector already names `[data-mode="dark"]` is a hand-written night-mode rule and gets no generated
  twin (used by the module header band, see `COLOUR_SYSTEM.md`).

## Limits

- The choice is per browser, not per account: signing in on another device starts in light.
- Colours added later in new code are covered automatically on the next build; a colour only built at runtime from
  data (for example an area colour chosen in settings) keeps its light value, which is fine for swatches and dots.
- The HR Hub's prebuilt style sheet (`public/hr/hr-hub.css`, built by `scripts/build-hr-css.mjs`) follows the same
  switch since 6 Nov 2026: its own dark tokens (`src/hr/styles/hr-tokens.css`) are scoped to `<html data-mode="dark">`,
  and the build runs this plugin over it as a last pass for the colours it still hard-codes. Before that fix its dark
  tokens were keyed to `data-theme="dark"`, which the platform never sets, so only the parts drawn with shared utility
  classes turned dark (white table headings, dark names on dark rows, a white Work profile card). Regression tests:
  `tests/unit/hr-dark-mode.test.ts`, `tests/e2e/hr-appearance.spec.ts`.
