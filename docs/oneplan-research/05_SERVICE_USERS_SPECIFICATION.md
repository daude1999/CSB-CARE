# 05 · Service Users specification

> **Coverage warning.** No service-user record, list page, care plan or form in OnePlan was opened (⏸ / ⛔, personal and medical data). What follows comes from three places: the Home dashboard's Service Users widget, the read-only profile card beside the Add Template form (values blacked out), and the Settings lists and report names. **[O]** observed, **[I]** inferred. The CSB specification in Part B is designed from care-sector practice and CQC expectations, not copied from OnePlan.

## Part A · What OnePlan shows about service users

### A1. Menu [O]
Users → Service Users → View All (`/members/client/`), Custom Forms (`/members/settings/form.php`), New On Site (`/members/client/create-careplan.php`), Holidays / Absences (`/members/holidays.php?client`). Also Users → Preference Manager and Communication Log.

### A2. Fields seen [O] (names only)

| Group | Fields |
|---|---|
| Identity | Photo, forename, surname, DOB and age, sex assigned at birth, ethnicity, tags, reference number, client number |
| Identifiers | NI number, NHS number, patient number, health care number, Community Health Index (Scotland) |
| Home and access | Address (+ map), postcode, key safe, NFC tag number (for carer clock-in) |
| Contact | Telephone, email, contact details |
| Clinical contacts | Pharmacy, doctor, doctor telephone |
| Next of kin | NOK name, NOK number |
| Care preferences | Carer gender preference ("Pref"), areas |
| Admin | Date added |

Row actions from Home: open live rota for this person, open their templates, info pop-up.

### A3. Related lists and reports [O names]

- Settings lists: Pharmacy, Doctors, Tags, Programs Of Care, Medication List (deprecated), Medication Admin Types, Medication Time Ranges, Communication Log Reasons, Document Category Manager.
- Reports (Service User group): Active Medication, Client Funder, Continuity, Controlled Medication, Invoice, Key Contacts, Legacy Medication, Live Hours, MARChart, Medication, Mileage, Notes, Programs Of Care, Service User Report, Task List, Task Outcome, Template Hours, Waterlow, Xero.
- General reports: Assessments Logs, Read Assessments, CQC Contact List, Incident List, Welfare Check, Visit Note.
- **[I]** From these: OnePlan has care plans ("New On Site" creates one), assessments that staff must read, a medication module with MAR charts and controlled drugs, Waterlow pressure-ulcer risk scoring, programmes of care, incidents, welfare checks, a family / care portal, and a communication log.

### A4. Holidays / absences [I]
Service-user absences (hospital, respite, holiday) stop visits being built for those dates (the Build Rota checklist asks for them first).

---

## Part B · CSB Service Users specification

Portal `/service-users`, module colour `#b45309` (from `src/lib/portals.ts`). One `ServiceUser` record is used by Rota (visits and templates), Finance (funding and invoices) and Reporting.

### B1. Data model (additive migration)

```
ServiceUser        id, organisationId, branchId, areaId?, reference (unique per org),
                   firstName, lastName, preferredName, dateOfBirth, sexAtBirth?, gender?, pronouns?,
                   ethnicity?, firstLanguage?, interpreterNeeded, religion?, photoFileId?,
                   status: ENQUIRY | ASSESSMENT | ACTIVE | PAUSED | ENDED, startDate?, endDate?, endReason?,
                   nhsNumber? (validated with the NHS modulus-11 check), niNumber?,
                   addressLine1, addressLine2?, town, postcode, latitude?, longitude?,
                   accessNotes?, keySafeCode? (encrypted at rest, revealed on request and audited),
                   carerGenderPreference: ANY | FEMALE | MALE, tags[]
ServiceUserContact id, serviceUserId, kind NEXT_OF_KIN | FAMILY | LPA_HEALTH | LPA_FINANCE | GP | PHARMACY | SOCIAL_WORKER | OTHER,
                   name, relationship?, phone?, email?, address?, isEmergency, canReceiveUpdates, notes
ServiceUserAbsence id, serviceUserId, reason HOSPITAL | RESPITE | HOLIDAY | OTHER, startsAt, endsAt?, cancelVisits: boolean, note
CarePackage        id, serviceUserId, funderId? (see 06), commissionedHoursPerWeek?, startDate, endDate?, reference?
CarePlan           id, serviceUserId, version, status DRAFT | IN_REVIEW | ACTIVE | SUPERSEDED,
                   reviewDue, approvedById?, approvedAt?
CarePlanSection    id, carePlanId, key (stable: about-me, communication, mobility, personal-care, nutrition,
                   continence, skin, medication-support, mental-capacity, risks …), title, body, outcomes
RiskAssessment     id, serviceUserId, type (ENVIRONMENT | MOVING_HANDLING | FALLS | PRESSURE_WATERLOW | MEDICATION | OTHER),
                   score?, level LOW | MEDIUM | HIGH, controls, reviewDue, assessedById, assessedAt
ServiceUserNote    id, serviceUserId, visitId?, authorId, category, text, at
Incident           id, organisationId, serviceUserId?, staffId?, visitId?, occurredAt, type, severity,
                   description, immediateAction, status OPEN | INVESTIGATING | CLOSED, notifiable (CQC / safeguarding)
```

Care plans follow the same pattern as policies: immutable versions once out of draft, reviewers and approver, audit log, and staff acknowledgements ("read assessments") reuse `Acknowledgement`-style records.

**Medication (eMAR) is a separate later stage**, because it is safety-critical and needs its own design and testing: medication list, administration times, MAR records per visit, missed-medication alerts (which feed OnePlan's "Calls with missed meds" tile equivalent), controlled drugs.

### B2. Screens

| Route | Screen | Built around |
|---|---|---|
| `/service-users` | Register | Find a person: search, filters (status, area, branch, funder, tags), columns kept to name, reference, area, status, package hours, next visit, care plan review due. No DOB or address in the list |
| `/service-users/new` | Referral / new person | Enquiry → assessment → active, with required fields at each stage |
| `/service-users/[id]` | Profile, tabbed | Summary (who they are, how to get in, key risks, preferences), Contacts, Care plan, Risk assessments, Visits (their live rota and templates, links into Rota), Notes, Absences, Funding, Documents, History |
| `/service-users/[id]/care-plan` | Care plan document | Sections with stable keys, version history, review, approve, publish, staff read-and-sign |

### B3. Rules
- Only users with `serviceUser.view` see the register; sensitive fields (DOB, NHS number, key safe, health details) need `serviceUser.sensitive`. Carers see only the people on their own visits, and only while the visit window is open (± carerDaysForward/Back).
- Ending a service user (status ENDED) cancels future visits after a preview, with a reason, and keeps history.
- A service-user absence with `cancelVisits` cancels overlapping unstarted visits (reason "Service user absent") and stops builds for those dates.
- Every view of the key safe code and every export is audited.
- Data protection: special category data (health). Retention, subject access and erasure rules follow `docs/SECURITY.md`; real data never in seed or tests.

### B4. Links
- Rota: `VisitTemplate.serviceUserId`, `Visit.serviceUserId`, carer preferences (`CarerPreference`), gender preference used in allocation checks.
- Finance: `CarePackage.funderId`, commissioned hours vs delivered hours.
- Policy & Compliance: incidents can raise compliance actions; care plan review overdue appears in compliance reporting.
- HR: incidents linked to a staff member are visible to HR with permission.
