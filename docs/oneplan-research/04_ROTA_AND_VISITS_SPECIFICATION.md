# 04 · Rota & Visits specification

The main deliverable. Part A records how OnePlan's scheduling works (inspected read-only on 29 October 2026). Part B specifies the CSB Rota & Visits portal (`/rota`, module colour `#6b46c9`) in enough detail to build without inspecting OnePlan again.

**[O]** observed, **[I]** inferred. Visit detail pages were **not** opened (⛔ personal and medical data), so the single-visit screen is specified from first principles and marked as such.

---

## Part A · How OnePlan scheduling works

### A1. The model [O, with inferences marked]

```
Service list (call types) ─┐
Tasks list ────────────────┤
Service user ──────────────┼─► Template (recurring visit)
Team member(s) ────────────┘      week 1–4 of a rolling cycle, weekdays, start, duration/end,
                                  1 or 2 carers, flags: time lock, medication, tasks, alert,
                                  rota type Normal/Alternate, run route, enabled/disabled
                                        │
                                        │ Build Rota (start date + week number + areas)
                                        ▼
                                  Visit (live, dated)  ◄── bulk edits, reassign, cancel, lock …
                                        │
                                        │ carer app: acknowledge, clock in/out (NFC / QR / location),
                                        │ tasks, medication, notes          [I]
                                        ▼
                                  The Monitor: Due → In Progress → Complete / Late / Missed / Short
                                        │
                                        ▼
                                  Wages (pay tariffs) and Invoices (charge tariffs, funders)   [I]
```

### A2. Templates

**Daily Templates** (`welcomeTemplate.php`, screenshot `08`) [O]
- Heading "Week N, <Day> Templates".
- Filters: team member (multi), service user (multi), Week (1, 2, 3, 4, All Weeks), Day (Monday–Sunday), search.
- Actions menu: Add New Template, View Deleted, To Live Rota, Forecast Rota Build.
- Columns: select, template ref, day, "New" badge, disabled icon, single/double-up icon, area colour dot, run route, risk rating colour, service user, start, end, duration, team member, service call, lock, alert, medication, tasks, week.
- A double-up shows as two rows with the same ref, one per carer.
- Bulk actions: add to / remove from run route; disable / enable; reassign / unassign; edit time; edit duration; nudge times; add / remove locks; edit service name; edit rota type; add / remove alert; duplicate; convert to double-up; revert double-up to single; update template CPLI (**[I]** care plan line item); make new; **add shifts to live rota** (push template changes into already-built weeks); delete; export to CSV.

**Add New Template** [O] (screenshots `09`–`11`; opened, nothing saved)
- Step 1: pick a service user from a searchable table (surname, forename, client number).
- Step 2: a profile card for that service user on the left (photo, tags, DOB and age, sex assigned at birth, reference, NFC number, carer gender preference, areas, NI / NHS / patient / health care / CHI numbers, key safe, address with map, contact details), and the form on the right:

| Field | Required | Type and options |
|---|---|---|
| Template Week | Yes | Week 1, Week 2, Week 3, Week 4 |
| Days | | Toggle buttons M T W T F S S (several at once) |
| Service List | Yes | Bed Call Private, Lunch Call Private, Morning Call Private, Sitting Call Private, Tea Call Private, Other |
| Rota Type | Yes | Normal / Alternate. Help: Alternate visits are handled differently in wages; avoid alternate visits that run past midnight |
| Start Time | Yes | Hour 00–23, minute 00–59 |
| Duration | | Slider shown as hh:mm |
| End Time | Yes | Hour and minute ([I] set from the duration) |
| Add Time Lock? | | No / Yes |
| Link Up? | Yes | No / Yes (two carers) |
| Staff 1 | | Team member list (optional, so a template can be unassigned). [I] Staff 2 appears when Link Up is Yes |
| Medication Required? | | No / Yes |
| Tasks Required? | | No / Yes |
| Alert? | | Yes (default) / No |

**Advanced Templates** (screenshot `12`) [O]: the planner board for templates. View selector, hide disabled, uncovered filter, run, team members and service users filters, bulk select, Actions (View Deleted, To Live Rota, My View Settings).

