# Feature completion matrix: Rostering & Care Management

Key: ✓ done and tested · ◐ partly done (see note) · ✗ not built (marked Planned in the app).
Column checks against CLAUDE.md's "feature is done" list: CRUD with persistence, search and filters, validation, permissions, audit, empty states, automated tests.

| # | Subsection | Route | State | CRUD | Filters | Validation | Permissions | Audit | Tests | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Today | /rota | ✓ | read | n/a | n/a | ✓ | n/a | e2e | late starts, cover gaps, review list, next two hours, next week's build, open alerts |
| 2 | Service users | /rota/service-users | ✓ | ✓ | ✓ | ✓ | ✓ sensitive fields gated | ✓ | int + e2e | contacts, absences, preferences, key safe, status flow |
| 3 | Care packages | — | ✗ | | | | | | | the service user's visit pattern lives in templates for now |
| 4 | Care plans and risks | — | ✗ | | | | | | | schema only |
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
| 18 | Incidents | — | ✗ | | | | | | | |
| 19 | Timesheets | — | ✗ | | | | | | | |
| 20 | Rates | — | ✗ | | | | | | | |
| 21 | Finance and invoicing | — | ✗ | | | | | | | never issued automatically |
| 22 | Payroll preparation | — | ✗ | | | | | | | |
| 23 | Reports | — | ✗ | | | | | | | |
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
