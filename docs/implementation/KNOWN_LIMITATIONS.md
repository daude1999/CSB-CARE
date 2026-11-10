# Known limitations

Written plainly so nothing below is mistaken for working software.

## Not built yet (marked "Planned" in the sidebar)
- Version 2 (owner, 29 Oct): WhatsApp and other messaging, recruitment, and the offline carer app.
- GPS, NFC and offline use on the carer page. Clock times are the server's time when the button is pressed, and the page says so.
- Travel times, distances and route optimisation. Run routes keep the order a coordinator sets by hand; mileage is what the carer states.
- Incidents: the "may need notifying" flag is a reminder only. The platform never sends notifications to CQC or a local authority.
- Medication records are switched off for every organisation until an admin switches them on and records who did the clinical review; the demo is not switched on. When on, the platform records what carers say happened. It does not check doses, interactions, allergies or stock, does not order medicines, and has no pharmacy or GP Connect link. A controlled drug's witness is a typed name, not a second sign-in.
- Finance prepares figures only. Nothing is ever paid, invoiced, submitted to HMRC or sent to a funder. Pay runs show gross pay before deductions; tax and National Insurance are left to the payroll provider. The CSV is for import into other systems.
- Mileage claims are typed by the carer (miles for a day, within 60 days). They are not worked out from a map, and the demo has no claims until someone makes one.
- Overnight and cut-off pay: runs prepared before this change keep their old lines until they are prepared again. A correction after a pay run is approved needs the run voided and prepared again; automatic adjustment lines into the next run are not built.
- Travel and rest advice uses visit times only, not addresses: under 10 minutes between visits, or under 11 hours between working days, is shown as advice in the allocation picker and never blocks.
- Reporting & Analytics has no charts by month or scheduled reports yet. Analytics covers at most a year at a time and Rota Reports 92 days.
- Invitations and password resets are not emailed: the admin copies a one-time link and gives it to the person.

- Policy acknowledgement assessments are a manager's recorded pass or fail, not an online quiz. Reminders and escalations for overdue acknowledgements are in-app only; no email or text goes to staff who have no sign-in, so their manager sees them as outstanding on Staff Sign-off.

- Exception deadlines are fixed per type and cannot yet be changed in Settings. Escalation goes to care managers and organisation admins inside the platform only.

## Open QA findings
- React's hydration notice (#418) shows in the browser console on one to three of 475 screens per QA walk, a different screen each run. Pages show and work correctly; the cause is not yet found. It is listed by the walk in `docs/implementation/v1-qa-walk.json`.
- Nothing in V1 has yet been checked by a person; `V1_ACCEPTANCE_CHECKLIST.md` is the owner's list.

## Data and environment
- The demo funders are fictional councils, and one package is left unfunded on purpose so the invoice run shows an exception.
- The seed builds last week as history (completed visits, timesheets, draft runs) through a seed-only option on Build Rota. Users cannot build a past week.
- **Synthetic demo data only.** Seeded attendance history (completed visits in the past) is generated, not real.
- The HR fixtures contain two different people called Amelia Hart. This is correct data, but confusing in lists; job titles tell them apart.
- Some HR fixtures deliberately lack evidence, so about 21 carer slots a week stay empty and some allocations show "needs review". This exercises the warnings.
- The database must allow the `btree_gist` extension (Supabase and standard PostgreSQL 16 do).
- When deployed, `vercel-build` runs `prisma migrate deploy` and the seed with `--if-empty`. The new migrations are additive, but merging this branch to `main` would apply them to the live demo database. Merge only on the owner's say-so.

## Behaviour to be aware of
- The call sweep runs every minute with the background worker. The Vercel demo has no worker, so there it runs when the job queue is kicked (at most hourly) or when someone presses Check now on the monitor. The monitor shows when it last checked and warns when that is over 10 minutes ago.
- The sweep looks back 14 days. Calls older than a day are still marked missed, but without in-app notifications.
- Planner drag-and-drop moves a visit between carers on the same day only. Moving to another day is done on the visit page.
- Daily Visits shows at most 1,000 visits and the planner 3,000 per week; both say so when they cut the list.
- Build Rota never builds the same template visit twice. To start a week again, delete its build; this is refused if any visit has started, is in the past, was changed by hand or has records, and then individual visits must be cancelled instead.

