# 03 · HR & Workforce feature specification

Covers what OnePlan does for staff ("Team Members"), how that compares with the CSB HR Hub (`src/hr`, `src/app/hr`, `src/app/api/hr`), and what CSB needs so that one staff record serves HR, Rota, Finance and Reporting.

> **Coverage warning.** OnePlan's staff list and staff records were **not inspected** (⛔, personal data). Everything below about OnePlan staff records comes from the Home dashboard's Team Members widget, the Contracts page, Settings and vendor release notes. Items are marked **[O]** observed or **[I]** inferred.

## 1. OnePlan staff functions

| # | Function | Where | What is stored or shown | Evidence |
|---|---|---|---|---|
| H1 | Staff list | Users → Team Members → View All (`/members/staff`) | Not inspected. The Home widget shows: forename, surname, status icon, permission, 4-digit app login code, DOB, ethnicity, role, date started, manager, address line 1, postcode, telephone, reference number, email | ⛔ page; [O] widget |
| H2 | Permission level | Staff record | "Field User" (carer, mobile app) or "System Admin" (office). **[I]** Further levels in Settings → Permissions | [O] values |
| H3 | Mobile app login code | Staff record | A 4-digit code used to log into the carer app | [O] column |
| H4 | Unverified emails | Home → Unverified Emails | Staff whose email address has not been confirmed | [O] button; page ⏸ |
| H5 | Roles list | Settings → All Lists → Roles List | Job roles (e.g. carer, senior, coordinator) | [O] list name; ⏸ content |
| H6 | Contracts | Users → Team Members → Contracts | "All Contracts" (Add New) and "Team Member Not Assigned To A Contract" (name, permission, role). Help text: a contract is needed for some features | [O]; **[I]** hours, holiday entitlement and pay rules attach to the contract |
| H7 | Holidays and absences | Users → Team Members → Holidays / Absences | Not inspected. Custom holiday and absence types exist (Settings list, "Used For: Team Member"). Home shows "Holidays Due". Build Rota asks for holidays to be entered before building | ⏸; [O] types list and checklist |
| H8 | Holiday accrual | Vendor notes | Irregular-hours accrual at 12.07% | [I] |
| H9 | Holiday cover | Vendor notes | A "replace rota" option reassigns a carer's visits for the holiday period | [I] |
| H10 | Qualifications | Settings Lists: Qualification List, Qualifications Sub-Status; Reports: Qualification | Qualification types with sub-statuses | [O] names; ⏸ fields |
| H11 | DBS | Reports: Team Member DBS | DBS details per staff member | [O] report name |
| H12 | References | Settings Lists: Team Member References | Reference types for recruitment | [O] list name |
| H13 | Vaccines | Settings Lists: Vaccine List; Reports: Vaccine | Vaccination records | [O] names |
| H14 | Documents | Settings Lists: Document Category Manager; Reports: Document | Document categories and a documents report | [O] names |
| H15 | Onboarding | Vendor notes | Custom "pending" sub-statuses and actions. A pending staff member cannot be put on the rota | [I] |
| H16 | Preferences | Users → Preference Manager; Settings | Carer rated 1–5 stars per service user. Rota settings can stop allocating a carer below a minimum rating ("Lock Team Member By Pref") | [O] settings; [I] editor |
| H17 | Availability | Reports: Availability, Requested Hours vs Live Hours | Carer availability and requested hours | [O] report names; [I] data |
| H18 | Location tracking | Users → Location Tracking | **[I]** Carer locations from the app at clock-in/out | ⏸ |
| H19 | Bradford Factor | Reports | Absence scoring | [O] report name |
| H20 | Areas | Settings → Areas | Staff linked to areas (count of linked users per area) | [O] |
| H21 | Birthdays | Home | Upcoming staff birthdays | [O] |
| H22 | Reminders | Top bar, Home, Settings → Reminders List | Reminders against a staff member or client, with due date and days overdue | [O] |
| H23 | Push messages | Rota bulk action "Send Push Message"; Settings late/missed push | Messages to carers' phones | [O] options; none sent |
| H24 | Team Member Portal | Settings tile | **[I]** Settings for what carers see in the app | ⏸ |
| H25 | Reports | Reports → Team Member group | Availability, Bradford Factor, Cancelled, Deleted Calls, Handback, Key Contacts, Late / Early, Live Hours, Mileage, Missed, Note, Requested vs Live Hours, Shadow Shift, Short Visit, Task List, Team Member DBS, Team Member Report, Template Hours, Visit Location, Wage Report | [O] names |

