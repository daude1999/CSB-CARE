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
