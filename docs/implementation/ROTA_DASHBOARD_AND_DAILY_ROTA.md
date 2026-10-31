# Rota Dashboard and Daily Rota (final design)

Built on 31 October 2026 on branch `claude/project-thread-v3f4gj`, from the owner's brief "CSB-CARE — Final Rota
Dashboard & Daily Rota implementation" and its two approved images (`CSB_Approved_Rota_Dashboard.png`,
`CSB_Approved_Daily_Rota.png`). The layout follows the images. All code, wording and styling are CSB's own, and every
figure comes from the database.

## What changed, by address

| Address | Now |
| --- | --- |
| `/rota` | **Rota Dashboard**. Operational only, with no money. |
| `/rota/visits` | **Daily Rota**: day figures, filters, Needs attention, a carer timeline and Visit Details. The List layout keeps every column and bulk action. |
| `/rota/planner` | **Weekly Planner**: the Monday–Sunday roster from PR #35, with drag and drop unchanged. The old planner page it replaced was only reachable from that roster. |
| `/rota/activity` | All recorded rota activity, searchable and paged (the dashboard's "View all activity"). |
| `/rota/search` | Results of the top bar search on rostering pages. |
| `/rota/today` | Redirects to `/rota`, keeping `?date=`. "Today at a Glance" is no longer in the menu. |

Menu order (Rota section): Rota Dashboard, Daily Rota, Advanced Rota, Weekly Planner, Unassigned Visits, Sickness &
Holiday Cover, The Monitor, Missed Calls, Exceptions, Visit Notes, Live Run Routes, Printable Rota, Build Rota, Generate &
Optimise. Rota Insights has moved to Reports.

## Definitions (shared by both screens)

`visitKpis` and `attentionOf` in `src/server/rota/overview.ts` drive both screens, so the dashboard for a day and the
Daily Rota for the same day always show the same five figures. An integration test checks this.

- **Scheduled**: visits in the period that are not cancelled.
- **Completed**: status Completed.
- **Unassigned**: at least one required carer slot is empty. A shadow does not count as a carer.
- **Missed**: status Missed (the existing monitoring rules).
- **Late**: `deriveFlags` late, using the Rota Settings late threshold. It covers visits started late, or not started
  after the threshold, but not visits already marked Missed.
- Late and Unassigned overlap the delivery states, so the five cards are not meant to add up.

**Today's Performance.** Each visit is in exactly one state: Completed, In progress, Still due (scheduled, not started),
Missed or Not delivered. The doughnut and the bars use the same counts. The centre shows the completed percentage, and
on a future date it shows "—" with "Not started yet". Unassigned and late are listed underneath as conditions, not as
slices. Every slice and bar opens the matching visits.

**Needs Attention** shows outstanding work only:
- missed visits in the period;
- upcoming visits with no carer at all;
- upcoming double-ups with one of two carers;
- visits still not started past the late threshold;
- carers whose readiness is Not ready, Ready with restrictions or Review required.

The red total counts **distinct visits** (a visit in two lists counts once), plus carers with readiness problems.

**Staffing & Availability** counts active carers in the member's scope (and the chosen branch).
- **Available** excludes carers who are off sick, on any approved leave, unavailable all day by their working pattern,
  or Not ready.
- **On annual leave** is approved holiday. **Off sick** is approved sickness.
- **Readiness restrictions** uses the same list as Needs Attention.
- Other leave and all-day unavailability are listed underneath when there are any.

**7-Day Visit Coverage** runs from the chosen date. Each active visit is exactly one of:
- **fully staffed**, with all required slots filled (2 of 2 on a double-up);
- **partly staffed**, with some slots filled (1 of 2);
- **unassigned**, with none filled.

Not-delivered visits are left out. A day with no visits in a week that was never built shows a dashed "Not built" box.
Each bar opens that day's Daily Rota.

**Key Operational Insights** are shown only when the condition is true. Each has a link:
- rota completion against the week before;
- staffing gaps tomorrow;
- carers on annual leave next week;
- service users with a planned absence in the next 7 days;
- bookings flagged after sickness, leave or HR changes;
- weeks not built in the next four;
- unpublished upcoming visits;
- overdue exceptions.

**Recent Rota Activity** comes from each visit's history (created, assigned, reassigned, removed, time changed,
published, swapped and status changes), plus whole-rota audit events (built, published, rolled forward, optimised plan
applied). Whole-rota events cover every branch, so they are shown only to members without branch limits and only when no
branch or search is chosen. Clock times and task ticks are left out; they are on each visit.

