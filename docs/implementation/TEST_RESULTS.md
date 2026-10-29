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
