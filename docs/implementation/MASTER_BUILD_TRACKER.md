# Master build tracker — five-module CSB CRM

Branch: `claude/project-thread-7d06tt` (daude1999/csb-care). Never merged to `main` without the owner's explicit "merge".
Brief: the owner's "Master autonomous CRM implementation" message of 29 October 2026 (project thread "Build the five-module CSB CRM").

## Status by stage

| Stage | State | Notes |
|---|---|---|
| 0 Audit and baseline | Done | Baseline green: typecheck, lint, vitest 109, HR 14, e2e 16 (see TEST_RESULTS.md). OnePlan research (PR #23) merged into this branch. HR–Rostering plan was missing; written at docs/architecture/HR_ROSTERING_INTEGRATION_PLAN.md |
| 1 Five-module dashboard | In progress | |
| 2 Shared workforce identity | In progress | Schema + migration `20261029120000_workforce_rostering_care_finance`; projection in `src/server/workforce/projection.ts`, hooked into `src/hr/lib/store.ts` transaction |
| 3 Eligibility, absences, availability | In progress | `src/server/workforce/eligibility.ts`, `impact.ts` written; absence/availability screens to do |
| 4 Service users | Not started | Schema done |
| 5 Rota engine | Not started | Schema + DB rules done (no double-booking exclusion constraint, template/date uniqueness, visit state machine) |
| 6 Rota screens | Not started | |
| 7 Call monitoring | Not started | |
| 8 Carer mobile | Not started | |
| 9 Care plans, risks, incidents | Not started | Schema + care-plan immutability trigger done |
| 10 Finance | Not started | Schema + frozen-run triggers done |
| 11 Reporting and admin | Not started | |
| 12 Final QA | Not started | |

## Priority order (owner, 29 Oct 11:10)

Rota core first: staff link, templates, Build Rota, daily visits, planner. Carer mobile and finance after.

## Next actions

1. Portals: five modules (merge Service Users into Rostering & Care Management; drop ECM tile), sidebar groups.
2. Seed: Branch.hrBranchKey for demo branches, reconcile workforce after HR seed, demo rota data.
3. Assignment service, template CRUD, build engine, visit operations.
4. Screens: Today, Daily Visits, Templates, Build Rota, Planner, Staff directory.
