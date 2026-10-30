# Version 1 manual test scenarios

Repeatable scenarios for user-acceptance testing (V1 brief, phase 8). Each one can be run by a person on the full-scale synthetic data, and each has an automated test that runs the same thing on every build.

**Before a session:** `npm run uat:data -- restore` (or `load` for today's dates), then `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csb_uat npm run dev` and open http://localhost:3000. Password for every account: `DemoPassword!2026`. Restore again afterwards; nothing here touches the live demo.

Accounts: `coordinator@care-solution.demo` (all branches), `manager@care-solution.demo` (manager and admin), `finance@care-solution.demo`, `jordan.ellis@care-solution.demo` (Group HR), branch coordinators `coordinator.tower-hamlets@uat.example`, `coordinator.liverpool@uat.example`, `coordinator.portsmouth@uat.example`, and every carer (sign-ins end `@uat.example`; see Administration › Users).

| # | Scenario | Steps (who, where) | Expected result | Automated test |
|---|---|---|---|---|
| 1 | Valid reassignment | Coordinator › Rostering › open a future visit › change the carer to someone shown as Eligible | Saved; visit history shows "Reassigned"; the old carer is free at that time | int rota "asks for confirmation on warnings…", uat-scenarios "sickness cover" |
| 2 | Valid swap | Coordinator › open a future visit › "Swap with another carer's visit" › choose a visit the same day › give a reason | Both visits now show the other carer; both histories show "Swapped" with the reason; Audit Log has `visit.swapped` | int swap "swaps two carers atomically…" |
| 3 | Invalid swap: overlap | Swap a carer onto a visit at a time they already work | Refused: "Swap refused: … is already booked…"; nothing changes | int swap "refuses a swap that would double-book…" |
| 4 | Invalid swap: training | Swap a carer onto a medication call when they are not medication-competent | Refused, naming the carer, the visit and the missing competency; nothing changes | int swap "refuses a swap when one carer lacks training…" |
| 5 | Approved leave | Look at the Liverpool carer on holiday next week (Advanced Rota, next week) | Their visits are flagged "On approved holiday", still assigned to them, and listed for review; nobody was moved automatically | int rota "needs a second person to approve, then flags clashing visits…" |
| 6 | Sickness cover | Today, Tower Hamlets: the carer off sick has flagged visits › open one › assign an Eligible carer | Saved; the review alert on the board closes; history shows the flag then the reassignment | int uat-scenarios "sickness cover" |
| 7 | Expiring compliance | Unassigned Visits from week 4 onwards: the visits of the carer whose DBS review falls due are empty, with the reason in the build | The build never booked them after the due date; trying to assign them is refused with the DBS reason | int uat-scenarios "expiring compliance" |
| 8 | Unassigned visits | Rostering › Unassigned Visits | Each visit lists ranked suggestions; people who cannot do it are not offered; assigning from the list works | int uat-scenarios "partial double-up"; e2e qa-walk |
| 9 | Partial double-up | Unassigned Visits › a double-up with one carer | Shown as needing a second carer; suggestions exclude the carer already on it | int uat-scenarios "partial double-up" |
| 10 | Missed, late and short calls | The Monitor for today; Rota Reports › Visit delivery for last week | Late and missed calls listed with times; short visits flagged; report totals match the visits | int attendance, rota-reports |
| 11 | Missing check-out | The Monitor: the two calls checked in this morning and never checked out | "Not clocked out" alert, once | int uat-scenarios "missing check-out" |
| 12 | Corrected attendance | Carer asks for a corrected time on a past visit; a coordinator approves it | The original clock is kept; the corrected time is used in reports and the timesheet | int corrections; e2e v1 "clock corrections" |
| 13 | Template change | Daily Templates › edit a template's start time › preview › apply | Preview lists every future visit with what will change; visits changed by hand, started or time-locked are left alone with the reason | int uat-scenarios "template change" |
| 14 | Cancel and reinstate | Open a future visit › cancel with a reason › reinstate with a reason | Both recorded in history; the carer stays booked after reinstating if still eligible | int rota-bulk "activates a cancelled future visit only with a reason" |
| 15 | Overnight visit | Week 2 or 4, Friday: the Tower Hamlets night sit (22:00–07:00) | Shown on Friday; paid across both days and bands; on the Monitor until it ends | int cutoff "keeps yesterday's overnight visit…", unit pricing |
| 16 | Pay cut-off | Finance › Timesheets for a week with a Sunday night visit | Work up to midnight paid this week, the rest carried into next week once | int cutoff |
| 17 | Mileage | A carer claims miles; finance approves | Claim needs a different person to decide; future dates refused | int routes-print-mileage; e2e v1 |
| 18 | Overdue policy acknowledgements | Policy & Compliance › Staff Sign-off › overdue | The two carers per branch who have not read the safeguarding policy are listed; they are "Requires review" when allocated | int signoff; UAT data |
| 19 | Training verification | Staff Readiness › the carer awaiting verification › verify (as a different person) | Becomes Ready; the person who entered it cannot verify it | int readiness; e2e v1 "staff readiness" |
| 20 | Timesheet exceptions | Finance › Timesheets (two weeks ago) › Generate › Submit all | Timesheets with unchecked exception lines are refused with the count; check the lines, then submit | int corrections "refuses to submit until exception lines are checked" |
| 21 | Finance approval | Finance › approve submitted timesheets › prepare pay and invoice runs › approve as another person › export | Approval by a second person; approved runs frozen and exportable | int finance |
| 22 | Branch-restricted access | Sign in as `coordinator.liverpool@uat.example` | Only Liverpool areas, people, staff, visits, timesheets and exceptions; other branches' records return "not found" | int branches, exceptions, packages, kpis |
| 23 | Concurrent coordinators | Two browsers: both coordinators swap overlapping visits at once, or edit the same visit | One succeeds; the other is told the visit changed and to reload; no visit ends up with two carers in one slot | int swap "lets only one of two coordinators' overlapping swaps win…", rota "refuses a stale edit" |
| 24 | Move a visit to another day | Rota Planner › drag a visit to another day (or open it and change the day) | Same time on the new day; the template is unchanged; refused into the past or onto a clash | int planner-moves |

## Owner's acceptance checklist (rota and dashboards)

Run these in order on the full-scale data (`npm run uat:data -- restore`, then sign in as `coordinator@care-solution.demo`). Use tomorrow's date so the visits are still in the future. Tick each one only when you have seen it yourself.

| # | Do this | You should see | Pass / fail |
|---|---|---|---|
| A1 | Rostering › Rota Dashboard, then the next-day arrow | A populated day: about 167–174 scheduled visits, with figures for still to start, unassigned, short double-ups and staff on duty | |
| A2 | Advanced Rota for the same date | Every carer's calls across the day, plus an Unassigned row at the top | |
| A3 | Daily Rota › Add visit: a person, 09:00, 30 minutes | "Visit added". Back on the dashboard, scheduled and unassigned are each one higher | |
| A4 | On that visit, choose a carer marked Eligible or "check first", tick "I have read the warnings", Assign | "Carer assigned". Unassigned goes back down and staff on duty may go up. The visit shows on the carer's day (Advanced Rota, carer filter) and on the person's Visits tab | |
| A5 | Replace the carer with another one | Only the new carer has the visit. History shows both | |
| A6 | Change the start time and Save visit | The new time shows on the visit, the Daily Rota and the Advanced Rota | |
| A7 | Open another staffed visit › "Swap with another carer's visit" › choose one › give a reason | Either "Carers swapped", or a refusal that names the carer and the clash. A refusal changes nothing | |
| A8 | Rota Planner › drag a visit to another day | It moves to the same time on the new day | |
| A9 | Cancel a visit with a reason, then refresh the browser | Still cancelled, with the reason. Dashboard: scheduled one lower, cancelled one higher | |
| A10 | Advanced Rota for a date five weeks ahead | The yellow "No rota has been built" notice with a Build this week link | |
| A11 | Build this week › Build New Rota › Publish | About 1,200 visits built and published. The notice is gone and the board is full | |
| A12 | As `manager@care-solution.demo`: Administration › Audit log | Entries for the visit you added, assigned, swapped and cancelled | |
| A13 | Rota Reports › Visit delivery for the dates you changed | Planned and cancelled totals include your changes | |
| A14 | Sign in as `coordinator.liverpool@uat.example` | Only Liverpool's people, carers and visits | |

## Recording a manual run

For each scenario, note: date, tester, account used, pass or fail, and for a fail what was seen (a screenshot helps). A failure that matches an automated test that passes is a gap in the test; report it so a test can be added.
