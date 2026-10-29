# Known limitations

Written plainly so nothing below is mistaken for working software.

## Not built yet (marked "Planned" in the sidebar)
- GPS, NFC and offline use on the carer page. Clock times are the server's time when the button is pressed, and the page says so. Task recording and notes from the phone (apart from the clock-out note) are not built.
- Run routes and travel optimisation.
- Visit task recording and general notes from the phone. Care plans, risk assessments and incidents are built.
- Incidents: the "may need notifying" flag is a reminder only. The platform never sends notifications to CQC or a local authority.
- eMAR and medication. Visits show a "medication prompt" flag only. No medication-compliance figures are shown anywhere.
- Finance prepares figures only. Nothing is ever paid, invoiced, submitted to HMRC or sent to a funder. Pay runs show gross pay before deductions; tax and National Insurance are left to the payroll provider. The CSV is for import into other systems.
- Mileage claims have no entry screen yet. Pay runs include approved claims if any exist, but the demo has none.
- The wider Reporting & Analytics and Administration modules. Rota Reports (/rota/reports) are built; they are worked out live, at most 92 days at a time, and do not include charts or scheduled emails.

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