## 2. What the CSB HR Hub already does

Source: `src/hr/lib/domain.ts`, `requirements.ts`, `reminders.ts`, `src/hr/components/*`. The HR Hub keeps each organisation's data as one JSON document (`HrWorkspace.state`), written under a row lock.

| Area | CSB HR Hub today |
|---|---|
| Employee record | staffId, name, preferred name, branch, job, department, status (Active / Onboarding / Archived), start date, leaving date, employment type, line manager, email, phone, full address, DOB, emergency contact, ID type and last four characters, employment history log |
| Privacy | Private fields (address, DOB, emergency contact, ID) are hidden from HR users without the `sensitive` flag (`permittedEmployee`) |
| Roles | Organisation Admin, Group HR, Branch HR, Branch Viewer. Each user is limited to their branches (`permits`). Branch Viewer is read-only |
| Compliance checks | DBS (with update-service and consent flags), right to work, training and other checks. Required or not, recurring, due date, evidence document, verified by, checked at. Statuses: Missing evidence, Awaiting verification, Incomplete information, Overdue, Due soon, Up to date, Not applicable |
| Requirement rules | Organisation rules by job and branch that create or retire checks automatically without losing evidence (`applyRequirements`) |
| Documents | Categories DBS, Identity, Right to work, Contracts, References, Training, Qualifications, Other. Versions, issue / review / expiry / retention dates. Uploads are quarantined |
| Reminders | Threshold reminders (30, 14, 7, 0 days and overdue) to the HR users who can see the employee (`runReminders`) |
| Tasks | HR tasks with type, assignee, due date, priority, status (Not started, Waiting on employee, Waiting on HR, Complete) |
| Import | CSV staff import staged then applied (`ImportBatch`) |
| Saved views | Per-user filters and columns |
| Notes and audit | Notes per employee and per document; an event log of every change |
| Overview link | `hrHeadline()` gives employee and overdue counts to the CSB Overview |

## 3. Comparison

| Need (from OnePlan) | CSB HR Hub | Status |
|---|---|---|
| Staff personal details, role, start date, manager, contact | Yes, richer than OnePlan (emergency contact, ID, history) | ✅ exists |
| Branch and area | Branch yes; **no areas** | ⚠ partial: areas missing |
| Permission level for app vs office | HR roles only cover HR users, not carers' app access | ❌ missing |
| Mobile app login | None | ❌ missing (planned "carer phone page") |
| Contract (hours, holiday entitlement, pay basis) | Employment type only | ❌ missing |
| Holidays and absences, custom absence types, accrual, Bradford Factor | None | ❌ missing |
| Availability and requested hours | None | ❌ missing |
| Carer preferences per service user, gender preference matching | None (no service users yet) | ❌ missing |
| Qualifications with sub-status | Checks and documents cover qualifications; no sub-status list | ⚠ partial |
| DBS | Yes, with update service and consent | ✅ exists, stronger than OnePlan |
| Right to work | Yes | ✅ exists |
| Training and certificate expiry | Yes (checks with due dates, reminders) | ✅ exists |
| References, vaccines | References as a document category; vaccines not modelled | ⚠ partial |
| Documents with categories | Yes, with versions and quarantine | ✅ exists |
| Onboarding stages blocking rota use | Status "Onboarding" exists; nothing blocks rota use because there is no rota | ⚠ partial |
| Reminders | Yes for checks; no general reminders | ⚠ partial |
| Push messages to carers | None | ❌ missing |
| Location tracking | None | ❌ missing (demo uses simulated location) |
| Pay rates per carer | None | ❌ missing (Finance, see 06) |
| Staff reports | HR Hub has its own lists and CSV exports; no hours, lateness or absence reports | ⚠ partial |

**CSB is ahead of OnePlan on** compliance evidence, verification, document control, privacy of sensitive fields, branch-scoped HR permissions and audit history. **OnePlan is ahead on** everything that connects a staff member to the rota: contracts, availability, absences, preferences, app access and pay.

## 4. Required CSB design: one shared staff record

The brief says: *"Do not build separate staff databases for HR and Rota."* Today the HR Hub's staff live inside a JSON document, which Rota, Finance and Reporting cannot reference with foreign keys or query efficiently. README.md already says the HR Hub records should move into relational tables so the rota can share staff records.

### 4.1 Recommended approach (decision needed from the owner before build)

