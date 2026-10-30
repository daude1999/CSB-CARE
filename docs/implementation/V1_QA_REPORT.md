# Version 1 QA report

30 October 2026, branch `feature/v1-complete`. Every result below comes from tests that ran on this branch against local PostgreSQL 16 databases (never the live demo). Commands and full results are in `TEST_RESULTS.md`.

## Result

**Pass, with one open item.** After bringing in the latest `main`, 294 unit and integration tests, 14 HR Hub tests and 68 browser tests pass, with none failing. The browser tests include the principal scenario and a walk of 475 screens for 8 roles. One open item: a browser console notice from React appears on 1–3 screens per walk (once in the final run; details below). Nothing has been checked by a person yet: use `V1_ACCEPTANCE_CHECKLIST.md` before real data goes in.

## The principal scenario

| Step | Database test | Browser test |
|---|---|---|
| HR creates a person | Pass | Covered by HR Hub tests |
| Appears in Rostering | Pass | Pass (demo staff) |
| Training requirements apply (not ready) | Pass | Pass (readiness test) |
| Evidence recorded and verified by a second person | Pass | Pass (readiness test) |
| Policies assigned | Pass | Pass (sign-off test) |
| Acknowledged by the person | Pass | Pass (policy scenario test) |
| Competency verified | Pass | n/a |
| Readiness worked out: ready | Pass | n/a |
| Service user created and made active | Pass | Pass |
| Repeating visit | Pass | Pass |
| Build Rota | Pass | Pass |
| Allocate through the eligibility check | Pass | Pass (with "I have read the warnings") |
| Publish | Pass | Pass |
| Carer sees the visit | Pass | Pass |
| Clock in | Pass | Pass when a visit is due at test time (the test clocks in only if the button is shown) |
| Task recorded | Pass | n/a |
| Concern note | Pass | Pass |
| Clock out | Pass | n/a |
| Exception reviewed and resolved | Pass | Pass |
| Timesheet submitted and approved by someone else | Pass | Pass (finance test) |
| Pay run includes the visit | Pass | Pass (finance test) |
| Branch and organisation reports | Pass | Pass |

## By module

| Module | Result | What was tested |
|---|---|---|
| Policy & Compliance | Pass | Library, policy pages, change queue, drafting to publication with separation of duties, assignment rules, acknowledgement with fixed wording, Staff Sign-off and CSV, audits, actions, evidence |
| Rostering & Care Management | Pass | Dashboard, Daily Visits, Advanced Rota, Build Rota, templates, allocation and eligibility, Monitor, Exceptions, Visit Notes, run routes, printable rota, service users, care packages, care plans, risks, incidents, carer page (clock, tasks, notes, corrections, mileage), Rota Reports |
| Medication | Pass (switched off) | Off until an admin records a clinical review; second-person approval (also enforced by the database); dose rules (clock-in, reasons, witness, daily limit); corrections keep the original; missed-medication exceptions; MAR chart; branch scope |
| Finance | Pass | Rates, funders, timesheets with attendance checks, pay and invoice runs with a second approver, overnight and cut-off pay, mileage, CSV |
| HR & Workforce | Pass | HR Hub's own tests, the staff projection, absences, the link between sign-ins and staff |
| Reporting & Analytics | Pass | 14 measures with definitions, branch and organisation scope, CSV, Compliance Reports, Rota Reports |
| Administration & Settings | Pass | Users (invite, roles, branches, deactivate, reset), audit log and CSV, branches, areas, rota settings, modules, setting up a real organisation from the command line |
| Branches and permissions | Pass | Branch-limited members kept to their branches in every new feature; carers kept to their own visits; second-person rules; other organisations kept out |
| Phone, tablet, desktop | Pass | 20 main screens at 1440, 834 and 390 with no sideways scrolling (screenshots in `screenshots/v1/`); keyboard check of the menu |

## The QA walk

Every screen each role can reach from its menus, and every link on those screens (two levels, each kind of screen once), was opened and checked. A check failed on a server error, a missing page, no heading, an error screen, a script error, sideways scrolling or an unlabelled form control.

| Role | Screens | Problems found (first run) | After fixes |
|---|---|---|---|
| Organisation admin (manager@) | 205 | 0 (+1 console notice) | 0 |
| Coordinator | 117 | 3 dead links | 0 |
| Finance officer | 54 | 4 dead links | 0 |
| Carer | 19 | 2 dead links | 0 |
| Policy author | 19 | 1 dead link | 0 |
| Policy approver | 22 | 1 dead link | 0 |
| Branch HR | 15 | 2 dead links | 0 |
| CSB platform admin | 24 | 5 dead links | 0 |

Fixed: care staff can now open policies they are asked to sign; dashboard links, the change queue, module pages and Settings tags only lead where the person can go; the Compliance dashboard no longer scrolls sideways on tablet and phone. Full list in `TEST_RESULTS.md`.

## Open item

React's hydration notice (#418) appears in the browser console on 1–3 of the 475 screens per walk, on a different screen each time. The page shows and works correctly. The cause is not yet found, and it could not be reproduced on its own.

## Not built (Version 2, labelled in the app)

WhatsApp and other messaging, recruitment, the offline carer app (GPS, NFC), travel planning, GP Connect and pharmacy links, automatic pay adjustments after an approved run.
