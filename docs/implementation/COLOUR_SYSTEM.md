# Colour system and shared page frame

Owner's brief of 10 November 2026 ("Build the approved redesign", 12 approved reference screenshots), built on branch
`redesign-colour-system` in four pull requests. This file covers PR 1; the later PRs add their own sections.

## The colour rule

Each module keeps the colour it already had (`Portal.colour` in `src/lib/portals.ts`, set as `--module` on `<main>`
by `src/components/main-area.tsx`):

| Module | Colour | White text on it |
| --- | --- | --- |
| Policy & Compliance | `#1f5fd1` | 5.81 : 1 |
| Rostering & Care Management | `#6b46c9` | 6.28 : 1 |
| HR & Workforce | `#c2410c` | 5.18 : 1 |
| Reporting & Analytics | `#0b6f99` | 5.60 : 1 |
| Administration & Settings | `#4b5666` | 7.44 : 1 |

All five pass WCAG 2.2 AA (4.5 : 1) for normal-size text.

The module colour appears in three places on a page: the header band, the main action button and the active tab.
Status colours (green, amber, red, and blue for unassigned) are separate and keep their meaning everywhere.

### Where the brief's opacities were changed, and why

The brief asks for the breadcrumb at white 78%, the description at white 88% and the other (secondary) buttons in the
band at white 14% with white text. Measured on each module colour:

| | Policy | Rota | HR | Reporting | Admin |
| --- | --- | --- | --- | --- | --- |
| Breadcrumb, white 78% (12px) | 4.20 ✗ | 4.49 ✗ | 3.73 ✗ | 4.06 ✗ | 5.30 |
| Description, white 88% (13.5px) | 4.89 | 5.27 | 4.35 ✗ | 4.74 | 6.23 |
| Secondary button text on white 14% | 4.44 ✗ | 4.65 | 4.11 ✗ | 4.27 ✗ | 5.17 |

Because the brief also requires AA, the build uses **white 92%** for the breadcrumb and description and a **white 8%**
fill (with the 38% white border) for secondary buttons. The results:

| | Policy | Rota | HR | Reporting | Admin |
| --- | --- | --- | --- | --- | --- |
| Breadcrumb and description, white 92% | 5.17 | 5.58 | 4.62 | 4.99 | 6.60 |
| Secondary button text on white 8% | 4.96 | 5.30 | 4.57 | 4.77 | 6.02 |

These are two tokens in `tailwind.config.ts` (`opacity.92` and `opacity.8`) and can be changed back if the owner
prefers the exact mock-up values over AA.

Other measured pairs: module colour text on white (main button, active tab) is the same ratio as in the table above;
the AI CSB Coordinator launcher (`#0a4f57` with white text) is 9.26 : 1; supporting text `#475467` on white is 7.69 : 1.

## Tokens (`tailwind.config.ts`)

- `colors.module` (`DEFAULT` reads `--module`, with alpha support: `bg-module/[.13]` is a 13% tint), `module.strong`
  (hover shade), and the five fixed module colours `module.policy` … `module.admin`.
- `colors.status.*` (completed, late, missed, unassigned, ink), `colors.page` `#f6f7fa`, `colors.rule` `#e4e7ec`,
  `colors.ink` `#101828`, `colors.coordinator` `#0a4f57`.
- `borderRadius.header` 12px and `borderRadius.chip` 11px; `spacing.chip` 44px, `spacing.tab` 38px,
  `spacing.topbar` 34px, `spacing.header-*` and `spacing.page-*`; `fontSize.crumb`, `header-title`, `header-desc`, `tab`;
  `maxWidth.header-desc` 78ch; `opacity` 8, 14, 16, 38, 78, 88, 92.

New components use these tokens; no new hex values were added to components.

## PR 1: shared page frame

### One header for every module

`ModuleHeader` (`src/components/module-header-band.tsx`) draws the band:

