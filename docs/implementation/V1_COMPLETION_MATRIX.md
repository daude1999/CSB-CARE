# Version 1 completion matrix

Branch `feature/v1-complete`. "Coded" means built with real persistence, validation, permissions and audit. "Tested" names the automated tests that exercise it (int = Vitest against a real PostgreSQL database, e2e = Playwright through the browser, unit = pure functions). "Checked by a person" is the owner's own sign-off before real data goes in; nothing below has been checked by a person yet, so that column is the owner's to fill. Test runs and results are in `TEST_RESULTS.md`; the QA walk and the principal scenario are in `V1_QA_REPORT.md`.

| # | Feature | Module | Coded | Tested | Checked by a person |
|---|---|---|---|---|---|
| 1 | Staff readiness: requirements, training records, second-person verification, competency, restrictions, exceptions, readiness matrix and queue, readiness in allocation, publish and clock-in | Workforce / Rostering | Yes | int (readiness, scenario) + e2e | |
| 2 | Policy assignment rules, read and acknowledge with fixed wording, assessment, exemption, correction, reminders and escalation in-app, Staff Sign-off and CSV | Policy & Compliance | Yes | int (signoff, scenario) + e2e | |
| 3 | Exceptions register: owner, deadline, escalation, resolution with evidence; `rota.sweep` job | Rostering | Yes | int (exceptions, scenario) + e2e | |
| 4 | Carer task outcomes and visit notes (general, handover, concern); Visit Notes list | Rostering | Yes | int (visit-record, scenario) + e2e | |
| 5 | Care packages: record, edit, end, replace, coverage against templates | Rostering | Yes | int (packages) + e2e | |
| 6 | Clock correction requests and timesheet attendance checks | Rostering / Finance | Yes | int (corrections) + e2e | |
| 7 | Users: invite links, roles, branches, deactivate, reactivate, reset links; audit log viewer and CSV; modules open built screens | Administration | Yes | int (admin-users, scenario) + e2e | |
| 8 | Analytics: 14 defined measures, branch and organisation scope, CSV | Reporting | Yes | int (kpis, scenario) + e2e | |
| 9 | Live and template run routes, printable rota PDF, mileage claims | Rostering / Finance | Yes | int (routes-print-mileage) + e2e | |
| 10 | Overnight and band splitting; pay period cut-off carry-over; unfinished-at-cut-off; clock-change safety | Finance | Yes | unit (pricing) + int (cutoff, finance) | |
| 10b | Travel-gap and 11-hour rest advice in the allocation picker | Rostering | Yes | unit (travel-rest) | |
| 11 | Medication: organisation switch with clinical review note, medicines with second-person approval, MAR recording on visits, corrections, missed-medication exceptions, MAR chart and PDF | Rostering | Yes, switched off | int (medication) + e2e | |
| 12 | Local-first: Windows guide, safe local reset (`--clean` for real data), `org:create`, `dev:all`, Docker option | Platform | Yes | used on the local database; `provisionOrganisation` int-tested | |
| 13 | Principal scenario HR → pay → reports | All | n/a | int (v1-scenario) + e2e (v1-scenario) | |
| QA | Every reachable screen for 8 roles; main screens at 1440, 834 and 390; keyboard reachability | All | n/a | e2e (qa-walk, screens) | |

## Built before V1 and re-checked in the QA walk

Policy Library, Regulatory Updates, Requirements Register, Change Queue, Audits, Actions & Risks, Evidence Library, Compliance Reports, AI Assistant (simulated), Rota dashboard, Daily Visits, Advanced Rota planner, Build Rota, Templates, Monitor, Service Users, Care Plans, Risk Assessments, Incidents, Rota Reports, Finance (rates, funders, timesheets, pay and invoice runs), HR & Workforce (the HR Hub, its own tests), Settings and Areas.

## Version 2 (not built, labelled in the app)

WhatsApp and other messaging, recruitment, the offline carer app (and GPS or NFC), travel planning and route optimisation, GP Connect and pharmacy links, automatic pay adjustments after an approved run.
