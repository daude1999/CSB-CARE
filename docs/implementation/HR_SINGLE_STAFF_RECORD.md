# HR & Workforce as the single staff record

Owner's brief of 1 November 2026: make HR & Workforce the single source of truth for employees, and remove duplicate staff administration from Rostering & Care Management, while keeping operational scheduling.

This is a staff-data integration and navigation clean-up. It adds no module, submodule or sidebar destination, and it does not redesign any page.

## Architecture as found (inspected before any change)

| Question | Finding |
|---|---|
| Where HR employees live | `HrWorkspace.state`: one JSON document per organisation (`employees`, `checks`, `documents`, `notes`, …), written under a row lock by `src/hr/lib/workspace-tx.ts`. The README's description is still accurate. |
| Where Rostering workers live | `StaffMember` is a projection of HR. `projectWorkforce()` (`src/server/workforce/projection.ts`) runs inside every HR transaction, so an HR save and its projection commit or roll back together. |
| Identifiers | `StaffMember.hrEmployeeId` is the HR employee id, with `@@unique([organisationId, hrEmployeeId])`. `StaffMember.id` is the rota-side key that every operational record points at. `staffNumber` is HR's staff id. Sign-ins are linked by hand only (`linkLogin`). |
| Who owns what | HR fields (name, job, status, branch, dates, work contact, check summaries) are copied by the projection and never edited in Rostering. Rostering's own data is in `RotaStaffProfile` (rota on/off, matching gender, drives, weekly limit, notes), `StaffArea`, `CarerPreference`, `StaffPayRate`, `VisitAssignment`, … |
| Leave and sickness | `StaffAbsence` is written only by HR accounts (`src/server/workforce/absences.ts`, `/workforce/absences`), with second-person approval. Approved absences block allocation and requested ones warn. |
| Availability | `StaffAvailability` (weekly pattern). Before this change it was editable only by HR accounts on `/workforce/availability`, so coordinators without an HR login could not see or change it. |
| Training and competency | HR checks (category Training, DBS and Right to work) are projected into `StaffCompliance`. Separately, Staff Readiness (`src/server/readiness`) records verified training and observed competency in `StaffTrainingRecord` and `CompetencyAssessment` from the rota side. See the open decision below. |
| Eligibility | One service, `src/server/workforce/eligibility.ts`. It is used by assignment, the planner, bulk actions, Build Rota, Optimise, Unassigned cover, Missed-call cover and swaps, and it is re-run inside every write transaction. It judges dates and expiry against the visit's date. |
| HR change → visits | `reviewStaffImpact()` re-checks future scheduled bookings. It flags them (`reviewReason`, `ALLOCATION_FLAGGED` event, `ALLOCATION_REVIEW` alert) and never removes, reassigns or touches started or completed visits. |

So most of the intended architecture was already in place. The gaps this change closes are:

1. **The Rota menu still had a "Staff & Workforce" destination.** It held HR's Holidays & Sickness and Availability pages beside the rota's staff pages.
2. **HR had no "Suspended" status**, so a suspension could not stop bookings.
3. **Non-care employees appeared in carer pickers.** Office staff, payroll and similar were listed (as "not eligible") in pickers, bulk bars, run-route forms and planner rows.
4. **Coordinators could not see or keep working patterns** unless they had an HR login.
5. **There was no link from the rota to the HR record**, and no identity health report.

## Ownership after this change

| HR & Workforce owns | Rostering & Care Management owns |
|---|---|
| Employee creation and identity (HR employee id, staff number) | Rota participation, matching gender, drives, weekly hour limit, coordinator notes (`RotaStaffProfile`) |
| Personal and contact details | Areas worked (`StaffArea`) |
| Contract, job, branch, start and leaving dates, **employment status (Active, New starter, Suspended, Archived)** | **Working pattern / operational availability** (`StaffAvailability`, editable by `rota.edit` on the staff page, and still by HR on `/workforce/availability`: one shared table, not a copy) |
| DBS, right to work, training checks (projected as summaries to `StaffCompliance`) | Visit assignments, unassigned visits, replacement cover, missed-call recovery |
| Employment documents | Scheduled hours (bookings) and actual hours (clock records, timesheets) |
| Holidays and sickness and their approval | Travel gaps, run routes |
| Staff compliance | Attendance and ECM |

