# Feature completion matrix: Rostering & Care Management

Key: ✓ done and tested · ◐ partly done (see note) · ✗ not built (marked Planned in the app).
Column checks against CLAUDE.md's "feature is done" list: CRUD with persistence, search and filters, validation, permissions, audit, empty states, automated tests.

| # | Subsection | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Today | /rota | ✓ | read | n/a | n/a | ✓ | n/a | e2e | late starts, cover gaps, review list, next two hours, next week's build, open alerts |
| 2 | Service users | /rota/service-users | ✓ | ✓ | ✓ | ✓ | ✓ sensitive fields gated | ✓ | int + e2e | contacts, absences, preferences, key safe, status flow |
| 3 | Care packages | — | ✗ | | | | | | | the service user's visit pattern lives in templates for now |
| 4 | Care plans and risks | /rota/care-plans, /rota/risks, /carer/care-plan/[id] | ✓ | ✓ | ✓ | ✓ | edit, approve (second person), carer own people only | ✓ | int + e2e | approved versions frozen by trigger |
| 5 | Recurring templates (1–4 week cycle) | /rota/templates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | int | carer clash refused, bulk enable/disable/nudge, duplicate, apply to built visits |
| 6 | Template planner | /rota/templates/planner | ✓ | update | ✓ | ✓ | ✓ | ✓ | manual browser check | drag a template to another carer |
| 7 | Build Rota | /rota/build | ✓ | ✓ | areas, cycle | ✓ | rota.build | ✓ | int + e2e | preview, checklist, confirm, publish, delete |
| 8 | Daily Visits | /rota/visits | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | int + e2e | bulk assign, move, lock, publish, cancel with a per-visit report |
| 9 | Rota planner | /rota/planner | ✓ | update | ✓ | ✓ | ✓ | ✓ | e2e (render) + manual drag | drag with eligibility check and "Move anyway" confirm |
| 10 | Allocation | /rota/visits/[id] | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | int + e2e | ranked candidates, warnings need explicit acceptance |
| 11 | Unassigned visits | /rota/unassigned | ✓ | update | ✓ | ✓ | ✓ | ✓ | e2e | suggestions for the first 25 |
| 12 | Double-ups | visit page | ✓ | ✓ | n/a | two distinct carers | ✓ | ✓ | int | |
| 13 | Run routes | — | ✗ | | | | | | | |
| 14 | ECM / clocking | /carer, /rota/visits/[id] | ✓ | create + correct | n/a | ✓ (zod, order of events, short-visit note) | own visits only; office needs rota.clockCorrect | ✓ | int + manual browser | append-only; corrections supersede; no GPS/NFC |
| 15 | Live call monitor | /rota/monitor | ✓ | read + check now | area | n/a | rota.monitor | runs recorded | int + e2e | late, missed, overrun, not delivered; alert latency |
| 16 | Carer mobile | /carer | ◐ | read, acknowledge, clock, not delivered | n/a | ✓ | own visits only | ✓ | int + e2e | no task recording, GPS, NFC or offline |
| 17 | Tasks and notes | — | ✗ | | | | | | | call types and care tasks reference lists exist |
| 18 | Incidents | /rota/incidents | ✓ | ✓ | ✓ | ✓ | report vs manage; reporters see own | ✓ | int + e2e | in-app alerts; never sends statutory notifications |
| 19 | Timesheets | /rota/finance/timesheets | ✓ | generate, adjust (reason), submit, approve/reject, bulk | week, status | ✓ (zod, version check) | finance.view/manage/approve; submitter cannot decide | ✓ | int + e2e | built from effective clock records; exceptions listed |
| 20 | Rates | /rota/finance/rates | ✓ | funders, rate cards, bands, bank holidays, settings, package funders, staff pay cards | tabs | ✓ (zod) | finance.manage | ✓ | int + unit | money in pence; bands locked once used in a run |
| 21 | Finance and invoicing | /rota/finance, /rota/finance/invoices | ✓ | prepare, approve (second person), void, CSV | week | ✓ | finance.manage/approve; creator cannot approve (DB trigger too) | ✓ | int + e2e | numbered on approval; never sent or issued |
| 22 | Payroll preparation | /rota/finance/payroll | ✓ | prepare, approve (second person), void, CSV | week | ✓ | finance.manage/approve; creator cannot approve (DB trigger too) | ✓ | int + e2e | gross hours and pay only; nothing is paid |
| 23 | Reports | /rota/reports | ✓ | read + CSV | report, dates (≤ 92 days), area | ✓ (zod, range checks) | rota.view; CSV needs report.export; area scope | export audited | int + e2e | delivery, hours by person, carer attendance, unfilled, alerts; worked out live from corrected clock times; no medication figures |
| 24 | Settings | /rota/settings, /admin/areas | ✓ | ✓ | n/a | ✓ (zod) | rota.settings, org.manage | ✓ | int | areas, call types, care tasks, member areas |

## Supporting features

| Feature | Route | State | Tests |
|---|---|---|---|
| HR → staff projection and reconcile | /admin/workforce | ✓ | int (projection, rollback) |
| Link sign-ins to staff (explicit only) | /admin/workforce | ✓ | int |
| Staff eligibility and rota profile | /rota/staff, /rota/staff/[id] | ✓ | int |
| Staff absences (HR-controlled, separation of duties) | /workforce/absences | ✓ | int |
| Weekly availability | /workforce/availability | ✓ | manual browser check |
| Alerts (flag, never reassign) | /rota | ✓ | int |

## Version 1 additions (Policy & Compliance)

| Feature | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|
| Policy assignment rules | /staff/policy/[id] | ✓ | create, withdraw | n/a | ✓ (zod) | signoff.manage; branch-limited members only target their branches | ✓ | int + e2e | withdrawing removes outstanding rows not covered by another rule |
| Staff Sign-off | /staff, /staff/person/[key], /api/staff-signoff | ✓ | read, exempt, assess, correct, CSV | person, policy, branch, role, state, overdue | ✓ | signoff.manage to act; branch scope | ✓ (export audited) | int + e2e | acknowledgement is not training and the page says so |
| Read and acknowledge | /acknowledgements, /policies/[id] | ✓ | open, acknowledge | state | fixed wording | own rows only | ✓ events append-only | int + e2e | assessment step where the rule asks for one |
