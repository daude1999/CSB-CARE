# HR & Workforce + Policy & Compliance: approved UX build (1–2 Nov 2026)

Owner's brief: "ONE MASTER BUILD: HR & Workforce + Policy & Compliance", with 20 approved mock-ups (5 HR, 11 Compliance
crops, 2 Compliance sheets). One branch, one draft PR. **Not merged, not deployed.** The mock-ups are design direction
only; every figure on screen is counted from the organisation's own records.

## Baseline

| Item | Value |
|---|---|
| `main` at start | `a83a98d` (Merge PR #52) |
| Branch | `claude/project-thread-fs9uw6` (the session's assigned branch; no other branch had started this redesign) |
| Working tree at start | clean |
| BEFORE screenshots | 63 real captures of the running app (`main`, production build, local demo data), 1672×941, 834 and 390 wide, 5 roles. In the review pack under `before/`. |

## What changed, in one page

- **HR = orange, Compliance = blue.** Both modules use a new left-aligned title bar with the module icon
  (`src/components/module-header.tsx`), their tabs under it, then one white strip with the page's purpose and actions.
  Rota keeps the shared centred `PageHeader`/`TitleBar`, untouched.
- **HR menu: 12 entries → 7 destinations.** Every former screen is a tab of one destination, at its old address.
- **New HR screens** (`src/hr/components/hr-views.tsx`, styles in `src/hr/styles/hr-views.css`, compiled into
  `public/hr/hr-hub.css`): HR Dashboard, Training & Readiness matrix, Documents split view, employee key-check boxes.
- **Recruitment** opens on the board; a card opens a candidate panel. The list is one click away.
- **Compliance Dashboard** rebuilt: four figures, policy review status ring, needs attention, upcoming reviews, recent
  activity, quick actions, recently published, my reading list.
- **Compliance pages**: all 23 inner pages use the blue header; the circle figure cards became plain figure cards
  (`ModuleStat`); the policy page's nine square tiles became one row of line tabs.

## Feature matrix

Role abbreviations: OA Organisation Admin (manager@), GHR Group HR (jordan.ellis@), BHR Branch HR (sam.parker@),
BV Branch Viewer (taylor.reed@), CL compliance lead/manager, AU/RV/AP author/reviewer/approver, ST care staff (carer1@).
"Unit", "Int", "E2E" name the test files in `tests/unit`, `tests/integration`, `tests/e2e`.

### HR & Workforce

| Existing feature | Existing URL | Existing action / service | New screen / subview | How a user gets to it | Role | Test coverage | Screenshot |
|---|---|---|---|---|---|---|---|
| HR home (greeting, My HR work, upcoming, recently updated, organisation snapshot) | `/hr/dashboard` | `/api/hr/hub` (HubData) | HR Dashboard: 4 figures, Employee directory (search, filter, 10 per page), Needs attention, Upcoming checks & reviews, Quick actions | Menu → HR Dashboard | Any HR login; actions only if `canEdit` | E2E hr-compliance-ux; Unit hr-views | hr01 |
| My Tasks | `/hr/alerts?view=tasks` | HRTasks | Tab "My Tasks" under HR Dashboard; Needs attention → My overdue tasks; figure "Open HR tasks" | HR Dashboard tab | HR | Unit hr-shell; E2E | hr11 |
| Alerts | `/hr/alerts` | AlertsWorkspace | Tab "Alerts" under HR Dashboard | HR Dashboard tab | HR | Unit hr-shell | hr12 |
| People directory, views, saved views, export | `/hr/people` | People | Unchanged screen, orange header | Menu → People | HR | existing | hr02 |
| Employee record (overview, employment, compliance, documents, training, activity, notes, edit, upload, sensitive details) | `/hr/people/[id]` | HRRecord | Same record + 4 key-check boxes (DBS, Right to work, Training, All checks) under the name | Directory / People / any name link | HR; sensitive fields need `sensitive` | E2E (key-checks) | hr03 |
| Add / edit employee, new starter | modal | EmployeeForm | Quick action "Add employee"; People page; record actions | Dashboard quick actions | `canEdit` | existing | hr01 |
| Recruitment list, filters, figures, reminders, interviews | `/hr/recruitment` | `recruitmentBoard` | Board by default (6 real stages + Closed tab), List one click away; candidate panel `?candidate=` | Menu → Recruitment | HR login | E2E hr-compliance-ux, care-intelligence | hr04, hr05b |
| Move stage | candidate page | `moveStageAction` (lock version, `manualMoves`) | Same form also in the candidate panel | Board → card → panel | `canEdit` | existing integration | hr05b |
| Candidate record (screening, interviews, offer, onboarding, notes, retention, erase) | `/hr/recruitment/[id]` | recruitment actions | Unchanged, orange header | Panel → Open full record | HR | existing | hr05 |
| Add candidate, reminders & retention | `/hr/recruitment/new`, `/settings` | as before | Unchanged, orange header | Recruitment header buttons | HR; edit rights | existing | hr15 |
| Training list | `/hr/training` | checks (training) | Training & Readiness matrix: per employee training x/y, next due, DBS, Right to work, top 3 training requirements, Overall; search, role, status; Due this week | Menu → Checks & Training | HR | E2E; Unit hr-views | hr07 |
| Compliance checks register (overview, overdue, due soon, missing, awaiting verification, complete; review a check; second-person verification) | `/hr/compliance` | Compliance + ReviewForm | Tab "Checks Register" under Checks & Training; heading renamed "Checks register" | Checks & Training tab; dashboard Needs attention links | HR; review needs `canEdit` | E2E | hr06 |
| Document centre (categories, filters, needs attention, all documents) | `/hr/documents` | DocumentCentre | Default "By employee" split view (employee list with % of required documents on file; selected person: required documents & checks, files & history, Upload file, View file, Review); "By category" = the old document centre unchanged | Menu → Documents | HR; upload/review `canEdit`; quarantined files cannot be opened | E2E | hr08 |
| Holidays & Sickness | `/workforce/absences` | `src/server/workforce` | Tab of "Time Off & Availability" | Menu; Rota → Staff tabs (unchanged) | HR login | E2E | hr09 |
| Availability | `/workforce/availability` | as before | Tab of "Time Off & Availability" | Menu tab | HR login | E2E | hr10 |
| HR settings (requirements, thresholds, document types, retention) | `/hr/settings` | SettingsPage | Tab "HR Settings" (heading "HR settings") | Menu → Settings | HR | existing | hr14 |
| Branches | `/hr/branches` | BranchWorkspace | Tab "Branches" under Settings | Settings tab | HR | Unit hr-shell; E2E | hr13 |
| HR search (top bar, Ctrl+K) | all HR pages | CommandPalette | Unchanged | Top bar | HR | navigation.spec | — |
| Branch scope picker | all HR Hub pages | `?branch=` | Same picker, in the header strip | Header | HR | navigation.spec | hr16 |

### Policy & Compliance (six workspaces unchanged)

| Existing feature | Existing URL | Existing action / service | New screen / subview | How a user gets to it | Role | Test coverage | Screenshot |
|---|---|---|---|---|---|---|---|
| Compliance Dashboard (KPIs, needs attention, activity, quick actions, recently published, reading list, setup checklist) | `/` | `complianceDashboard` | Blue header "Policy & Compliance" + Add policy (authors only); 4 figures; Policy review status ring (current / due in 60 days / overdue, counts only); Needs attention; Upcoming reviews (next 5); Recent activity; Quick actions; Recently published; My Reading List | Menu → Compliance Dashboard | All; actions by permission | Int compliance-module; E2E | pc01, pc01b |
| Policy Library (My Policies, Templates, Archived, Review Calendar, filters, inspector) | `/policies` | library-view | **Unchanged** (it already follows the separately approved `docs/design/policy-library-reference.png`; see decision D1) | Menu | All | existing library.spec | pc02 |
| Policy page (review sheet, text, procedure, forms, versions, regulation map, read & sign, flags, downloads, start revision, log read & sign) | `/policies/[id]` | versions/workflow | Blue header with ref + title, version, next review, tags and all actions; nine square tiles → one row of line tabs (same names and panels) | Library → policy | All; actions by permission | E2E | pc03 |
| Review & Approval Queue, revisions | `/queue`, `/revisions/[id]` | workflow (separation of duties, approver count) | Blue header; figure cards | Policy Library tab | AU/RV/AP | existing scenario.spec | pc04 |
| Regulatory Updates, Requirements Register, Source Status | `/changes`, `/requirements`, `/compliance/regulatory/sources` | sources/changes/impact | Blue header; figure cards | Menu → Regulatory Monitoring | All (triage by role) | existing | pc05–07 |
| Staff Sign-off (Overview, By Employee, By Policy, Overdue, Assignment Rules, My Reading List) | `/staff…`, `/acknowledgements` | assignment | Blue header; figure cards | Menu → Staff Sign-off | Managers; staff see reading list | existing | pc08–10 |
| Audits, findings, corrective actions, verification, risk register, evidence | `/audits…`, `/actions…`, `/compliance/risks…`, `/evidence` | compliance/* | Blue header; figure cards | Menu → Audits & Improvements | By permission | existing compliance.spec | pc11–14 |
| Compliance Reports + CSV/Excel/PDF | `/compliance/reports` | reports | Blue header | Menu → Compliance Reports | `report.view` | existing; E2E (404 for staff) | pc15 |

## Shown in a mock-up but not built (concept only)

These are left out of the screens rather than shown as dead buttons.

| Mock-up element | Why not |
|---|---|
| HR "Assign Training" button | There is no training-assignment feature; training requirements come from HR Settings per role. |
| HR "Send Reminder" (training) | Reminders are automatic in-app notices; there is no manual send and no email/SMS service. |
| HR "Request Missing Documents" | No outbound request to employees exists. |
| HR "Mark Verified" as a one-click button | Verification goes through Review, which records the decision, reviewer and next date (second-person rule). The Documents view links to Review. |
| HR "Open Absences" figure | Absences live in the platform database, not the HR Hub data the dashboard reads; shown on Time Off instead. "New starters" and "Open HR tasks" are shown. |
| HR "Probation" status box | No probation record exists in the HR data. "All checks" is shown instead. |
| Employee photographs | No uploaded photos exist; initials avatars are used. |
| Recruitment "Compliance" stage, "Open roles", "Request documents" | Not real stages/records. The real stages are Applied, Screening, Interview, Offer, Onboarding, Ready for Work. |
| Recruitment "Book interview" in the panel | Interview booking has clash checks and fields on the candidate record; the panel links there. |
| Compliance "Sign-off rate 96%" / "94% Compliant" | No defined numerator for a whole-organisation % on the dashboard; review status is shown as counts with a definition. (Staff Sign-off keeps its defined completion %.) |
| Compliance "Send Reminder" on Staff Sign-off | Overdue reminders/escalation already run automatically in-app; no external send. |
| Compliance "Add Update" (regulatory) | Regulatory updates come from monitored sources only. |
| Compliance Settings screen | Illustrative only (owner's note); settings stay in context and in Administration. |
| Incidents in Compliance | Cross-link concept only; incidents stay in Rota. Dashboard "Safeguarding incidents open" already links there. |

## Decisions taken (please confirm or change)

- **D1 Policy Library list left as it is.** CLAUDE.md names `docs/design/policy-library-reference.png` as the Policy
  Library's visual source of truth, and the live page already matches it. The new mock-up shows a simpler table. I did
  not replace an approved design without your word.
- **D2 Recruitment opens on the board** (the approved design); the list remains one click away.
- **D3 HR pages lost the "Back" link** in the title bar (the menu and tabs replace it); records (employee, candidate,
  policy) keep "Back".
- **D4 The setup checklist** (existing, dismissible) was closed for the AFTER shots of the dashboard so the page can be
  seen; it still appears until dismissed.

## Rota and Overview

No file under `src/app/(app)/rota`, `src/server/rota`, `src/components/rota-*`, `src/app/(app)/overview` or the shared
`PageHeader`/`TitleBar` changed. Shared files touched: `src/components/tabs.tsx` (only `TileTab`/`TileTabList`, used
only by the policy page) and `scripts/build-hr-css.mjs` (one extra input file). Rota Dashboard, Daily Rota and Overview
screenshots before and after are in the review pack.

Proof: `main` (`a83a98d`) and this branch were both built and run side by side against the same demo database, and the
Overview, Rota Dashboard and Daily Rota were captured at 1672×941 within the same minute. All three pairs are
**pixel-identical (0 changed pixels)**: `side-by-side/frozen-identical__*.png` in the review pack. (The earlier BEFORE
set was taken the previous evening, so its visit counts and clock differ; that is data and time, not layout.)

## Test results (2 Nov 2026, local, isolated databases)

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run test:hr` | 14 passed |
| `npm test` (Vitest, `csb_test`) | 74 files, 587 passed, 0 failed |
| `npm run build` | succeeded |
| `npx playwright test` (all, `csb_e2e`) | 131 passed, 1 failed (phone overflow on Documents) |
| fix, rebuild, `npx playwright test hr-compliance-ux overview navigation` | 35 passed, 0 failed |

## Limitations

- HR figures are worked out in the browser from the HR Hub data already sent to it; they follow the branch picker.
- The training matrix shows the three training requirements most people have; the rest are on each record.
- Vercel preview builds fail on every PR (known); checks were run locally.
