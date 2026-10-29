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
