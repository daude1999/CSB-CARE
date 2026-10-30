# Version 1 full functional test matrix

Phase 3 of the V1 readiness brief: every action exercised end to end. Each row names the automated tests that run the action against a real PostgreSQL database (int, Vitest) or through the browser (e2e, Playwright). Columns:

- **Persists**: the change is saved and read back.
- **Audit**: an audit log entry or record history is written and checked.
- **Invalid**: bad input is refused with a useful message.
- **Permission**: a person without the right role, branch or organisation is refused on the server.
- **Second user**: a second person (approver, another coordinator, another organisation) is part of the test.
- **Feedback**: the screen shows a success or error message (the shared `?ok=` / `?error=` flash, checked in e2e).

✓ = the behaviour is built and the named test files exercise it. Persists, Invalid, Permission and Second user are asserted directly. Audit and Feedback are asserted directly for most rows (audit counts in the integration tests, flash messages in the e2e tests); for the rest the action runs through the same `audit()` and `handle()` paths, so treat those cells as covered by the shared path rather than by a dedicated assertion. · = not applicable.

## Rostering & Care Management

| Action | Persists | Audit | Invalid | Permission | Second user | Feedback | Tests |
|---|---|---|---|---|---|---|---|
| Build a week (preview, confirm, never duplicate) | ✓ | ✓ | ✓ past week, not Monday | ✓ | · | ✓ | int rota; e2e rota, v1-scenario |
| Publish a week (re-checks every carer, flags, notifies in-app) | ✓ | ✓ | · | ✓ | · | ✓ | int rota, readiness; e2e v1-scenario |
| Delete an untouched build (refused once a visit was changed by hand) | ✓ | ✓ | ✓ | ✓ | · | ✓ | int rota |
| Assign / reassign a carer (eligibility, warnings need confirmation) | ✓ | ✓ | ✓ ineligible, double-booking | ✓ | ✓ concurrent edit | ✓ | int rota, uat-scenarios; e2e rota |
| Remove a carer (reason required, alerts closed) | ✓ | ✓ | ✓ | ✓ | · | ✓ | int rota |
| Two-way shift swap | ✓ | ✓ | ✓ overlap, training, same visit, no reason | ✓ carer role, other organisation | ✓ two coordinators at once | ✓ | int swap |
| Move a visit to another day in the planner (optionally another carer) | ✓ | ✓ | ✓ past, time-locked, stale version, double-booking | ✓ | · | ✓ | int planner-moves |
| Change time or duration; cancel and reinstate; double-up on and off | ✓ | ✓ | ✓ reason for reinstating | ✓ | ✓ stale version | ✓ | int rota-bulk, rota |
| Add a one-off visit | ✓ | ✓ | ✓ inactive person | ✓ | · | ✓ | int rota |
| Bulk actions on visits and templates | ✓ | ✓ | ✓ time lock respected | ✓ | · | ✓ | int rota-bulk |
| Templates: create, edit, duplicate, switch off, set carer | ✓ | ✓ | ✓ clash in pattern, stale version | ✓ | · | ✓ | int rota, rota-bulk |
| Template change: preview impact, apply safely to future visits | ✓ | ✓ | ✓ stale preview | ✓ | · | ✓ | int uat-scenarios |
| Run routes (live and template): add, order, remove, move between routes | ✓ | ✓ | ✓ other week, unreadable colours | ✓ branch | · | ✓ | int routes-print-mileage, planner-moves; e2e v1 |
| Printable rota PDF (carer or person, key safes only if allowed) | ✓ | ✓ | ✓ range too long | ✓ key safe permission | · | ✓ | int routes-print-mileage, document-qa; e2e v1 |
| Clock in and out (own visit only, early and repeat refused, note on short) | ✓ | ✓ | ✓ | ✓ other carer's visit | · | ✓ | int attendance |
| Call monitoring sweep: late, missed, not clocked out (each once) | ✓ | ✓ | · | ✓ | · | ✓ | int attendance, monitoring, uat-scenarios |
| Office records a late arrival or short clock-out | ✓ | ✓ | ✓ note required | ✓ | · | ✓ | int attendance |
| Clock correction request and approval | ✓ | ✓ | ✓ | ✓ | ✓ different approver | ✓ | int corrections; e2e v1 |
| Exceptions: own, escalate, resolve with evidence, deadlines | ✓ | ✓ | ✓ | ✓ branch | ✓ | ✓ | int exceptions; e2e v1 |
| Visit record: tasks, notes, concerns | ✓ | ✓ | ✓ reason for not done | ✓ not on the visit | · | ✓ | int visit-record; e2e v1 |
| Service users: create, edit, end care (future visits cancelled) | ✓ | ✓ | ✓ | ✓ other organisation | · | ✓ | int rota |
| Key safe reveal | · | ✓ every reveal | · | ✓ hidden without access | · | ✓ | int rota |
| Care packages: record, replace, end, coverage | ✓ | ✓ | ✓ | ✓ branch | · | ✓ | int packages; e2e v1 |
| Care plans: draft, submit, approve, supersede | ✓ | ✓ | ✓ stale save, every section | ✓ | ✓ second person approves | ✓ | int care-records |
| Risk assessments: create, review, archive | ✓ | ✓ | ✓ | ✓ | · | ✓ | int care-records |
| Incidents: report, triage, close | ✓ | ✓ | ✓ outcome required | ✓ reporter sees own | ✓ | ✓ | int care-records |
| Medication (switched off): enable with review note, add, approve, record, MAR | ✓ | ✓ | ✓ | ✓ | ✓ second person, witness | ✓ | int medication, document-qa; e2e v1 |
| Rota reports and CSV | ✓ reconciles | ✓ | ✓ bad ranges | ✓ export permission | · | ✓ | int rota-reports |
| Unassigned Visits with ranked suggestions | · | · | · | ✓ | · | ✓ | int uat-scenarios; e2e qa-walk |

