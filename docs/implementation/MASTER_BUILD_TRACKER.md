# Master build tracker — five-module CSB CRM

Branch: `claude/project-thread-7d06tt` (daude1999/csb-care). Never merged to `main` without the owner's explicit "merge".
Brief: the owner's "Master autonomous CRM implementation" message of 29 October 2026 (project thread "Build the five-module CSB CRM").

## Status by stage

| Stage | State | Notes |
|---|---|---|
| 0 Audit and baseline | Done | Baseline green: typecheck, lint, vitest 109, HR 14, e2e 16 (see TEST_RESULTS.md). OnePlan research (PR #23) merged into this branch. HR–Rostering plan written at docs/architecture/HR_ROSTERING_INTEGRATION_PLAN.md |
| 1 Five-module dashboard | Done | Portals: Overview, Policy & Compliance, Rostering & Care Management, HR & Workforce, Reporting, Administration. ECM and Service Users tiles removed; /service-users redirects to /rota/service-users. Rota sidebar grouped; unbuilt pages marked Planned |
| 2 Shared workforce identity | Done | `StaffMember` projected inside every HR transaction (`src/hr/lib/workspace-tx.ts` → `src/server/workforce/projection.ts`); reconcile and explicit sign-in linking on /admin/workforce |
| 3 Eligibility, absences, availability | Done | `eligibility.ts` (14 rules), `impact.ts` (flag, never auto-reassign). Staff page has an eligibility checker. /workforce/absences (separation of duties) and /workforce/availability built |
| 4 Service users | Done (core) | `src/server/care/service-users.ts`: register, create, edit (version check), status flow incl. ending care, contacts, absences (cancel built visits), carer preferences (re-check), key safe (encrypted, audited reveal) |
| 5 Rota engine | Done | templates, build (preview/confirm/publish/delete, advisory lock, no duplicates), visits (edit, cancel, reinstate, double-up, bulk), one assignment path with row locks + DB exclusion constraint |
| 6 Rota screens | Done (core) | /rota (Today), /rota/visits, /rota/visits/[id], /rota/unassigned, /rota/planner (drag + confirm), /rota/templates (+new, [id], planner), /rota/build, /rota/service-users (+new, [id]), /rota/staff (+[id]), /rota/settings, /admin/areas |
| 7 Call monitoring | Done | `src/server/rota/monitor.ts`: sweep in `maintenance.tick` (late alert, then missed once, overrun), /rota/monitor with Check now, last-check time and alert latency |
| 8 Carer mobile | Mostly done | /carer: My Visits, acknowledgement, clock in/out (server time, nonce against double submit), short-visit note, "Could not deliver". Office entries and corrections on the visit page (`attendance.ts`). No GPS, NFC, offline or task recording |
| 9 Care plans, risks, incidents | Done | `src/server/care/{care-plans,risks,incidents}.ts`. Versioned plans with second-person approval and carer read confirmation; risk register with reviews and archive; incidents with manager triage, notifiable reminder and close. Demo records seeded through the services |
| 10 Finance | Not started | Schema + frozen-run triggers done |
| 11 Reporting and admin | Not started | |
| 12 Final QA | In progress | vitest 152, HR 14, e2e 26/26; screenshots in docs/implementation/screenshots. See TEST_RESULTS.md |

## Priority order (owner, 29 Oct 11:10)

Rota core first: staff link, templates, Build Rota, daily visits, planner. Carer mobile and finance after.

## Next actions

1. Open the review PR (done once this checkpoint is pushed) and keep it green. Never merge without the owner's "merge".
2. Carer task recording (VisitTaskOutcome) and visit notes from the phone.
3. Timesheets from clock records.
4. Tasks and notes from the phone.
5. Timesheets, rates, invoicing and payroll prep (separation of duties, never issued automatically).
6. Rostering reports.

Docs: ARCHITECTURE_DECISIONS.md, FEATURE_COMPLETION_MATRIX.md, KNOWN_LIMITATIONS.md and TEST_RESULTS.md are current as of this checkpoint.

## Notes for a resumed session

- Local DB `csb` is disposable (drop/create + `prisma migrate deploy` + `npm run db:seed`). Prisma blocks `migrate reset` from AI sessions; use dropdb/createdb on the local server only.
- Demo seed: `seedDemo(masters, { care: true })` builds this week and next; 266 visits a week, about 21 empty slots a week (HR fixtures leave some carers non-compliant on purpose).