## OnePlan bulk actions not copied (29 Oct 2026)

These OnePlan Daily Rota and Daily Templates actions are deliberately left out:
- **Clock In Scheduled, Clock Out Scheduled, Complete Visits, Reassign and Complete.** They would record attendance nobody gave, which breaks call-monitoring evidence. Office corrections on the visit page record who corrected what, and why.
- **Send Push Message.** Outbound messages need review first.
- **Update Pay Status, Update Chargeable Status.** Pay and charging come from the finance module's timesheets and invoices.
- **Delete Visits, Delete Template.** We cancel or disable with a reason instead, so the history stays. A whole future build can still be deleted from All Rotas.
- **Reset Visits, Edit Rota Type, Update Template CPLI, Make New, Add Shifts To Live Rota, Export To CSV.** Not built yet. Export is available from Rota Reports, and built visits are updated from a template's own page.
- **Add To / Remove From Run Route, Live Run Routes, Template Run Routes, Printable Rota.** Built in V1 (29–30 Oct). Run Routes do not plan travel.

## Missed call automation (4 Nov 2026)

- Off by default. An organisation admin switches it on in Rostering settings.
- On Vercel, collection runs when the queue is kicked or a coordinator presses Refresh evidence. Rota and cover changes are picked up within about 10 minutes, not instantly.
- Carers are asked in the app only, and only within a day of detection. No text, email or WhatsApp.
- Different answers from carers on a double-up give "Conflicting evidence" rather than a reason.
- Contingency-plan and time-critical fields from the spec do not exist yet.

## Quality gates (enterprise readiness, workstream 1, 10 Nov 2026)

- **The CI check is not yet required.** The owner has to tick "Quality gate" under GitHub, Settings, Branches, branch protection for `main`. Until then a failing check does not block a merge.
- `npm audit` still reports 8 moderate findings (`uuid` through `exceljs`, and `minimatch`). The gate fails on high and critical only.
- The browser tests are not part of the Quality gate. They run in their own workflow (`playwright-e2e.yml`). That workflow runs four of the specs; the full suite of 258 (about 20 minutes) is run by hand.
- Pressing Back in the first fraction of a second after reloading a page, before it is interactive, changes the address but not the page. This is how the framework behaves; the browser test now waits as a person would.
- A carer who is booked elsewhere after one of their calls was marked missed cannot clock in to the missed call; they are told to phone the office. Whether the office should be able to override that is a product decision, not made here.
- Vercel's preview check fails on every pull request for a reason outside the repository (its logs cannot be read from here). It is not part of the Quality gate.
- The nightly late-evening and after-midnight test runs start only once the workflow is on `main`.
- Ending a service user's care cancels visits that have not started. A visit already in progress at that moment is left alone and then blocks archiving until it ends. Not changed here.

## UX and responsiveness (enterprise readiness, workstream 5, 10 Nov 2026)

Full detail in `UX_RESPONSIVENESS_AUDIT.md`.

- **Timings are from demo volumes on one machine.** No query was slow there, so no index was added. Repeat the crawl on a staging copy with realistic volumes before deciding the database needs nothing.
- **The staff eligibility check runs once per week or per visit on several rota pages** (`/rota/visits/[id]` 105 queries, `/rota/coordinator/shift` 80, `/rota/attention` 78, `/rota/build` 71). Fast locally; on a hosted database each query adds network time. Batching it is a change to the rota's core rule and is not done.
- **Mobile Lighthouse performance is below 90 on the HR Hub and Policy Library** (simulated slow phone). The HR Hub loads its whole workspace in one request and one script; the Policy Library loads the document viewer with the list. Desktop scores are 98 to 100.
- **The "missing from built weeks" notice on a visit template arrives a moment after the page**, and needs JavaScript to appear.
- **The drafts queue and "my sign-offs" are not paged**; audits and corrective actions are (50 a page).
- **Not done from the brief, on purpose:** per-section `loading.tsx` files, `useOptimistic`, a toast component, the single type scale (the owner decided it will be its own pull request after these are merged; page background and padding came with the colour redesign), and splitting the HR Hub's two large files. Reasons are in the audit.
- **Two accessibility items left for other changes:** the Policy Library viewer's toolbar buttons at 1440 wide (17 px, needs 24 px) with one low-contrast label on that screen, and one small tap target in the shared top bar on a phone. The orange "Late calls" tile listed here earlier was fixed by the colour redesign.