## Daily Rota

- **Header**: the day, and the five figures for the whole day in the chosen branch and area. The other filters narrow
  only the timeline and list, so a figure never changes because you are looking at part of the day.
- **Filters**: Branch, Area, Team member, Service user, Status, and previous, date and next. The screen updates when a
  filter changes, and has a Go button when JavaScript is off.
- **Filter (n)** opens service call, show only (late, unassigned, needs review), a text search and "include cancelled".
- **Day / Week**: Week opens the Weekly Planner.
- **Timeline / List**, **Actions** (add visit, show cancelled, printable rota, cover, build or publish, Advanced Rota,
  Weekly Planner, templates), **Add Visit** and **Optimise Rota**.
- **Timeline**: one row per team member, with the run route they mostly work, visits and hours, and any leave or
  sickness. An Unassigned row sits on top. Each visit is a card titled by the **service user**, with the call, time,
  duration and state. A double-up is **one visit** drawn on both carers' rows with a "Double-up" tag. The purple line is
  the current time. Choosing a card selects it (`?visit=`) and opens Visit Details.
- **Visit Details** has four tabs: Details, Notes, Care tasks and History.
  - Details shows the reference, date, area, run route, risk, service call, scheduled start, end and duration, clock in,
    clock out, actual duration, team members, acknowledgement, double-up state, shadowing and office notes.
  - The actions post to the existing server actions, so the eligibility check, row locks, `lockVersion` concurrency check
    and audit history all apply:
    - **Reassign**: `assignCarerAction`, with the ranked carers for each slot. Not-eligible carers cannot be picked.
    - **Move visit**: `updateVisitAction`, which keeps the call type, notes and flags.
    - **Swap shift**: `swapCarersAction`.
    - **Cancel**: `cancelVisitAction`, which needs a reason.
    - **Add a second carer**: `doubleUpAction`. The new slot is then filled with Reassign.
    - **Reinstate** where permitted.
  - After any action the page returns to the same day with the visit still selected.
- **List** is the same table as before, with every column, bulk action, the search and totals.

## Security

- Every query goes through `rotaScope` (organisation and branch or area limits from the session).
- The branch filter (`visitBranchClause`) matches nothing for a branch the member may not pick, so a hand-edited link
  cannot show another branch. The dashboard ignores such a branch and falls back to the member's own.
- Visit Details uses `getVisit`, which returns 404 or 403 outside scope. The panel then shows a short "not available"
  note.
- The rostering search checks `serviceUser.view` and `staff.directory` before searching those groups, and keeps the
  branch and area limits.
- No schema change was needed for this work.

## Screenshots

These are real Playwright captures of the working app on the synthetic three-branch UAT database (`csb_uat`). They
are in `/mnt/project-files/rota-rebuild/final/`, at widths 1672 (×941, the reference size), 1440, 1366, 1024, 834 and
390. None of the six screens scrolls sideways at any width.

The screens are: dashboard, Daily Rota with a visit open, Daily Rota list, activity, search and Weekly Planner.

**Side-by-side differences that remain, on purpose:**
- **Branch selector.** It sits in the page header, not the top bar, because the top bar is shared by every module.
- **Today's Performance.** It keeps a doughnut and the bar list together: the brief asks for the doughnut and the image
  shows bars.
- **Coverage legend.** It reads "Fully staffed, Partly staffed, Unassigned", as the brief defines. The image's legend
  differs.
