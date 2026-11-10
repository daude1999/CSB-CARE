# Master build tracker — five-module CSB CRM

## Enterprise readiness (brief of 10 Nov 2026)

Five workstreams, one pull request each, never merged without the owner. Plan: `ENTERPRISE_READINESS_PLAN.md`.

| Workstream | State |
|---|---|
| 1. Quality gates | Built on `enterprise-readiness`: `.github/workflows/ci.yml` (schema, types, lint, full vitest in three parts on PostgreSQL 16, HR tests, audit, build; one "Quality gate" check to mark required), `.github/dependabot.yml`, scratch file removed, high and critical audit findings cleared by upgrading existing packages (zod 4, vitest 4, nodemailer 10), four test failures fixed at their causes. Results: `TEST_RESULTS.md`. |
| 2. Row-level security | Built on `enterprise-readiness-2-rls`: PostgreSQL row-level security on all 150 tables with an `organisationId` column, the `csb_app` role, a per-request scope (`src/server/tenancy`), an audited bypass with every call site listed in `docs/SECURITY.md`, and `tests/integration/rls-tenancy.test.ts`. **Its migration runs on the live database when merged: merge only with the owner watching, after a trial on a staging copy.** Limits: `KNOWN_LIMITATIONS.md`. |
| 3. Operations | In progress on `enterprise-readiness-3-operations`. Error tracking waits for the owner's approval. |
| 4. Assurance pack | Drafted on `enterprise-readiness-4-assurance` (`docs/assurance/`). |
| 5. UX and responsiveness | Not started. Shares ground with the colour system redesign (`redesign-colour-system`); that branch owns the page frame, header, tabs and tailwind tokens. |

## Branch-specific Policy Generator (4 Nov 2026, draft PR)
Policy & Compliance gains Branch & Local Authority Configuration, Local & Safeguarding References (organisation-level
verification of national, regional and local sources), a Policy Generator (company policy with branch appendices or
separate branch policies, gaps shown before generating, AI optional and checked), publish confirmations, branch
reading rules, Branch Coverage and cross-boundary safeguarding decisions. Starter sources are all "not yet verified"
and no contact numbers are recorded. Details: `BRANCH_POLICY_GENERATOR.md`.

## Daily Rota bulk actions repair and Complete Calls (2 Nov 2026, draft PR)
All 17 bulk actions were traced from the dropdown to the database and repaired; Complete Calls (office-confirmed
completion of past visits, no clock or medicine records created) is the 18th. Go opens a review that runs the real
rules without saving; Confirm applies visit by visit and the results list every visit not changed and why. Audit
table, rules and limits: `DAILY_ROTA_BULK_ACTIONS.md`.

## HR overview, People and Recruitment redesign (2 Nov 2026, draft PR)
Built to the owner's approved HR concept: the HR Dashboard became "HR overview" (four figures, Action required with
working Review links, Coming up), People is one clean directory, and Recruitment is a pipeline board of all six real
stages. Shared HR tokens and components under `.hr-ui`. Details and counting rules: `HR_OVERVIEW_REDESIGN.md`.

## HR Assign Training and Send Reminder (2 Nov 2026, draft PR)
The two buttons under "Due this week" on Checks & Training now work. Assign Training records a course, date and HR
follow-up task per person without touching checks or rota readiness; Send Reminder sends an in-app (bell) reminder to
people with a linked CSB sign-in, once a day, nothing by e-mail or text. Details: `HR_TRAINING_ACTIONS.md`.

## Find Replacement Cover, Contact & Communication, header Back/Forward (2 Nov 2026, draft PR)
One shared Find Replacement Cover panel and service for filling an empty place, replacing a booked carer and recovery
after a missed call, opened from the existing Find Cover buttons. A Contact & Communication tab records each attempt to
tell the service user or their contacts (append-only, corrections keep the original) and lists outstanding
communication on Visits Needing Attention. Back/Forward buttons in the shared top bar are a separate commit. Details:
`REPLACEMENT_COVER.md`.

## HR & Workforce as the single staff record (2 Nov 2026, draft PR)
"Staff & Workforce" left the Rota menu. Its operational pages are now Daily Rota tabs at the same addresses. HR gains a Suspended status, which blocks bookings and flags future visits. Carer lists show only HR care roles. Coordinators keep working patterns on each staff page. There is a guarded "Open HR record" link, and an identity report and backfill (`npm run workforce:identity`). Details: `HR_SINGLE_STAFF_RECORD.md`. Open decision: where training and competency evidence is recorded.