## Colour redesign, PR 1 (10 Nov 2026)
- The header band uses white at 92% for the breadcrumb and description and a white 8% fill for secondary buttons, not
  the mock-up's 78%, 88% and 14%, because those fail WCAG AA on several module colours. See `COLOUR_SYSTEM.md`.
- Below 640px the page frame keeps a 16px side padding (the brief's 24px applies from tablet width up), and the band's
  icon chip is hidden so the title has room.
- Pages that kept their own layout: the Overview (approved and locked; only the launcher moved), the Evantix Platform
  Admin Centre (its own shell), the HR Hub's employee record (the person's name stays as its heading) and the Policy
  Reader's document pills under the band.
- The body map keeps its own clinical colours, and a few exported-file accents (Excel/PDF) keep their navy.

## Colour redesign, PR 2 (10 Nov 2026)
- The Late tile uses `#b45309`, a little darker than its old `#c0570c`, so its figure passes AA on the tile's tint.
- Daily Rota call rounds are the organisation's call types. A call type has no set hours, so a round's times are its
  first and last visit start of the day, and rounds are ordered by their first visit. Rows are grouped only when the
  list is sorted by time; other sorts show a plain list.

## Colour redesign, PR 3 (10 Nov 2026)
- The Daily Rota opens on the Board. Links that carry a list filter, sort, page or selected visit still open the list.
  The "Planner" header button became "Advanced Rota planner" in the Actions menu.
- Call rounds on the Board take their times from the day's visits, because a call type has no set hours. Two rounds
  can overlap.
- Dragging needs a mouse. With a keyboard or touch screen, open the block and use "Reassign", which goes to the same
  assignment form and checks.
- On phones the name column scrolls with the board rather than staying pinned, to leave room for the visits.
- A scheduled visit past its start time shows as "Late" on the Board; there is no separate "overdue" colour.
- "Why this carer" shows the match reasons as they stand now, not as they stood when the carer was booked. The
  eligibility decision and accepted warnings are the ones recorded at booking.

## Colour redesign, PR 4 (10 Nov 2026)
- The command bar finds service users, team members and today's visits for people with rota access. HR-only records
  (employee files, HR documents) and policies are not searched in it; the HR Hub's search and the Policy Library
  search stay in the top bar. Ctrl+K no longer opens the HR Hub's search on HR pages.
- Six results are shown per group. The top bar's search page still lists up to 15.
- Actions are links to existing screens. Nothing is changed from inside the command bar.
- The Evantix Platform Admin Centre has its own shell and keeps its own quick search.

## Colour redesign, PR 5: Overview (10 Nov 2026)
- Call rounds come from today's visits: one round per call type that has visits, timed by its first and last visit
  (call types have no set hours). "Done" means nothing is left to deliver in the round (completed, missed or not
  delivered); "Now" is the latest round that has started and still has visits to come.
- The Policy tile's figure is the sum of the Policy items in Needs your attention; its breakdown line is cut short with
  an ellipsis when it does not fit (the full text is in the tooltip).
- The Reporting tile's figure and bars are completed visits for the last seven days, for people with rota access. Others
  see the number of report exports instead.
- "View all" still opens Notifications, which is not filtered to the attention items.
- Rearrange orders the four tiles along the bottom. The Rota tile and Needs your attention stay at the top.

