# Version 1 operational readiness: final handover

Brief: "CSB-CARE — Version 1 complete operational readiness, defect repair and realistic testing" (30 Oct 2026). Branch `claude/project-thread-emflic`, based on `main` after PR #27. **Not merged and not deployed.** The live demo and its database were not touched.

## What was done

| Phase | Result | Detail |
|---|---|---|
| 1. Policy PDF preview | Fixed at the root cause | Fonts were named but not embedded, so each device drew its own "Helvetica". Fonts are now embedded; responsive viewer and full-screen reader; print and download kept. `V1_DOCUMENT_RENDERING_QA.md` |
| 2. Feature inventory | Done | `V1_OPERATIONAL_AUDIT.md` |
| 3. Every action end to end | Done | `V1_FULL_FUNCTIONAL_TEST_MATRIX.md` |
| 4. Workflow repairs | Done | Two-way shift swap, move a visit to another day, move between routes; review alerts now close when a carer is replaced |
| 5. Documents and exports | Done | Rota print and MAR chart read back by tests (one overlap fixed); one CSV writer (negative amounts, Excel encoding, formula safety) |
| 6. Screens and hydration | Done | 96 screens at 1440, 1366, 834 and 390 on full-scale data with no problems; one hydration cause found and fixed |
| 7. Synthetic data | Done | Three branches, seven areas, 58 people, 58 carers, about 173 visits a day, six weeks, in a disposable local database with a one-step restore. `V1_DEMO_DATA_VALIDATION.md` |
| 8. Scenarios | Done | 24 scenarios with steps and the automated test for each. `V1_MANUAL_TEST_SCENARIOS.md` |
| 9. Performance | Done (measured) | Every measured page under 1 s of server time at full scale; two scale defects fixed. `V1_OPERATIONAL_AUDIT.md` |
| 10. Documents and PR | Done | This file and the six others in `docs/implementation/V1_*.md` |

19 defects were found and fixed or built; see `V1_DEFECT_REGISTER.md`. Two of them only appeared at full scale (a week of 1,204 visits could not be published; Unassigned Visits took over 3 seconds), which is why the full-scale data was worth building.

## Follow-up: rota calls missing and dashboards not updating (30 Oct, evening)

The owner reported scheduled calls missing from the rota and dashboards not changing after rota actions. Root causes and fixes are in `V1_ROTA_ROOT_CAUSE.md` (defects D20–D25). In short: the live demo has no rota weeks at all, and unbuilt weeks gave no explanation (both now flagged on screen). The Rota Dashboard lacked most of the figures an action changes, and now has them, counted from the same rows. Missed calls were marked hourly without a worker, and are now marked every five minutes. The Overview counted unassigned visits differently, and now uses the same rule. The owner's acceptance checklist is in `V1_MANUAL_TEST_SCENARIOS.md` (A1–A14).

Re-run after those changes, at commit 80b865e plus documents:

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Pass |
| `npm test` | **346 of 346 passed**, 47 files (adds `consistency.test.ts`) |
| `npm run test:hr` | **14 of 14 passed** |
| `npm run build && npx playwright test` | **72 of 72 passed** (12.2 min), adds `dashboard-refresh.spec.ts`; QA walk 477 page visits, 0 findings, 0 hydration warnings |
| Acceptance run on full-scale data (`csb_uat`, production build) | Add, assign, reassign, retime, swap, cancel, build and publish a week all worked, and the dashboard figures changed at every step and survived a reload. One hydration warning appeared once in an earlier attempt of this run (page not recorded) and not in the repeat |

## Test runs (exact commands and results)