## Rota sidebar simplified to nine destinations (1 Nov 2026)
The Rota menu is now Rota Home, Daily Rota, Visits Needing Attention, The Monitor, Daily Templates, Service Users, Staff & Workforce, Finance and Reports, with Settings at the foot. Former menu pages are workspace tabs at their old addresses. There is a new combined page, `/rota/attention`, which shows Unassigned Visits and Missed Calls together. Notes and the full old-to-new mapping are in `ROTA_NAVIGATION.md`.

Backlog (these were "Planned" rows in the old menu and are not built): Service User Absences, Preference Manager, Communication Log, Holiday Report, and Help guides and videos.

## Simplified Rota Dashboard (1 Nov 2026, draft PR)

"Coming up" panel removed from `/rota` (services kept), live UK time beside the date. Details: `ROTA_LIVE_SCREENS.md`.

## Integrated care intelligence build (1 Nov 2026, PR #48, merged)

Recruitment in HR & Workforce, onboarding into readiness, rota "Coming up" alerts and plans for chosen visits, Care
Summary on care plans, Monitor alerts, compliance links and Care Operations Insights. Details: `CARE_INTELLIGENCE_BUILD.md`.

## Unassigned Visits, Find Cover and Coverage History (1 Nov 2026)

`/rota/unassigned` rebuilt in the Daily Rota style with a Find Cover panel (Recommended, Manual, Review then Confirm) and a
Coverage History tab with reconciling figures, a visit timeline and Excel/PDF exports. Rules and limitations: `UNASSIGNED_COVERAGE.md`.

## Find Cover inside Missed Calls, phase 1 (1 Nov 2026)

The owner's "Build smart replacement cover inside Missed Calls" brief. Phase 1, the single-visit workflow, is built: a Find
Cover slide-out panel on `/rota/missed` and on each case books an eligible carer on a linked recovery visit through the
one assignment path. Phase 2 (whole-day sickness cover) is not built yet. Design, rules, test matrix and limits:
`MISSED_CALLS_FIND_COVER.md`.

## Rota Dashboard and Daily Rota Live List, modernised OnePlan style (1 Nov 2026)

The owner changed direction at 23:39 on 31 Oct and approved two images. `/rota` is now the OnePlan-style dashboard (call
cards, people, reminders, issue strip, birthdays, quick actions) and `/rota/visits` is a table-first live list with no
figure cards and a Visit Details drawer. Definitions, limitations and the 3–4 carer design note are in
`ROTA_LIVE_SCREENS.md`. The Birdie-style dashboard below is replaced; its services remain for tests and reports.

## Final Rota Dashboard and Daily Rota (31 Oct 2026, replaced 1 Nov)

`/rota` is the operational Rota Dashboard and `/rota/visits` the Daily Rota, both to the owner's approved images. The week roster moved to `/rota/planner`. Also Generate & Optimise and Rota Insights. Definitions, limitations and the acceptance checklist: `ROTA_DASHBOARD_AND_DAILY_ROTA.md` and `ROTA_OPTIMISE_AND_INSIGHTS.md`.

## Missed Calls (31 Oct 2026)

Built on the owner's approved specification: register, case investigation, manager sign-off, histories, KPIs, Excel and PDF exports. Checklist and design notes: `MISSED_CALLS.md`.

## Version 1 (branch `feature/v1-complete`, owner's "COMPLETE VERSION 1" brief, 29 Oct 2026)

Backlog: `V1_BACKLOG.md`. Audits: `v1-audit/`. The build moved from the laptop session to a cloud session at 22:01 on 29 Oct at the owner's choice; work continues on the same branch.