**Template Run Routes** (screenshot `13`) [O]: list of template routes with "Add New Template Run Route".

### A3. Building the live rota

**Build Rota** (`rota-builder.php`, screenshots `06`, `07`) [O]
- "All Rotas" list: start date, end date, current rota (the current week is highlighted), week label ("Week 1 Rota" … "Week 4 Rota"), created at, build status. Future weeks have Delete. Weeks are built about two weeks ahead and cycle Week 1 → 4.
- "Add New Rota" dialog (not submitted): a pre-build checklist (templates created, service-user holidays entered, team-member holidays entered, correct week setting), Start date (required), Week Setting 1–4 (required), Areas multi-select with select-all, "Build New Rota", and a dismiss button.
- Templates → "Forecast Rota Build" previews a build. [I]

### A4. Working the live rota

**Daily Rota** (`welcomeAdvanced.php`, screenshot `02`) [O]
- One day of visits. Filters: team member (multi), service user (multi), date with previous/next, search.
- Actions: Add Visit, View Deleted, View Holidays (count), To Templates.
- Columns: select, rota reference, date, status, cancelled, acknowledged by carer, link (single or slot 1/2), area, run route, risk rating, service user (name + postcode), scheduled start / end / duration, clocked start / end / duration, team member, service call, and more to the right.
- Row colour by status: Late pale yellow, In Progress pale blue, Due white. Footer: total scheduled hours and total clocked hours.
- Bulk actions: add to / remove from run route; **cancel**, activate, reset, delete; reassign, unassign; **complete**; clock in scheduled, clock out scheduled (office clocks a visit at its scheduled times); add / remove rota lock; send push message; update pay status; edit times; edit time and reassign; reassign and complete; edit duration; update chargeable status; edit service name; edit rota type; add / remove alerts; add shadow shifts; convert to double-up; revert to single; nudge times; export.

**Advanced Rota** (`advanced-rota.php`, screenshot `03`) [O]
- Planner board: one row per carer plus an **Unassigned** row at the top; columns are 30-minute slots across the day. Each visit is a card with service user, start, reference, service name and small icons (area, tasks, alert). Card colour follows status.
- Views: Team Members Today, Team Member By Day, Team Members By Week, Team Member By Area, Service User By Day, Service User By Area, Service User By Week, Visits By Run Route.
- Filters: cancelled (hide / include / only), uncovered (hide / include / only). Toggles: bulk select, auto refresh. Actions: Add Visit, View Deleted, View Holidays, To Templates, Advanced Rota Settings.
- [I] Cards can be dragged to another carer or time (not tested).

**Live Run Routes** (`runroute_live.php`, screenshot `04`) [O]: this week's routes, future weeks (week commencing, week ending, view), past weeks. Add form (not saved): Run Route Name*, Run Type* (default "Team member Route"), Team Member, Start Date*, Colour*, Text Colour*.

**The Monitor** (`the-monitor.php`, screenshot `05`) [O]: full-width live monitoring. Four ring gauges (complete, late, missed, missed medication, with % and count), search, settings cog (not opened). Table: ref and date, team member with acknowledgement icon, area, In (scheduled time and state such as "»Late", "»Due", "»in: 08:12"), Out ("«Due", "«Out: …"), client, service call.

**Printable rotas** [O, forms only]
- Per team member: font size, start and end date; options include cancelled visits, shadow visits, separate rota per carer, address, medication, key safe, exclude last name; choose team members.
- Per service user: font size, dates; include staff images, address, exclude last name; client table with run, NFC, required hours, forecasted hours, remaining hours.

### A5. Rules in Settings → Rota And App Settings (screenshot `20`) [O]