Contractual hours are HR's. HR's employee record has no contracted-hours field today, so nothing is copied. The rota's **weekly hour limit** is a scheduling cap, not a contract. **Scheduled hours** come from bookings and **actual hours** from clock records and timesheets, and Rostering calculates both.

## One employee identity

- The canonical identity is the HR employee: `(organisationId, hrEmployeeId)`.
- `StaffMember` is its one projection, with a stable `id` that rota, attendance, ECM, payroll, mileage, readiness and audit records reference. It is upserted on the unique key, so it can never be duplicated.
- No second employee master was created. No schema change was needed for the identity link, because `hrEmployeeId` already is the explicit mapping. The only migration adds the `SUSPENDED` enum value (`prisma/migrations/20261102000000_employment_suspended`, additive).
- `StaffMember` is never edited directly. Rota pages change only `RotaStaffProfile`, `StaffArea` and `StaffAvailability`.
- An HR employee who disappears from the HR document keeps their `StaffMember` row with `hrMissing = true`. Their history is kept, their future bookings are flagged ("The HR record for this person no longer exists"), and they are listed in the identity report.

## Identity report and backfill

`src/server/workforce/identity.ts` and `npm run workforce:identity [-- --org <slug>] [-- --reconcile]`.

- **Read-only by default.** For each organisation it reports:
  - `linked`: HR employees with exactly one StaffMember.
  - `notProjected`: HR employees with no StaffMember yet.
  - `stale`: StaffMember rows whose copy differs from HR now.
  - `unmatched`: StaffMember rows with no HR employee, with how many records still refer to them and how many future bookings they have.
  - `duplicateStaffNumbers`: a staff number used on more than one HR employee.
  - `sameName`: different HR employees with the same name. This is **never** treated as a match.
  - `references`: counts of assignments, clocks, timesheets, pay lines, mileage, absences, availability, pay rates, notes, task outcomes, MAR, alerts and missed-call cases.