| # | Item | State | Notes |
|---|---|---|---|
| 0 | Baseline | Done | See TEST_RESULTS "V1 baseline (cloud)". Readiness WIP broke one attendance test (demo carer left "pending"); fixed in the seed |
| 1 | Staff readiness screens | Done | /admin/readiness (matrix, versions, retire), readiness section on /rota/staff/[id] (status, evidence, record/verify/assess/restrict/exception/review), /rota/readiness queue, CSV at /api/readiness/[staffId], readiness column on Team Members, readiness in the allocation picker. Clock-in refusal now records its alert after the refused transaction (it was rolled back before). Search on staff lists could widen the area scope; fixed |
| 2 | Policy assignment and acknowledgement | Done | Assignment rules (organisation, branch, role, job title, team, person) on /staff/policy/[id]; rows for staff with or without a sign-in, linked when a sign-in is attached; states assigned → opened → acknowledged (→ assessment passed/failed), exempted, withdrawn, superseded; fixed wording stored with each acknowledgement; reminders from 3 days before due, escalation after 7 days overdue (2 for priority 1) in-app only; correction supersedes the old row; Staff Sign-off rebuilt (people, policies, rows) with a 21-column audited CSV; a non-material republish keeps existing acknowledgements. Database trigger freezes acknowledged rows and makes events append-only |
| 3 | Exceptions register | Done | /rota/exceptions: every rota alert with owner, deadline, escalation and resolution with evidence; filters by state, type, severity, area and owner; branch scope. Overdue exceptions are escalated once to care managers in-app by the call sweep, which now runs as its own `rota.sweep` job instead of inside the policy maintenance tick. Overview alert tile opens the register |
| 4 | Carer tasks and notes | Done | On /carer, after clocking in the carer records each task once (done, not done or refused with a reason) and writes notes (general, handover, concern). A concern raises an exception for the office. The last handover note for the person shows on the carer's next visits. Office notes on the visit page. /rota/notes lists notes by the day written, in the member's areas; the dashboard counter opens it (it now counts only the member's areas). Database: one outcome per task per carer; note kinds checked |
| 5 | Care packages | Done | "Care package" tab on each service user: record, edit, end, replace (the active one ends the day before), history; commissioned hours compared with the repeating visits over the rota cycle. Funder is set only by finance. Database: one active package per person, dates and minutes checked. Invoice runs now pick the package in force on each visit date even if it has since ended (before, an ended package was ignored for past weeks) |
| 6 | Attendance verification and correction requests | Done | Timesheet lines with exceptions must be checked (with how) before a timesheet can be submitted; checks are kept when a timesheet is refreshed and cannot be removed (database trigger). Carers ask for a clock correction from /carer; a coordinator approves (it becomes an office entry that supersedes the carer's record) or rejects with a reason; the requester can never decide (database trigger too). Office entries are recorded as approved requests. Requests raise an exception until decided |
| 7 | Administration | Done | /admin/users: invite (one-time link, 7 days), roles, branch grants, job title, deactivate (roles cleared, sessions ended) and reactivate, password reset links (24 hours). At least one admin always remains; nobody deactivates themselves; demo accounts and people in several organisations cannot be reset by an organisation. /account/[token] is the public page that uses a link. /admin/audit: full audit log with filters, paging and an audited CSV. Modules: training, care plans and rotas now open their built screens and say plainly what is not built; module requests notify the CSB team in-app |
| 8 | Reporting & Analytics | Done | /analytics: a registry of 14 measures (delivery, workforce, compliance, finance), each with its definition and a link to the records behind it, worked out live for a branch (only branches the member may see) and dates (at most a year); measures shown only to roles allowed to see their module; organisation-only measures say so; audited CSV with report.export. Reporting menu: Analytics, Compliance Reports, Rota Reports, AI Assistant |
| 9 | Run routes, printable rotas, mileage | Done | Live Run Routes (/rota/routes) and Template Run Routes (/rota/routes/templates): carer or area rounds for a week with colours checked for readable contrast, visits added in bulk, stop order set by hand (up and down), removal leaves the visits in place. Build Rota carries a template route's order into each built visit. Routes never assign a carer and travel times are not worked out. Printable Rota (/rota/print): PDF per team member or per service user for up to 31 days, options for address, medication, cancelled and shadow visits, surnames and key safe codes (only for roles allowed to see them); every print is audited. Mileage: carers claim miles for a day on /carer (stated by the carer, not from a map, within 60 days); finance or a coordinator approves or rejects with a reason on /rota/finance/mileage; approved claims go into the pay run |
| 10 | Overnight and cut-off pay | Done | Hourly pay and charges are split at midnight and at every rate band boundary and each stretch is priced at its own band, so a Friday 22:00–07:00 night is partly weekday evening and partly weekend, and only bank-holiday minutes get the bank-holiday rate. Per-visit bands still price the visit once by its start. A stretch with no band makes the run list an exception instead of guessing. Split lines are labelled |
| 11 | Medication (MAR) | Done, switched off | Owner's scope change (see decisions). Rota Settings switch: off until an organisation admin switches it on and records who did the clinical review; switching off hides it again and keeps the records. Each person's Medication tab: medicines with strength, dose, route, support (prompt, assist, administer), time ranges (morning, lunch, tea, bed) or as required with a daily limit, controlled-drug flag, prescriber, dates. A medicine is used only after a second person checks it against the prescription; changes are new entries that replace the old one when approved; stop with a reason. On /carer, after clocking in, the carer records each due dose once (given, prompted, refused, not given; as-required doses up to the daily limit); refused or not given needs a reason and raises an exception; a controlled drug needs a witness. The office corrects a record with a reason (the original stays). The call sweep raises one critical "missed medication" exception for a completed visit with a due dose not recorded. Monthly MAR chart on screen and as a PDF. Monitor and dashboard "Calls with missed meds" now count these when switched on. Database triggers: second-person approval, approved medicines frozen, MAR records append-only. The platform does not check doses, interactions or stock |
| 10b | Pay period cut-off, travel and rest | Done | Pay runs pay Sunday-night work up to midnight and carry the rest into the next week's run (listed as an exception, paid once; a run prepared before this change that already paid the whole visit is respected). Visits still in progress when a run is prepared are listed as "unfinished at the cut-off" and not paid. Unit tests around the 25 Oct 2026 and 28 Mar 2027 clock changes. The allocation picker shows advice (not a block or a warning) for under 10 minutes between visits and under 11 hours' rest between working days. Rota type "Alternate" had no meaning, so the field is hidden (stored values kept). Monitor test for yesterday's overnight visits |
| 12 | Local-first setup | Done | docs/LOCAL_SETUP.md (Windows, PowerShell, PostgreSQL 16 installer or `docker compose up -d db`); `npm run db:reset:local` (local databases only, asks for RESET; `--clean` for no demo data) with .ps1 and .sh wrappers; `npm run org:create` sets up a real organisation and prints a one-time link for its first admin; `npm run dev:all` starts web and worker together without a new dependency |
| 13 | Final QA | Done | Principal scenario as one Vitest test (a new HR record through readiness, policy acknowledgement, a service user, a schedule, build, allocate, publish, the visit, an exception, the timesheet, pay and branch and organisation reports) and one Playwright test through the screens. QA walk (`tests/e2e/qa-walk.spec.ts`): every screen reachable for 8 roles, 475 in all, checked for errors, dead links, headings, sideways scrolling and unlabelled controls. Main screens at 1440, 834 and 390 (`tests/e2e/screens.spec.ts`), keyboard check. Fixes in TEST_RESULTS. V1_COMPLETION_MATRIX.md, V1_ACCEPTANCE_CHECKLIST.md, V1_QA_REPORT.md |

### Decisions taken without asking (the brief says record and continue)

- The misleading `/staff` figures are replaced in item 2, when that page is rebuilt as Staff Sign-off, rather than patched in item 1.
- A restriction only blocks clock-in when it applies to the visit (all work, the visit's task or the visit's person). Before, any restriction blocked every clock-in.
- Acknowledgement assessments are recorded by a manager (pass or fail with a note), not an online quiz; nobody may assess their own row. A quiz builder is not in V1.
- A publication is "material" unless the publisher unticks the box; only a material publication asks staff to sign again. Readiness checks use the latest material publication.
- When a policy has assignment rules, they decide who signs, even if the policy's "requires acknowledgement" flag is off; without rules the old behaviour (everyone in the organisation) stays.
- Exception deadlines are fixed per type (missed and late calls 30 minutes; not delivered, not clocked out and readiness refusals 1 hour; concerns 4 hours; review work 24 hours) rather than a new setting. The monitor's 5-minute alert latency target is about detection, not resolution, so it was not reused. Alerts raised before this change keep no deadline, so merging does not escalate old alerts in bulk.
- Items 4 and 5 were checked with one full test run between them (each had its own tests run first); the order of work is unchanged.
- Carers record each task once; a second record for the same task is refused rather than overwriting the first, because outcomes are care records.
- Invitations and password resets are one-time links the admin hands over, not emails, because outbound messages need review first. The link is shown once (in a two-minute cookie, never in a URL) and only its hash is stored.
- Deactivating a member clears their roles (kept for reactivation) so no list, alert or rota counts them; the user record and history stay.
- A new permission, analytics.view, lets care managers and finance officers open Reporting & Analytics without seeing compliance reports.
- Medication (scope change by the owner at 23:10 on 29 Oct): built in V1 after item 10, following OnePlan's medication and MAR set-up, switched off per organisation until an admin turns it on and confirms a clinical review. WhatsApp, recruitment and the offline carer app are Version 2.
- Run routes reuse the existing live and template route tables; stop order is a new nullable column on visits and templates. Template routes are switched off rather than deleted because built weeks refer to them.
- Mileage is what the carer states, not worked out from a map, so nothing claims a GPS or route distance.
- Overnight pay: a visit is split at midnight and at band boundaries; a minimum length is made up at the first stretch's rate. Existing lines in runs already prepared are not recalculated.
- Medication is not switched on in the demo seed, so merging changes nothing on the live demo until an admin switches it on with a clinical review note. Tests switch it on for their own database.
- A medicine approved after a visit is not counted as missed on that visit, and a stopped medicine is not counted after it stopped.
- Cut-off pay is split when the pay run is prepared, not by storing segments on timesheet lines: the result is the same and no timesheet schema changes. A change after a pay run is approved is still handled by voiding the run and preparing it again; automatic adjustment lines are not built.
- `npm run dev:all` uses a small script instead of the `concurrently` package, so no dependency is added.
- Item 11 of the brief (design polish): the navigation and motion pass merged to `main` on 29 Oct (PR #25) already covers transitions, sidebar states and reduced motion. Route `loading.tsx` files are not added: they broke client navigation in production before (see UI_MOTION_AND_NAVIGATION.md).


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
| 10 Finance | Done (preparation) | `src/server/finance/{pricing,rates,timesheets,runs}.ts`. Rates and funders, timesheets from clock records, pay and invoice runs with second-person approval (database trigger too), CSV export. Never pays, issues or sends |
| 11 Reporting and admin | In progress | Rota Reports built (`src/server/rota/reports.ts`, /rota/reports, CSV at /api/rota/reports): delivery by day, hours by person, carer attendance, unfilled visits, call alerts. Reporting & Analytics module and Administration still to do |
| 6b OnePlan structure | Done | Rota Dashboard, menu, Daily Rota and Advanced Rota rebuilt to OnePlan's structure at the owner's request (see ARCHITECTURE_DECISIONS) |
| UI polish (29 Oct) | Done on branch `claude/project-thread-i7uu8j` | Navigation and motion pass across all modules: motion tokens, instant portal/sidebar feedback, progress bar, page entrance, placeholders, pending buttons, dialogs, reduced motion, HR boundary kept. See UI_MOTION_AND_NAVIGATION.md |
| Multi-carer visits (2 Nov) | Merged (#60) | Any number of carers 1 to 20 with numbered places across rota, templates, build, roll forward, unassigned, cover, missed calls, optimiser and bulk. See MULTI_CARER_VISITS.md |
| Medication Lead (2 Nov) | Merged (#61) | Automatic lead on single-carer medication visits when cleared; coordinator choice on multi-carer visits; ends with the carer; eMAR missed doses against the lead. See MEDICATION_LEAD.md |
| Service user records (2 Nov) | Built, merging | Grouped profile sections (folds in #58); risk assessment versions with actions and who is responsible; who was told about an incident; risk review prompts; visit notes per person; records summary. Documents and body map are a separate build. See SERVICE_USER_RECORDS.md |
| Documents and Body Map (2 Nov) | Built, PR open | Council Documents and Other Documents (separate sections, versions, restricted sensitive files, audited previews and downloads) and the Digital Body Map (front/back/left/right, follow-ups, photos, manager incident decision) in the service user profile. Files kept in private database storage on Vercel. See SERVICE_USER_DOCUMENTS_BODY_MAP.md |
| Body map with AI suggestions (3 Nov) | Built, draft PR | Approved layout, append-only notes, history and side-by-side photos, review tasks, linked records, medicine application sites, AI-assisted suggestions (off by default, human decision only) and deterministic escalation prompts. See BODY_MAP_AI.md |
| Set up from support plan (4 Nov) | Built, draft PR | Upload a council support plan, check and correct what was read (page-referenced AI proposal or typed in), confirm: person, contacts, package, one visit template per timetable row and documents in one transaction, ready for Build Rota. Care plan, risks and medication stay manual. See SUPPORT_PLAN_IMPORT.md |
| Missed call automation (4 Nov) | Built, PR open | Evidence and timeline, in-app carer confirmation and a rules-based suggested reason inside the existing missed call case. Three switches, off by default. Never decides anything for the coordinator. See MISSED_CALL_AUTOMATION.md |
| Set up from support plan (4 Nov) | Built, draft PR | Upload a council support plan, check and correct what was read (page-referenced AI proposal or typed in), confirm: person, contacts, package, one visit template per timetable row and documents in one transaction, ready for Build Rota. Care plan, risks and medication stay manual. See SUPPORT_PLAN_IMPORT.md |
| AI Care Coordinator (4 Nov) | Built, draft PR | Upload a referral's documents; every fact kept with its page and quote and mapped to an exact profile field; coordinator check with plain forms; manager approval per section with separation of duties; idempotent saving with read-back; drafts only for care plan, risks and medicines; unpublished draft rota through Build Rota with suggested carers; whole-shift check. AI reading off by default. See AI_CARE_COORDINATOR.md |
| CQC Inspection & Evidence + RCA (4 Nov) | Built, draft PR | One Policy & Compliance workspace: Overview (warnings above scores), versioned CQC framework (56 areas under the five key questions), assessments with approval and snapshots, evidence review (suggest, never auto-verify), Root Cause Analysis in seven steps with escalation decisions, improvement actions through the existing action service, PDF/CSV reports. Internal readiness only, never an official rating. See CQC_INSPECTION_RCA.md |
| Service user Call Notes (4 Nov) | Built, draft PR | New Call Notes group on every Service User profile: inline Add Call Note, Organise (AI or no-AI keyword rules) into quoted, classified bullets routed to the right record, duplicate check against existing records, manager review with separation of duties, routed items into the Care Coordinator review queue, follow-up tasks in Active Reminders with overdue reminders, urgent-concern flags, corrections with versions, search, filters, pagination. New Call Notes section in the AI Care Coordinator. See CALL_NOTES.md |
| Policy Reader redesign (5 Nov) | Built, draft PR | One continuous policy document with a sticky strip of section cards that follows scrolling, Policy Progress (never signs), Review Sheet with five indicators and the full detail table, Policy Actions (Mark as Important, Add to Reading List, Assign to Staff, Compare Versions, Version History), Linked Forms & Resources, purple breadcrumb bar. New PolicyBookmark table and compare page. See POLICY_READER.md |
| 12 Final QA | In progress | vitest 166, HR 14, e2e 28 (27 + rota spec 12/12 after a test fix); screenshots in docs/implementation/screenshots. See TEST_RESULTS.md |

## Priority order (owner, 29 Oct 11:10)

Rota core first: staff link, templates, Build Rota, daily visits, planner. Carer mobile and finance after.

## Next actions

1. Keep PR #24 green. Never merge without the owner's "merge".
2. Run routes and travel.
3. Task recording and notes from the carer phone; mileage claim entry.
4. Reporting & Analytics and Administration modules.

Docs: ARCHITECTURE_DECISIONS.md, FEATURE_COMPLETION_MATRIX.md, KNOWN_LIMITATIONS.md and TEST_RESULTS.md are current as of this checkpoint.

## Notes for a resumed session

- Local DB `csb` is disposable (drop/create + `prisma migrate deploy` + `npm run db:seed`). Prisma blocks `migrate reset` from AI sessions; use dropdb/createdb on the local server only.
- Demo seed: `seedDemo(masters, { care: true })` builds this week and next; 266 visits a week, about 21 empty slots a week (HR fixtures leave some carers non-compliant on purpose).

## Policy, procedure and forms (brief of 5 Nov 2026)

Tracked separately in `FORMS_POLICY_LINKS_PROGRESS.md` (PR 0 register fix and PR 1 explicit policy-to-form links built; PR 2 to PR 7 not started).

## AI CSB Coordinator agent (brief of 6 Nov 2026)

Tracked in `AI_CSB_COORDINATOR_AGENT.md` (Phase 1, document reading fix, in a draft PR; Phases 2 to 6 not started).

## Evantix Platform Admin Centre (brief of 8 Nov 2026)

Tracked in `PLATFORM_ADMIN_CENTRE.md`. Built at `/platform-admin` on branch `claude/project-thread-8z4axw` in a draft PR. Not merged.
