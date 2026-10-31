# Rota defect register

Owner's reports of 31 Oct 2026: "Build Rota does not let me build a schedule", "branch access appears organisation-wide", and the wider rostering audit. Investigated on branch `claude/project-thread-v3f4gj` against the full-scale synthetic UAT data in the local, disposable `csb_uat` database (58 service users, 58 carers, 3 branches, 7 areas, about 170 visits a day, seven weeks built from 12 Oct to 29 Nov). The hosted demo was not touched.

Earlier fixes in PR #29 (calls missing because no weeks were built, dashboards not refreshing) are not repeated here.

Severity: **Critical** (data exposure or wrong data across branches), **High** (a core workflow fails or misleads), **Medium** (workflow works but fails badly in some cases), **Low** (polish).

| ID | Feature | How to reproduce | Root cause | Severity | Fix | Tests | Result |
|---|---|---|---|---|---|---|---|
| R01 | Build Rota | Open Build Rota on data that already has weeks built ahead (the live demo has four). Press Build Rota. | The form always opened on next Monday. That week was already built, so the preview showed 0 visits and only "Nothing new to build for this week", with no reason and no way forward. | High | The form now opens on the next week that is not built for the member's own areas (the current week if it is unbuilt). A note says how far the rota is already built. | `rota-branch-builds.test.ts` "opens on the next week that still needs building"; browser step 1 | Opens on 30/11/2026 on UAT data (screenshot 01) |
| R02 | Build Rota | Choose a built week, a week with no templates, a cycle week with no templates, or an area user with no areas. | `plan()` returned an empty preview and the page showed one generic line. | High | `whyNothing()` gives the precise reason, most basic first: no areas on the account, already built (with publish or open-rota link), no active templates (link to templates), no templates in this cycle week (names the weeks that have them), everything skipped (absences, care status, start already passed). The confirm action uses the same message. | 4 integration tests; browser step 2 | Pass (screenshot 02) |
| R03 | Build Rota | Choose a Week Setting that is not a number (edit the address to `cycle=abc`). | `Number("abc")` is NaN, which passed the range check and reached Prisma, giving a generic error. | Medium | `parseCycleWeek` rejects non-integers with a readable message. | "rejects a Week Setting…" | Pass |
| R04 | Build Rota | Build the current week on Wednesday. | Monday and Tuesday visits were created in the past and the call sweep immediately marked them missed. | Medium | Visits whose start has passed are skipped with the reason "Start time has already passed". The demo seeds keep building whole past and current weeks. | Covered by seeds and existing build tests | Pass |
| R05 | Build Rota, branch access | As a Liverpool-only coordinator, open All Rotas, then publish or delete a Tower Hamlets build by its id. | `listBuilds`, `publishBuild`, `deleteBuild` filtered by organisation only. | Critical | Builds are filtered to those touching the member's areas (`buildWhere`). Publish acts only on the member's own visits in a shared build. Delete is refused unless the whole build is inside the member's areas. Other branches' areas are counted, never named. | 6 integration tests; browser steps 6, 7 | Tower Hamlets gets "not found"; nothing changes |
| R06 | Rota Dashboard, Daily Rota, Planner | As a Liverpool coordinator, ask whether a week is built when only Tower Hamlets built it. | `weekIsBuilt` and the dashboard build count were organisation-wide, so "not built" notices were hidden. | High | Both use `buildWhere`. | "says a week is not built for a branch…" | Pass |
| R07 | Daily Rota search | As a Liverpool coordinator, search the Daily Rota for a Tower Hamlets surname. | The search added an `OR` that replaced the area limit's `OR` in the same object, so every branch's matching visits appeared. | Critical | `visitWhere` now puts the limit inside `AND`, so no caller can replace it. | "keeps a Tower Hamlets visit… out of… searches"; browser step 21 | Search finds 0 |
| R08 | The Monitor (ECM) | As a Liverpool coordinator, open the Monitor. | Same `OR` collision with the Monitor's two-day window: every branch's calls showed. | Critical | Fixed by R07. | "keeps the Monitor to the coordinator's own branch" | Pass |
| R09 | Visits with no area | Create a Tower Hamlets visit with no area. Open it as a Liverpool coordinator. | Records with no area were visible to every member. | Critical | A visit or template with no area is judged by its service user's area and branch, in queries and in single-record checks. | 3 integration tests | Liverpool gets "outside your areas"; Tower Hamlets and managers still see it |
| R10 | Rota Dashboard | Open the dashboard as a Liverpool coordinator. | Team Members, absence reminders and the holiday counter were organisation-wide. | High | All three use the member's staff scope. | "lists only the coordinator's own team, absences and holidays" | Pass |
| R11 | Template Planner | Open `/rota/templates/planner?area=<a Tower Hamlets area>` as a Liverpool coordinator. | The area filter replaced the scope instead of narrowing it. | Critical | The filter is an extra `AND` on top of the scope. | Code review; same clause as R09 tests | Pass |
| R12 | Template Run Routes | Open a staff route as an area-limited member. | The candidate list spread an area `OR`, then the staff `OR` replaced it. | High | Both clauses inside `AND`. | Code review | Pass |
| R13 | Pick lists and allocation | As a Liverpool coordinator, open a visit's carer picker or the rota staff filter. | Lists offered every branch's staff, and the server accepted any carer. | Critical | Pick lists and filters use the staff scope; `assignInTx` refuses a carer outside the member's branch or area. Managers still see the whole organisation. The planner keeps a row for another branch's carer who was booked by a manager, so the visit never disappears. | "never offers or books another branch's carer"; "lists only the coordinator's own branch staff" | Pass; browser step 9 now offers Liverpool carers only |
| R14 | Build Rota checklist | Preview a week as a Liverpool coordinator. | Holiday counts in the checklist were organisation-wide. | Low | Scoped to the member's staff. | Browser step 1 | Pass |
| R15 | Weekly Planner move, visit edit | Drag a regular visit onto the next day, where the same template already has a visit. | The database's one-visit-per-template-per-day rule rejected it and the user saw "Something went wrong". | High | A clear refusal naming the existing visit, before the write. Moves into the past are refused too. | "refuses, with a clear reason, to move a regular call…"; browser step 13 | "This service user already has this regular call on Tuesday 3 November (V-…)" |
| R16 | Visit page (accessibility) | Try to move a visit to another day without a mouse. | Moving to another day was only possible by dragging in the planner. | Medium | The Change visit card has a Date field, with the same checks as a move. | Browser step 15 | Pass |
| R17 | Build Rota (rota.build permission) | Open Build Rota as a role that can view the rota but not build. | The page returned "not found". | Low | Explains which roles can build. Roles without rota access still get "not found". | "refuses a role without rota.build" (server) | Pass |

## Not changed (recorded for the next pass)

- Alerts without a visit (for example "N slots unassigned after the build") are still visible to every member with Monitor access. They link to filtered lists that are themselves scoped, so no visit details leak, but the message text names the week and count. To be scoped when alerts gain a branch field.
- A React hydration warning (#418) appeared once in one of four browser runs and not in the repeats. Page not yet identified; tracked.

## Tests run (31 Oct 2026)

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npx vitest run tests/integration/rota-branch-builds.test.ts` | 20/20 pass. With the fixes removed, 15 of the first 17 fail, which confirms the defects were real |
| `npm test` (all unit and integration) | See PR description for the final run |
| `node scripts/uat-rota-lifecycle.mjs` on `csb_uat` (production build) | 22/22 steps pass. Screenshots in `docs/implementation/screenshots/rota-repair/` |
| `npm run test:e2e` | See PR description |