- **Height at 1672 × 941.** The dashboard is about 90px taller than the reference, so the last row of activity needs a
  short scroll.
- **Daily Rota opening view.** The timeline opens scrolled to the current time, or to the chosen visit, rather than at
  07:00.
- **"On route".** The image's "On route" under each carer is not shown. The platform has no live location, and the
  owner's rules forbid presenting GPS as real. The run route name is shown instead.

## Tests

- `tests/integration/rota-overview.test.ts` (8 tests) checks:
  - figures reconcile with `listVisits` for a manager and a branch coordinator, today and next week;
  - every visit is in one performance state and one coverage state;
  - unbuilt days;
  - the distinct attention total;
  - no money in the payload;
  - branch limits, including a hand-picked other branch and branch figures that add up to the whole;
  - activity scope and search;
  - the Visit Details loader for in-scope, other-branch, other-organisation and missing visits;
  - rostering search scope.
- Playwright (`tests/e2e/rota.spec.ts`, `dashboard-refresh.spec.ts`) checks:
  - dashboard sections, the performance total, no "£", quick-action targets, the period switch, a coverage bar opening
    the Daily Rota, searchable activity and the `/rota/today` redirect;
  - the Weekly Planner;
  - Daily Rota filters, timeline, Visit Details fields, tabs, close, List and Week;
  - moving and reassigning from the inspector;
  - keyboard-only open and reassign;
  - the top bar rostering search;
  - the add, staff, move and cancel acceptance flow with the dashboard and Daily Rota figures agreeing at each step;
  - the not-built notice;
  - no page overflow at desktop, tablet and phone widths.

## Known defects and limitations

1. **Two older integration tests fail in the evening.** `cutoff.test.ts` (two tests) and `missed-calls.test.ts` (one
   test) failed in the 21:00 run. They expect visits still scheduled later today and a missed-call count with no upper
   date bound. They do not touch these screens. Each failure is listed in the test report rather than changed.
2. **Rota Insights shows a money estimate to finance roles** (from the earlier Generate & Optimise brief). It is a
   separate page under Reports, not the dashboard. The owner may want it removed or kept.
3. Phone use of the timeline is a horizontal scroll inside the panel. The page itself does not scroll sideways.
4. The date control uses the browser's own date format (for example `10/31/2026` in a US-set browser).
5. "Not built" is judged per week (a build record or any visit in that week), as on the other rota screens.

## Manual acceptance checklist (for the owner)

Sign in as the manager, then as a branch coordinator.

- [ ] `/rota` opens on today. Changing the branch, the date arrows, Today, This Week and Next Week changes every panel.
- [ ] Each KPI card opens the Daily Rota list filtered to the same visits, with the same count.
- [ ] Today's Performance slices add up to Scheduled Visits. The centre shows the completed percentage.
- [ ] Needs Attention rows open the matching visits, and the red total looks right.
- [ ] Staffing numbers match the people on leave or sick today in HR.
- [ ] A coverage bar opens that day's Daily Rota. A far-future week shows "Not built".
- [ ] Recent Rota Activity shows your own last change. "View all activity" searches by service user or reference.
- [ ] Build Rota, Roll Forward, Optimise Rota and Manage Cover open the real screens.
- [ ] No money appears anywhere on the dashboard.
- [ ] `/rota/visits` has carers as rows and service users on the cards. A double-up shows on both carers' rows.
- [ ] Choosing a card opens Visit Details. Reassign, Move visit, Swap shift, Cancel and Add a second carer all work, and
      the change appears on the visit's History tab.
- [ ] Filters (Branch, Area, Team member, Service user, Status, Filter) narrow the timeline, while the top figures stay
      for the whole day.
- [ ] List keeps every column and bulk action. Week opens the Weekly Planner, where drag and drop still works.
- [ ] As a Liverpool-only coordinator, no Tower Hamlets visit, carer, service user or activity appears anywhere,
      including in the top bar search.
- [ ] Old bookmarks to `/rota/today` land on the dashboard.
