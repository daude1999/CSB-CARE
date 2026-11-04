# Analytics category navigation (4 Nov 2026)

## Problem

Choosing a category on Analytics (for example Finance) made every other category tab disappear.

Root cause: `computeKpis()` in `src/server/reports/kpis.ts` returns only the measures for the chosen `group`, and
`src/app/(app)/analytics/page.tsx` built the tabs from those already-filtered rows. With `group=finance` the rows held
only Finance measures, so only "All" and "Finance" were left.

## Fix

The tabs now come from category metadata, separate from the figures:

| Concern | Where |
| --- | --- |
| Which measures a member may see | `permittedKpis(ctx)` (registry + `hasOrgPermission`, unchanged rules) |
| Tabs and counts | `kpiCategories(ctx)`: all six categories in fixed order, with the number of permitted measures in each; "All" shows the total. Reads only the registry, so nothing is worked out just to count. |
| Selected filters | `kpiScope()` (unchanged: branch, from, to, group, branch grants) |
| Figures | `computeKpis()` works out only the permitted measures in the chosen category (unchanged calculations) |
| Rendering | the page shows the tables for the chosen category under the always-complete `SegmentNav` |

- All seven tabs always show, with counts. A category with no permitted measures shows 0 and an explanation.
- URLs are unchanged (`/analytics`, `/analytics?group=delivery|staffing|workforce|quality|compliance|finance`).
  Switching keeps `branch`, `from` and `to`. Back and Forward work because state lives only in the URL.
- "Last 28 days" now keeps the chosen branch and category and resets only the dates.
- CSV export, definitions, links, branch scoping and permissions are unchanged.
- On a narrow screen the tab row scrolls sideways (existing `SegmentNav`), and the selected tab is scrolled into view
  (`src/components/active-tab-into-view.tsx`). The page itself does not scroll sideways.

## Recently viewed reports

`src/components/recent-reports.tsx` remembers the last five measure links a member opened from Analytics, in this
browser only (localStorage, keyed by user). Only the measure key and its internal link are stored. Names are shown
only for measures the signed-in member may still see (the page passes the permitted list), and only links starting
with a single `/` are used. No server tracking was added. Limitation: it does not follow a member across devices.

## Tests

- `tests/integration/kpis.test.ts`: categories and counts are the same whichever category is chosen, counts match
  permitted measures, a finance-only member gets all six categories with 0 outside Finance, figures for a category
  equal those on All, CSV for a category.
- `tests/e2e/analytics-nav.spec.ts`: seven tabs on every switch, filters kept, Back/Forward, direct links, CSV,
  finance-only member, recently viewed, phone width.