## HR & Workforce and staff readiness

| Action | Persists | Audit | Invalid | Permission | Second user | Feedback | Tests |
|---|---|---|---|---|---|---|---|
| HR save projects staff into Rostering in the same transaction (rolls back together) | ✓ | ✓ | · | · | · | · | int rota |
| HR change flags affected visits, never reassigns (expiring check, absence) | ✓ | ✓ | · | · | · | ✓ | int rota, uat-scenarios |
| Absence: record, approve (not by the requester), cancel | ✓ | ✓ | ✓ overlap | ✓ Branch Viewer refused | ✓ | ✓ | int rota |
| Sickness cover: flagged visit covered by an eligible carer, alert closed | ✓ | ✓ | · | · | · | ✓ | int uat-scenarios |
| Link a sign-in to a staff member (by hand only) | ✓ | ✓ | ✓ confirmation | ✓ | · | ✓ | int rota |
| Training record and second-person verification | ✓ | ✓ | ✓ future dates | ✓ | ✓ | ✓ | int readiness; e2e v1 |
| Exceptions to requirements (time-limited, revocable) | ✓ | ✓ | ✓ where forbidden | ✓ | ✓ | ✓ | int readiness |
| Requirement versioning | ✓ | ✓ | · | ✓ | · | ✓ | int readiness |
| HR Hub's own domain rules | ✓ | ✓ | ✓ | ✓ | · | · | `npm run test:hr` (14) |

## Policy & Compliance

| Action | Persists | Audit | Invalid | Permission | Second user | Feedback | Tests |
|---|---|---|---|---|---|---|---|
| Policy revision: draft, review, approve, publish, roll back | ✓ | ✓ | ✓ illegal transitions | ✓ | ✓ separate approver | ✓ | int workflow, scenario |
| Policy Library: list, search, inspect, archive and restore | ✓ | ✓ | ✓ reason | ✓ other organisation | · | ✓ | int library; e2e library |
| Policy documents: PDF and Word | · | · | · | ✓ | · | ✓ | unit document-rendering, documents; e2e library |
| Staff sign-off: rules, acknowledge, assess, exempt, correct, export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | int signoff; e2e v1 |
| Regulatory monitoring and change items | ✓ | ✓ | · | ✓ | · | · | int monitoring |
| Audits, findings, actions with separate verification | ✓ | ✓ | ✓ unanswered questions | ✓ | ✓ | ✓ | int workflow |
| Evidence uploads (type sniffing) | ✓ | ✓ | ✓ disallowed files | ✓ | · | ✓ | int workflow |

## Finance

| Action | Persists | Audit | Invalid | Permission | Second user | Feedback | Tests |
|---|---|---|---|---|---|---|---|
| Timesheets: generate, check exception lines, adjust, submit, approve | ✓ | ✓ | ✓ unchecked exceptions, stale version | ✓ branch | ✓ someone else decides | ✓ | int finance, corrections |
| Pay and invoice runs: prepare, approve, void, export | ✓ | ✓ | ✓ one open run a week | ✓ | ✓ second approver | ✓ | int finance |
| Rate cards, bands, bank holidays, overnight and cut-off | ✓ | ✓ | ✓ used card locked | ✓ | · | ✓ | unit pricing; int finance, cutoff |
| Mileage claims | ✓ | ✓ | ✓ future dates | ✓ | ✓ someone else decides | ✓ | int routes-print-mileage; e2e v1 |

## Reporting & Analytics; Administration & Settings

| Action | Persists | Audit | Invalid | Permission | Second user | Feedback | Tests |
|---|---|---|---|---|---|---|---|
| Analytics: 14 measures with definitions, branch scope, CSV | · | ✓ export | ✓ dates | ✓ role and branch | · | ✓ | int kpis; e2e v1 |
| Users: invite, roles, branches, deactivate, reactivate, reset | ✓ | ✓ | ✓ | ✓ other organisation | ✓ | ✓ | int admin-users; e2e v1 |
| Branch grants and area limits | ✓ | ✓ | ✓ | ✓ | · | ✓ | int branches |
| Audit log viewer and export | · | ✓ | · | ✓ | · | ✓ | int admin-users |
| Overview module order | ✓ | · | ✓ | ✓ | · | ✓ | int overview-layout; e2e overview |
| Sign-in, sessions, rate limiting | ✓ | · | ✓ | · | · | ✓ | int workflow |

## Whole-app checks

| Check | Tests |
|---|---|
| Every reachable screen for 8 roles: no errors, labelled controls, named buttons | e2e qa-walk (477 page visits, 0 findings in the last run) |
| Main screens at 1440, 1366, 834 and 390: no sideways scroll, visible heading | e2e screens; `scripts/uat-screens.mjs` on full-scale data (96 screens, 0 problems) |
| Keyboard: menu and portal switcher | e2e screens, navigation |
| Principal scenario HR → rota → visit → exception → timesheet → report | int v1-scenario; e2e v1-scenario |

## Last runs (30 Oct 2026)

See `V1_FINAL_HANDOVER.md` for the exact commands and results.