- background `var(--module)`, radius 12px, padding 16px 20px, 14px below;
- a 44px icon chip (radius 11px, white 16%) with the module's sidebar icon, 22px, white;
- breadcrumb "Module › Page" (12px, weight 500), h1 22px weight 600 white, left-aligned, optional description
  (13.5px, at most 78 characters wide);
- the page's actions on the right: the main action is white with module-colour text; the others are outlined in
  white; selects and inputs are white with dark text;
- an optional second row inside the band for a page's own controls (the Rota Dashboard's date navigation).

The module and its icon are worked out from the address (`portalForPath`), so a page only passes its title.

It replaces, without changing any page's data, links or permission checks:

| Was | Now |
| --- | --- |
| `TitleBar` (`data-testid="title-bar"`, centred title and Back link) and `PageHeader` in `ui.tsx` | Both draw `ModuleHeader`. The band keeps `data-testid="title-bar"`. |
| `ModulePageHeader`, `HrPageHeader`, `CompliancePageHeader` (`module-header.tsx`) and `PcHeader` (`.pc-header`) | Draw `ModuleHeader`. A detail page's `back` address becomes the middle breadcrumb. |
| `HrHeading` (`.hx-head`) and the HR Hub's own `PageHeading`, Documents, Alerts and Branches headings | `ModuleHeader` with `module="hr"`. |
| Rota Dashboard header | Band with the date navigation, live UK time, branch select, date picker and Today in its second row. |
| Daily Rota header | Band with previous day, date picker, next day, List / Planner and Add Visit. Title now "Daily Rota" as in the mock-up. |
| Visits Needing Attention, Unassigned Visits, The Monitor, Missed Calls, a missed call, Build Rota, Templates, AI CSB Coordinator workspace, the Policy Reader, error and not-found pages | `ModuleHeader`. Headings that repeated the title further down became `h2`s. |

Back links were removed from banners; the breadcrumb and the top bar's history arrows cover them. The second
"All Service Users" title in the page body was removed (its description moved into the band).

### Page frame

Every page except the Overview uses `.page-frame`: background `#f6f7fa`, padding 16px 24px 24px (16px at the sides
below 640px wide, so a phone keeps its 16px gutter). Content sits in white cards.

### Main action buttons

`.btn-primary` now takes the module colour everywhere (outside a module `--module` is the platform navy, so pop-up
dialogs look as before). In Policy & Compliance every purple button, tint, selected state, link and tab underline
(`#5b2bb5` and its tints in `globals.css`, the `.pc-*`, `.pl-*` and `.reader-*` styles and the Policy pages) now
reads `--module`, so it is Policy blue. Reporting's and Administration's navy Apply, Search and Record buttons are
`.btn-primary` and so take their module colour. Rostering's own purple buttons (`#5b2bb5` in Tailwind classes) now use
`bg-module` too. The body map keeps its own colours (clinical figure).

### One tab style

`.tabs-line` / `.tab-line` (globals.css): underline style, 38px high, 14px, grey `#475467` when inactive, module
colour and a 2px underline when active, a 1px `#e4e7ec` rule beneath. Used by `SegmentNav` (the boxed folder tabs on
Analytics, Users & Logins, Time Off & Availability, Background Jobs), `.ws-tabs` (Rota, HR and Admin workspace tabs,
including Staff Readiness), `PcTabs` (`.pc-tabs`), the Radix `TabList`/`TileTabList` and the Templates views.

### AI CSB Coordinator launcher

