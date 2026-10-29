# Test results

Only commands that actually ran are recorded here.

## Baseline (29 Oct 2026, before any change, commit a2abf2d + research docs)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (vitest, local csb_test) | 12 files, 109 tests passed |
| `npm run test:hr` | 14 passed |
| `npm run build && npm run test:e2e` (local csb_e2e) | build ok, 16 passed |

## Rostering build checkpoint (29 Oct 2026, commit bb25d08 + e2e test fixes)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (vitest, local csb_test) | 14 files, 137 tests passed (adds `tests/unit/london.test.ts` 5, `tests/integration/rota.test.ts` 22, updated portals tests) |
| `npm run test:hr` | 14 passed, 0 failed |
| `npm run build` | pass |
| `npm run test:e2e` (full, local csb_e2e) | 23 passed, 1 failed: the keyboard test opened today's first visit, which had already happened and so cannot be reassigned |
| `npx playwright test tests/e2e/rota.spec.ts` after pointing that test at tomorrow's visits | 8 passed |

An earlier full e2e run in the same session had 20 passed and 4 failed. The fixes were: page overflow at 834 px and 390 px (grid columns, scrolling table wrapper), a strict-mode alert selector, Build Rota defaulting to a week the seed has already built, and sign-in at phone width, where the sidebar is hidden. All of them were re-run after fixing.

Screenshots captured by the e2e run at 1440, 834 and 390 px are in `docs/implementation/screenshots/`. Each one was checked for horizontal page overflow (≤ 1 px) by the test.

## Call monitoring and clocking checkpoint (29 Oct 2026)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 15 files, 144 tests passed. Adds `tests/integration/attendance.test.ts` (7). One older rota test had picked a carer already on the visit, depending on the time of day; the test now excludes them |
| `npm run build` | pass |
| `npm run test:e2e` (full) | 24 passed, 1 failed: `/rota/monitor` overflowed at 390 px because a screen-reader-only table heading escaped the scroll box. Fixed with `relative` on the wrapper |
| `npx playwright test tests/e2e/rota.spec.ts` after the fix | 9 passed |
| Manual browser check, carer at 390 px | Clocked in and out of a real visit; clocking out of a short visit was refused until a note was added; the clock rows and the SHORT_VISIT note were stored |

## Care records checkpoint (29 Oct 2026)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 16 files, 152 tests passed. Adds `tests/integration/care-records.test.ts` (8): demo seed, draft, stale save refused, empty sections refused, second-person approval, supersede on approval, database freeze of approved plans, carer read and confirm, risk review and archive, cross-tenant refusal, carer incident reporting, notifiable close |
| `npm run build` | pass |
| `npm run test:e2e` (full) | 26 passed, 0 failed |

Care plan, risk and incident screenshots at 1440 and 390 px (`c1440_*`, `c390_*`) were taken from the local demo database and checked for page overflow.

## Finance preparation checkpoint (29 Oct 2026)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 18 files, 161 tests passed. Adds `tests/integration/finance.test.ts` (6: demo seed, timesheet generation and exceptions, separation of duties on timesheets and runs, database freeze of approved runs, one run per week, CSV formula neutralising, cross-tenant refusal) and `tests/unit/pricing.test.ts` (3: band choice, bank holidays, rounding) |
| `npm run build` | pass |
| `npm run test:e2e` (full) | 27 passed, 0 failed. Adds the finance test (the preparer sees no Approve button; a second person approves and downloads the CSV) and the five finance pages to the overflow check at 1440, 834 and 390 px |

Finance screenshots (`*_rota_finance*`, `f1440_*`, `f390_*`) are in `screenshots/`, taken from the local demo database as the finance officer.

## Rota reports checkpoint (29 Oct 2026)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 19 files, 166 tests passed. Adds `tests/integration/rota-reports.test.ts` (5): delivery totals match the visit records, an office clock correction changes the carer report, people/coverage/alerts agree with the records, refusal of bad ranges, another organisation's area, carers and CSV without `report.export`, and an audited CSV export |
| `npm run build` | pass |
| `npm run test:e2e` (full) | 27 passed, 1 failed: the new reports test used an ambiguous "To" label (it also matched the Area list). After the fix, `tests/e2e/rota.spec.ts` was re-run: 12 of 12 passed |

Report screenshots (`r1440_*`, `r390_*`, `*_rota_reports*`) are in `screenshots/`.

## OnePlan structure checkpoint (29 Oct 2026)

The owner asked for the Rota dashboard, Daily Rota and Advanced Rota (the calendar board) to mirror OnePlan's structure. They were rebuilt and compared side by side with the redacted OnePlan screenshots. Those screenshots stay on the owner's laptop and are not committed, because this repository is public.

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 20 files, 169 tests passed. Adds `tests/integration/rota-dashboard.test.ts` (3): call counts match the visit records, people and reminders lists with reminders in date order, template conflicts, and refusal for carers |
| `npm run build` | pass |
| `npm run test:e2e` (full) | 28 passed, 2 failed. The failures were a stale build (the monitor was renamed after the build) and an ambiguous bulk-action label in the test. After a rebuild and fixing the test, `tests/e2e/rota.spec.ts` ran 14 of 14 passed. One more fix was needed during that rerun: the reports test now filters `role=alert` by its text, because Next's route announcer also has that role |

Our screenshots of the restructured screens are `screenshots/oneplan-structure_*.png`.

## OnePlan screens and behaviour checkpoint (29 Oct 2026)

The owner asked that the logic behind each screen match OnePlan too, not only the layout. The Monitor, Build Rota (All Rotas list plus the Add New Rota form) and Daily Templates were rebuilt to OnePlan's layout. The Daily Rota and Daily Templates bulk-action lists now follow OnePlan's order. Advanced Rota now lets you drag a card to another team member to reassign it, through the eligibility check.

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 21 files, 175 tests passed. Adds `tests/integration/rota-bulk.test.ts` (6): visit bulk edit time, duration, alerts and double-up; activate needs a reason; carers refused; template list by week and day; template bulk changes respecting the time lock, with an audit entry for each; duplicates start disabled; All Rotas order and the current-week flag |
| `npm run build` | pass |
| `npx playwright test tests/e2e/rota.spec.ts` | 14 of 14 passed after two test fixes. The Build Rota test now checks the Add New Rota form. The screen-size test now waits for the page heading instead of the old title bar, which the OnePlan-style pages no longer have. The phone-width run caught the Monitor's search row overflowing at 390px, which was fixed before the passing run |

Not built yet, and listed in KNOWN_LIMITATIONS: OnePlan's bulk actions that would fake attendance (Clock In/Out Scheduled, Complete Visits, Reassign and Complete), send messages (Send Push Message), change pay or chargeable status, delete visits outright (we cancel with a reason), or use run routes and printable rotas.
