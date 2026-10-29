# Known limitations

Written plainly so nothing below is mistaken for working software.

## Not built yet (marked "Planned" in the sidebar)
- Live call monitoring and the late or missed call sweep job. Settings are stored but nothing runs.
- Carer clocking in and out. GPS, NFC and offline use are not built, and nothing claims they are. The carer page shows visits and an "I have seen my visits" acknowledgement only.
- Run routes and travel optimisation.
- Care plans, risk assessments, tasks and notes, and incidents. The schema exists, including the care-plan immutability trigger, but there are no screens.
- eMAR and medication. Visits show a "medication prompt" flag only. No medication-compliance figures are shown anywhere.
- Timesheets, rates, invoicing and payroll preparation. The schema and frozen-run triggers exist, but there are no screens. Nothing is ever issued automatically.
- Rostering reports and the wider Reporting and Administration modules.

## Data and environment
- **Synthetic demo data only.** Seeded attendance history (completed visits in the past) is generated, not real.
- The HR fixtures contain two different people called Amelia Hart. This is correct data, but confusing in lists; job titles tell them apart.
- Some HR fixtures deliberately lack evidence, so about 21 carer slots a week stay empty and some allocations show "needs review". This exercises the warnings.
- The database must allow the `btree_gist` extension (Supabase and standard PostgreSQL 16 do).
- When deployed, `vercel-build` runs `prisma migrate deploy` and the seed with `--if-empty`. The new migrations are additive, but merging this branch to `main` would apply them to the live demo database. Merge only on the owner's say-so.

## Behaviour to be aware of
- Planner drag-and-drop moves a visit between carers on the same day only. Moving to another day is done on the visit page.
- Daily Visits shows at most 1,000 visits and the planner 3,000 per week; both say so when they cut the list.
- Build Rota never builds the same template visit twice. To start a week again, delete its build; this is refused if any visit has started, is in the past, was changed by hand or has records, and then individual visits must be cancelled instead.