| Option | Description | Verdict |
|---|---|---|
| A. Migrate HR employees to relational tables | New `StaffMember` table becomes the single source of truth. The HR Hub reads and writes it through `src/server/workforce`, and its checks, documents and tasks move to tables in later steps | **Recommended.** It is the only option that satisfies "one staff record" with integrity. Larger change to an out-of-scope module, so needs explicit approval |
| B. Relational `StaffMember` synced from the JSON | HR Hub stays as is; a sync copies employees into `StaffMember` on every HR write | Faster, but it is two copies of staff data, which the brief forbids. Only acceptable as a short transition step |
| C. Rota reads the JSON directly | No new table | Rejected: no foreign keys, no indexes, whole-document reads for every rota query |

### 4.2 Proposed relational model (Option A, first step)

All tables carry `organisationId` and every query is scoped by `ctx.organisationId` (CLAUDE.md security rules).

```
StaffMember
  id, organisationId, branchId?, userId? (links to User when the person logs in)
  staffNumber (unique per org), firstName, lastName, preferredName
  jobRoleId → JobRole, status: ONBOARDING | ACTIVE | SUSPENDED | LEFT
  startDate, leavingDate?, lineManagerId? → StaffMember
  email, phone, gender? (for client preference matching), drives: boolean, transport mode
  appAccess: NONE | CARER_APP, appPinHash? (never store the PIN in clear)
  hrLegacyId (the HR Hub employee id, for migration)
StaffArea            staffId, areaId                       (many-to-many)
JobRole              id, organisationId, name, isCareRole
StaffContract        id, staffId, type (HOURLY | SALARIED | ZERO_HOURS), contractedHoursPerWeek?,
                     holidayEntitlement (days or hours), accrualMethod (FIXED | IRREGULAR_12_07),
                     payBasis, startDate, endDate?
StaffAvailability    id, staffId, weekday, startTime, endTime, effectiveFrom, effectiveTo?, kind (AVAILABLE | UNAVAILABLE)
AbsenceType          id, organisationId, name, paid: boolean, countsForBradford: boolean, colour
Absence              id, staffId, absenceTypeId, startsAt, endsAt, status (REQUESTED | APPROVED | DECLINED | CANCELLED),
                     requestedById, decidedById?, decidedAt?, note
CarerPreference      id, serviceUserId, staffId, rating 1–5, blocked: boolean, reason?
```

The HR Hub's sensitive fields (address, DOB, emergency contact, ID) stay behind the existing `sensitive` rule wherever they are stored.

### 4.3 Rules

- **Rota eligibility:** a staff member can be allocated to a visit only if status is ACTIVE, they have a care role, they are linked to the visit's area (or area rules are off), they are not on approved absence at that time, and (setting) their mandatory checks are not Overdue or Missing evidence. The HR compliance status comes from the existing `checkStatus` logic. Breaches are blocked or warned according to an organisation setting, never silently allowed.
- **Onboarding:** ONBOARDING staff can be added to visits only as shadow carers (OnePlan blocks them entirely; CSB allows supervised shadowing, which matches real induction).
- **Absence approval:** separation of duties, so a manager cannot approve their own absence. Approving an absence lists the affected visits and offers to unassign them or reassign them (see 04 "holiday cover").
- **Bradford Factor:** S² × D over a rolling 52 weeks, from absences whose type counts for Bradford.
- **Holiday accrual:** for irregular-hours and part-year workers, 12.07% of hours worked (from clocked visits), as UK law allows for leave years from 1 April 2024. Show the calculation; never hide the formula.
- **Audit:** every create, update, status change, absence decision and preference change writes `AuditLog`.

### 4.4 HR screens to add (inside the HR Hub's own look, once in scope)

| Screen | Purpose |
|---|---|
| Staff record → Work tab | Contract, availability pattern, areas, app access, preferences |
| Absence calendar | Month grid by staff member, request, approve, decline, with conflicts against booked visits |
| Absence request (carer phone page) | Carer asks for leave; manager decides |
| Staff reports | Absence and Bradford Factor, availability vs booked hours, lateness (from Rota) |

## 5. Open questions for the owner

1. Approve Option A (move HR staff into relational tables) when Rota is built? It touches the HR Hub, which CLAUDE.md marks as out of scope.
2. Should an expired DBS or right-to-work check **block** allocation or only **warn**? (Recommended: block for DBS and right to work, warn for training.)
3. Should carers log in with their own email and password (CSB `User`), or with a short PIN on a shared device as in OnePlan? (Recommended: their own login, with a PIN only as a second factor on the phone page.)
