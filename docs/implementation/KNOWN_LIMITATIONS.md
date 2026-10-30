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
