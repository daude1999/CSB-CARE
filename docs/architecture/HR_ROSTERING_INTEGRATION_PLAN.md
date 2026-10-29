# HR – Rostering integration plan

**Status:** agreed technical direction for the five-module build (29 October 2026).

> This file was referenced by the master build brief but did not exist in the repository or in the project files when the build started. It has been written from the brief's Part 4 ("Critical architecture: HR and Rostering"), `docs/oneplan-research/03_HR_FEATURE_SPECIFICATION.md` §4 and an inspection of the current code. Where this plan makes a decision the brief did not, the decision is recorded in `docs/implementation/ARCHITECTURE_DECISIONS.md`.

## 1. The problem

The HR Hub (`src/hr`) keeps every employee of an organisation inside one JSON document, `HrWorkspace.state`, written under a row lock by `transaction()` in `src/hr/lib/store.ts`. Rostering, finance and reporting need to point at a staff member with a foreign key, index visits by carer and check eligibility quickly. A JSON document cannot do that.

## 2. The rule

One employee has **one** workforce identity across the platform.

- HR & Workforce stays the **authoritative source** of employee identity, employment status, job role, branch, DBS, right to work, training, qualifications and documents. Its existing screens, rules and JSON storage are preserved.
- A relational `StaffMember` row is the **stable identity** every other module references. It is a *projection* of the HR employee, keyed one-to-one by `(organisationId, hrEmployeeId)`. It is never edited directly by Rostering.
- Names, e-mail addresses and staff numbers are **not** the relationship. The HR employee's stable id (`Employee.id`, a UUID created by the HR Hub) is.

## 3. Same-transaction projection

Every HR mutation already runs inside `store.transaction(organisationId, fn)`, which locks the `HrWorkspace` row, applies `fn` to the state and saves it. The projection is added **inside that same Prisma transaction**, after `fn` and before commit:

```
db.$transaction(async (tx) => {
  state = SELECT … FOR UPDATE           // existing
  result = fn(state)                    // existing HR rules
  save(state)                           // existing
  projectWorkforce(tx, orgId, state)    // NEW: upsert StaffMember + StaffCompliance for changed employees
  detectRotaImpact(tx, orgId, changed)  // NEW: flag future assignments that are no longer valid
})
```

Consequences:

- Create, edit, import (approve-import), archive, status change, branch transfer and job change all project automatically, because they all go through `transaction()`. No HR route needed rewriting and no scheduled sync or HTTP call is involved.
- If the projection fails, the HR change rolls back too, so HR and Rostering can never disagree.
- The HR row lock still serialises concurrent HR writes, so the projection inherits HR's concurrency protection.
- Each projected row stores `hrVersion` and a content hash (`hrHash`); only employees whose projected content changed are written, so a 45-person (or 2,000-person) workspace costs one indexed read per HR write.

## 4. What is projected

| `StaffMember` field | From the HR employee | Notes |
|---|---|---|
| `hrEmployeeId` | `id` | unique per organisation; never changes |
| `staffNumber` | `staffId` | display only, not used for linking |
| `displayName`, `preferredName` | `name`, `preferredName` | |
| `jobTitle` | `job` | `isCareRole` derived from the organisation's care-role list |
| `employmentStatus` | `status` | ACTIVE / ONBOARDING / ARCHIVED |
| `hrBranchKey`, `branchId` | `branch` | `branchId` is resolved through `Branch.hrBranchKey` (explicit mapping, never by name) |
| `startDate`, `leavingDate` | `start`, `leavingDate` | |
| `workEmail`, `workPhone` | `email`, `phone` | operational contact only |

**Not projected:** address, date of birth, emergency contact, identification, documents, notes. Rostering never needs them.

`StaffCompliance` rows (one per HR check) carry only what eligibility needs: category (DBS / Right to work / Training / other), name, required, recurring, next review date, verified, evidence present. No certificate numbers, no documents.

## 5. Rostering-owned data

Rostering owns `RotaStaffProfile` (rota participation, gender for preference matching, drives, max hours), `StaffArea`, allocations, visits, routes, attendance and acknowledgements. These hang off `StaffMember.id` and survive any number of HR edits.

Holidays, sickness and working availability are HR-controlled (brief §4.4). They are stored relationally (`StaffAbsence`, `StaffAvailability`) because Rostering must query them by date range, and they are edited only through HR & Workforce screens with HR permissions (`/workforce/*`, in the HR module colour). Rostering shows them read-only.

## 6. Eligibility

One server function, `checkStaffEligibility(ctx, input)` in `src/server/workforce/eligibility.ts`, returns `ELIGIBLE | REQUIRES_REVIEW | NOT_ELIGIBLE` with blocking reasons, warnings, a compliance summary and scheduling restrictions. Every assignment path (manual, planner drag-and-drop and keyboard move, bulk reassignment, template preferred carers, rota build, visit edit) calls the shared assignment service, which calls the eligibility service inside the write transaction. Colour on screen is never the check.

Unknown or missing mandatory evidence is never treated as valid. DBS has no statutory expiry: the check uses the organisation's own *next review date* recorded by HR, as the HR Hub already does.

## 7. Impact detection

When a projected change, an approved absence or an availability change makes a staff member unable to do future work they are allocated to, the affected future `VisitAssignment`s are flagged for review (`reviewReason`), a `RotaAlert` is raised and in-app notifications go to coordinators. Nothing is cancelled, deleted or reassigned automatically. Delivered visits are never touched.

## 8. Logins are separate

An HR employee is not a login. Creating an employee creates no `User`, no `Membership`, no permission and no invitation. A carer login is linked to a staff identity only by an organisation administrator through an explicit, audited "link login" action that selects both the membership and the staff member; matching e-mail addresses are shown as a hint, never used automatically.

## 9. Backfill and reconciliation

`reconcileWorkforce(organisationId)` projects every employee in the workspace inside one locked transaction. It is idempotent (re-running changes nothing), it never creates a duplicate (the unique key is `organisationId + hrEmployeeId`), and it marks projections whose HR employee no longer exists as `hrMissing` rather than deleting them, so historical visits keep their carer. It runs from the seed, from Administration → Workforce sync, and from a maintenance job.
