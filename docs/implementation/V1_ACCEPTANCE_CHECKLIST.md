# Version 1 acceptance checklist (for the owner)

Tick each line yourself before real people's records go in. Every line has an automated test behind it (see `V1_COMPLETION_MATRIX.md`); this list is for your own eyes. Use a local copy started with `npm run db:reset:local` (demo data), sign in with the demo accounts in `README.md`, and allow about an hour.

## Before anything else
- [ ] The PR's checks are green and `TEST_RESULTS.md` shows the latest run passing.
- [ ] You have read `KNOWN_LIMITATIONS.md` and are content with what is not built yet.

## Policy & Compliance (manager@)
- [ ] Open a policy, add an assignment rule for a branch, and see the people it covers on Staff Sign-off.
- [ ] Sign in as carer@, open "My policies to read", open the policy and acknowledge it. Back as manager@, the row shows acknowledged with the wording.
- [ ] Download the Staff Sign-off CSV.

## Workforce and readiness (manager@, coordinator@)
- [ ] Staff Readiness: verify a piece of evidence someone else recorded; you cannot verify your own.
- [ ] A person with expired training shows "not ready" and cannot be allocated to a visit that needs it.

## Rostering (coordinator@)
- [ ] Create a service user, make them active, add a repeating visit, build a future week, allocate a carer and publish.
- [ ] Exceptions: give an open exception an owner and resolve it with what was done.
- [ ] Run Routes: add a route, add visits, change the order. Printable Rota: download a PDF.
- [ ] Care package tab: record a package and see planned hours against commissioned hours.

## Carer (carer@, on a phone if you can)
- [ ] See today's visits, clock in, record tasks, write a handover note, clock out.
- [ ] Ask the office to correct a time; as coordinator@, approve it on the visit page.
- [ ] Claim mileage.

## Medication (manager@)
- [ ] Rota Settings shows medication records off. Switch them on only after writing who did the clinical review.
- [ ] Add a medicine to a person; it waits for a second person. As another manager-level account, approve it.
- [ ] Switch medication records off again if you are not going live with them.

## Finance (finance@)
- [ ] Timesheets: lines with problems must be checked before submitting; someone else approves.
- [ ] Prepare a pay run; whoever prepared it cannot approve it. Approve as a second person and download the CSV.
- [ ] Mileage: approve a carer's claim.

## Reporting and administration (manager@)
- [ ] Analytics: switch between the organisation and one branch; each figure says how it is worked out.
- [ ] Users: invite someone with a one-time link, open the link in a private window, set a password and sign in.
- [ ] Audit Log: find the changes you just made; download the CSV.

## Going live with real data
- [ ] Start from an empty database: `npm run db:reset:local -- --clean`, then `npm run org:create` with your organisation, branches and your own email.
- [ ] Set your business details in Settings, the rota settings, rates and funders, before inviting staff.
- [ ] Back up the database (see `docs/LOCAL_SETUP.md`, section 9) before the first real record and every day after.
- [ ] Merging to `main` changes the live demo site. Say "merge" only when you want that.
