# Rota Dashboard and Daily Rota Live List (modernised OnePlan style)

The owner changed direction on 31 October 2026 at 23:39. The two rota screens now follow two approved images,
`Rota_Dashboard_APPROVED.png` and `Daily_Rota_APPROVED.png`, in a modernised OnePlan style that non-technical office
staff can use. All code, wording and styling are CSB's own. The figures, names and alerts in the images are only
examples: nothing from them is hardcoded. **The sidebar was not changed**, because it is handled in a separate piece of
work.

## `/rota`: Rota Dashboard

Data comes from `rotaDashboard()` in `src/server/rota/dashboard.ts`, the same service the earlier OnePlan-style
dashboard used, now with a branch filter. One date drives the whole page: previous, next, a date picker and Today. When
the member has more than one branch, they can also pick a branch, and a branch they may not choose is ignored.

| Area | What it shows | Source |
| --- | --- | --- |
| Completed Calls (green) | Visits with status Completed. The % is of the day's scheduled visits that are not cancelled. | `listVisits` |
| Late Calls (orange) | Started late, or still not started past the late threshold in Rota Settings. Missed visits are not counted here. | `deriveFlags` |
| Missed Calls (red) | Visits with status Missed. The card opens Missed Calls for the day. | visit status |
| Calls with Missed Meds (blue) | Visits on the day with a `MISSED_MEDICATION` alert, shown **only when medication records are switched on** after clinical review. While they are off (as in the demo), the card shows **Unassigned Calls** instead: visits with an empty carer slot. CLAUDE.md forbids showing medication figures without review, and there is no reliable figure to show anyway. | `missedMedsCount` |
| All Service Users | Active, paused and assessment service users in scope. Columns: forename, surname, date of birth and next scheduled visit. Search, area filter, sorting and pages of five. Actions open the Daily Rota for that person, their visit templates and their record. The design's Ethnicity column is not shown because the platform does not record ethnicity. | `serviceUser.view` |
| All Team Members | Staff in scope with role and **day status**: Off sick or On leave (approved absence that day), then Not ready (readiness), then On rota (holds a carer booking that day), otherwise Off rota. The amber badge counts staff with no app sign-in linked. | `staff.directory` |
| All Active Reminders | Care plan reviews and risk reviews due within 14 days or overdue, plus leave requests still to decide. Overdue days are shown in red. **View All** opens `/rota/reminders`, which has a 14, 30 or 90 day window and no row limit. | `activeReminders()` |
| Issue strip | **Rota Conflicts**: visits on the date with an allocation to review. **Template Conflicts**: template slots with no carer, or a carer who has left. **Holidays Due**: approved absences starting in the next 14 days. **Visit Notes**: notes written on the date. | as before |
| Service User Upcoming Birthdays | Next 30 days, from the stored date of birth. Needs `serviceUser.view`. | `ServiceUser.dateOfBirth` |
| Team Member Upcoming Birthdays | Next 30 days. Dates of birth stay in HR & Workforce and are **never projected into Rostering**. They are read from the HR record only for someone with an HR sign-in, only for employees their HR branch access covers, and only for staff they can already see. Everyone else sees a short note saying why the panel is empty. | `staffBirthdays()` |
| Quick Actions | Build Rota (`rota.build` only), Weekly Planner, Unassigned Visits (with the day's count), and Exceptions (with the open count, `rota.monitor` only). | |

**"Unread Notes" is shown as "Visit Notes".** Visit notes have no read or unread tracking. Adding it needs a schema change
(who read which note, and when), so until it is approved the strip counts the notes written on the date.

No money appears anywhere on the dashboard.

## `/rota/visits`: Daily Rota – Live View

- **There are no figure cards.** The page opens straight onto the visits, and the day's figures are on the dashboard.
- **Header**: the date and branch, previous and next day, a date picker, and Today. **List** is the default view.
  **Planner** opens the Advanced Rota for the same day, keeping the area and team member. **Add Visit** is also here.
- **Filter bar** (kept in the address): search by service user, carer name, postcode or reference; Area; Status; Service
  User; Team Member.
  - **More Filters** has branch, service call, "show only" (short of a carer / uncovered, late, allocation to review)
    and include cancelled.
  - **Actions** has add visit, show cancelled, the **carer timeline** for the day (the previous Birdie timeline, kept),
    unassigned visits with suggestions, printable rota, cover, build or publish, Generate & Optimise, Weekly Planner and
    templates.
- **Bulk actions**: the same 16 actions as before, through `bulkVisitsAction`. Select all ticks the current page.
- **Default columns**:
  1. Select
  2. Ref
  3. Date
  4. Status
  5. Service User (links to their record)
  6. Time
  7. Duration
  8. **Carers**: booked of needed (1/1, 1/2, 2/2). Green when full, amber when part-staffed, red when nobody is booked.
     A part-staffed visit is never shown as missed or failed.
  9. Service Call
  10. Team Member(s) (amber when the booking needs review)
  11. Alerts: late, needs review, shorter than planned, medication prompt
  12. Notes: the visit's notes plus office notes
  13. **Week**: the rota pattern week
  14. **Calendar week**: the ISO week number
  15. **Checklist**
- **Column settings** add: area, run route, risk, end time, clock in, clock out, clocked duration, acknowledged, and
  published and locks.
- **Sorting**: by reference, date, status, service user, time, duration, carers, service call or team member.
- **Pages**: 25, 50 or 100 rows per page.

### Week and checklist

- **Rota pattern week** (`patternWeek()`) is the cycle week the visit's build used (`RotaBuild.cycleWeek`, since a build
  can override the calendar). If a visit came from a template without a build record, it is the cycle week of its date.
  A one-off visit shows "—", never an invented "Week 1".
