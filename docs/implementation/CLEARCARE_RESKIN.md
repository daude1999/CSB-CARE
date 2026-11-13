# ClearCare re-skin

Owner's brief of 12 Nov 2026: apply the approved "Recommended mix" design (prototype: claude.ai artifact
4yZvgL1ae2AGaLTxBPizkq, 91 screens, fictional data) to the whole application. Restyle only: no module, screen, field,
filter, column, button, bulk action, permission, workflow or business rule is removed, merged, renamed or moved, and no
database, server, API or permission code changes. The product is now called ClearCare; Care Solution Bureau is a client
organisation (tenant). Plan approved by the owner on 12 Nov 2026 ("continue"). Seven draft pull requests, merged only on
the owner's "merge".

| Phase | Scope | Branch | State |
|---|---|---|---|
| 1 | Shared pieces: tokens, Figtree, sidebar, top bar, header band, sub-module buttons, buttons, inputs, panels, tables, tags | `design/clearcare-reskin-1` | Draft PR #154 |
| 2 | Overview, Rota Dashboard, Daily Rota | `design/clearcare-reskin-2` | Draft PR #155 |
| 3 | Rest of Rostering & Care Management | | Not started |
| 4 | Policy & Compliance | | Not started |
| 5 | Reporting & Analytics, Administration & Settings, Platform Admin Centre | | Not started |
| 6 | HR & Workforce (HR Hub; settings-only override, needs the owner's approval first) | | Not started |
| 7 | ClearCare name in text people see (list of every place sent to the owner first) | | Not started |

## Phase 1: what changed

- **Tokens** (`tailwind.config.ts`, `src/app/themes.css`). The default theme ("care", internal id kept so saved choices
  still work) now holds the ClearCare palette: ink `#16242B`, page `#F4F6F7`, borders `#DFE5E8` / `#E9EEF0`, control
  borders `#C9D3D8`, teal `#0F766E` (primary) and `#0B5F58` (brand text), mint sidebar `#E9F3F1` / `#CFE3DF`, and the four
  status tints. New `cc-*` colour names. Module colours in `src/lib/portals.ts` are unchanged.
- **Type.** Figtree Variable (self-hosted `@fontsource-variable/figtree`, approved with the plan) for the whole platform;
  IBM Plex Mono for references. The named scale from PR #152 now reads 12.5 / 13 / 14 / 15 / 16.5 / 18 / 20 / 22 / 24 /
  28 / 36px, so nothing is below 12.5px and body text is 15px. Page titles 28px. The root stays 18px so spacing is
  unchanged. The HR Hub keeps its own Inter until Phase 6.
- **Sidebar** (`portal-switcher.tsx`): 248px mint, the ClearCare text wordmark (no official logo yet), each module with
  a 28px rounded tile in its colour, the open module's pages under a module-coloured line, the current page white and
  bold. Same links, order, groups, folds and permission rules. Organisation switcher, person and sign out stay at the
  foot. Shown from 1024px; below that it opens from the menu button, as on phones.
- **Top bar** (`src/app/(app)/layout.tsx`): one white bar on every page, the Overview included. Organisation tile and
  name (Care Solution Bureau's existing monogram on a navy tile; other organisations show their initials, because the
  database has no logo field), search, branch (2xl screens), AI Coordinator, a "Demo data" pill when the organisation is
  a demo, the bell, appearance, help, and the account menu. Back / Forward from 1280px. The Overview keeps today's date
  and time in the bar. The old navy Overview header is gone; everything it held is kept.
- **Header band** (`module-header-band.tsx`): 14px corners, 28px title, 40px buttons with 10px corners (main action
  white, others translucent outlined). A "More" menu collects the extra buttons when a page has more than four; they are
  the same elements, not copies.
- **Sub-modules** (`.tabs-line` / `.tab-line`): a row of 40px buttons with 9px corners; inactive white with a hairline
  border, active filled in the module colour. Same links and keyboard behaviour.
- **Building blocks** (`ui.tsx`, `globals.css`): panels and cards white with a 1px border and 14px corners; titled
  `Panel` / `Card` get a tinted title strip (`.panel-head`, with `data-tone="alert"` red and `"due"` amber variants for
  later phases); buttons and inputs 44px with 10px corners; the main button is ClearCare teal outside a band; tables have
  a module-tinted bold header row and 48px rows; status badges are pills in the four tints.

## Tests changed in Phase 1 (text or selector only; none deleted)

- `overview.spec.ts`: the h1 is now the greeting and the organisation is named in the top bar; the header test reads the
  unified top bar, and the Overview now has the search box.
- `dark-mode.spec.ts`: the Overview has the appearance button in the top bar as well as in the account menu.
- `colour-system.spec.ts`: page colour `#F4F6F7`; sub-module buttons (filled active, white inactive, 40px); the AI
  Coordinator button is outlined white and 40px.
- `navigation.spec.ts`, `typography.spec.ts`: the platform typeface is Figtree; the HR Hub may keep Inter until Phase 6.

## Known limits

- Screens with their own hand-written colours (about 3,000 colour classes in 194 files) keep them until their module's
  phase, so some panels still use the earlier greys until then.
- The HR Hub keeps its own fonts, colours and controls until Phase 6.
- The Platform Admin Centre has its own shell and is restyled in Phase 5.

## Phase 2: what changed

- **Rota Dashboard** (owner's picture, 12 Nov 2026): one band row with the title on the left and the live time, day
  arrows, a white date pill (the date input laid over the written-out date), branch picker and Today on the right.
  `ModuleHeader` gained optional `inline` and `icon` props.
- **Overview**: greeting, date line and Rearrange in a blue header band; the top-bar clock shows from 1536px and the live
  time is in the band below that.
- **Daily Rota**: day arrows are rounded squares (`.mh-round`), as everywhere in bands.
- Top bar: name and role (and branch) from 1280px; the organisation tile no longer overlaps the search.
- Tests: new one-row header test in `rota-dashboard-simple.spec.ts`; Overview greeting size now 28px/700.
