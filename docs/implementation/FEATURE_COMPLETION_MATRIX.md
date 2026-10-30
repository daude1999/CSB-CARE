# Feature completion matrix: Rostering & Care Management

Key: ✓ done and tested · ◐ partly done (see note) · ✗ not built (marked Planned in the app).
Column checks against CLAUDE.md's "feature is done" list: CRUD with persistence, search and filters, validation, permissions, audit, empty states, automated tests.

| # | Subsection | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Today | /rota | ✓ | read | n/a | n/a | ✓ | n/a | e2e | late starts, cover gaps, review list, next two hours, next week's build, open alerts |
| 2 | Service users | /rota/service-users | ✓ | ✓ | ✓ | ✓ | ✓ sensitive fields gated | ✓ | int + e2e | contacts, absences, preferences, key safe, status flow |
| 3 | Care packages | /rota/service-users/[id]?tab=package | ✓ | create, edit, end, replace | n/a | ✓ (zod, dates, one active) | serviceUser.edit; funder needs finance.manage; area scope | ✓ | int + e2e | commissioned vs planned hours |
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
| 15b | Exceptions register | /rota/exceptions | ✓ | assign owner, escalate, resolve | state, type, severity, area, owner | ✓ | rota.monitor to view, rota.edit to act; area scope | ✓ | int + e2e | escalation in-app only; deadline per type |
| 16 | Carer mobile | /carer | ✓ | read, acknowledge, clock, not delivered, tasks, notes | n/a | ✓ | own visits only | ✓ | int + e2e | no GPS, NFC or offline |
| 17 | Tasks and notes | /carer, /rota/visits/[id], /rota/notes | ✓ | create (append-only) | dates, kind, text | ✓ | carer own visits; office rota.edit; area scope | ✓ | int + e2e | concerns raise exceptions |
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
| Clock correction requests | /carer, /rota/visits/[id] | ✓ | request, approve, reject | n/a | ✓ (zod, 24-hour window) | carer own visits; rota.clockCorrect to decide; requester cannot decide (DB trigger) | ✓ | int + e2e | approval supersedes the carer's record |
| Timesheet attendance checks | /rota/finance/timesheets/[id] | ✓ | check per line or all | n/a | ✓ | rota.edit or finance.manage; not your own timesheet | ✓ | int | submit refused while exception lines are unchecked |

## Version 1 additions (Administration, Reporting)

| Feature | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|
| Users and invitations | /admin/users, /account/[token] | ✓ | invite, revoke, edit roles and branches, deactivate, reactivate, reset link | status, name or email | ✓ (zod, 12-character passwords) | org.manage; one admin always remains | ✓ | int + e2e | links handed over by the admin, nothing emailed |
| Audit log viewer | /admin/audit, /api/admin/audit | ✓ | read, CSV | who, action, record type, dates; paged | ✓ | org.manage; own organisation only | export audited | int + e2e | |
| Analytics | /analytics, /api/analytics | ✓ | read, CSV | branch, dates, area | ✓ (dates, branch) | analytics.view plus each measure's module permission | export audited | int + e2e | 14 measures with definitions |

## Version 1 additions (Rostering, Finance, Medication)

| Feature | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|
| Live Run Routes | /rota/routes, /rota/routes/[id] | ✓ | create, add visits, reorder, remove visit, remove route | week, area | ✓ (zod, colour contrast) | rota.view to read, rota.edit to change; branch scope | ✓ | int + e2e | never assigns a carer; no travel times |
| Template Run Routes | /rota/routes/templates, /rota/routes/templates/[id] | ✓ | create, add templates, reorder, remove, switch off | n/a | ✓ | as above | ✓ | int | order carried into built weeks |
| Printable Rota | /rota/print, /api/rota/print | ✓ | PDF per carer or service user | dates (31 days), people, options | ✓ (zod) | rota.view; key safe codes need serviceUser.keysafe | ✓ every print | int + e2e | |
| Mileage claims | /carer, /rota/finance/mileage | ✓ | claim, approve, reject | status | ✓ (zod, 60 days, 500 miles) | carer own claims; finance.manage or rota.edit to decide, not your own | ✓ | int + e2e | miles as stated by the carer |
| Overnight and cut-off pay | pay and invoice runs | ✓ | n/a | n/a | n/a | finance.manage | ✓ (runs) | unit + int | split at midnight and band boundaries |
| Medication switch | /rota/settings | ✓ | on (with review note), off | n/a | ✓ | org.manage | ✓ | int + e2e | off by default |
| Medicines | /rota/service-users/[id]?tab=medication | ✓ | add, approve (second person), change, stop | n/a | ✓ (zod) | medication.view, medication.manage; branch scope | ✓ | int + e2e | DB triggers: second person, frozen once approved |
| MAR records | /carer, /rota/visits/[id] | ✓ | record dose, correct (supersede) | n/a | ✓ reason, witness, daily limit | carer own visit after clock-in; medication.manage to correct | ✓ | int | append-only (DB trigger) |
| Missed medication | /rota/exceptions, /rota/monitor, /rota | ✓ | raised by the sweep, resolved in the register | type | n/a | rota.monitor | ✓ | int | critical, 30-minute deadline |
| MAR chart | service user Medication tab, /api/rota/mar | ✓ | read, PDF | month | ✓ | medication.view | ✓ export | int | |
