# Demo data clean-up (fresh start), 6 Nov 2026

The owner asked on 6 Nov 2026 to "remove all demo data from the system ... so we can have it as a fresh application".
Scope confirmed in the project thread: remove every service user (including the one real record entered on 4 Nov),
remove the other demo records too, and keep the support workers because they are needed for HR policies and for
assigning carers to service users the team will add themselves.

## How it runs

`prisma/demo-cleanup.ts` runs once from `vercel-build`, after `prisma migrate deploy` and before the seeds. It does
nothing unless this is the production build, the `csb-demo` organisation exists and is still a demo, and
`2026-11-06-fresh-start` is not already in the audit log. Everything happens in one transaction: if any step fails,
nothing changes and the deployment carries on.

1. **Backup.** Every table is copied as it is into the schema `backup_20261106_before_cleanup` in the same database.
2. **Deleted for Care Solution Bureau** (the full list is `CLEARED_TABLES`): service users and everything about them
   (contacts, packages, care plans, risk assessments, incidents, medication and MAR, body maps, documents, intake
   reviews, safeguarding decisions), visits and their history, visit templates, rota builds and plans, run routes,
   alerts, missed-call cases, invoices, pay runs, timesheets, mileage claims, call notes, recruitment candidates,
   audits, actions, risks, CQC assessments and evidence links, RCA investigations, evidence documents, completed form
   records, bell notifications, assistant history and the three "(fictional)" funders. The test organisation
   Oakridge and its only login are deleted too.
3. **Kept:** the organisation, branches, areas, call types, rate cards, finance and rota settings, every Care
   Solution Bureau login and membership, staff records and the HR workspace, readiness rules, the policy library,
   policy acknowledgements, form definitions and templates, audit templates, the CSB platform logins
   (`*@csb.demo`) and the audit log (immutable by design).
4. **No longer a demo.** The organisation's `isDemo` becomes false and "(DEMO)" leaves its name. That removes the
   "Fictional demonstration person" and "All names in the demo are fictional" labels, hides the demo sign-in hint on
   the login page, and makes `demo-reset.ts`, `seed.ts --if-empty`, `seed-hr.ts` and `seed-recruitment.ts` skip from
   then on, so no deployment adds demo data back. Its logins stop being demo logins, so their passwords can be
   changed (they still use the shared demo password until someone changes them).

The "Run your first audit" setup step shows as not done again, because the demo audit is gone.

## Restoring

The backup schema has the same table names as `public`. To put back one service user, for example, copy the rows
from the backup tables into `public` in foreign-key order with the triggers paused (as `demo-reset.ts` does). To
drop the backup once it is no longer needed: `DROP SCHEMA backup_20261106_before_cleanup CASCADE;`. Never run either
without the owner's go-ahead.

## Tests

`tests/integration/demo-cleanup.test.ts` seeds the demo, runs the clean-up and checks what goes, what stays, the
backup copy, that it never runs twice, and that a failure inside the transaction leaves everything as it was.