| Setting | Current value | Meaning |
|---|---|---|
| Allow rota conflicts | No | A carer cannot be double-booked |
| Allow same team member on link calls | Yes | [I] Same carer in both slots of a double-up (odd; CSB should forbid) |
| Allow QR clock in and out | Yes | Clock in by QR code as well as NFC |
| Lock Team Member By Pref / Pref Min level | Yes/No, 1–5 | Block carers rated below the minimum for that client |
| Team Member Login Area Clockin | Yes/No | [I] Clock-in only inside the visit's area |
| Auto ClockOut Complete % | 5–100 | [I] If a carer forgets to clock out, auto clock-out counts the visit as this % complete |
| Late Value / Early Value (min) | 10 / 10 | Minutes after / before scheduled start that count as late / early |
| Stop Early Clock Ins | No | Block clocking in before the early window |
| Push on late call / missed call | No / – | Phone alerts to the carer |
| Short Visit Note, Percentage Complete Value, Notify On Call | – | A visit under X% of scheduled duration is "short"; require a note; alert the on-call manager |
| Allow Door Step Cancels, Welfare Checklist | – | Carer can record "client refused / not home" at the door, with a welfare checklist |
| App settings | – | Show today/week hours in the app; lock notes to the visit's own day and to clocked-in visits; mandatory notes on clock-out; disable holiday feature |
| Show X days forward / backward | – | How far ahead and back carers and families can see |

### A6. Reports tied to the rota [O names]

Late / Early, Live Hours, Missed, Cancelled, Deleted Calls, Short Visit, Shadow Shift, Handback, Template Hours, Requested Hours vs Live Hours, Visit Location, Manual vs App Clocking, Rota Duration, Run Route, Continuity, Task List, Task Outcome, Mileage, Working Hours, Welfare Check, Visit Note.

---

## Part B · CSB Rota & Visits specification

### B1. Scope and principles

- Domiciliary care only (Care Solution Bureau). Visits happen at the service user's home.
- One staff record (see 03) and one service-user record (see 05) shared across modules.
- Business logic in `src/server/rota`, mutations through Server Actions and `handle()`, Route Handlers only for JSON polling (live monitor) and printable/PDF downloads.
- Every write that touches more than one record uses `db.$transaction`. Every state change writes `AuditLog`.
- Strict tenancy: every query is filtered by `ctx.organisationId`; ids from forms are re-checked for ownership.
- Real, honest UI: no planned control is shown as working. Anything not built says so.

### B2. Data model (new Prisma models, additive migration)

```
Area                id, organisationId, branchId, name, colour, active
CallType            id, organisationId, name ("Morning call"), defaultDurationMin, monitored: boolean, active
CareTask            id, organisationId, name, description, active
VisitTemplate       id, organisationId, serviceUserId, callTypeId, areaId?,
                    cycleWeek 1..4, weekdays (int bitmask or Int[]), startMinute (0–1439), durationMin,
                    carersRequired 1|2, timeLocked, medicationRequired, tasksRequired, alertOnLate,
                    rotaType NORMAL|ALTERNATE, runRouteTemplateId?, enabled, notes,
                    effectiveFrom, effectiveTo?, version
TemplateSlot        templateId, slot 1|2, staffId?                       (preferred carers)
TemplateTask        templateId, careTaskId
RotaCycle           organisationId, cycleLength 1..4, anchorMonday (date of a Week 1 Monday)
RotaBuild           id, organisationId, weekStart (Monday), cycleWeek, areaIds[], status BUILT|DELETED,
                    builtById, builtAt, visitCount
Visit               id, organisationId, serviceUserId, callTypeId, areaId?, templateId?, rotaBuildId?,
                    reference (human, unique per org), date, scheduledStart, scheduledEnd,
                    status (see B4), cancelReason?, cancelledById?, rotaType, timeLocked,
                    medicationRequired, tasksRequired, chargeable: boolean, payable: boolean,
                    runRouteId?, riskLevel?, notes, lockVersion (optimistic concurrency)
VisitAssignment     id, visitId, slot 1|2|SHADOW, staffId?, acknowledgedAt?, assignedById, assignedAt
VisitClock          id, visitId, staffId, kind IN|OUT, at, method APP_GPS|APP_NFC|APP_QR|OFFICE|AUTO,
                    latitude?, longitude?, accuracyM?, recordedById, reason? (required for OFFICE)
VisitTaskOutcome    visitId, careTaskId, outcome DONE|REFUSED|NOT_DONE, note?, recordedById, at
VisitNote           id, visitId, authorId, text, at
RunRoute            id, organisationId, name, staffId?, weekStart, colour, textColour, kind CARER|AREA
RunRouteTemplate    id, organisationId, name, staffId?, colour, textColour
```