All run in this environment on 30 Oct 2026 against local, disposable databases (`csb_test`, `csb_e2e`, `csb_uat`).

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | Pass |
| `npm run lint` | Pass |
| `npm test` (Vitest, unit and integration, real PostgreSQL) | **344 of 344 passed**, 46 files |
| `npm run test:hr` | **14 of 14 passed** |
| `npm run build && npx playwright test` (first full run, at the swap commit) | **70 of 70 passed** (12.3 min); QA walk 477 page visits, 0 findings, 0 hydration warnings |
| `npm run build && npx playwright test` (final full run, at commit 4a24b15) | **69 passed, 1 failed**: the rota report CSV test expected the file to start with "Date"; it now starts with the byte-order mark added on purpose (D12). The test was updated and re-run: **passed**. The final run's QA walk passed; its hydration list was not kept because the re-run cleared the results folder |
| `node scripts/uat-screens.mjs` on full-scale data | 96 screens, 0 problems (no sideways scroll, headings visible, no script or hydration errors) |
| `node scripts/uat-page-timings.mjs` and `scripts/uat-perf.ts` | Timings in `V1_OPERATIONAL_AUDIT.md` |

New tests in this pass: `tests/unit/document-rendering.test.ts` (22), `tests/unit/csv.test.ts` (3), `tests/integration/swap.test.ts` (5), `planner-moves.test.ts` (5), `uat-scenarios.test.ts` (5), `document-qa.test.ts` (3), plus additions to `tests/e2e/library.spec.ts` and `screens.spec.ts`.

## How to try it

```bash
npm run uat:data -- load        # full-scale synthetic data into the local csb_uat database (about 2.5 minutes)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csb_uat npm run dev
# sign in as coordinator@care-solution.demo, manager@care-solution.demo, or a branch coordinator such as
# coordinator.liverpool@uat.example; password DemoPassword!2026
npm run uat:data -- restore     # back to the baseline after a test session
```

The loader refuses anything that is not a local database whose name contains `uat`.

## What needs the owner

1. **Review and, if happy, say "merge".** Nothing is merged. Merging to `main` deploys to the live demo.
2. **Live demo data.** The live demo still has carers who are all "Requires review" (they have no sign-in, so they cannot acknowledge the safeguarding policy; D13). Updating the live demo's data needs your explicit "yes, reset the live demo"; the full-scale data is only for local testing.
3. **Your own sign-off** of the scenarios in `V1_MANUAL_TEST_SCENARIOS.md` before any real data goes in (your rule of 29 Oct).
4. **Medication** stays switched off until an admin records a clinical review.
5. **OnePlan side-by-side check.** The redacted OnePlan screenshots are on your laptop, so this pass could not repeat the screen-by-screen comparison. Menu order and page layouts are unchanged, but three controls were added (a swap form on the visit page, "Move to…" on run routes, and dragging a visit to another day in the planner). Please check those against OnePlan.

## Known limitations (carried forward, stated plainly)

- Messaging is in-app only: no e-mail, SMS or WhatsApp is sent (WhatsApp is Version 2). Invitations and password resets are one-time links the admin hands over.
- Clocking in is through the web app; GPS, NFC and the offline carer app are Version 2 and are not presented as real.
- Travel time between visits is advice from the gap between bookings, not worked out from addresses.
- The planner shows up to 3,000 visits a week and the Advanced Rota up to 1,000 a day, each with a message when there are more.
- Recruitment and applicant tracking are Version 2.
- Evidence files are stored on the local disk of whatever runs the app; the Azure storage option is ready but hosting comes later.
- Performance was measured in a shared cloud container; the real host will differ.

## Files changed (summary)

- PDF and viewer: `src/server/documents/{fonts.ts,fonts/,pdf.ts,docx.ts,model.ts,logo.ts}`, `src/components/library/document-viewer.tsx`, `src/app/globals.css`, `next.config.ts`, `src/server/rota/print.ts`, `src/server/care/mar-pdf.ts`.
- Rostering: `src/server/rota/{swap.ts,visits.ts,routes.ts,assign.ts,build.ts,queries.ts}`, `src/server/workforce/{eligibility.ts,impact.ts}`, `src/server/readiness/evaluate.ts`, `src/lib/london.ts`, rota pages and actions.
- Exports: `src/lib/csv.ts` and its callers; HR people export.
- Test data: `src/server/seed/uat.ts`, `prisma/seed-uat.ts`, `scripts/uat-*.{mjs,ts}`.
- Tests and the seven `V1_*` documents.
