# Version 1 operational audit

Phase 2 (feature inventory) and phase 9 (performance at full scale) of the V1 operational readiness brief of 30 Oct 2026. Branch `claude/project-thread-emflic`, based on `main` after PR #27.

Classification:
- **Working and verified**: built with real persistence, permissions and audit, and exercised end to end by automated tests that passed in the last run (see `V1_FULL_FUNCTIONAL_TEST_MATRIX.md`).
- **Fixed in this pass**: was broken or missing; repaired and now verified (defect IDs refer to `V1_DEFECT_REGISTER.md`).
- **Incomplete**: works, with a stated gap.
- **Not tested**: no automated test exercises it.
- **Deferred to Version 2**: not built; the app says so where it appears.

No feature is marked working unless it passed. Nothing in this document has been checked by a person yet; that is the owner's sign-off.

## 1. Policy & Compliance

| Feature | Status | Notes |
|---|---|---|
| Policy Library: list, search, filters, inspector, archive and restore | Working and verified | |
| Policy document preview | **Fixed in this pass** (D01, D05, D06, D07) | Embedded fonts, responsive viewer, full-screen reader, print |
| Policy PDF and Word downloads | **Fixed in this pass** (D01–D04) | Read-back and page-image tests |
| Revisions: draft, review, approve, publish, roll back, scheduled publication | Working and verified | Separation of duties and state machine enforced in the database |
| Regulatory Updates and source monitoring | Working and verified | Sources in the demo are simulated and labelled |
| Requirements Register, Change Queue | Working and verified | |
| Staff Sign-off: assignment rules, acknowledgement, assessment, exemption, export | Working and verified | |
| Audits, findings, Actions & Risks | Working and verified | |
| Evidence Library (uploads with type checks) | Working and verified | Files are stored on local disk (`STORAGE_PROVIDER=local`); the Azure storage option exists but is not set up (hosting comes later) |
| AI Assistant | Incomplete | Runs in labelled "simulated" mode unless an Anthropic key is configured; never replaces approved text |
| Policy Library visual match to the approved reference image | Not re-checked in this pass | Last checked when PR #20 merged |

## 2. Rostering & Care Management

