# Version 1 synthetic test data: validation

Full-scale operational test data for user-acceptance testing (V1 brief, phase 7). It lives only in a **disposable local database** and never touches the live demo, a hosted database, or any local database holding records anyone wants to keep.

## How to load, restore and check it

```bash
npm run uat:data -- load       # empties csb_uat, applies migrations, loads the data, saves csb_uat_baseline (about 2m20s)
npm run uat:data -- restore    # puts csb_uat back exactly as the baseline (seconds)
npm run uat:data -- snapshot   # makes the current csb_uat the new baseline
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csb_uat npx tsx scripts/uat-validate.ts   # read-only report
```

`scripts/uat-data.mjs` refuses to run unless the database host is this computer and the database name contains `uat` (default `postgresql://postgres:postgres@localhost:5432/csb_uat`, override with `UAT_DATABASE_URL`). To use the app on it: `DATABASE_URL=<that address> npm run dev`. Every demo password is `DemoPassword!2026`.

## What it contains (measured with `scripts/uat-validate.ts` on the baseline, 30 Oct 2026)

| Branch | Areas | Service users | Carers (HR, active, in an area) | Visits a day (min / average / max over 42 days) | Target in the brief |
|---|---|---|---|---|---|
| Tower Hamlets | Bow and Poplar; Stepney and Whitechapel; Isle of Dogs | 30 | 40 | 90 / 93.6 / 96 | 30, 40, about 95 |
| Liverpool | Liverpool North; Liverpool South | 16 | 10 | 44 / 44.7 / 45 | 16, 10, about 45 |
| Portsmouth | Portsmouth Central; Portsmouth North | 12 | 8 | 33 / 33.7 / 34 | 12, 8, about 34 |

Seven care areas in total. 7,227 visits across six weeks (3,933 + 1,878 + 1,416).

**Built the way an office builds a rota.** 349 visit templates (weekday and weekend teams, double-ups for hoist users, afternoon sittings that alternate between weeks 1 and 3 and weeks 2 and 4, and one overnight sitting on Fridays in weeks 2 and 4). The four-week cycle is anchored so that six weeks were built and published through the real build engine: two past weeks (weeks 1 and 2), this week (week 3) and three ahead (week 4, then weeks 1 and 2 again).

**Staff come from HR.** The extra carers were added in the HR Hub's own transaction, which projects them into Rostering. Their HR checks have synthetic evidence and are verified, and the readiness matrix and training records were entered through the real readiness services (a second person verifies each). Every carer has a sign-in linked through the audited link workflow. The safeguarding policy is assigned to care roles and acknowledged by all but two carers per branch.

**History.** 5,972 clock records for the two past weeks and earlier today (most on time, some late, some short, a few missed), 52 approved timesheets for last week with draft pay and invoice runs, care plans (eight approved, one awaiting approval), risk assessments, three incidents, rate cards and fictional funders.

## Scenarios the data sets up on purpose

| Scenario | Where it shows | Count in the baseline |
|---|---|---|
| Expiring compliance | One carer per branch has a DBS review due in 10 days; their visits after that date are left unassigned by the build | 3 carers |
| Missing evidence | One Tower Hamlets carer has no right-to-work evidence | 1 |
| Readiness short | One carer awaiting training verification, one with expired safeguarding training, one awaiting a practical sign-off (with a time-limited exception) | 3 |
| Medication competency | About a third of carers are not competent for medication prompts and are not planned on those calls; some are competent with restrictions (flagged for review) | 191 flagged bookings |
| Overdue policy acknowledgement | Two carers per branch have not read the safeguarding policy (flagged "Requires review") | 6 carers |
| Unassigned visits | Empty slots from the cases above and three deliberately empty template slots | 218 visits over six weeks, incl. past missed ones |
| Partial double-ups | A double-up with only one carer | 55 |
| Approved leave | One Liverpool carer on holiday next week (visits flagged, not reassigned) | 1 |
| Sickness | One Tower Hamlets carer off sick today and tomorrow (visits flagged, not reassigned) | 1 |
| Missing check-out | Two calls from earlier today checked in, never checked out | 2 |
| Branch-limited coordinators | `coordinator.tower-hamlets@uat.example`, `coordinator.liverpool@uat.example`, `coordinator.portsmouth@uat.example` (one branch each) | 3 |

## Labelling and privacy checks

- Every service user reference starts `UAT-` (measured: 0 that do not), with addresses on "Test Street", "ZZ" postcodes and "SYNTHETIC TEST RECORD" in the access notes.
- New carers have staff numbers starting `UAT-` and e-mail addresses ending `@uat.example`; templates are noted "Synthetic UAT template".
- All names are invented. No OnePlan, CSB or other real employee or service-user information was used.
- The organisation is the demo organisation, flagged as demo data.

## Limits of the data

- The base demo seed (policies, HR fixtures, the CSB demo people) is loaded first, so the original 45 HR fixture employees are present; office staff among them are not carers.
- Absences are only the two above; the scenario tests create their own.
- Dates are relative to the day the data is loaded. Load it again (or restore and accept the dates of the baseline day) before a test session.