- **`--reconcile`** runs the existing `reconcileWorkforce()`, which only adds or updates projections from HR (HR's values win, by the ownership rule) and sets `hrMissing`. It prints the report before and after, and checks that the reference counts are identical.
- **Safe to re-run.** A second run changes nothing (tested). Each run that changes something is audited as `workforce.projected`.
- **Recovery.** Nothing is deleted or merged. A wrong HR value is undone by correcting it in HR, which projects again. An `hrMissing` person comes back when the HR employee is restored.
- **Conflicts are reported, never resolved silently.** Duplicate staff numbers and same-name pairs need an HR decision.

## Carer lists (populating Rostering from HR)

`inRotaPool()` (eligibility.ts) is the one rule for who is listed. It includes:
- HR employees in a care role (Rota Settings → care role titles), unless rota participation is switched off.
- Anyone whose participation was switched on by hand.

Archived and HR-missing people are excluded. The pool says nothing about eligibility for a particular visit: `evaluate()` still judges employment status, dates, checks, absences, availability, overlaps, travel, double-up, preferences and readiness for that visit's date and time.

The pool is used by:
- `rankCarers` and `rankCarersMany`, behind the assign picker, Unassigned Visits, Find Cover and Missed-call recovery.
- `rotaLookups().carers`, behind the Daily Rota and Templates bulk bars, the Unassigned carer filter, the template form, run-route forms, the service-user preference picker, and Weekly Planner, Advanced Rota and Advanced Templates rows.

`rotaLookups().staff` still names everyone, so history shows the right names. A non-care employee asked about directly is still refused on the server, with the reason "… is not a care role".

## Eligibility changes from HR

| HR change | Effect on new allocations | Effect on existing future bookings |
|---|---|---|
| Suspended (new) | Blocked: "Suspended in HR & Workforce". A suspended carer's own sign-in cannot act on visits. | Flagged for review, kept |
| Archived / HR record removed | Blocked | Flagged, kept |
| Start date after the visit date | Blocked: "Starts on …" | Flagged, kept |
| Leaving date before the visit date | Blocked: "Left on …" (judged on the visit's date) | Flagged, kept |
| Approved holiday or sickness | Blocked | Flagged, kept |
| Requested leave | Needs confirmation | Not flagged |
| Mandatory training, DBS or right-to-work expiry | Per Rota Settings rule (block or review), judged on the visit's date | Flagged if blocking |
| Readiness (competency, restrictions) | As before | As before |
| Role or branch change | Re-checked; readiness review raised | Flagged if blocking |

Every save re-runs eligibility inside its transaction, so a stale screen cannot book an invalid carer. Overlap, travel, double-up and replacement-cover checks are unchanged.

## Navigation: before and after

| Before (Rota menu) | Route | After |
|---|---|---|
| Staff & Workforce → Team Members | `/rota/staff` | **Daily Rota → "Staff & Eligibility" tab**. Same page, same address. |
| Staff & Workforce → Staff Readiness | `/rota/readiness` | **Daily Rota → "Staff Readiness" tab**. Same address. |
| Staff & Workforce → Holidays & Sickness | `/workforce/absences` | HR & Workforce menu → Workforce → Holidays & Sickness (unchanged there). Rota pages show HR time off read-only. |
| Staff & Workforce → Availability | `/workforce/availability` | HR menu (unchanged), **and** the new Availability card on each rota staff page, editable with `rota.edit` |
| Staff & Workforce (menu entry) | none | **Removed.** The Rota menu has eight destinations and Settings. |

- All old addresses still work. `/rota/staff` and `/rota/staff/<id>` now light **Daily Rota**.
- Nothing redirects into HR, so nobody is sent to an HR page they cannot open.
- A finance officer's only Rota destination is now Finance. The staff list is still reachable by address, but staff tabs alone do not make a "Daily Rota" entry for someone with no rota page.

### Staff & Eligibility page (`/rota/staff/<id>`)

- **Open HR record** appears only for people HR itself lets in: an active HR account whose branches cover the employee (`hrRecordHref`). It is a full page load into the HR Hub with `returnTo` set to the rota page. The HR record's own Back and the shell's Back return the user. The HR Hub checks access again.
- **Availability** card: the working pattern (add or end lines, with `rota.edit`, audited as `rota.availability.*`, re-checking and flagging affected visits), plus HR's holidays and sickness for the next four weeks. Only the kind, dates and status are shown, never the reason or HR's notes.
- A line under "From HR & Workforce" says that personal details, employment, documents, checks, training records and leave are changed in HR.

## Permissions and confidentiality

- Scheduling grants no HR access. The HR Hub's API (`/api/hr/hub`) refuses anyone without an HR account (tested with a coordinator). `hrRecordHref` mirrors HR's own `permits()` rule.
- `StaffMember` and `StaffCompliance` carry no date of birth, address, ID, emergency contact, salary, document, certificate number or reviewer (tested on the schema).
- Rota-side availability reads and writes are scoped by organisation and by the coordinator's branches and areas (`staffDirectoryWhere`). Another organisation's staff id returns 404, and roles without `rota.edit` are refused.

## Training and competency evidence (owner's decision, 2 Nov 2026: "HR accounts only")

Staff Readiness keeps its records (`StaffTrainingRecord`, `CompetencyAssessment`) and its rules, but **entering, verifying and assessing** training or competency now needs an HR & Workforce account that may edit that employee: an active HR account whose branches cover them, and not a Branch Viewer. This is on top of the existing readiness permission (`requireHrEvidenceEditor` in `src/server/workforce/hr-record.ts`, called by `recordTraining`, `verifyTraining` and `recordAssessment`).

- Coordinators without HR access see readiness read-only, with a note that the evidence is recorded in HR & Workforce.
- Second-person verification is unchanged.
- Restrictions, exceptions and review flags are operational decisions and stay with their existing readiness permissions.
- The demo seed enters its synthetic evidence as the Group HR account.

## Limitations

- HR has no contracted-hours field. Contractual hours cannot be shown or compared yet.
- `/workforce/availability` (HR) and the rota staff page both edit the same working-pattern table. This is intentional, because it is one record, but HR's page was not redesigned to say that Rostering now owns it.
- The HR Hub's "All people" back link does not read a rota `returnTo` (unchanged HR code). Browser Back and the shell's Back return to the rota page.
- Suspension is recorded in HR as an employment status. There is no suspension reason or period in Rostering, by design.
