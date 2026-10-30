# Rota calls missing and dashboards not updating: root-cause report

Owner's report of 30 Oct 2026 (18:15): scheduled calls do not appear in the rota, and dashboards do not change after rota actions. Investigated on branch `claude/project-thread-emflic` against the full-scale test data (58 service users, 58 carers, about 174 visits a day, three branches, seven areas) in the local `csb_uat` database, with a production build in a real browser.

## Short answer

1. **The live demo has no rota to show.** It was seeded before the rostering module existed, and the build step only seeds an empty database (`seed.ts --if-empty`), so the Care Solution Bureau demo there has never had templates built into visits. A rota only has visits for weeks someone has built. None of the work since PR #28 (including this fix) is on the live demo yet, because nothing is merged.
2. **Empty weeks gave no explanation.** A date in a week nobody had built showed an empty board with no message, which looked like missing data.
3. **Several dashboard figures did not exist.** The Rota Dashboard only showed completed, late and missed calls. Adding, cancelling, assigning or removing a carer changed nothing visible there except a small "of N visits" note.
4. **Missed calls were marked up to an hour late on the live host.** Without a background worker (Vercel), the call sweep that marks missed and not-clocked-out calls ran once an hour.
5. **The Overview and the rota counted "unassigned" differently** (empty slots on not-started visits against visits with an empty slot), so the two numbers disagreed.

The mutation plumbing itself was sound, and was measured rather than assumed. Every action saves in a database transaction, then clears Next.js's cached pages (`revalidatePath("/", "layout")` in `handle()`) before redirecting. Every rota page is rendered per request (`force-dynamic`), and link prefetching is off. In a production build, after cancelling a visit, the dashboard showed the new total straight away. That held when opened from the menu, from the Overview, and with the browser's Back button.

## The twelve questions from the brief

| # | Question | Finding |
|---|---|---|
| 1 | Are recurring templates created? | Yes. The UAT load creates 349 templates (four-week cycle, weekday and weekend teams, double-ups, a Friday night sit). |
| 2 | Are the correct weeks built? | Yes: two past weeks, this week and three future weeks, through the real Build Rota and Publish. Later weeks need building, and the screens now say so. |
| 3 | Are real dated Visit rows generated? | Yes: 7,227 over six weeks at the time (8,431 over seven weeks since the load was extended to a month ahead), each with a reference, service user, area, call type, times, carers required, tasks and build. |
| 4 | Linked to the right service user? | Yes. Checked by the consistency tests: the person's schedule lists the same visit. |
| 5 | Carers assigned correctly? | Yes, through the eligibility service. A slot is left empty when the template's carer has a hard stop, and shows as unassigned. |
| 6 | Branch or area filters hiding visits? | No. All-branch roles see all 174 a day. Branch coordinators see their own branch only (tested). |
| 7 | Status or date exclusions? | Cancelled visits are hidden by default on the lists, as intended. The dashboard now counts them separately. |
| 8 | Organisation and permissions? | Correct. Every query is scoped by the session's organisation and the member's branch and area grants. |
| 9 | Empty screens from missing data or broken queries? | Missing data (unbuilt weeks, and the live demo with no rota at all). The queries return the rows. |
| 10 | Stale server-rendered pages? | Not found. Pages are dynamic, and actions clear the cache before redirecting (measured in the browser). |
| 11 | Do dashboards use the same records as the rota? | Yes. The Rota Dashboard counts the Daily Rota's own `listVisits` rows. The Overview now uses the same unassigned rule. |
| 12 | Are writes committed and visible after navigation? | Yes, including after a full reload (tested in the browser). |

## What changed

- **Rota Dashboard call-status strip:** scheduled visits, still to start, in progress, cancelled, unassigned, double-ups short of a carer, staff on duty, and open exceptions (with how many are overdue). All are counted from the date's visit rows, and each links to the list behind it.
- **Automatic refresh:** the Rota Dashboard (for today) and the Overview refresh every 60 seconds while visible, and straight away when you come back to the tab. The Monitor and Advanced Rota already had this.
- **Missed calls without a worker:** where there is no worker, the call sweep runs every five minutes while anyone is signed in (it was once an hour). The worker still runs it every minute.
- **"No rota has been built" notice:** Daily Rota, Advanced Rota, the Planner and the dashboard show it for any week with no build and no visits, with a "Build this week" link.
- **Overview unassigned figure:** it now counts visits still to be delivered with an empty carer slot, the same rule as the rota, and links to that list.
- **UAT data:** every service user now has a unique name. Before, a second pass through the first names repeated names, such as two people called Agnes Abbott in different branches.

## Verified

- `tests/integration/consistency.test.ts` follows one visit through create, assign, reassign, move to another day, change of time and length, cancel and reinstate. After every step it checks that the same rows show in the Daily Rota and Advanced Rota data, the person's and both carers' schedules, the Rota Dashboard figures, the delivery report and the audit log. A second test does the same for a two-way swap and a carer removal.
- `tests/e2e/dashboard-refresh.spec.ts` does the same in the browser, including after a full reload, and checks the "not built" notice on four screens.
- Acceptance run on the full-scale data in a production build (screenshots in `/mnt/project-files/csb-v1-readiness/rota-acceptance/`):

| Step | Result | Dashboard (Sat 31 Oct): scheduled / unassigned / cancelled / on duty |
|---|---|---|
| Before | | 167 / 8 / 0 / 46 |
| Add a 09:00 visit (Ivy Ashcombe) | "Visit added" | 168 / 9 / 0 / 46 |
| Assign Jacob Morris | "Carer assigned"; the visit is on his day and on her visits tab | 168 / 8 / 0 / 47 |
| Reassign to Amara Eze | "Carer assigned" | |
| Move to 09:45 | "Visit saved" | |
| Swap two carers' evening visits | First two choices refused with the reason (double-booking). Third: "Carers swapped" | |
| Cancel another visit with a reason | "Visit cancelled"; reason shown after reload | 167 / 8 / 1 / 47, unchanged after reload |
| Build and publish week of 23 Nov | Built in 2.1 s; "1204 visits published. 49 linked carers have been told in the app." | Mon 23 Nov: 174 / 8 / 0 / 48 |

- Screens at 1440, 1366, 834 and 390 for the dashboard, the Overview and the three rota views with the notice showed no sideways scroll and no script errors.

## Still open, stated plainly

- **The live demo** needs this branch merged and its data replaced before it shows a populated rota. Both need your say-so: "merge", then "yes, reset the live demo". Until then the live rota is empty because no weeks exist there, not because the screens are broken.
- **Hydration warning (#418):** seen once during a full-scale browser run tonight, on a page the script did not record. A repeat of the same run did not show it. It is intermittent and still under watch (D14).
- **Moving a visit to another day** is done by dragging it in the Planner (tested in `planner-moves.test.ts`). The visit page changes time and length, not the day.