`CallType` is OnePlan's "Service List" (morning call, tea call …). It is deliberately not named `ServiceType`, because that model already exists for branch registration types (domiciliary, residential).

Indexes: `Visit(organisationId, date)`, `Visit(organisationId, status, date)`, `VisitAssignment(staffId, visitId)`, `VisitTemplate(organisationId, serviceUserId, cycleWeek)`.

Database rules (triggers in a new migration, like the policy engine):
- A visit's status follows the state machine in B4.
- `VisitClock` rows are append-only (corrections are new rows with a reason).
- A staff member cannot have two non-cancelled assignments whose times overlap, unless the organisation setting `allowConflicts` is on (enforced in the service with a row lock, and checked again by an exclusion constraint on a generated time range where practical).

### B3. Settings (`RotaSettings`, one row per organisation)

| Setting | Default | From OnePlan |
|---|---|---|
| cycleLength | 4 | 1–4 week templates |
| buildAheadWeeks | 2 | Builds about two weeks ahead |
| lateAfterMin / earlyBeforeMin | 10 / 10 | Late and Early values |
| missedAfterMin | 30 | [new] when a not-started visit becomes Missed |
| blockEarlyClockIn | false | Stop Early Clock Ins |
| allowConflicts | false | Allow rota conflicts |
| shortVisitPercent | 75 | Percentage complete value |
| requireNoteOnShortVisit | true | Short Visit Note |
| autoClockOutPercent | null (off) | Auto clock-out |
| complianceGate | BLOCK_DBS_RTW_WARN_TRAINING | [new] HR link-up |
| minPreferenceRating | null | Lock Team Member By Pref |
| clockMethods | GPS, QR | QR / NFC / location |
| geofenceMetres | 150 | [new] distance check for app clock-in |
| mandatoryClockOutNote | false | Mandatory notes on clock out |
| doorstepCancel | true | Door Step Cancels |
| carerDaysForward / Back | 7 / 1 | Show X days forward/back |

Changes to settings are audited and need `rota.settings` permission.

### B4. Visit status state machine

```
           build/add                 carer or office clocks in                clock out
SCHEDULED ─────────► (Due) ──────────────────────────► IN_PROGRESS ──────────────────► COMPLETED
    │                 │  now > start + lateAfter, no clock-in → shown as LATE (derived)       │
    │                 │  now > start + missedAfter, no clock-in → MISSED (job sets it)        └► SHORT (derived: clocked < shortVisitPercent)
    │                 └─ doorstep refusal by carer → NOT_DELIVERED (reason required)
    ├─ cancel (reason, by office) → CANCELLED ── reinstate → SCHEDULED
    └─ no carer in a required slot → shown as UNASSIGNED (derived, not a status)
MISSED ── late clock-in with reason → IN_PROGRESS (audited)
COMPLETED ── office correction (reason) → COMPLETED (new VisitClock rows; history kept)
```

Stored statuses: `SCHEDULED, IN_PROGRESS, COMPLETED, MISSED, CANCELLED, NOT_DELIVERED`. Late, short, unassigned and conflict are **derived** flags, computed by `src/server/rota/status.ts`, so they never go stale.

A worker job `rota.sweep` (every 5 minutes in the worker; daily cron on Vercel plus on-demand from the monitor page) marks overdue SCHEDULED visits MISSED and creates notifications.

### B5. Permissions (add to `ORG_PERMISSIONS`)

| Permission | Who (proposed new `OrgRole`s: `CARE_COORDINATOR`, `CARER`) |
|---|---|
| `rota.view` | ORG_ADMIN, COMPLIANCE_LEAD, CARE_COORDINATOR |
| `rota.edit` (templates, visits, assignments, builds) | ORG_ADMIN, CARE_COORDINATOR |
| `rota.build` | ORG_ADMIN, CARE_COORDINATOR |
| `rota.monitor` | ORG_ADMIN, CARE_COORDINATOR, COMPLIANCE_LEAD |
| `rota.clockCorrect` (office clock-in/out, corrections) | ORG_ADMIN, CARE_COORDINATOR |
| `rota.settings` | ORG_ADMIN |
| `visit.own` (see and work own visits on the phone page) | CARER |

