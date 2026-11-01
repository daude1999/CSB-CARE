# One typeface: Inter Variable (1 Nov 2026)

Owner's request ("MANDATORY — SCREENSHOT REVIEW AND APPROVAL BEFORE MERGE", 1 Nov 2026): every module uses Inter
Variable, checked in computed browser styles, with text overflow and layout regressions fixed before review.
Draft PR only; merging waits for the owner's written approval of the screenshots.

## What was mixed before

Measured with computed styles at 1672 × 941 on 15 screens (14 modules; HR has directory and profile):

| Where | Before | After |
| --- | --- | --- |
| Body, tables, buttons, forms, page and section headings (default "CSB blue" theme) | Roboto | Inter Variable |
| Sidebar, top bar, Overview, Policy Library chrome | Inter Variable | Inter Variable |
| Policy Library page title, list titles, inspector title | Source Serif 4 | Inter Variable |
| HR Hub (`.cs`) text and staff IDs | Geist / Geist Mono | Inter Variable |

## Changes

- `src/app/themes.css`: the default theme's `--font-sans` is Inter Variable (display, label, prose and mono already
  follow it). Other selectable themes (Board paper, GOV.UK, Carbon, Zinc) keep their own type by design.
- `src/app/globals.css`: Policy Library `.pl-h1`, `.pl-row-title`, `.pl-serif` inherit Inter (title 40px/650,
  row titles 15px) instead of the serif.
- `src/hr/styles/*.css` → `public/hr/hr-hub.css` (rebuilt with `npm run build:hr-css`): HR `--font-sans` and
  `--font-mono` are Inter Variable; the HR style sheet no longer declares Geist. The HR root no longer forces
  tabular figures, because Inter's tabular set also widens hyphens ("Full - time", "CSB - 1001").
- `src/app/layout.tsx`: Roboto is no longer loaded.
- Reference codes (visit and template refs) no longer use tabular figures, for the same hyphen reason.
- Overflow fixes found in the before/after comparison:
  - Rota Dashboard: Team Members status pill was clipped at the card edge; the Reminders header wrapped
    ("14 days + overdue", full wording in the tooltip); "Unassigned Visits" quick action wraps instead of cutting off.
  - Unassigned Visits: Find Cover button clipped at the right edge.
  - Daily Templates: Area names no longer cut off (column up to 140px).
  - Staff Sign-off: Status by branch/role tables no longer scroll sideways; Clear button stays on the filter row.
  - Policy document viewer: fit-to-width leaves room for the page border (no 2px sideways scroll).

## Tests

`tests/e2e/typography.spec.ts` signs in and asserts every visible text element on the 14 module pages computes to
Inter Variable, and that the font loaded.

## Known differences left

- Policy Library no longer matches the serif headings in `docs/design/policy-library-reference.png`; this follows
  the owner's newer instruction to use Inter everywhere.
- HR People table is 8px wider than its scroll area at 1672px (unchanged from before this work).
- Some long values are still cut with "…" by design (Rota Dashboard roles, Unassigned reasons); full text is in the tooltip.