- **Calendar week** (`isoWeek()`) is the UK/ISO 8601 week of the visit date. For example, Saturday 31 October 2026 is
  week 44.
- **Checklist** (`checklistOf()`) uses each task's latest recorded outcome:
  - "—" means there are no tasks.
  - A green tick means every task is done.
  - Amber with a count means some tasks are recorded as not done or refused.
  - Grey with "done/total" means tasks are still to record.

  Selecting it opens the Care tasks tab.

### Visit Details drawer

The drawer opens only when a visit is selected (`?visit=`). With no visit selected, the table uses the full width. The
selected row is outlined, and the filters, sort and page are kept. The drawer shows:

- the name (linking to the service user's record), reference and status;
- the date, time and duration, area and run route, service call, and risk;
- clock in and out, and acknowledgement;
- carers as "x of y", with a remove button on each;
- **Add Carer**: assigns an open slot, or makes the visit a double-up;
- the care task count, and the tabs Notes, Care tasks and History.

Actions:

- **Reassign Carers**: ranked carers per slot. Not-eligible carers are disabled.
- **Edit Visit**: date, time, length and office notes.
- **Add Note**: Note, Handover, or Concern, which raises an exception.
- **Full visit**.
- **Swap shift**.
- **Make single**.
- **Cancel visit**.
- **Reinstate** (where permitted).

Every action posts to the existing server actions, so `rota.edit`, the branch scope, the eligibility service, row locks,
`lockVersion` and the visit history and audit all apply. Completed and cancelled visits cannot be moved or re-staffed.

## Security

- Every query goes through `rotaScope`. Branch choices are checked against `authorisedBranches`, and a branch a member
  may not choose is ignored (dashboard) or matches nothing (Daily Rota).
- Panels check `serviceUser.view`, `staff.directory` and `rota.monitor` on the server.
- Team dates of birth need an active HR user, and HR's own `permits()` branch rule applies.
- No schema change was made.

## Supporting 3 or 4 carers on one visit (not built)

Today a visit needs one or two carers (`carersRequired` 1–2, slots `PRIMARY` and `SECOND`, plus an optional `SHADOW`).
Supporting 3 or 4 would need:

1. **Model**: allow `carersRequired` 1–4, and replace the fixed `AssignmentSlot` enum with numbered carer slots (a
   `slotIndex` int with a unique index per visit for live rows) while keeping `SHADOW`. Migrate PRIMARY→1 and SECOND→2.
   Database checks would keep `slotIndex <= carersRequired`.
2. **Assignment and eligibility**: `assignCarer`, `swapCarers`, bulk reassign, `rankCarers` (`otherSlotStaffIds`) and
   `visitCandidates` would loop over N slots. Double-booking and travel-gap checks are already per carer.
3. **Templates and build**: `preferredStaff1Id` and `preferredStaff2Id` become a preferred-staff list per template, and
   build and roll-forward copy N slots.
4. **Attendance**: clock-in already records each carer. The rules for in progress, complete and missed must decide when
   all N carers count as present, and short visits and missed-call attribution would work per carer.
5. **Optimiser and matching**: proposals per slot index.
6. **Screens**: the coverage badge already shows filled/required, so it needs no change. The pickers would loop over N
   slots.
7. **Tests**: the migration, all four slots, the eligibility for each, and the attendance states.

## Screenshots and visual comparison

Real Playwright captures of the working app on the synthetic three-branch UAT database (`csb_uat`), at widths 1672
(×941, the reference size), 1440, 834 and 390. They are in `/mnt/project-files/rota-rebuild/oneplan-style/`. No page
scrolls sideways at any width.

These differences from the images remain on purpose:

- **Sidebar and top bar** are the platform's existing ones. They are out of scope.
- **Ethnicity column**: Area/DOB/Next Visit are shown instead, because the platform does not record ethnicity.
- **The blue card** shows Unassigned Calls while medication records are off.
- **The "Unverified Emails" badge** is "N without a sign-in", the real equivalent.
- **"Unread Notes"** is "Visit Notes" (see above).
- **The date picker** shows the browser's own date format.
- **The paperclip (documents) column** in the Daily Rota image is not shown, because visits have no attached documents.
- **The drawer** on screens narrower than 1280px sits below the table, not beside it.

## Tests

- `tests/integration/rota-live-screens.test.ts` (10 tests) covers:
  - ISO week against pattern week;
  - birthdays (including 29 February);
  - the truthful checklist;
  - the pattern week source;
  - carer-name search;
  - dashboard figures reconciling with the Daily Rota for a manager and a branch coordinator;
  - the branch filter ignoring other branches;
  - team day status and next visit;
  - birthday permissions;
  - reminder order and branch scope.
- The existing `rota-dashboard`, `rota-overview`, `consistency` and `rota-branch-builds` tests still pass.
- Playwright (`tests/e2e/rota.spec.ts`, `dashboard-refresh.spec.ts`) covers:
  - the dashboard: sections, no money, search and pages, links, quick actions, View All, date;
  - the Daily Rota: no figure cards, List by default, filters, all 15 column headings, coverage and week formats, the
    drawer opening, tabs and closing, column settings, sorting, Planner;
  - editing and reassigning from the drawer;
  - keyboard-only open and reassign;
  - the add, staff, move and cancel acceptance flow, with the dashboard and the Daily Rota agreeing at every step;
  - no overflow at desktop, tablet and phone widths.

## Cancelling: charge or don't charge (owner's request, 1 November 2026)

- Every cancel form asks **"Charge for this cancellation?"** with two choices, **Charge** and **Don't charge**. This applies to Bulk Actions → Cancel Visits, Cancel visit in Visit Details, and the full visit page. The server refuses a cancel with no choice made.
- The choice is saved on the visit in `Visit.cancellationCharge` and written into the visit history, for example "In hospital (charged)". Reinstating a visit clears it.
  - **Schema change:** this is one additive nullable column (migration `20261101010000_visit_cancellation_charge`).
  - **Why a new column:** reusing `Visit.chargeable` would wrongly leave a reinstated visit unbilled.
  - **When it is empty:** visits cancelled by the system (care ended, service user away) leave it empty.
- **Invoicing** (`cancellationCharged()` in `src/server/finance/runs.ts`):
  - When the office chose, its choice decides whether the cancellation is invoiced.
  - With no choice recorded, the funder's short-notice rule still decides, as before.
- **How cancelled calls look:**
  - **Daily Rota:** the row has a red line through it, and its status shows a red **X Cancelled** with "· charged" or "· not charged".
  - **Visit Details:** the name is struck through, and the reason shows the charge decision.
  - **Advanced Rota and the carer timeline:** cards get the same red line and an X.
- **Tests:**
  - `tests/integration/cancellation-charge.test.ts` covers the invoice decision, single cancel, reinstate and bulk cancel.
  - The e2e tests in `rota.spec.ts` and `dashboard-refresh.spec.ts` check that the choice is required and that the row is struck through.
- **Screenshots:** `/mnt/project-files/rota-rebuild/cancel-charge/`.