Coordinators may be limited to their areas (Membership → areas), like HR's branch scoping. Portal access goes through `canUsePortal()`.

### B6. Screens

All under `/rota`, purple module colour, CSB TitleBar, Tailwind 3, shared primitives in `src/components/ui.tsx`.

| Route | Screen | Built around | Key behaviour |
|---|---|---|---|
| `/rota` | **Today** | Visits at risk today | See 02. Outcome strip, needs-attention list, today's visits |
| `/rota/visits?date=` | **Daily visits** (OnePlan Daily Rota) | A day's visit list | Filters: date, carer, service user, area, status, call type, unassigned only, include cancelled. Columns: ref, time (sched / actual), service user, carer(s) with slot, call type, status in words, flags (locked, medication, tasks, double-up, shadow, compliance warning). Footer: scheduled vs clocked hours. Bulk actions (B7) |
| `/rota/planner?view=carer-day&date=` | **Planner board** (Advanced Rota) | Allocation | Rows = carers (+ Unassigned row), columns = time. Views: carer by day, carer by week, service user by day, service user by week, by area, by run route. Drag a card to another carer or time **with keyboard alternative** ("Move…" dialog). Every move runs the same server checks as the form and shows a clear reason when refused. Uncovered and cancelled filters. Optional auto refresh |
| `/rota/visits/[id]` | **Visit** | One visit | Times (scheduled vs clocked), carers per slot with acknowledgement, service user summary (no unnecessary personal data), tasks with outcomes, medication flag, notes, clock events with method and distance from the home, full audit history. Actions: assign / reassign, edit time (respects lock), cancel with reason, reinstate, office clock-in/out with reason, complete, add note |
| `/rota/templates?week=1&day=mon` | **Templates** (Daily Templates) | The recurring pattern | Same filters and table as OnePlan. Add / edit template form (B8). Disable / enable. "Apply changes to built weeks" (with a preview of affected visits) |
| `/rota/templates/planner` | **Template board** (Advanced Templates) | Shaping the pattern | Same board component in template mode |
| `/rota/build` | **Build weeks** (Build Rota) | Generating visits | List of built weeks (week start/end, cycle week, current, visits created, built by/at). "Build next week" dialog with the pre-build checklist computed live (templates with no carer, absences not yet approved, holidays in the week) and a **preview** (N visits, M unassigned, K conflicts) before confirming. Delete a future build only if no visit in it has started |
| `/rota/monitor` | **Live monitor** (The Monitor) | Watching calls in real time | Polls `/api/rota/monitor` every 30 s (JSON route). Counts by state, table sorted late-first. Each row links to the visit. Big-screen friendly |
| `/rota/routes` | **Run routes** | Rounds | Live routes by week and template routes. Name, carer, colour, text colour (contrast checked). Visits list per route in time order with gaps |
| `/rota/print` | **Printable rota** | Paper and PDF | Per carer or per service user, date range, options as OnePlan (include address, key safe, medication, cancelled, shadow, exclude surname). Generated server-side with `pdfkit` after a permission check, not stored |
| `/rota/settings` | **Rota settings** | Rules | B3 settings with explanations |
| `/carer` (carer phone page) | **My visits** | The carer's day | Today and next N days; acknowledge; clock in/out (GPS, QR fallback; simulated location in the demo, labelled as such); tasks; notes; doorstep "not delivered" with reason; request absence |

### B7. Bulk actions (MVP subset, each one confirmed with a summary dialog)

Assign / reassign, unassign, cancel (with reason), reinstate, shift times (nudge ± minutes, respecting locks), change call type, lock / unlock, add to / remove from run route, add shadow carer, convert to double-up / back to single, export CSV. Each runs in one transaction with per-row validation; the result lists what succeeded and what was refused and why. "Complete visits" and "Clock in scheduled" exist only as **office clock with reason**, never silently.

Out of MVP (later): push messages (needs a phone app or SMS provider), pay status and chargeable status (Finance stage).