The launcher moved from the bottom-right corner into the top bar, to the left of the notifications bell (also in the
Overview's own header): 34px high, 13px weight 600, `#0a4f57` with white text. On phones it shows the icon only, with
the same accessible name. It opens the same panel. The panel and its conversation stay outside the top bar, so they
survive moving between pages; only the button is drawn into the top bar (`COORDINATOR_SLOT`, `src/lib/shell-slots.ts`).

## PR 2: Rota Dashboard tiles and Daily Rota list

### Call tiles (`src/app/(app)/rota/page.tsx`)

The four tiles (`card-completed`, `card-late`, `card-missed`, `card-unassigned` or `card-missed-meds`) keep their
links and figures. Each is now a white card with a 7% tint and a 1px border at 28% of its status colour, a solid
status-colour icon chip with a white icon, the figure and percentage in the status colour, supporting text in
`#475467`, and a 5px bar along the bottom filled to the tile's percentage.

The tile colours are the `tile.*` tokens. They are the existing tile colours, except Late, which is a little darker
so the figure passes AA on its tint. Measured:

| Tile | Colour | Figure and % on the 7% tint | White icon on the chip |
| --- | --- | --- | --- |
| Completed | `#15803d` | 4.57 : 1 | 5.02 : 1 |
| Late | `#b45309` (was `#c0570c`, 4.16 on the tint) | 4.57 : 1 | 5.02 : 1 |
| Missed | `#c42b2f` | 5.05 : 1 | 5.62 : 1 |
| Unassigned / missed meds | `#0a72b5` | 4.67 : 1 | 5.14 : 1 |

The brief's exact status hexes (`#16a34a` green, `#d97706` amber) give 3.05 and 2.96 on the tint, so they would fail
for the 16px percentage. Supporting text `#475467` on each tint is 6.9 : 1 or more.

### Daily Rota list (`src/app/(app)/rota/visits/page.tsx`)

- Column order: Time, Duration, Service User, Service Call, Team Member, Carers, Status, alerts, notes, checklist, Ref.
  The optional End time column still sits next to Time.
- Date, Week and Calendar week are hidden by default and are in the Columns menu ("Date", "Week (rota pattern)",
  "Calendar week"), saved in the address like the other optional columns.
- Sorted by time (the default, either direction), rows are grouped under a header row per call round, using the
  organisation's call types: "Morning calls · 07:00 to 08:30 · 12 visits", tinted with 8% of the module colour. The
  times are the round's first and last start times for the day and the count is every visit in that round matching
  the filters (not only the page). Rounds are ordered by their first visit. Any other sort shows a plain list.
- Each row has a 4px stripe on the left in the colour of its status badge.
- Time is 15px bold with tabular numerals.
- Sorting, bulk actions (the row checkboxes and Select all), filters, column settings, the Visit Details panel and
  pagination are unchanged.

## PR 3: Daily Rota Board and visit drawer

### Board (`/rota/visits`, `src/components/rota-board.tsx`)

The Daily Rota opens on the Board. "List" and "Board" sit side by side in the header; the Advanced Rota planner is in
the Actions menu. A link that asks for something only the list has (`visit`, `status`, `view`, `sort`, `dir`, `page`,
`per`, `cols` or `cover` in the address) still opens the list, so the Dashboard tiles, Quick Actions and saved links
land where they did before. `?layout=list` and `?layout=board` choose a view outright.

Nothing is loaded or decided twice. The page loads the day's visits once with the existing filters and passes them to
`boardData` (`src/app/(app)/rota/visits/board-data.ts`). Grouping by team member, the "Needs a carer" set, which
visits can move and the "confirm this move" address are in `src/server/rota/board.ts`, used by both the Board and the
Advanced Rota planner (which lost its own copies). A drag posts to `assignCarerAction`, which calls `assignCarer` and
so the eligibility service: a blocked move is refused with its reason, a move with warnings comes back asking to
confirm (`src/components/move-confirm.tsx`, also shared).

Layout:

- 196px name column with initials, name and "N visits · X h" (shadow shifts and cancelled visits are not counted),
  50px rows (taller only when a team member's visits overlap), most visits first.
- "Needs a carer" is the first row, tinted light red, for visits short of their full set of carers.
- Call round labels above the hours come from the organisation's call types ("Morning calls" reads "Morning").
- A stretch of more than 90 minutes with no visits folds into a 22px hatched divider (`src/lib/day-board.ts`,
  unit-tested). The footer says so when anything is folded.
- Blocks show surname and "start · duration"; under 60px wide they show initials and the start time. Double-ups show
  "×2".
- Block colours: completed `#dcfce7` with a 3px `#16a34a` left edge; still to come 13% module tint with a module
  left edge; needs a carer white with a 1.5px dashed `#dc2626` border; missed, late, in progress and cancelled use
  their status-badge colours.
- A red line with the time marks now (Europe/London) when the day shown is today; earlier hours are shaded lightly.
- One compact row above: search, the existing filters, and the legend on the right.
- Footer: visits today, completed, still to come, needs a carer, carers working. "Visits today" matches the list's
  total for the same filters (a browser test checks it).
- Below 1280px the board scrolls sideways inside its card; the page does not.
- Every block is a button named with service user, call, time, carer(s), status and reference.

### Visit drawer

Selecting a block opens a 420px dialog from the right over a dimmed page: initials, name, call type and reference,
close button; time and duration, status badge, carer(s), area; the visit's care tasks with any recorded outcome; and
"Why this carer". Focus moves into the drawer and stays there; Esc (or the backdrop or Close) closes it and puts focus
back on the block. Footer: "Reassign" in the module colour (only for someone who may change the rota, and only while
the visit can still be allocated; it opens the list's Visit Details panel for that visit) and "Open full visit".

"Why this carer" shows only stored or computed facts, per booked carer: what the eligibility service decided at
booking, the warnings the coordinator accepted (word for word), any review flag, and the matching service's reasons
with their points (`visitDrawer` in `src/server/rota/board.ts`). When none of those exist the section is left out.
The data comes from `GET /api/rota/visits/[id]/drawer`, which needs `rota.view` and goes through `getVisit`, so a
visit in another organisation, branch or area returns 404 (integration-tested).

## PR 4: command bar (Ctrl+K)

`src/components/command-bar.tsx`, mounted once in the app layout. Ctrl+K (Cmd+K on a Mac) opens a centred 640px
dialog from any page inside the platform shell. Results are grouped in this order: Service users, Staff, Visits today,
Pages, Actions.

- **Service users and Staff** come from the top bar's search service (`rotaSearch`), so the command bar finds exactly
  what that search finds, including CSB numbers, postcodes and exact external references. A service user's row shows
  their area and next scheduled visit when they have them.
- **Visits today** are today's visits (Europe/London) whose service user, booked carer or reference matches, with the
  status on the right ("Needs a carer" when a scheduled visit is short of its carers).
- **Pages** are the modules and sidebar pages the layout already worked out this person may open. Before anything is
  typed, only the modules are listed.
- **Actions** are links to the screens that do the work (Add a visit, Build the rota for a week, Add a service user
  and so on), each listed only with its permission and each checked again by the screen it opens. When a service user
  is found, "Add a visit for …" and "Open care plans for …" for the first one come first.

Scoping (`src/server/search/command.ts`, `GET /api/search/command`): the organisation, branches, areas and
permissions come from the session; the request carries only the search text (zod-checked, 100 characters at most). A
member without `rota.view`, a suspended organisation and a platform account with no organisation get no records.
`tests/integration/command-bar.test.ts` plants a matching service user, team member and visit in two organisations and
proves neither sees the other's, and that a branch-limited coordinator sees only their branches.

Keyboard: the search box keeps focus; Up and Down move the highlight (it wraps), Enter opens, Esc closes and puts
focus back where it was. Tab stays in the dialog. It is a `dialog` with a `combobox` and `listbox`
(`aria-activedescendant`), and a polite status line gives the number of results. The highlighted row is a 10% tint of
the module colour of the page underneath; text on it is `#101828` (15.2 : 1 or more on every module's tint) and the
right-hand detail is `#475467` (6.6 : 1 or more). The service-user chip is white on the module colour (5.18 : 1 or more).

Ctrl+K used to put the cursor in the top-bar search box (and, on HR pages, open the HR Hub's own search). It now opens
the command bar everywhere. The top-bar box and the HR Hub's search are unchanged and still open from the top bar.


The dark twins are generated at build time (`docs/implementation/DARK_MODE.md`), so the band, tabs and buttons follow
the switch automatically. The band keeps the module colour with white text in dark mode.