| Feature | Status | Notes |
|---|---|---|
| Rota Dashboard, Daily Rota, Advanced Rota, Rota Planner | Working and verified | Verified at full scale (1,204 visits a week) |
| Build Rota (four-week cycle) and publish | **Fixed in this pass** (D15) | Publish timed out at full scale; now 2.7 s for 1,204 visits |
| Assign, reassign, remove, eligibility with warnings | **Fixed in this pass** (D17) | Replaced carers' alerts now close |
| Two-way shift swap | **Built in this pass** (D08) | |
| Planner: move a visit to another day | **Built in this pass** (D09) | Drag and drop, or open the visit |
| Visit edits: time, duration, cancel, reinstate, double-up, bulk actions | Working and verified | |
| Templates, template change preview and apply | Working and verified | Template change now has its own scenario test |
| Live and template run routes, move between routes | **Built in this pass** (D10) | |
| Unassigned Visits with ranked suggestions | **Fixed in this pass** (D16, D19) | 3.3 s → 0.8 s at full scale; phone layout |
| The Monitor (late, missed, not clocked out) and call sweep | Working and verified | |
| Exceptions register | Working and verified | |
| Clocking, corrections, visit records and notes | Working and verified | Clocking is through the web app; GPS and NFC verification are Version 2 and not presented as real |
| Service users, contacts, key safes, care packages | Working and verified | |
| Care plans, risk assessments, incidents | Working and verified | |
| Printable rota PDF | Working and verified | Now read back by a document test |
| Medication and MAR | Working and verified, **switched off** | Stays off until an admin records a clinical review (owner's rule). MAR chart layout fixed (D18) |
| Rota reports and CSV | Working and verified | |
| Carer's own screens (My visits) | Working and verified | Web only; the offline carer app is Version 2 |

## 3. HR & Workforce

| Feature | Status | Notes |
|---|---|---|
| HR Hub (people, checks, documents, tasks, reports) | Working and verified | Its own 14 domain tests; not restructured (out of scope) |
| HR to Rostering projection in the same transaction | Working and verified | |
| HR changes flag visits, never reassign | Working and verified | New scenario tests for an expiring check and sickness |
| Absences and availability | Working and verified | |
| Staff readiness (training, competency, exceptions, matrix) | Working and verified | |
| HR people CSV | **Fixed in this pass** (D12) | |
| HR Hub branch filter hydration | **Fixed in this pass** (D14) | |
| Recruitment and applicant tracking | Deferred to Version 2 | |

## 4. Reporting & Analytics

| Feature | Status | Notes |
|---|---|---|
| Analytics (14 defined measures, branch scope, CSV) | Working and verified | |
| Compliance reports and CSV | Working and verified | |
| Rota reports and CSV | Working and verified | Totals reconcile with the visit records |
| CSV exports (all) | **Fixed in this pass** (D11, D12) | |

## 5. Administration & Settings

| Feature | Status | Notes |
|---|---|---|
| Users: invite, roles, branches, deactivate, reactivate, reset links | Working and verified | |
| Branches, branch grants, areas | Working and verified | |
| Audit log viewer and CSV | Working and verified | |
| Rota settings, finance settings, rate cards, funders | Working and verified | |
| Organisation set-up for real data (`org:create`, local reset `--clean`) | Working and verified | |
| Outbound e-mail and SMS | Incomplete by design | Rota and acknowledgement notices are in-app only; invitations and password resets are one-time links the admin hands over |
| WhatsApp messaging | Deferred to Version 2 | |

## Phase 9: performance at full scale

Measured on 30 Oct 2026 in this cloud environment (shared CPU, PostgreSQL 16 on the same machine), production build (`next build` + `next start`), against the synthetic UAT data: 58 service users, 85 staff (58 carers), 7,227 visits over six weeks, about 173 visits a day. Numbers are measured, not estimated; a slower or busier machine will be slower.

### Pages (`scripts/uat-page-timings.mjs`, one warm-up then three loads, 1440 px)

"Server" is the time until the page's HTML has arrived; "ready" is when the browser has finished loading it.

| Signed in as | Page | Server median (ms) | Ready median (ms) |
|---|---|---|---|
| coordinator | Rota Dashboard `/rota` | 179 | 243 |
| coordinator | Advanced Rota (today, 174 visits) | 158 | 280 |
| coordinator | Rota Planner (week, 1,204 visits) | 412 | 610 |
| coordinator | The Monitor | 302 | 370 |
| coordinator | Unassigned Visits (14 days, 25 ranked) | 811 (was 3,252 before D16) | 846 |
| coordinator | Exceptions | 128 | 178 |
| coordinator | Service Users | 97 | 165 |
| coordinator | Staff & Eligibility | 229 | 284 |
| coordinator | Templates | 337 | 639 |
| coordinator | Rota Reports | 280 | 303 |
| coordinator | Timesheets | 157 | 266 |
| finance | Payroll | 54 | 76 |
| finance | Invoices | 70 | 81 |
| manager | Overview | 132 | 168 |
| manager | Analytics | 175 | 196 |
| manager | Staff Readiness | 208 | 260 |
| manager | Policy Library | 187 | 239 |
| manager | HR Dashboard | 103 | 132 |
| Tower Hamlets coordinator | Advanced Rota (own branch) | 141 | 197 |

### Heavy operations (`scripts/uat-perf.ts`, server functions called directly)

Measured after the eligibility speed-up, on a freshly restored baseline (the script changes the data, so the baseline is restored afterwards).

| Operation | Timings (ms) | Notes |
|---|---|---|
| Daily rota: today, all areas (listVisits) | 71, 45, 56 | 174 visits |
| Planner: this week, all areas (listVisits, 3,000 cap) | 314, 303, 260 | 1204 visits, truncated false |
| Call monitor board | 89, 47, 44 |  |
| Rota report: carer attendance, last 2 weeks | 366, 410, 386 |  |
| Rota report: visit delivery by day, last 2 weeks | 415, 420, 402 |  |
| Analytics measures (computeKpis), default period | 153, 126, 103 |  |
| Rank carers for one visit (eligibility over all 58 carers) | 150, 172, 132 | 85 carers ranked |
| Build preview: week +4 (all areas) | 500 | 1204 visits |
| Build confirm: week +4 | 1667 | 1204 visits |
| Publish: week +4 (re-checks every carer on the week) | 2715 | 1204 visits, 49 carers notified |
| Call monitoring sweep (whole organisation) | 2473 |  |
| Generate timesheets: two weeks ago | 736 |  |
| Submit all timesheets: two weeks ago (bulk) | 309 | 6 submitted, 46 refused (lines with exceptions not yet checked) |
| Approve all timesheets: two weeks ago (bulk) | 46 | 6 approved |
| Prepare pay run: two weeks ago | 149 |  |
| Prepare invoice run: two weeks ago | 321 |  |
| HR save that re-projects 58 carers (one check edited) | 174 |  |
| Two-way swap (one pair, eligibility both ways) | 198 | swapped |

### What was changed for performance

- D15: publish re-checks only its own week (and no longer stops silently at 2,000 bookings).
- D16: ranking many visits at once loads facts once; London date parts are memoised; bookings are indexed by carer; readiness is worked out once per person and day.

### Known limits

- The Rota Planner shows up to 3,000 visits a week and says so when there are more (choose an area).
- Advanced Rota shows up to 1,000 visits a day and says so.
- The call sweep looks back 14 days and handles up to 5,000 open visits per run.
- Travel time between visits is advice only; it is not worked out from addresses.
