# Retention schedule (proposed)

> **DRAFT FOR HUMAN REVIEW.** These are **proposed** periods. Each cites the guidance or law it is taken from, but
> the citations were written from general knowledge on 10 November 2026 and **every one must be checked against the
> current edition of its source** before the schedule is adopted. Where a contract with a council or the NHS sets a
> longer period, the contract wins.
>
> **Nothing is deleted by the software.** No deletion or anonymisation job exists and none will be built until the
> owner signs this schedule off in writing.

## Principles

1. Keep a record for as long as the longest rule that applies to it, then review it. UK GDPR Article 5(1)(e)
   (storage limitation) requires a justified period; it does not set the periods.
2. The period starts at the **trigger** shown (for example the end of care), not when the record was created.
3. "Review, then delete or anonymise" means a named person confirms nothing is holding the record (a complaint,
   a safeguarding enquiry, a legal claim, an inquest, a subject access request, a public inquiry) before it goes.
4. A legal hold stops the clock. The platform has no legal-hold flag yet; that is listed under "What the software
   would need".
5. Backups follow their own short cycle (35 days in `docs/BACKUPS.md`); a record deleted from the live database
   disappears from backups as they age out.

## Sources used

| Short name | Full source |
| --- | --- |
| NHS RM Code | NHS England, *Records Management Code of Practice* (2021, as updated), Appendix II retention schedule. It covers adult social care records that are jointly held or NHS-funded and is the usual benchmark for care providers. |
| CQC Reg 17 | Health and Social Care Act 2008 (Regulated Activities) Regulations 2014, regulation 17 (good governance), and CQC's guidance on it: records must be kept securely and for an appropriate period. |
| NICE NG67 / SC1 | NICE guideline NG67, *Managing medicines for adults receiving social care in the community*, and SC1, *Managing medicines in care homes*: providers must have a process for keeping medicines records. |
| Limitation Act | Limitation Act 1980: 6 years for contract claims, 3 years for personal injury (from the date of knowledge; no limit runs while a person lacks capacity). |
| RIDDOR | Reporting of Injuries, Diseases and Dangerous Occurrences Regulations 2013, regulation 12: records kept for at least 3 years. |
| HMRC PAYE | Income Tax (Pay As You Earn) Regulations 2003, regulation 97, and HMRC guidance "PAYE and payroll for employers: keeping records": 3 years from the end of the tax year. |
| HMRC CT / VAT | Finance Act 1998 Schedule 18 paragraph 21 (company tax records, 6 years from the end of the accounting period); VAT Act 1994 Schedule 11 paragraph 6 (6 years). |
| Companies Act | Companies Act 2006 section 388: accounting records, 3 years for a private company (HMRC's 6 years is longer and governs). |
| NMW | National Minimum Wage Regulations 2015, regulation 59 as amended in 2021: pay records kept for 6 years. |
| WTR | Working Time Regulations 1998, regulation 9: records kept for 2 years. |
| Right to work | Home Office, *Employer's guide to right to work checks*: copies kept for the length of employment and 2 years after. |
| DBS | DBS code of practice and "Handling of DBS certificate information": certificate information kept no longer than necessary, generally up to 6 months; CQC accepts keeping it until the next inspection. Only the certificate number, date and outcome are kept long term. |
| ICO employment | ICO guidance on employment practices and data protection (recruitment and selection; keeping employment records). |
| Equality Act | Equality Act 2010 section 123: 3 months to bring a tribunal claim (extendable), the basis for keeping unsuccessful applications about 6 months. |
| SMP | Statutory Maternity Pay (General) Regulations 1986, regulation 26: 3 years after the end of the tax year. |

## Care records

| Record type (tables) | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Service user record: personal details, contacts, care package (`ServiceUser`, `ServiceUserContact`, `CarePackage`, `CarerPreference`) | 8 years | End of care or death | NHS RM Code (adult social care records, 8 years); CQC Reg 17 | Confirm whether any council contract asks for longer |
| Care plans and their versions, care instructions and carer acknowledgements (`CarePlan`, `CarePlanSection`, `CarePlanAcknowledgement`, `CareInstructionVersion`, `CareInstructionAck`, `CareSummary`) | 8 years | End of care or death | NHS RM Code; CQC Reg 17 | Kept as a whole with the service user record |
| Risk assessments and versions (`RiskAssessment`, `RiskAssessmentVersion`) | 8 years | End of care or death | NHS RM Code | |
| Visit records: visits, assignments, tasks and outcomes, clock times, notes, events (`Visit`, `VisitAssignment`, `VisitTask`, `VisitTaskOutcome`, `VisitClock`, `VisitNote`, `VisitEvent`) | 8 years | End of care or death | NHS RM Code (part of the care record); NMW for the pay evidence in clock times (6 years) | The longer period governs |
| Medication records: medicines, MAR entries, application sites (`Medication`, `MarRecord`, `MedicationApplicationSite`, `VisitMedicationLead`) | 8 years | End of care or death | NICE NG67 and SC1 (process required); NHS RM Code (8 years for adult records) | Medication is switched off until a clinical review is recorded |
| Incidents (`Incident`) | 8 years; 3 years minimum where RIDDOR-reportable | End of care or death, or date of the incident for staff-only incidents | NHS RM Code; RIDDOR reg 12; Limitation Act | A serious incident may need 20 years under the NHS RM Code; decide case by case |
| Safeguarding records (restricted RCAs, safeguarding authority decisions, incident safeguarding flags) | 8 years, reviewed before disposal | Closure of the concern or end of care, whichever is later | NHS RM Code; local safeguarding adults board policy | **[OWNER]** check each branch's local authority policy; some ask for longer |
| Body-map observations, photos, reviews and notes (`BodyMap*`) | 8 years | End of care or death | NHS RM Code | Photos are special-category data; restrict export |
| Council and other documents uploaded for a person (`ServiceUserDocument`, versions, `StoredObject` files) | 8 years | End of care or death | NHS RM Code | The council remains the owner of its own originals |
| Encrypted reference numbers: council, Frameworki, NHS (`ServiceUserExternalReference`) | Same as the service user record | End of care or death | NHS RM Code | |
| Call notes, items, revisions and tasks (`CallNote*`) | 8 years | End of care or death | NHS RM Code (communications that form part of the care record) | |
| Care intake working files: uploaded referral documents, extracted facts, review items (`CareIntake*`, `DischargeReview`) | Accepted intakes: 8 years with the record. Intakes that never became a service user: 1 year | Decision not to proceed | UK GDPR Art 5(1)(e); NHS RM Code has no specific entry | **Proposal without a direct source**; a declined referral may still be needed for a complaint |
| Missed-call cases, actions, cover and communication attempts (`MissedCall*`, `CoverContactAttempt`) | 8 years | End of care or death | NHS RM Code; CQC Reg 17 | Evidence of how a missed visit was handled |
| Service user absences (`ServiceUserAbsence`) | 8 years | End of care or death | NHS RM Code | |
| Completed form records (`FormRecord`, events, links) | Follows the subject of the form: 8 years for care forms, HR period for staff forms | As the parent record | As the parent record | |

## Rota and operations

| Record type | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Rota builds, plans and plan changes, run routes, templates (`RotaBuild`, `RotaPlan*`, `RunRoute*`, `VisitTemplate`, `TemplateTask`) | 6 years | End of the year they relate to | NHS RM Code (duty rosters, 6 years) | Individual visits are kept longer as care records (above) |
| Rota alerts and processing runs (`RotaAlert`, `RotaProcessingRun`, `MissedCallInvestigationRun`) | 2 years | Date created | No direct source; operational data | **Proposal** |
| Staff availability and absences in the rota (`StaffAvailability`, `StaffAbsence`) | 6 years after employment ends | End of employment | Limitation Act; WTR (2 years minimum) | Sickness absence is health data |

## HR and workforce

| Record type | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Personnel record (HR workspace person record, `StaffMember`, `RotaStaffProfile`) | 6 years | End of employment | Limitation Act; ICO employment guidance | NHS RM Code suggests keeping a summary until age 75 for NHS staff; not proposed here |
| Right-to-work check evidence | 2 years | End of employment | Right to work (Home Office guide) | Do not keep longer |
| DBS certificate information | Certificate number, date and outcome: with the personnel record. Any copy of the certificate itself: no more than 6 months | Recruitment decision | DBS code of practice | The platform should store the outcome, not the certificate |
| Training records, competency assessments, restrictions, readiness snapshots (`StaffTrainingRecord`, `TrainingRecord`, `CompetencyAssessment`, `StaffRestriction`, `StaffReadiness*`) | 6 years | End of employment | Limitation Act; CQC Reg 18 and 19 evidence | |
| Unsuccessful job candidates (`Candidate*`) | 6 months | Recruitment decision | Equality Act s123; ICO employment guidance | Longer only with the candidate's agreement to stay on file |
| Successful candidates' recruitment file | Moves into the personnel record | Start of employment | ICO employment guidance | Keep only what is relevant to employment |
| Policy acknowledgements and reading assignments (`Acknowledgement`, `AcknowledgementEvent`) | 6 years | End of employment | Limitation Act; CQC Reg 17 | Evidence that staff were told the procedure |
| HR uploaded files (`HrFile`) | As the record they evidence | As above | As above | |

## Finance and pay

| Record type | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Timesheets, lines, clock corrections (`Timesheet`, `TimesheetLine`, `ClockCorrectionRequest`) | 6 years | End of the pay reference period | NMW reg 59 (6 years); WTR reg 9 (2 years) | |
| Pay runs and lines, staff pay rates (`PayRun`, `PayLine`, `StaffPayRate`) | 6 years | End of the tax year | NMW (6 years); HMRC PAYE (3 years) | The platform prepares figures only; the payroll provider holds the statutory payroll record |
| Mileage claims (`MileageClaim`) | 6 years | End of the tax year | HMRC CT; HMRC PAYE | |
| Invoice runs, invoices and lines, rate cards, funders (`InvoiceRun`, `Invoice`, `InvoiceLine`, `RateCard`, `RateBand`, `Funder`) | 6 years | End of the financial year | HMRC CT / VAT; Companies Act s388 | |

## Policy and compliance

| Record type | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Policies, versions, revisions, approvals and publications (`Policy*`, `ApprovalDecision`) | Life of the organisation plus 6 years | Superseded or organisation closes | NHS RM Code (policies and procedures) | Published versions are immutable in the database by design |
| Regulatory source versions and change records (`SourceVersion`, `RegulatoryChange`, ...) | Kept indefinitely | n/a | No personal data; citations must stay checkable | |
| Audits, findings, actions, risks (`Audit*`, `ComplianceAction`, `ComplianceRisk`) | 6 years | Closure | NHS RM Code (audit records); CQC Reg 17 | |
| CQC readiness assessments, evidence links, root cause analyses (`Cqc*`, `Rca*`) | 6 years; 8 years where linked to a service user's incident | Closure | CQC Reg 17; NHS RM Code | |
| Evidence documents (`EvidenceDocument`) | 6 years, or the `retainUntil` date set on upload | Upload or closure of the linked record | CQC Reg 17 | The only record type with a retention field today |
| Complaints (where recorded as incidents, call notes or forms) | 10 years | Closure of the complaint | NHS RM Code (complaints, 10 years) | There is no separate complaints register yet |

## Platform and security

| Record type | Proposed period | Trigger | Source | Notes |
| --- | --- | --- | --- | --- |
| Audit log (`AuditLog`) | 8 years | Date of the entry | NHS RM Code treats audit trails as part of the record they describe | Immutable by database trigger; disposal would need a reviewed migration |
| User accounts and memberships (`User`, `Membership`) | Disabled on leaving; anonymised 6 years after | End of employment or contract | Limitation Act | The name must stay readable in the audit log for the period above |
| Sessions, sign-in attempts, rate-limit windows, account tokens (`Session`, `LoginAttempt`, `RateLimitWindow`, `AccountToken`) | 90 days | Expiry | UK GDPR Art 5(1)(e); security-monitoring need | **Proposal.** Safe to purge automatically once approved |
| Notifications and delivery records (`Notification`, `NotificationDelivery`) | 2 years | Date sent | No direct source | **Proposal** |
| Background jobs (`BackgroundJob`) | 90 days after completion | Completion | No direct source; payloads may name records | **Proposal** |
| AI usage events and assistant queries (`AiUsageEvent`, `AssistantQuery`) | 1 year | Date created | No direct source | **Proposal.** Queries may contain personal data typed by staff |
| Support access grants (`SupportAccessGrant`) | 8 years | Expiry of the grant | Evidence of who could see tenant data | |
| Application logs (hosting provider) | 30 to 90 days | Date written | Security-monitoring need | Set in the hosting account, not the code |
| Encrypted backups | 35 days | Date taken | `docs/BACKUPS.md` | |

## Decisions the owner must make

1. Adopt, change or reject each proposed period, in writing.
2. Name who reviews records before disposal (suggested: the registered manager for care records, the HR lead for
   staff records).
3. Whether leaving service users are deleted or anonymised at the end of the period (anonymising keeps the visit
   and finance history countable).
4. Whether any council or NHS contract sets longer periods.
5. How a legal hold is recorded.

## What the software would need (not built)

- A legal-hold flag on service users and staff that blocks disposal.
- A "due for review" report per record type, driven by the triggers above.
- A reviewed disposal action with a second person's confirmation and a permanent disposal certificate (what, when,
  who, under which rule) that does not itself contain the personal data.
- Purge of sessions, sign-in attempts, finished jobs and expired tokens.
- A way to anonymise a user named in the immutable audit log.
