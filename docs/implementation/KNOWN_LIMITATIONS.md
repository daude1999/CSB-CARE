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

## Row-level security (enterprise readiness, workstream 2, 10 Nov 2026)

Full description, the complete list of bypass call sites and operating notes: `docs/SECURITY.md`, "Row-level security".

- **Not yet tried on the hosted database.** Everything was tested on local PostgreSQL 16, where the application's
  login is a superuser. The live database is Supabase, where the `postgres` login is not a superuser. The migration
  needs that login to be able to create the `csb_app` role and switch to it. Try the migration on a staging copy of
  the hosted database before merging; if it fails there, nothing in the application has changed yet.
- **The migration runs on the live database at merge** (through `vercel-build`). It adds policies and a role; it
  does not change or delete any row. Rollback is in the pull request.
- **Second layer, not a replacement.** The application's own `organisationId` filters remain the first layer. The
  database layer stops a forgotten filter from leaking; it does not stop SQL injection or a stolen database
  password, because the application's login still owns the tables. A separate, weaker login for the application is
  hosting work and out of scope.
- **Child tables without an `organisationId` column** (for example `CarePlanSection`, `VisitTask`) are protected
  only through their parent row.
- **Shared rows** (no organisation: CSB master policies, platform notifications, platform audit entries) are
  readable from any scope, as before; platform permissions in the application decide who may change them.
- **The vitest suite and the browser-test fixtures run in the system scope**, because they call server functions
  directly across organisations. Tenant scoping is exercised by `rls-tenancy.test.ts` and by the browser suite,
  which signs in through the real request path.
- **Speed.** Each query is now a short transaction with one extra statement. Measured locally on the demo data
  (150 requests per page, same build with the feature off and on): the slowest 5% of loads went from 170 to 194 ms
  on the Rota Dashboard, 110 to 120 ms on the Daily Rota, 106 to 125 ms on All Service Users and 73 to 92 ms on a
  service user's profile (table in `TEST_RESULTS.md`). Not measured on the hosted database, where each extra round trip costs more.
- **Backups.** `pg_dump` must run as a login that bypasses row-level security, or it stops with an error rather
  than writing a partial backup. Check the backup job (`docs/BACKUPS.md`) once it is active.