### B8. Template form (CSB)

Service user (search), call type, cycle weeks (one or more of 1–4, with "every week" shortcut), weekdays (toggle buttons with labels, not just letters), start time (time input), duration (minutes, with end time shown), carers required (1 or 2), preferred carer per slot (filtered to eligible carers with a reason shown for ineligible ones), tasks (multi-select from Care tasks), medication required, time locked, alert on late, rota type, run route, effective from / to, notes. zod validation: end after start, not crossing midnight unless rota type ALTERNATE, slot 2 only when carers required = 2, slot 1 and slot 2 different people.

### B9. Allocation checks (one function, used by forms, board, bulk actions and build)

`checkAssignment(ctx, visit, staffId)` returns `ok | warn[] | block[]`:
1. Staff belongs to the organisation, is ACTIVE (ONBOARDING only as shadow), and has a care role.
2. No overlapping assignment (unless allowConflicts), including travel buffer when travel times exist (later).
3. Not on approved absence; inside availability (warn if outside).
4. HR compliance gate: DBS / right to work Overdue or Missing evidence → block; training → warn (setting).
5. Preference: rating below minimum or blocked for this service user → block; gender preference not met → warn.
6. Area: not linked to the visit's area → warn.
7. Double-up: the same person cannot fill both slots.
8. Locked visit: time cannot change; carer change needs `rota.edit` and is audited.

### B10. Build algorithm

For the chosen Monday and cycle week (computed from `RotaCycle.anchorMonday`, overridable): for each enabled template in the chosen areas whose effective dates cover the day and whose cycle week matches, create one visit per weekday with assignments from the template slots; skip service users with an approved absence on that day (record why); mark carers on absence as unassigned instead of assigning them; run `checkAssignment` and keep the visit but leave the slot empty where blocked. All in one transaction per week, idempotent (rebuilding the same week is refused; "apply template changes" updates future, unstarted visits only and shows a diff first).

### B11. Notifications (existing `Notification` model)

| Event | Who |
|---|---|
| Visit late (not clocked in after lateAfterMin) | Coordinators for the area; optionally the carer |
| Visit missed | Coordinators and on-call manager |
| Short visit | Coordinators |
| Unassigned visits in the next 48 h | Coordinators |
| Carer allocated despite a warning | Audit only |
| Absence requested / decided | Manager / carer |
| Visit changed within 24 h of start | The carers affected |

### B12. Reports (Rota stage, CSV and on-screen)

Late / early, missed, cancelled, short visits, scheduled vs clocked hours by carer and by service user, continuity of care (distinct carers per service user per period), unassigned visits, office-clocked vs app-clocked, template hours vs built hours, run route sheets. Finance-related reports follow in stage F (see 06).

### B13. Non-functional requirements

- Daily visits and monitor pages respond in under 1 s for 500 visits a day per organisation (indexed queries, no N+1).
- Concurrency: `Visit.lockVersion`; a stale edit shows "This visit changed since you opened it" and reloads.
- Times stored in UTC, displayed in Europe/London. Builds across the clock change keep local wall-clock times.
- Location data: stored only at clock events, retained per the retention policy, visible only with `rota.monitor`.
- Accessibility: every status in words, board usable by keyboard, colour never the only signal, 4.5:1 contrast.
- Responsive: planner board scrolls horizontally inside its own panel on tablet; on phone the board is replaced by the day list.

### B14. Improvements over OnePlan

| OnePlan | CSB |
|---|---|
| Status by row colour | Status in words plus icon, accessible |
| Carer allocated regardless of HR checks | HR compliance gate at allocation |
| Same carer allowed in both double-up slots | Forbidden |
| "Complete visits" / "Clock in scheduled" without a reason | Office clock only with a reason, audited |
| No preview before Build Rota | Preview with unassigned and conflict counts |
| Template changes pushed blindly ("Add Shifts To Live Rota") | Diff of affected future visits before applying |
| Printable rota shows surnames and key safe codes by default | Least-data defaults; key safe only on request, with audit |
| 30+ bulk actions in one menu | Grouped, with confirmation summaries |
