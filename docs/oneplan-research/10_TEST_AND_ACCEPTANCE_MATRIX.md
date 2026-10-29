# 10 · Test and acceptance matrix

Automated tests and acceptance criteria for the stages in [09](09_COMPLETE_IMPLEMENTATION_ROADMAP.md). Test types: **U** Vitest unit, **I** Vitest integration (real local Postgres, `csb_test`), **E** Playwright e2e (`csb_e2e`), **V** visual check (Playwright screenshots at 1440 / 834 / 390 compared with the approved mock-up), **H** HR Hub node tests (`npm run test:hr`).

Database tests run only against local, isolated databases (CLAUDE.md). Seed data uses invented people only.

## Baseline

No application code was changed for this research, so no tests were run for it. The last recorded baseline on `main` (PR #21, 29 October 2026) was: Vitest 109 passed, HR Hub 14 passed, Playwright 15 passed. Each stage must re-record the baseline before starting.

## Dashboard (Rota "Today")

| ID | Criterion | Type |
|---|---|---|
| DASH-01 | Figures for the chosen date and areas equal a direct count of `Visit` rows (complete, late, missed, unassigned) | I |
| DASH-02 | Previous / next day and date picker change every figure and the table | E |
| DASH-03 | Each figure link filters the visit table to exactly those visits | E |
| DASH-04 | With no visits, the page shows "No visits on this date" and no zeros dressed up as data | E |
| DASH-05 | A user without `rota.view` gets 404 / no-access, not an empty page | I, E |
| DASH-06 | A coordinator limited to area A never sees area B visits or counts | I |
| DASH-07 | "Carer checks expiring" lists only carers on visits in the next 7 days whose HR checks are Overdue / Due soon | I |
| DASH-08 | Status shown in words; page passes axe checks; keyboard reaches every control | E |
| DASH-09 | Hide screen blanks the view, Escape restores it, no request is sent | E |
| DASH-10 | Layout matches the approved mock-up at 1440 / 834 / 390 | V |

## Foundations and permissions

| ID | Criterion | Type |
|---|---|---|
| ACC-01 | Every new permission maps to the intended roles only (`ORG_PERMISSIONS` snapshot test) | U |
| ACC-02 | `canUsePortal("rota")` true for ORG_ADMIN and CARE_COORDINATOR, false for STAFF; CARER reaches `/carer` only | U |
| ACC-03 | Records of organisation B are never returned to organisation A by any rota, service-user or finance function (one test per server module) | I |
| ACC-04 | Ids from form data that belong to another organisation raise NotFoundError | I |
| ACC-05 | Area CRUD with validation and audit entries | I |

## Workforce (Stage W, H2)

| ID | Criterion | Type |
|---|---|---|
| WF-01 | Migration copies every HR Hub employee to `StaffMember` once, keeps `hrLegacyId`, and is re-runnable without duplicates | I |
| WF-02 | HR Hub tests and HR e2e pass unchanged after the move | H, E |
| WF-03 | Sensitive fields remain hidden from HR users without `sensitive` | H, I |
| WF-04 | Absence request → approve by a different manager; self-approval refused | I |
| WF-05 | Approving an absence lists affected visits; choosing "unassign" unassigns exactly those | I |
| WF-06 | Bradford Factor S²×D over 52 weeks matches worked examples | U |
| WF-07 | 12.07% accrual from clocked hours matches worked examples | U |

## Service users (S1, S2)

| ID | Criterion | Type |
|---|---|---|
| SU-01 | Create, edit, end a service user; required fields per status; NHS number modulus-11 check | U, I |
| SU-02 | Register list never shows DOB, address or NHS number | E |
| SU-03 | Key safe code is encrypted at rest; reveal requires permission and writes an audit entry | I |
| SU-04 | Ending a service user previews and cancels only future unstarted visits, with reason | I |
| SU-05 | Absence with "cancel visits" cancels overlapping unstarted visits and blocks builds for those dates | I |
| SU-06 | Carer sees only service users on their own visits within the allowed window | I, E |
| SU-07 | Care plan versions are immutable after draft (DB trigger), approval needs a second person | I |

## Rota templates and build (R1)

| ID | Criterion | Type |
|---|---|---|
| ROTA-01 | Template validation: end after start; no midnight crossing unless ALTERNATE; slot 2 only for double-ups; slot 1 ≠ slot 2 | U |
| ROTA-02 | Cycle week for any date is computed correctly from the anchor Monday for cycle lengths 1–4, across year ends | U |
| ROTA-03 | Building week N creates exactly one visit per enabled template per matching weekday in the chosen areas | I |
| ROTA-04 | Build skips service users on absence and leaves absent carers' slots unassigned, recording why | I |
| ROTA-05 | Building the same week twice is refused (ConflictError) | I |
| ROTA-06 | Build preview figures equal the visits actually created | I |
| ROTA-07 | Deleting a future build is refused once any visit in it has started | I |
| ROTA-08 | "Apply template changes" changes only future unstarted visits and shows the diff first | I |
| ROTA-09 | Clock change weeks keep local wall-clock times (Europe/London) | U |
| ROTA-10 | Templates and build screens match the mock-ups at 3 widths | V |

## Allocation (R1, R2)

| ID | Criterion | Type |
|---|---|---|
| ALLOC-01 | Overlapping assignment refused when `allowConflicts` is off, allowed with warning when on | U, I |
| ALLOC-02 | Two concurrent requests assigning the same carer to overlapping visits: exactly one succeeds | I |
| ALLOC-03 | DBS or right to work Overdue / Missing evidence blocks; training Overdue warns (default gate) | U, I |
| ALLOC-04 | Carer rated below minimum or blocked for the service user is refused | U |
| ALLOC-05 | Gender preference not met gives a warning, not a block | U |
| ALLOC-06 | ONBOARDING staff can only be shadow carers | U |
| ALLOC-07 | Locked visit: time change refused; carer change allowed with permission and audited | I |
| ALLOC-08 | Board drag and keyboard "Move…" call the same server function and show the same refusal reasons | E |
| ALLOC-09 | Bulk reassign reports per-visit success / refusal and changes nothing for refused rows | I |
| ALLOC-10 | Stale edit (lockVersion) shows "changed since you opened it" | I, E |

## Visit delivery and monitor (R3)

| ID | Criterion | Type |
|---|---|---|
| VIS-01 | Status machine: only allowed transitions succeed; the DB trigger rejects the rest | U, I |
| VIS-02 | Late is derived at start + lateAfterMin with no clock-in; early clock-in blocked when set | U |
| VIS-03 | Sweep job marks visits MISSED after missedAfterMin and notifies area coordinators once | I |
| VIS-04 | Short visit flagged below the % threshold; note required when set | U, I |
| VIS-05 | Clock events are append-only; office clocking needs a reason and permission | I |
| VIS-06 | Carer can clock only their own assigned visits, only within the window | I, E |
| VIS-07 | Location outside the geofence is recorded and flagged, not silently accepted | U |
| VIS-08 | Doorstep "not delivered" requires a reason and notifies the coordinator | I |
| VIS-09 | Monitor JSON route requires `rota.monitor` and returns only the user's areas | I |
| VIS-10 | Carer phone page usable at 390 px with keyboard and screen reader labels | E, V |

## Finance (F)

| ID | Criterion | Type |
|---|---|---|
| FIN-01 | Visit split across rate bands priced correctly (worked examples incl. bank holiday) | U |
| FIN-02 | Rounding settings (per visit / per invoice, half-down / half-up) give expected pence | U |
| FIN-03 | Minimum wage top-up includes travel time and brings pay up to the age-band rate | U |
| FIN-04 | Invoice run approval by the creator is refused | I |
| FIN-05 | Approved run lines are immutable (DB trigger); corrections create adjustments | I |
| FIN-06 | Invoice numbers are unique and sequential per organisation under concurrency | I |
| FIN-07 | Visits with no rate appear as exceptions and block approval | I |
| FIN-08 | Invoice PDF downloads only after a permission check | I, E |

## Reports

| ID | Criterion | Type |
|---|---|---|
| REP-01 | Each report's totals equal a direct query over the same filters | I |
| REP-02 | Area / branch scoping applies to every report | I |
| REP-03 | CSV export needs `report.export`, neutralises formula injection (`csvCell`), and is audited | U, I |
| REP-04 | Each report states its definition on screen | E |

## Non-functional

| ID | Criterion | Type |
|---|---|---|
| NFR-01 | Daily visits and monitor respond < 1 s with 500 visits/day seeded | I (timed) |
| NFR-02 | No N+1 queries on list pages (query count assertion) | I |
| NFR-03 | All new pages pass axe with no serious violations | E |
| NFR-04 | No personal data in logs (log capture test on error paths) | I |
| NFR-05 | Typecheck and lint clean; no `any` in new code | CI |

## Acceptance sign-off per stage

A stage is accepted when all its rows pass, the screenshots at 1440 / 834 / 390 have been compared with the approved mock-ups, keyboard navigation has been checked, and the owner has reviewed the result on the branch. Merge to `main` only on the owner's explicit approval.
