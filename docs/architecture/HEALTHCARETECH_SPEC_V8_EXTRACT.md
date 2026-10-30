A multi-agency care management, compliance, workforce, communications
and operations platform for UK domiciliary care and supported-living
providers.

Prepared: 29 October 2026

Purpose: consolidated product scope for developers, technical
consultants, integration partners and implementation teams.

| **Status**             | **Core product direction**                                                                                                                                                      |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Product status         | Proposed specification and design blueprint. This document does not claim that the product is built, deployed, certified or regulator-approved.                                 |
| Operating model        | Multi-tenant SaaS, with strict separation between care agencies and branch-level permissions inside each agency.                                                                |
| Dashboards             | Both organisation-wide / all-branch dashboards and single-branch dashboards, with Tower Hamlets used as the example.                                                            |
| Communications         | WhatsApp-first two-way messaging; architected from day one to add SMS and voice calling through the same communications module.                                                 |
| Medication integration | Medication and MAR module first; GP Connect-ready architecture, with live access only after the relevant NHS onboarding, assurance, agreements and access requirements are met. |

# 1. Executive summary

24 HealthCareTech is intended to be a subscription software platform for
UK domiciliary care and supported-living providers. It brings policy and
CQC compliance, recruitment, workforce checks, training, care records,
medication support, rostering, electronic call monitoring (ECM), staff
communications, payroll calculations, finance support, quality assurance
and management reporting into one connected system.

The product must work for a single-branch provider and for agencies
operating several branches. It must also support a software supplier
serving multiple unrelated care agencies. Each agency is a separate
tenant with isolated data, branding, users, configuration, records,
integrations and billing. Within a tenant, branch-level access restricts
users to their authorised branch or branches.

The first operational pilot proposed is CSB's Tower Hamlets branch.
Liverpool and Portsmouth should be represented as separate branches
within CSB's tenant, while each external subscriber receives its own
isolated tenant. The platform must not assume that every customer uses
the same policies, pay rules, local-authority requirements, services or
staffing arrangements.

## 1.1 Product objectives

- Replace disconnected tools where practical, especially policy
  management, workforce compliance, rostering and ECM.

- Provide two dashboard views: an organisation-wide view and a
  single-branch view, with consistent drill-down to source records.

- Reduce missed visits, rota gaps, administrative duplication,
  unverified timesheets and payroll errors.

- Offer WhatsApp messaging in both directions first, with SMS and
  business voice calling available through the same replaceable
  communications layer.

- Create a medication-support workflow and data model that can later
  connect to GP Connect through an approved route.

- Use AI to assist drafting, summarisation and exception detection while
  preserving human review and accountability.

- Maintain a complete audit trail for important actions, approvals, data
  changes, exports and access to sensitive records.

- Support phased migration, reconciliation, testing and rollback from
  existing systems.

# 2. Core design principles

- Security by design: enforce tenant, branch, role, assignment and
  purpose-based permissions on the server and database, not only in the
  interface.

- Human accountability: AI-generated policies, medication changes,
  payroll results and high-impact decisions require authorised human
  review.

- Clear data provenance: distinguish information from a GP source, an
  agency record, a worker entry, an AI suggestion or an external
  integration.

- Configurable rules: tolerance windows, escalation timers, pay rules,
  templates, approval limits and branch procedures must be configurable
  and versioned.

- Interoperability: use documented APIs, webhooks, standard export
  formats and replaceable integration adapters.

- Operational resilience: handle poor mobile connectivity, duplicate
  events, late sync, outages and incomplete payroll periods safely.

- Accessible, responsive UX: desktop-first management dashboards and
  mobile-first care-worker workflows.

- No false assurance: the product must not claim CQC compliance, NHS
  approval, GP Connect access or successful delivery unless those states
  have been verified.

# 3. Organisation, tenant and branch model

## 3.1 Hierarchy

| **Level**           | **Purpose**                                             | **Examples / controls**                                                                                         |
|---------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| Platform            | Software operator's administration of the SaaS service. | Subscription plans, feature entitlements, service health and support access. No routine access to care records. |
| Agency tenant       | One care provider's isolated workspace.                 | CSB is one tenant; another subscribing provider is a separate tenant.                                           |
| Branch              | Operational location or business unit within a tenant.  | Tower Hamlets, Liverpool and Portsmouth.                                                                        |
| Team / service area | Optional grouping within a branch.                      | Domiciliary care team, supported living, locality or rota team.                                                 |
| User / role         | Individual account with least-privilege permissions.    | Director, branch manager, coordinator, care worker, HR, payroll, compliance, auditor.                           |

## 3.2 Required controls

- Every tenant-owned record must include tenant_id. Branch-scoped
  records must include branch_id where applicable.

- Use database-level isolation controls where supported, plus
  server-side authorisation checks and automated tenant-isolation tests.

- Cross-branch access is explicitly granted, logged and reviewable; a
  branch manager must not automatically see another branch's full
  records.

- Platform support access is exceptional, time-limited where feasible,
  justified, approved and audited.

- Reports, search, exports, background jobs, files, notifications,
  webhooks and integrations must enforce the same tenant boundaries.

- Allow agencies to configure their own legal entity, registered
  locations, branding, service types, subscriptions, retention rules,
  payroll settings and integration credentials.

# 4. Dashboards and navigation

## 4.1 Shared dashboard rules

- Show the active agency, dashboard scope, branch, date range, timezone,
  last refresh timestamp and data freshness warnings.

- Provide filters for date, branch, service, coordinator, worker, visit
  status and exception severity where the user has permission.

- Every KPI should drill into a filtered list of source records and
  display its definition so managers understand what is counted.

- Distinguish live operational figures from cached, delayed, estimated
  or incomplete data.

- Do not show sensitive client, medication, immigration, DBS or HR
  details on overview cards unless the role and purpose justify it.

- Provide a responsive layout, keyboard navigation, readable contrast,
  accessible labels and clear loading, empty, error and stale-data
  states.

## 4.2 Organisation-wide / All Branches dashboard

Purpose: provide authorised directors and regional managers with a
consolidated view across permitted branches. It is a cross-branch
operational overview, not a replacement for detailed branch workflows.

| **Dashboard area**            | **Key contents**                                                                                                                  | **Actions / drill-down**                                |
|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| Executive KPI row             | Scheduled visits; completed; in progress; exceptions; staffing on shift; uncovered visits; overdue actions; workforce compliance. | Open the relevant cross-branch filtered list.           |
| Branch comparison             | Per-branch service volume, completion rate, exception count, rota coverage and outstanding actions.                               | Open the selected branch dashboard.                     |
| Live operations               | Live visit status and critical attendance exceptions across authorised branches.                                                  | Contact coordinator; open visit; assign investigation.  |
| Workforce and compliance      | Expiring training/checks, vacancies, absence and staffing capacity, subject to role permissions.                                  | Open HR/compliance queues.                              |
| Quality and safeguarding      | Incidents, complaints, safeguarding actions and overdue reviews shown in appropriately restricted summaries.                      | Open authorised case records.                           |
| Finance and payroll readiness | Timesheets pending approval, payroll exceptions, invoice status and reconciliation indicators.                                    | Open branch or period detail.                           |
| Communication health          | Outgoing/incoming message counts, failed delivery, unanswered operational messages and provider status.                           | Open communications inbox and retry permitted failures. |
| System health                 | Integration errors, mobile sync delays, queue failures and stale data indicators.                                                 | Open technical status details for authorised users.     |

## 4.3 Single-branch dashboard

Purpose: give the branch manager and coordinator an actionable daily
control centre. The selected branch is fixed in the page context;
cross-branch figures are hidden unless a user with wider permissions
deliberately changes scope.

| **Dashboard area**         | **Example for Tower Hamlets**                                                                          | **Primary action**                                     |
|----------------------------|--------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| Branch header              | Tower Hamlets Branch, selected date, data freshness, alerts and profile.                               | Change date; export authorised report.                 |
| Visit KPIs                 | Scheduled, completed, in progress, late, missed check-ins, missing check-outs and exceptions.          | Open live visits or exceptions.                        |
| Visit status chart         | Completed, in progress, upcoming, cancelled and exception categories.                                  | Filter the visit list by status.                       |
| Exceptions panel           | Missed check-in, late arrival, missing check-out, short visit, sync failure and unresolved case.       | Call/message worker; assign; record outcome; escalate. |
| Live visit map             | Approximate/authorised location and visit pins where location use is lawful, necessary and enabled.    | Open visit detail; respect location permissions.       |
| Live visits table          | Service user reference, worker, scheduled/actual times, duration, status and actions.                  | Open record; contact worker; investigate.              |
| Staff on shift             | Workers on duty, next visit, contact availability and relevant rota status.                            | Open staff profile or contact.                         |
| Upcoming visits and cover  | Next visits, unfilled shifts, worker availability and route conflicts.                                 | Offer shift; reassign with approval; message staff.    |
| Medication and care alerts | Only role-appropriate prompts, such as overdue MAR completion or medication review due.                | Open authorised care/medication record.                |
| Quick actions              | Create visit, log an exception, send message, call worker, offer shift, create incident or open audit. | Start a controlled workflow.                           |

## 4.4 Dashboard scope behaviour

- All Branches is available only to roles granted multi-branch access.

- Selecting a branch changes all widgets, counts, maps, tables, exports
  and actions to that branch's scope.

- The dashboard must display its scope prominently to reduce accidental
  cross-branch actions.

- A single-branch user must not infer or access other branches through
  URL manipulation, API calls, search suggestions or export filters.

- KPI definitions and denominators must be documented, configurable only
  by authorised administrators and versioned.

- Demo data must be clearly labelled as illustrative and never presented
  as live operational data.

# 5. User roles and permission model

| **Role**                        | **Typical access**                                                                                 | **Key restrictions**                                                                |
|---------------------------------|----------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| Platform administrator          | Tenant setup, subscriptions, technical health and support tools.                                   | No routine care-record access; exceptional access requires justification and audit. |
| Agency owner / director         | Agency-wide KPIs, branches, governance, approved finance and workforce summaries.                  | Sensitive case details remain permission-controlled.                                |
| Regional / multi-branch manager | Assigned branches and cross-branch comparisons.                                                    | Only permitted branches and functions.                                              |
| Branch manager                  | Branch operations, staffing, exceptions, branch reports and approvals within delegated limits.     | No unassigned branch access.                                                        |
| Coordinator / scheduler         | Rotas, visits, attendance exceptions and staff communications.                                     | No unrestricted clinical, HR or payroll information.                                |
| Care worker                     | Own rota, assigned visits, check-in/out, authorised care plans, MAR tasks and work communications. | No access to other workers' records or unassigned service users.                    |
| HR / recruitment                | Applicants, employment records, checks, training and workforce compliance.                         | No unnecessary care-record or medication access.                                    |
| Payroll officer                 | Approved hours, pay profiles, adjustments and payroll exports.                                     | Only payroll data needed for the role.                                              |
| Medication-authorised staff     | Medication instructions, MAR and permitted medication workflows.                                   | Actions limited by training, delegation and agency policy.                          |
| Compliance / quality lead       | Policies, audits, incidents, actions and evidence.                                                 | Case access depends on purpose and permissions.                                     |
| Auditor / commissioner viewer   | Explicitly shared, time-limited read-only evidence.                                                | No unapproved edits or broad tenant access.                                         |

# 6. Full module catalogue

## 6.1 Agency, branch and subscription management

Agency details, service types, branches, teams, branding, user seats,
subscription plans, feature flags, renewals, billing status and branch
configuration. Keep configuration changes versioned and auditable.

## 6.2 Dashboard and management reporting

Role-aware organisation-wide and branch dashboards, configurable KPI
definitions, drill-downs, scheduled reports, freshness indicators and
access-controlled exports.

## 6.3 AI policy management and policy library

Searchable policy/form library; AI-assisted drafting from approved
templates; version history; owners/reviewers/approvers; publication
status; staff acknowledgement; branch appendices; retirement and review
reminders. AI output remains a draft until approved.

## 6.4 Regulatory change and compliance actions

Curated source register, source dates and links, impact assessments,
assigned actions, deadlines, evidence and escalations. Detected changes
prompt human assessment and do not automatically prove a legal change.

## 6.5 Recruitment and applicant tracking

Vacancies, candidate pipeline, applications, interviews, scoring,
references, offers, consent and onboarding checklists. Apply fair and
auditable decision processes.

## 6.6 HR and employee records

Employment details, contracts, role, branch assignment, emergency
contacts, supervision, absence, performance records, return-to-work and
document expiry alerts with strict access control.

## 6.7 Right to Work, DBS and workforce checks

Check workflow, evidence, expiry/renewal dates, reviewer, outcomes and
escalation. Restrict sensitive records, follow applicable legal
requirements and do not infer clearance from incomplete evidence.

## 6.8 Training, competency and supervision

Mandatory and role-specific learning, training matrix, certificates,
competency observations, refreshers, supervision, overdue reminders and
branch compliance summaries.

## 6.9 Service-user records and care planning

Demographics, contacts, representatives, needs, risks,
consent/preferences, care plan, visit tasks, reviews, communication
needs and document history. Access only for legitimate care purposes.

## 6.10 Medication, MAR and GP Connect readiness

Medication profile, allergies, instructions, MAR events,
omissions/refusals, PRN protocols, stock where applicable, discrepancy
handling, medication reviews and GP-source provenance. Live GP Connect
access is a separate approved integration phase.

## 6.11 Rostering and shift allocation

Availability, contracted/target hours, skills, continuity, travel time,
visit duration, rest constraints, leave, absence, unfilled shifts,
offers, acceptance, rota publication and change history.

## 6.12 Service-user visit scheduling

Recurring and one-off visits, required duration, tasks, time windows,
double-up visits, preferences, risk/skill requirements, cancellations,
replacement visits and schedule conflict checks.

## 6.13 Electronic Call Monitoring (ECM)

Mobile check-in/out, timestamps, visit matching, offline queue and sync,
late/missed alerts, short/long visits, missing check-outs, exception
ownership, correction requests and audit trail.

## 6.14 Mobile care-worker application

Secure sign-in, own rota, assigned service users, directions, authorised
care-plan access, check-in/out, visit notes, MAR tasks, incident
reporting, messaging and offline-safe event capture.

## 6.15 Staff communications centre

Unified inbox for WhatsApp first, then SMS and voice; outgoing/incoming
messages, templates, replies, delivery state, staff preferences,
escalation, call outcome and audit trail.

## 6.16 Travel and route optimisation

Travel-time estimates, visit sequencing suggestions, mileage capture
where configured, route conflicts and travel-time evidence. Human
schedulers retain override authority; avoid unsafe or unrealistic travel
plans.

## 6.17 Timesheets and attendance approval

Reconcile scheduled visits, verified ECM events, approved corrections,
travel and other payable items. Maintain pending, approved, exported and
adjusted states.

## 6.18 Payroll calculations and export

Effective-dated pay profiles, hourly rates, overtime, sleep-in/live-in,
travel time, mileage, allowances, deductions, holiday pay, bank-holiday
premiums and reconciliation. Support review/approval and export to a
payroll provider before any claim of full statutory payroll capability.

## 6.19 Invoicing and finance support

Commissioner/client rate cards, billable hours, contract rules, invoice
drafts, adjustments, payment status, debtor summaries and reconciliation
with approved visit data.

## 6.20 Incidents, safeguarding and complaints

Secure case records, chronology, risk/severity, notifications, actions,
evidence, responsible owner, deadlines, outcomes and restricted access.
Configurable escalation must not replace statutory duties.

## 6.21 Quality assurance and audits

Audit schedules, sample selection, findings, corrective actions,
evidence, completion verification, trend reporting and
inspection-readiness index.

## 6.22 Supported-living operations

Accommodation/tenancy reference where applicable, support plans, staff
coverage, outcomes, daily notes, risk reviews and service-specific
reporting. Keep tenancy data separate from clinical and HR data by
permission.

## 6.23 Document and evidence management

Secure document store, versioning, expiry alerts, retention schedules,
access history, export packages and evidence links. Use private storage
and time-limited access links.

## 6.24 Analytics and business intelligence

Branch, service, staffing, compliance, quality, attendance,
payroll-readiness and financial trend reports. Document metric
definitions and prevent re-identification in small-group reports where
appropriate.

## 6.25 Integrations and developer platform

API gateway, webhook subscriptions, import/export, integration
credentials, event logs, retries, rate limits, versioning and provider
adapters for messaging, maps, payroll and approved NHS integrations.

## 6.26 Notifications and task management

In-app, email and supported channel alerts; task owner, due date,
severity, escalation, acknowledgement and closure. Avoid sending
unnecessary sensitive information in message previews.

## 6.27 Audit, privacy and information governance

Record important views and changes to sensitive data, approvals,
exports, role changes, message events and integration access. Support
retention, subject-rights workflows and incident investigation.

## 6.28 Subscription billing and customer support

Plans, usage metering, tenant feature entitlements, invoices, support
cases and status pages. Support staff access is scoped, approved and
logged.

## 6.29 AI assistant and knowledge search

Search approved internal documents and authorised records, summarise
evidence and propose actions. Show source links and uncertainty; do not
autonomously diagnose, prescribe, approve payroll or publish policy.

## 6.30 System configuration and service monitoring

Feature flags, branch rules, message templates, escalation timers, queue
monitoring, backups, restore tests, integration health and deployment
audit.

# 7. Communications: WhatsApp first, SMS and phone calls

## 7.1 Product requirement

All channels must use one communications service and shared conversation
model. The user interface may show WhatsApp, SMS and voice separately,
but modules such as ECM, rostering and HR must call a common API.
WhatsApp is the first implementation priority; SMS and voice must remain
compatible without redesigning the application.

## 7.2 Two-way WhatsApp

- Send messages from the worker profile, visit record, roster, ECM
  exception and communications inbox.

- Receive inbound messages through verified provider webhooks and
  associate them with the correct contact/worker using validated
  phone-number matching.

- Support one-to-one conversations, approved operational templates,
  shift offers, confirmations, lateness/sickness reports and
  missed-check-in outreach.

- Record message ID, channel, sender/recipient, timestamp, template,
  delivery/read state where provided, failure reason, inbound reply and
  linked operational case.

- Support opt-in/preferences, business identity, template approvals,
  applicable WhatsApp conversation/template rules and opt-out handling.

- Provide controlled bulk messaging with audience preview, branch
  scoping, duplicate checks, approval for high-impact sends and a send
  summary.

- Do not treat a sent, delivered or read message as proof of attendance,
  care delivery or acknowledgement unless the workflow separately
  records that event.

## 7.3 SMS and voice

- Add SMS send/receive, delivery receipts, replies and fallback rules
  after the WhatsApp pilot.

- Add click-to-call through an approved voice API or business telephony
  integration, with business caller ID where available.

- Capture call attempt, time, outcome, duration where supplied,
  coordinator notes and follow-up task. Call recording must be off by
  default unless separately assessed, configured and lawfully managed.

- Do not expose managers' personal numbers by default. Use approved
  business numbers and agency-specific sender identity where supported.

- Provider pricing and message/call charges must be transparent, metered
  per tenant and configurable into subscription plans.

## 7.4 Automation examples

| **Trigger**                                   | **Automated action**                                                             | **Safety control**                                                                     |
|-----------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Missed check-in after configured grace period | Send approved WhatsApp prompt; create coordinator alert; escalate if unresolved. | No automatic assumption that worker is absent or visit was not delivered.              |
| Rota published or changed                     | Notify affected workers and request acknowledgement where configured.            | Record version and recipient list; prevent accidental bulk-send.                       |
| Emergency cover needed                        | Offer shift to eligible staff; record accept/decline/expiry.                     | Check qualifications, rest rules, branch access and scheduling conflicts.              |
| Message delivery failure                      | Retry safely or use configured SMS fallback.                                     | Avoid duplicate messages; respect preferences and costs.                               |
| No response to urgent exception               | Create task for a coordinator to call the worker.                                | Escalation depends on urgency; messaging is not a substitute for emergency procedures. |

# 8. Medication module and GP Connect roadmap

## 8.1 First-release medication functionality

- Medication profile with source, status, effective date, review date
  and last verified timestamp.

- Medication name, strength, formulation, dosage instructions, route,
  frequency, timing and special instructions where available and
  authorised.

- Allergy and sensitivity record with provenance and
  unknown/not-recorded distinction.

- MAR events: administered, omitted, refused, unavailable, not
  applicable and other configured outcomes; record time, staff identity,
  reason and follow-up.

- PRN protocols and outcome/effect recording where authorised by the
  care plan and agency process.

- Medication discrepancy, adverse concern and missed-dose workflows with
  prompt escalation to a competent person.

- Change history that preserves previous instructions and records who
  verified/approved a change.

- Permission controls so only trained/authorised staff see or record
  medication events appropriate to their role.

## 8.2 GP Connect-ready design

The initial release must not claim live GP Connect connectivity. It
should provide a clean integration boundary and a source-labelled
medication view so a future approved integration can be added without
rebuilding the medication module.

- Keep GP-sourced medication and allergy data distinguishable from
  agency-authored instructions and MAR records.

- Display source organisation, retrieval timestamp, data freshness,
  missing-data warning and source status.

- Do not silently overwrite agency records or infer that a GP list is
  complete, current or an administration instruction.

- Use a separate NHS integration adapter with credential management,
  audit, access checks, error handling and a test environment.

- Before live access, verify the current NHS England onboarding and
  assurance route, provider eligibility, technical requirements,
  relevant data-sharing agreements, DSPT expectations, service-user
  information/objection handling and any required assured-system or
  partner route.

- Confirm with NHS England and the chosen integration partner whether
  the product's architecture and intended use are eligible for the
  specific GP Connect capability. Do not promise access until confirmed.

- No prescribing, prescribing changes or write-back to GP records is in
  scope unless a separately approved service and explicit specification
  authorise it.

## 8.3 Medication safety workflow

A medication list from a GP source is reference information, not
automatic authority to administer. The system must display the approved
care-plan instruction, highlight discrepancies, require appropriate
review and preserve the audit trail. It must not use AI to make
medication decisions or automatically change dosage instructions.

## 8.4 Data protection and clinical safety

- Complete a data protection impact assessment and relevant
  clinical-safety assessment before production use of medication
  features or NHS data.

- Apply least privilege, strong authentication, encryption, access
  logging and monitored break-glass access where justified.

- Define retention, correction, subject-rights, incident and breach
  workflows with the organisation's data protection lead.

- Make unavailable, stale, conflicting or unknown medication information
  visually clear; never display missing data as a negative finding.

# 9. ECM and attendance control centre

## 9.1 Core screens

| **Screen**          | **Contents**                                                                                                          |
|---------------------|-----------------------------------------------------------------------------------------------------------------------|
| ECM overview        | KPIs, visit-status chart, exception counts, staff on shift, missing check-outs, upcoming visits and live-visit list.  |
| Live visits         | Scheduled and actual times, duration, current state, authorised location evidence, worker and service-user reference. |
| Exceptions          | Type, severity, detection time, owner, deadline, escalation, evidence, notes and resolution status.                   |
| Correction requests | Original event, proposed correction, reason, evidence, requester, reviewer, decision and audit record.                |
| Attendance approval | Verified attendance, approved payable duration, linked travel and timesheet export state.                             |
| Audit trail         | Actor, timestamp, action, record, before/after values where appropriate, reason and source device/integration.        |

## 9.2 Required events and controls

- Capture check-in/out events with immutable event ID, visit ID, worker
  ID, device/app, timestamp, local/offline status and server-received
  timestamp.

- Support offline capture and later sync, idempotent processing and
  duplicate-event detection.

- Configure late, missed check-in, missing check-out, short/long
  duration, out-of-order events and sync-failure rules.

- Original events must never be silently overwritten. Corrections are
  separate records requiring reason, evidence where appropriate and
  authorised approval.

- Unverified or disputed visits must not automatically become approved
  payable attendance.

- Reconcile approved attendance with timesheets and export references,
  preserving a trail of corrections and adjustments.

- Location tracking must be proportionate, transparent, role-restricted
  and limited to legitimate operational needs; do not track continuously
  by default.

## 9.3 ECM data model

| **Entity**         | **Key fields**                                                                                                  |
|--------------------|-----------------------------------------------------------------------------------------------------------------|
| ScheduledVisit     | tenant_id, branch_id, service_user_id, worker_id, scheduled_start/end, required_duration, status, visit_type.   |
| AttendanceEvent    | event_id, visit_id, worker_id, event_type, event_timestamp, received_timestamp, device/app, sync_state, source. |
| Exception          | exception_id, visit_id, type, severity, detected_at, owner_id, deadline, status, escalation_state, resolution.  |
| CorrectionRequest  | request_id, original_event_id, proposed_values, reason, evidence_refs, requester_id, approver_id, decision.     |
| ApprovedAttendance | visit_id, verified_start/end, unpaid_break, payable_duration, approval_status, approver, timesheet_export_ref.  |
| AuditEvent         | actor, action, timestamp, entity, before/after reference, reason, channel, correlation_id.                      |

# 10. Rostering, travel and scheduling

- Support recurring/one-off visits, worker availability, leave, absence,
  skill and competency requirements, service-user preferences,
  continuity and double-up visits.

- Display gaps, conflicts, travel estimates, excessive workload and
  potential rest-period issues before publishing a rota.

- Allow workers to receive and respond to shift offers through the
  communications module.

- Keep manual overrides possible but record who changed the schedule,
  when and why.

- Use travel-time and route services through replaceable adapters; show
  estimates and uncertainty rather than treating travel time as exact.

- Do not allocate a worker to a visit if required competency,
  permissions or scheduling rules are not satisfied without a documented
  authorised exception.

# 11. Payroll, timesheets and overnight-shift rules

## 11.1 Pay calculation engine

- Use effective-dated pay profiles and preserve the rate/policy version
  used for every calculation.

- Support hourly pay, overtime, sleep-in/live-in arrangements, travel
  time, mileage, allowances, deductions, holiday pay, bank-holiday
  premiums and configured contract rules.

- Separate payable working time, unpaid breaks, travel, allowances,
  expenses and deductions as itemised lines.

- Do not assume a bank-holiday premium is statutory; apply the
  employee's contract and configured policy.

- Only apply rolled-up holiday pay to eligible irregular-hours or
  part-year workers where permitted, and itemise it clearly.

- Provide reconciliation, exception reports, approval, export and a
  record of the payroll period and calculation version.

## 11.2 Overnight and cut-off behaviour

A shift from 20:00 on 29 October to 09:00 on 30 October remains one
linked shift record lasting 13 hours before any unpaid break. If a
payroll cut-off falls at midnight, the engine may allocate 4 hours to
the earlier period and 9 hours to the next period while preserving the
original shift identity and the relationship between segments.

- Do not split the source shift into unrelated records merely because
  payroll periods differ.

- If the shift is unfinished at payroll close, keep the unverified
  remainder pending; do not guess the finish time.

- If a closed payroll requires a correction, create a linked adjustment
  in the next eligible run rather than silently rewriting the closed
  period.

- Reconcile each original shift and its segments so hours are not
  duplicated or lost.

- Test daylight-saving transitions, overnight work, breaks, duplicate
  check-outs, late sync and cut-off boundaries.

## 11.3 Payroll scope boundary

The first production phase should prioritise validated
attendance-to-timesheet calculations, exception handling and exports to
an established payroll provider. The product must not be marketed as a
complete statutory payroll engine until tax, National Insurance,
pension, statutory payments, RTI and all applicable obligations have
been implemented and independently tested.

# 12. AI, search and automation

- AI can draft policies, summarise records the user is authorised to
  access, identify possible missing evidence, suggest actions and
  explain reports.

- Every material AI answer should show source documents/records, time
  context and uncertainty where appropriate.

- AI must not autonomously publish policies, determine employee fitness,
  make safeguarding determinations, diagnose, prescribe, change
  medication, approve payroll or close critical incidents.

- Use tenant-aware retrieval and ensure search results never cross
  agency boundaries.

- Record model/provider version, prompt/workflow version, source
  references and human decision for consequential AI-assisted workflows
  where appropriate.

- Provide a way for users to correct errors and report unsafe or
  misleading outputs.

# 13. Security, privacy and information governance

- Strong authentication, role-based and attribute-based authorisation,
  secure session management and optional multi-factor authentication.

- Encryption in transit and at rest, managed secrets, private object
  storage and time-limited file links.

- Tenant isolation tests across APIs, search, reports, exports, jobs,
  notifications and integration callbacks.

- Audit access to sensitive care, medication, HR, DBS, immigration and
  financial records.

- Retention schedules, secure deletion, legal holds, data export and
  subject-rights workflows.

- Data protection impact assessments for high-risk processing, including
  medication data, location features, communications and AI features.

- Subprocessor register, incident response, backup/restore testing,
  disaster recovery and vulnerability management.

- Do not put unnecessary special-category or medication details into
  SMS/WhatsApp message previews.

# 14. Technical architecture

| **Layer**          | **Recommended starting approach**                       | **Design notes**                                                                            |
|--------------------|---------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Web application    | Next.js + TypeScript                                    | Responsive dashboard, accessible components and permission-aware navigation.                |
| Mobile application | React Native or equivalent cross-platform approach      | Care-worker rota, visit tasks, check-in/out, MAR and offline-safe capture.                  |
| Backend            | NestJS / TypeScript modular monolith initially          | Clear module boundaries, versioned APIs, server-side authorisation and background jobs.     |
| Database           | Managed PostgreSQL                                      | Tenant and branch keys, migrations, backups, row-level security where appropriate.          |
| Files              | Private encrypted object storage                        | Malware scanning, access policies, retention and expiring access links.                     |
| Queue / jobs       | Managed queue or equivalent                             | Messaging, reminders, exports, retries and integration events with idempotency.             |
| Hosting            | Azure is a candidate platform                           | Choose appropriate UK data residency, security, resilience, support and cost configuration. |
| AI provider        | Provider-neutral adapter                                | Do not hard-wire the whole product to one model supplier.                                   |
| Communications     | Provider-neutral adapter for WhatsApp, SMS and voice    | Use official APIs, verified webhooks, delivery events and per-tenant metering.              |
| Maps / routing     | Replaceable mapping adapter                             | Respect usage terms, privacy and operational limits.                                        |
| NHS integration    | Separate GP Connect adapter after eligibility confirmed | Use approved technical and organisational route; no assumed direct access.                  |

## 14.1 Core engineering controls

- Use versioned APIs and schema migrations; maintain development, test,
  staging and production environments.

- Apply secrets management, least-privilege service identities, rate
  limits, webhook signature verification and replay protection.

- Make event processing idempotent and preserve correlation IDs across
  ECM, messaging, payroll and audit events.

- Monitor application errors, queue lag, integration failures, delivery
  status and stale data.

- Test backups and restores, not merely backup completion.

- Use automated tests for tenant isolation, permissions, payroll
  calculations, message routing and data migration.

# 15. Core data entities

| **Entity group**         | **Representative records**                                                                                            |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------|
| Tenant and configuration | Tenant, agency, branch, team, subscription, feature entitlement, settings, pay policy, notification rule.             |
| Identity and permissions | User, role, permission, branch assignment, session, access grant, approval limit.                                     |
| Care operations          | Service user, representative, care plan, risk assessment, scheduled visit, visit task, care note, incident.           |
| Medication               | Medication profile, source record, allergy, MAR event, PRN protocol, discrepancy, review, verification event.         |
| Workforce                | Applicant, employee, contract, check, training, competency, supervision, absence, availability.                       |
| Rostering and ECM        | Shift, rota version, visit, attendance event, exception, correction request, approved attendance.                     |
| Communications           | Contact endpoint, conversation, message, template, delivery event, opt-in/preference, call log, webhook event.        |
| Payroll and finance      | Pay profile, pay item, timesheet, payroll period, adjustment, export batch, invoice, payment reconciliation.          |
| Compliance and audit     | Policy, policy version, acknowledgement, source, compliance action, audit event, evidence item, retention rule.       |
| Integration and platform | Integration connection, credential reference, sync job, webhook subscription, error event, usage meter, support case. |

# 16. Key end-to-end workflows

## 16.1 Missed check-in

1.  The scheduled visit reaches its configured check-in threshold.

2.  ECM creates a traceable exception and notifies the appropriate
    coordinator.

3.  The communications service sends the configured WhatsApp prompt and
    records provider status.

4.  If no suitable response is received, the coordinator can call the
    worker and record the outcome.

5.  The coordinator investigates service-user safety and visit delivery
    according to agency procedure.

6.  Any attendance correction follows the controlled approval workflow;
    original events remain preserved.

7.  The exception is closed only with an outcome, responsible person and
    audit history.

## 16.2 Rota change and shift offer

8.  Coordinator selects eligible workers using availability, skill,
    branch and conflict checks.

9.  The system sends a shift offer through the shared communications
    module.

10. Worker response is recorded; accepted shifts are revalidated before
    the rota is updated.

11. Affected staff receive a change notification and the rota version is
    retained.

12. Unaccepted or failed offers return to the coordinator queue.

## 16.3 Medication discrepancy

13. Worker sees a mismatch, omission, refusal or unclear instruction.

14. The system captures the event, reason and time without silently
    changing the medication profile.

15. A competent authorised person is alerted according to severity and
    agency procedure.

16. The current instruction source and any GP-sourced record are
    displayed separately with freshness status.

17. Resolution, advice received, authorised change and follow-up are
    recorded and audited.

## 16.4 Payroll close

18. ECM events and correction approvals feed attendance reconciliation.

19. Unresolved, duplicate, missing or disputed events are flagged before
    approval.

20. Overnight shifts are allocated across period cut-offs while
    preserving source-shift linkage.

21. The payroll officer reviews calculated items, premiums, holiday pay
    and adjustments.

22. Approved data is exported; the export reference and reconciliation
    outcome are stored.

23. Post-close corrections become linked adjustments in a subsequent
    run.

# 17. Reporting and KPIs

| **Domain**        | **Example measures**                                                              | **Required interpretation**                                |
|-------------------|-----------------------------------------------------------------------------------|------------------------------------------------------------|
| Service delivery  | Scheduled/completed visits, on-time arrival, visit duration variance.             | Define exclusions, cancellations and denominator.          |
| ECM               | Missed check-ins, missing check-outs, unresolved exceptions, sync delay.          | Separate open, resolved, duplicate and invalid exceptions. |
| Rostering         | Unfilled visits, rota coverage, travel conflicts, overtime indicators.            | Show data freshness and rules used.                        |
| Workforce         | Training/check completion, vacancies, absence and staff availability.             | Restrict sensitive details and small-group disclosure.     |
| Medication        | MAR completion, omissions/refusals, review due and unresolved discrepancies.      | Not a clinical outcome or proof of safety by itself.       |
| Compliance        | Overdue actions, policy acknowledgements, audit findings.                         | Distinguish draft, in-review and approved evidence.        |
| Communications    | Sent/delivered/failed messages, replies, response time and call outcomes.         | Provider status is not proof the recipient read or acted.  |
| Payroll readiness | Pending approval, disputed hours, reconciliation variance, export status.         | Not a substitute for final payroll validation.             |
| Finance           | Draft invoices, approved billable hours, reconciliation and outstanding balances. | Trace amounts back to rate cards and approved records.     |

# 18. Testing and acceptance criteria

| **Area**                | **Minimum acceptance test**                                                                                                                          |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| Tenant/branch isolation | A user cannot access another tenant or an unassigned branch through UI, API, search, export, URL or background job.                                  |
| Dashboard scope         | All Branches is available only to authorised users; selecting Tower Hamlets filters all widgets and actions consistently.                            |
| ECM                     | Missed check-in, late arrival, missing check-out, offline sync, duplicate event and correction approval work as specified.                           |
| Audit                   | Original attendance and medication events remain traceable; corrections include reason, actor, approver and timestamp.                               |
| WhatsApp                | Outbound and inbound messages are correctly associated, webhook signatures are validated, retries do not create duplicates and failures are visible. |
| SMS/voice readiness     | Channel adapters can be added without changing business workflows; personal numbers are not exposed by default.                                      |
| Medication              | MAR actions are permission-controlled, discrepancies escalate, source provenance is visible and stale/unavailable data is not hidden.                |
| GP Connect readiness    | No live access is enabled before onboarding/assurance gates; mock/test data is clearly labelled; integration failures fail safely.                   |
| Payroll                 | Overnight shifts, cut-off segments, unfinished shifts, holiday pay configuration, adjustments and reconciliation produce expected results.           |
| Mobile/offline          | Events are captured offline, synced safely and reconciled without loss or duplication.                                                               |
| Privacy/security        | Sensitive data is not included unnecessarily in notifications; access is logged; retention and export workflows are tested.                          |
| Accessibility           | Core dashboard and mobile workflows can be navigated with keyboard/screen-reader support and clear error states.                                     |

# 19. Delivery roadmap

| **Phase**                                   | **Scope**                                                                                                     | **Exit gate**                                                                      |
|---------------------------------------------|---------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| Phase 0 — Discovery and validation          | User journeys, roles, data inventory, policy/legal review, integration feasibility, prototype and cost model. | Signed-off scope, risk register, architecture and acceptance criteria.             |
| Phase 1 — Secure foundation                 | Tenant/branch model, authentication, roles, audit, settings, dashboard shell and deployment pipeline.         | Isolation/security tests passed.                                                   |
| Phase 2 — Core workforce and policy         | Policy library, compliance actions, HR records, checks, training and recruitment.                             | Human approvals and document history tested.                                       |
| Phase 3 — Care records and scheduling       | Service users, care plans, visit scheduling, rotas and branch dashboards.                                     | End-to-end visit and rota workflows tested.                                        |
| Phase 4 — ECM and mobile                    | Check-in/out, offline events, exceptions, manager dashboard, correction workflow and timesheet handover.      | Operational pilot passes ECM acceptance tests.                                     |
| Phase 5 — Communications pilot              | WhatsApp Business Platform two-way inbox, templates, webhooks, delivery states and ECM triggers.              | Inbound/outbound messages, permissions, audit and cost controls validated.         |
| Phase 6 — Medication module                 | Medication profiles, MAR, discrepancy workflows and source provenance.                                        | Medication safety review, DPIA and permissions approved.                           |
| Phase 7 — Payroll and finance               | Attendance reconciliation, pay calculations, overnight rules, exports and invoice support.                    | Parallel payroll reconciliation completed.                                         |
| Phase 8 — SMS and voice                     | SMS send/receive, click-to-call, business caller ID, fallback and call logs.                                  | Channel adapter and cost controls tested.                                          |
| Phase 9 — GP Connect integration            | Confirm route/eligibility, partner and assurance; then implement and test the approved integration.           | Required NHS and organisational approvals confirmed before production data access. |
| Phase 10 — CSB pilot and commercial rollout | Pilot Tower Hamlets, resolve issues, then expand to Liverpool and Portsmouth; onboard external tenants.       | Branch sign-off, support process, recovery test and commercial readiness.          |

# 20. Migration and launch

- Inventory existing staff, service users, care plans, policies, rotas,
  pay rules, medication records and historical attendance before
  migration.

- Map source fields and owners; classify mandatory, optional, stale and
  disputed data.

- Import into a staging environment, validate counts and samples,
  reconcile totals and obtain business-owner sign-off.

- Run old and new systems in parallel where appropriate, especially for
  ECM and payroll, before switching operational control.

- Define rollback, incident communication, support ownership, staff
  training and go-live criteria.

- Do not migrate unnecessary historical sensitive data without a
  documented purpose and retention basis.

# 21. Governance, risks and decisions

| **Risk / dependency**                        | **Mitigation / decision**                                                                                                                             |
|----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| GP Connect access is not automatic           | Confirm current NHS England route, supplier eligibility, technical requirements and any assured integration partner before committing delivery dates. |
| WhatsApp costs or policy restrictions change | Keep provider-neutral design, meter usage, review current official terms and provide a manual/alternate operational route.                            |
| Message mistaken for attendance evidence     | Keep communication events separate from ECM attendance events and require explicit attendance evidence.                                               |
| Medication data is stale or conflicting      | Show source/freshness, preserve provenance, alert for review and prohibit silent changes.                                                             |
| Payroll complexity and statutory obligations | Start with validated timesheet calculations and provider export; obtain specialist payroll review before claiming full payroll capability.            |
| Cross-branch or cross-tenant data leakage    | Database and server enforcement, automated isolation testing, restricted support access and audit.                                                    |
| AI output is inaccurate                      | Source citations, human review, uncertainty labels and prohibited autonomous high-impact actions.                                                     |
| Scope/cost overrun                           | Deliver in phases, establish a minimum viable product, price integrations separately and approve change requests.                                     |

# 22. Proposed MVP priorities

| **Priority**                       | **Deliverable**                                                                                                                                                                         |
|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Must have                          | Secure multi-tenant architecture; branches; both dashboard scopes; user/role permissions; care records; rostering; ECM; exception management; audit; basic HR/training; policy library. |
| Must have for communications pilot | Two-way WhatsApp, message templates, inbound webhook handling, delivery/failure status, branch-scoped permissions and audit.                                                            |
| Must have for medication pilot     | Medication profile, MAR, discrepancy/omission workflow, source provenance, permission controls and safety warnings.                                                                     |
| Design for from day one            | SMS and voice adapters, GP Connect adapter boundary, payroll provider export, route provider adapter, tenant usage metering.                                                            |
| Later release                      | SMS and voice activation; advanced payroll; finance/invoicing; GP Connect live integration after approved route; advanced analytics and wider AI workflows.                             |

# 23. Final product definition

24 HealthCareTech is a multi-agency operating platform with shared core
services and role-aware modules. Every agency has an isolated tenant;
every branch has a consistent local dashboard; authorised directors can
use an All Branches dashboard. ECM, rostering, staff communications,
care records, medication support, workforce compliance and payroll
handover must operate as connected workflows rather than separate
applications.

The first practical pilot should use CSB's Tower Hamlets branch.
WhatsApp two-way messaging is the first communications integration,
while SMS and voice remain part of the same designed communications
service. The medication module should be implemented with safe MAR
workflows and GP Connect readiness, but live NHS access must wait until
the applicable technical and organisational route is confirmed and
approved.

This specification is the intended product blueprint for design and
development. It does not represent a live production system, NHS
integration, security certification, legal advice or regulatory
approval.

# Appendix A — Dashboard and Module Visual Reference

This visual reference is an illustrative design overview of the proposed
24 HealthCareTech platform. It is intended to help developers understand
the dashboard hierarchy and the intended look and feel of the modules.
The figures, names and screen contents in the mock-up are illustrative
only and are not live CSB data.

<img src="media/image1.png" style="width:6.94028in;height:4.62685in" />

*Figure A1. 24 HealthCareTech — organisation-wide dashboard, Tower
Hamlets single-branch dashboard and module overview.*

# Appendix B — Dashboard and Module Screen Inventory

The infographic is a high-level overview rather than a substitute for
detailed wireframes or acceptance criteria. Each screen below should be
designed and tested against the functional requirements in the main
specification.

| **No.** | **Screen / module**            | **Purpose and key content**                                                                                      |
|---------|--------------------------------|------------------------------------------------------------------------------------------------------------------|
| 1       | Organisation-wide dashboard    | Cross-branch KPIs, branch comparison, live operations, alerts and finance/compliance summaries.                  |
| 2       | Single-branch dashboard        | Branch-scoped KPIs, visit status, exceptions, map, live visits, staff on shift and upcoming visits.              |
| 3       | Rostering and scheduling       | Staff availability, shift allocation, visit timetable, coverage gaps and rota publication.                       |
| 4       | ECM — live visits              | Check-in/out status, late/missed events, missing check-outs, exception investigation and attendance audit.       |
| 5       | Communications                 | Two-way WhatsApp first; later SMS and voice, with inbox, delivery state, templates and conversation history.     |
| 6       | Care records                   | Service-user profile, care plan, risk assessments, notes, contacts and document history.                         |
| 7       | Medication management          | Medication profile, MAR, allergies, omissions/refusals, discrepancy alerts and review history.                   |
| 8       | GP Connect planned integration | Source-labelled read-only GP information if and when approved access is available; not connected in the mock-up. |
| 9       | Staff management               | Worker directory, branch assignment, contact details, status and role-specific profile.                          |
| 10      | Recruitment and onboarding     | Applicant pipeline, interviews, references, offers and onboarding checklist.                                     |
| 11      | Training and qualifications    | Training matrix, competency, certificates, refreshers and overdue actions.                                       |
| 12      | HR and workforce               | Workforce overview, contracts, absence, supervision, expiry alerts and restricted HR records.                    |
| 13      | Supported living               | Property/service overview, support coverage, care plans and outcome records.                                     |
| 14      | Client management              | Service-user directory, service type, status, branch and authorised record access.                               |
| 15      | AI policy management           | Policy search, draft assistance, approval, version history and staff acknowledgement.                            |
| 16      | CQC compliance                 | Regulatory evidence, actions, policy links, audit findings and deadlines.                                        |
| 17      | Finance and invoicing          | Rate cards, billable hours, invoice drafts, payment status and reconciliation.                                   |
| 18      | Payroll                        | Approved attendance, pay items, exceptions, payroll periods and provider export.                                 |
| 19      | Reporting and analytics        | Operational trends, service delivery, workforce, compliance and finance reports.                                 |
| 20      | Multi-branch management        | Branch setup, branch-specific permissions, configuration and authorised comparison.                              |
| 21      | Mobile care-worker app         | Own rota, assigned visits, secure check-in/out, care tasks, MAR and messages.                                    |
| 22      | Client/family portal           | Permission-based access to agreed care information, messages and visit details.                                  |
| 23      | Administration and settings    | Users, roles, integration settings, branch rules, message templates and feature configuration.                   |
| 24      | Audit trail and activity log   | Who did what and when, with controlled evidence of changes, approvals and access.                                |
| 25      | Multi-agency tenant management | Separate subscribing agencies, tenant configuration, subscriptions and strict data isolation.                    |

## Visual implementation note

The infographic shows all 25 top-level modules in one overview image.
Individual modules still require their own detailed wireframes,
responsive layouts, field definitions, user permissions, validation
rules and workflow tests. The image must not be interpreted as evidence
that the system is already built, connected to live data, or approved
for GP Connect.

# Appendix C — NHS, CQC and Adult Social Care Training Requirements

This appendix expands the Training and Qualifications module. It is
designed to help subscribing agencies evidence training, competence and
supervision requirements. Training rules differ by role, service, risk,
commissioner contract and workforce setting. The platform must not label
every NHS training interval as a universal legal requirement for every
adult social care worker.

## C1. Training management objectives

- Maintain a role-based training matrix for every employee, bank worker,
  agency worker and relevant volunteer.

- Track induction, Care Certificate standards, e-learning, classroom
  sessions, practical assessment, competency sign-off, supervision and
  refresher dates.

- Separate mandatory for the role, required by agency policy, required
  by a commissioner/contract, recommended, and not applicable.

- Support NHS/commissioner-specific training profiles where a contract
  or staff-movement arrangement requires them, without imposing those
  rules on all tenants by default.

- Provide evidence packs for CQC, commissioners, audits and internal
  governance: training status, certificates, assessment records, overdue
  actions and remediation.

- Prevent a worker being allocated to duties requiring unverified
  competence, while allowing an authorised manager to record a
  controlled exception with a reason and expiry.

- Use versioned requirements so changes to national guidance, a local
  contract or an agency policy do not silently rewrite historical
  compliance.

## C2. Core training catalogue and configurable matrix

| **Training area**                                         | **Who**                                                           | **System requirements**                                                                                                                                                                  | **Timing / renewal**                             |
|-----------------------------------------------------------|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| Care Certificate                                          | New-to-care and role-appropriate workers                          | Use the current 2025 standards (16 standards); track knowledge, workplace evidence and competent assessor sign-off. The 2025 standards include learning disability and autism awareness. | At induction / based on role and prior evidence  |
| Safeguarding adults                                       | Level set by role and local requirements                          | Track awareness, escalation routes, local safeguarding procedures and refresher evidence.                                                                                                | Configurable by role/contract                    |
| Safeguarding children                                     | Where role/service/contract requires it                           | Track level and relevance; do not assign the same level to every adult social care worker automatically.                                                                                 | Configurable                                     |
| Learning disability and autism                            | All relevant staff, level appropriate to role                     | Include The Oliver McGowan Mandatory Training on Learning Disability and Autism where applicable; record Tier 1/Tier 2 route, provider, completion and evidence.                         | Role-based; follow current guidance and contract |
| Health and safety                                         | Role-based                                                        | Record course, assessment and renewal requirement.                                                                                                                                       | Configurable                                     |
| Fire safety                                               | Role-based                                                        | Include service/property-specific procedures where relevant.                                                                                                                             | Configurable                                     |
| Moving and handling                                       | Role/task risk-based                                              | Track theoretical training and practical competence where required; link to moving-and-handling plans.                                                                                   | Configurable                                     |
| Infection prevention and control                          | Role-based                                                        | Track training level, assessment and refreshers.                                                                                                                                         | Configurable                                     |
| Medication support / administration                       | Only where duties require it                                      | Require medication policy training and competency assessment before authorised medication duties; record observed competence and reassessment.                                           | Before duties; review based on risk/policy       |
| Basic life support / resuscitation / first aid            | Role and service-specific                                         | Record exact level, practical assessment and renewal date.                                                                                                                               | Configurable                                     |
| Information governance and data security                  | All relevant staff                                                | Include confidentiality, safe records, data breaches, phishing, device security and handling sensitive care information.                                                                 | Configurable                                     |
| Equality, diversity, human rights and person-centred care | Role-based                                                        | Link learning to respectful care, reasonable adjustments, consent, dignity and communication needs.                                                                                      | Configurable                                     |
| Mental capacity, consent and restrictive practice         | Role/service-specific                                             | Track training for relevant decision-making, best-interest processes, least restrictive practice and escalation.                                                                         | Configurable                                     |
| Dementia, autism and communication                        | Based on service-user needs                                       | Assign additional learning based on client population and care plan requirements.                                                                                                        | Needs-based                                      |
| Positive Behaviour Support / de-escalation                | Where required by service model or client needs                   | Track theory, practical competency, care-plan alignment and authorised use of any intervention.                                                                                          | Needs-based                                      |
| Food hygiene / nutrition / hydration                      | Where relevant to duties                                          | Track role-specific requirements and assessment.                                                                                                                                         | Configurable                                     |
| Lone working, personal safety and emergency procedures    | Relevant community and domiciliary roles                          | Record local procedures, escalation, visit-risk awareness and emergency response.                                                                                                        | At induction and as configured                   |
| ECM, mobile app and communications                        | All relevant users                                                | Train on check-in/out, offline sync, secure devices, approved WhatsApp/SMS use and reporting incidents; messaging is not proof of visit completion.                                      | Before system use; after material changes        |
| Medication-record and GP-source awareness                 | Medication-authorised roles and relevant managers                 | Teach source provenance, stale/conflicting data, MAR recording and escalation; GP-sourced information must not silently override authorised instructions.                                | Before relevant duties                           |
| Role-specific and commissioner training                   | As specified by local authority, NHS partner, contract or service | Support custom modules, evidence, expiry rules, named commissioner, contract reference and exception approval.                                                                           | Contract-specific                                |

## C3. NHS-specific training profiles

- Create a configurable 'NHS / healthcare partner profile' that can be
  attached to a particular contract, service or eligible worker group.

- Allow authorised administrators to load a specific training list,
  levels, accepted prior evidence, renewal periods, approved learning
  providers and evidence standards from the relevant NHS body or
  contract.

- Where a valid staff-movement agreement or NHS partner arrangement
  applies, support recognition of suitably evidenced prior training only
  to the extent permitted by that arrangement.

- Keep the NHS profile separate from the agency's baseline adult social
  care matrix. Display exactly which requirement is driving a training
  task.

- Do not automatically apply NHS England staff-movement training
  intervals to all care workers. Validate whether the arrangement
  applies to the provider, role and movement concerned.

- Support evidence of Oliver McGowan training and the applicable tier.
  Do not treat a generic awareness course as equivalent unless the
  applicable guidance or contract confirms it.

- Support external learning records, LMS integration, certificates,
  provider validation, completion dates, level/tier, assessor and
  verification status.

## C4. Dashboard requirements for training

| **Screen**                  | **Required information**                                                                                                                                                                            |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Organisation-wide dashboard | Compliance percentage by branch and training area; overdue critical training; upcoming expiries; staff not yet cleared for assigned duties; evidence gaps; branch comparison.                       |
| Single-branch dashboard     | Training due this month; overdue staff; workers awaiting competency sign-off; Care Certificate progress; Oliver McGowan status where applicable; medication competency status; upcoming refreshers. |
| Worker profile              | Training timeline, certificates, assessed competence, assessor, learning provider, expiry/review date, exemptions/recognition rationale and outstanding actions.                                    |
| Manager action queue        | Assign training, book course, record external certificate, schedule observation, request evidence, suspend an assignment pending review, approve an exception with expiry.                          |
| Audit / evidence export     | Dated training matrix, requirement source/version, status, completion evidence, assessment and competency sign-off, reminders and manager actions.                                                  |

## C5. Training data fields

TrainingRequirement: tenant_id, branch_id if scoped, role/service
applicability, requirement name, category, source authority, source
URL/reference, source version/date, mandatory classification, required
level/tier, approved provider rules, renewal rule, effective dates.

TrainingRecord: worker_id, requirement_id, course/provider, completion
date, expiry/review date, result, certificate/evidence reference,
assessment type, assessor, competence outcome, verified_by, verification
timestamp, recognition/exemption rationale, status and audit reference.

CompetencyAssessment: worker_id, task/skill, assessment method, observed
evidence, assessor qualification/role, outcome, restrictions, remedial
action, review date and approval. Completion of an online course alone
must not automatically mark a practical skill as competent.

## C6. Training workflow and safeguards

24. At recruitment, calculate the worker's training profile from role,
    service type, branch, client needs and contract requirements.

25. Check prior training evidence and record whether it is accepted,
    partly accepted or needs reassessment; do not rely solely on a
    certificate title.

26. Assign induction and relevant Care Certificate standards; track
    knowledge learning separately from workplace competence assessment.

27. Before unsupervised work or a restricted task, confirm the required
    training and practical competency have been signed off by an
    appropriate assessor.

28. Send reminders to worker and manager before due dates; escalate
    overdue critical requirements according to agency policy.

29. When a requirement changes, preserve historical versions and
    recalculate future obligations without rewriting past records.

30. Provide audit-ready reports for CQC, NHS/commissioner audits and
    internal governance, filtered to the requesting authority's lawful
    scope.

31. Allow managers to record a justified temporary exception only where
    policy permits, with approval, compensating controls and expiry;
    never auto-waive a requirement.

## C7. Official guidance to maintain in the system's source register

- **Skills for Care — Care Certificate standards (updated March 2025):**
  https://www.skillsforcare.org.uk/Developing-your-workforce/Care-Certificate/Care-Certificate-standards.aspx

- **CQC — Regulation 18: Staffing:**
  https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-18

- **CQC — Staff training plan for home care and supported living:**
  https://www.cqc.org.uk/guidance-regulation/registration/supporting-documents-provider/document/staff-training-plan

- **NHS England — Statutory and mandatory training staff-movement
  agreement (applies only where relevant agreement/conditions apply):**
  https://www.england.nhs.uk/long-read/action-needed-to-save-up-to-200000-days-of-staff-time-following-changes-to-statutory-and-mandatory-training/

- **Skills for Care — Statutory and mandatory training bundle for adult
  social care:**
  https://www.skillsforcare.org.uk/news-and-events/news/skills-for-care-launches-new-statutory-and-mandatory-training-bundle-for-adult-social-care

- **CQC — Training and competence in medicines optimisation for adult
  social care staff:**
  https://www.cqc.org.uk/guidance-providers/adult-social-care/training-competence-medicines-optimisation-adult-social-care

- **NHS England — Learning Disability and Autism Programme policy
  guidance:** https://www.england.nhs.uk/long-read/core-policy/

Implementation note: official guidance and commissioner requirements can
change. The product should store source dates, review owners and version
history, and require an authorised compliance lead to approve changes to
the agency's training matrix. This appendix is a product requirement,
not legal advice.

# Appendix D — Security, Hosting, Data Protection and UK GDPR Requirements

**Purpose.** This appendix defines mandatory design and procurement
requirements for the 24 HealthCareTech platform, including hosting,
databases, mobile applications, integrations, communications, backups,
support access and the complete data lifecycle. It is a specification
for implementation and assurance, not evidence that the system is
already built, certified, approved or compliant.

## D1. Security principles and risk classification

- Treat care-recipient records, diagnoses, disability and support needs,
  medication/MAR, safeguarding, visit locations, staff records and
  payroll as confidential personal data; health and care information may
  be special-category data.

- Apply security by design and by default: collect only necessary
  information, limit access to the minimum needed, use safe defaults,
  and make every sensitive action attributable to an authenticated user
  or service.

- Protect confidentiality, integrity and availability. Security must
  cover accidental loss, unauthorised access, alteration, disclosure,
  deletion, service outage and malicious activity.

- Maintain a documented information-security risk register, threat
  model, data-flow diagrams, asset inventory and security ownership
  matrix. Review after material changes, incidents and at least
  annually.

- Use separate development, test/staging and production environments.
  Never use identifiable live care data in development or testing unless
  a documented, justified and approved exception applies with equivalent
  safeguards.

## D2. Hosting and infrastructure requirements

- Use a reputable managed cloud provider with appropriate security
  assurance, contractual commitments, support arrangements, resilience
  and evidence of independent audit/certification. Microsoft Azure UK
  regions may be evaluated as the preferred candidate, but the final
  design must verify the residency and support terms of each individual
  service.

- Primary production data should be hosted in an agreed UK region where
  the chosen services support it. Document the physical/contractual
  location of databases, files, logs, backups, disaster-recovery
  replicas, AI processing and support access. Do not assume that
  choosing a UK region means every service or support operation remains
  in the UK.

- Do not transfer personal data outside the UK, or permit overseas
  access, until the transfer has been assessed and the required UK GDPR
  transfer mechanism and safeguards are in place. Maintain an up-to-date
  list of countries, subprocessors and data locations.

- Use private networking where practical; restrict database access to
  authorised application services; disable public database endpoints by
  default; apply network segmentation, firewall rules, web application
  firewall, DDoS protections and secure administrative access.

- Separate production, customer data, secrets, logs and backup
  environments. Keep infrastructure configuration in version control,
  review changes, and use infrastructure-as-code and policy checks where
  practicable.

- Use managed services with documented patching, resilience, physical
  security and incident processes. Contracts must identify which
  security tasks are the provider's responsibility and which remain with
  24 HealthCareTech.

## D3. Encryption, secrets and key management

- Encrypt data in transit using current secure TLS configurations (TLS
  1.2 or later, with stronger options where supported); prohibit
  insecure HTTP and insecure integration endpoints.

- Encrypt databases, object/file storage, backups, exports and other
  persistent storage at rest. Use managed encryption keys or a managed
  key vault; restrict key administration separately from ordinary
  application administration.

- Rotate, revoke and monitor credentials, API keys, signing keys and
  certificates. Store secrets in a managed secrets vault, never in
  source code, source-control history, screenshots, support tickets or
  client-side application bundles.

- Use device-level encryption and secure storage for mobile devices.
  Sensitive information cached offline must be minimised, encrypted,
  time-limited and removed on logout, device revocation or expiry where
  technically possible.

- Document encryption choices, key ownership, key recovery, rotation,
  revocation and emergency-access procedures. Encryption is one control
  within a layered security model, not a substitute for access control
  and monitoring.

## D4. Identity, access control and tenant separation

- Require multi-factor authentication (MFA) for platform administrators,
  agency owners/directors, privileged users and remote support access.
  Provide MFA for all users where practicable, with stronger controls
  for high-risk roles.

- Use role-based and attribute-based permissions scoped by tenant,
  branch, team, care relationship and task. Apply least privilege and
  deny access by default. A user in one agency must not be able to view
  or infer another agency's records.

- Enforce tenant and branch scoping server-side on every API, background
  job, export, report, search, file download, mobile sync and
  integration—not merely by hiding screens in the user interface.

- Use defence in depth for multi-tenancy: tenant identifiers on records,
  database-level controls such as row-level security where suitable,
  automated tenant-isolation tests, and separate storage/access policies
  for files. Consider stronger physical/logical isolation for
  higher-risk customers if commercially justified.

- Support secure joiner/mover/leaver processes, time-limited
  invitations, prompt account suspension, session expiry, secure
  password reset, protection against brute force, and periodic access
  recertification.

- Restrict vendor support and platform administrators. Require
  just-in-time approval, time-limited access, MFA, a recorded reason,
  audit logs and customer visibility for any access to customer content.
  No shared administrator accounts.

- For sensitive actions—medication record changes, MAR corrections,
  safeguarding records, payroll approval, data exports and permission
  changes—record the actor, timestamp, affected record, action, reason
  where relevant and approval.

## D5. Audit logging, monitoring and cyber defence

- Maintain tamper-resistant audit trails for logins, failed logins,
  permission changes, record access where proportionate, data exports,
  medication/MAR events, visit/ECM changes, payroll actions,
  administrator access, integrations and deletion.

- Use centralised security monitoring and alerting for unusual logins,
  impossible travel, repeated failures, privilege escalation, bulk
  downloads, cross-tenant access attempts, disabled logging, malware
  indicators and unexpected data transfers.

- Synchronise system clocks, restrict access to logs, protect logs from
  alteration and define retention periods. Do not put passwords, access
  tokens or unnecessary sensitive care details into logs.

- Run automated dependency and vulnerability scanning, code analysis,
  container/image scanning where applicable, and patch management.
  Define severity-based remediation targets and document accepted risks.

- Arrange independent penetration testing before production launch,
  after major architectural/security changes and periodically
  thereafter. Fix critical/high-risk findings and retest before release
  or document a formally approved exception.

- Use secure development practices including peer review, protected
  branches, secrets scanning, dependency pinning, signed/reviewed
  releases where practical, separate deployment permissions and rollback
  capability.

## D6. Backups, disaster recovery and service continuity

- Create encrypted, automated backups of databases, required files,
  configuration and essential audit information. Keep backups logically
  isolated from production credentials and protect against ransomware
  and accidental deletion.

- Use immutable or write-protected backup copies where supported, with
  access restricted to designated recovery roles. Define retention and
  secure expiry of backup copies.

- Set and approve service recovery objectives before launch. Initial
  planning targets for discussion: Recovery Point Objective (RPO) of no
  more than 15 minutes for core transactional data and Recovery Time
  Objective (RTO) of no more than 4 hours for critical services. These
  are proposed targets, not guarantees; validate cost, architecture and
  supplier commitments.

- Test restoration from backup at least quarterly and perform a
  documented disaster-recovery exercise at least annually, including
  database restore, file restore, identity/secrets recovery and
  communications to customers.

- Prepare a business continuity plan for loss of hosting, ransomware,
  mobile connectivity failure, GP/integration outages and communications
  provider failure. Provide safe downtime procedures for urgent care
  visits and medication workflows.

- Monitor availability, capacity, backup success, replication health and
  recovery readiness. Alert a responsible person when a backup or
  recovery control fails.

## D7. UK GDPR and Data Protection Act requirements

- Establish the correct roles for each processing activity. Normally the
  subscribing care agency will be the controller for its care, workforce
  and service-user records, while 24 HealthCareTech will act as
  processor under documented instructions. 24 HealthCareTech may be a
  separate controller for limited activities such as its own account
  administration or legal obligations; document the roles rather than
  assuming one role applies to everything.

- Sign a UK GDPR Article 28 data processing agreement with each agency
  customer. It must cover processing instructions, confidentiality,
  security, subprocessors, assistance with rights requests and DPIAs,
  breach support, audits, return/deletion at contract end and
  international transfers.

- Maintain a record of processing activities and a data inventory
  showing categories of people/data, purposes, lawful bases,
  special-category conditions, recipients, locations, retention, access
  roles and processors.

- Before live deployment, complete a Data Protection Impact Assessment
  (DPIA) because the platform is intended to process sensitive
  health/care data at scale and may introduce monitoring, profiling or
  AI-assisted decisions. Record risks, mitigations, residual risk and
  sign-off; consult the ICO where legally required if high residual risk
  cannot be mitigated.

- For each processing purpose, document the controller's lawful basis
  under Article 6 and, where health or other special-category data is
  processed, the applicable Article 9 condition and relevant Data
  Protection Act 2018 safeguards. Do not treat consent as the automatic
  lawful basis for all care records.

- Build privacy by design: data minimisation, accuracy, purpose
  limitation, storage limitation, transparency and confidentiality.
  Provide configurable retention rules and documented legal holds; avoid
  indefinite retention by default.

- Support data subject rights workflows, including access,
  rectification, erasure where applicable, restriction, objection,
  portability where applicable, and responses to requests within
  statutory deadlines. Include identity verification, search/export,
  review, response tracking and audit evidence.

- Provide privacy notices and customer configuration for recipients,
  representatives, staff and other affected individuals. Explain
  purposes, lawful bases, recipients, retention, rights, contact routes
  and any relevant international transfers.

- Maintain a breach-response process. Notify the controller customer
  without undue delay after becoming aware of a personal data breach.
  The controller must assess whether notification to the ICO is required
  and, where required, normally notify within 72 hours of awareness;
  affected people must be informed where the legal high-risk threshold
  applies.

- Ensure data is returned in a usable, documented export format and
  securely deleted at contract end according to the agreed retention
  schedule, subject to legal obligations and backup expiry cycles.
  Provide deletion confirmation where appropriate.

- Maintain a current subprocessor register and obtain required customer
  authorisation before adding or changing subprocessors. Assess each
  provider's security, locations, purposes, retention, transfer
  arrangements and contract terms.

## D8. AI, messaging and external integrations

- Do not use customer care records, medication details, staff records or
  messages to train general-purpose AI models by default. Any AI
  provider must be assessed for retention, training use, data location,
  subprocessors, access controls and contractual commitments; obtain
  appropriate authorisation and document the lawful basis before use.

- AI-generated policies, summaries, risk flags and recommendations must
  be labelled as AI-assisted, reviewable by an authorised person and
  auditable. Do not allow AI alone to make consequential care,
  employment, safeguarding or medication decisions without a documented
  lawful and safety assessment.

- For WhatsApp, SMS, email and voice integrations, minimise message
  content. Avoid placing full diagnoses, medication lists or detailed
  care plans in message previews or unverified channels. Verify
  recipients, manage opt-outs and consent where relevant, record message
  delivery and access, and retain conversations according to policy.

- Use authenticated webhooks, signature verification, replay protection,
  rate limits and secrets rotation for communication, GP Connect,
  payroll and other external integrations. Keep external systems' data
  provenance and timestamps visible.

- GP Connect or any NHS integration must not be described as live,
  approved or available until eligibility, onboarding, technical
  assurance, information-governance requirements, contracts and testing
  have been completed. Preserve source, time and provenance; never
  silently overwrite a medication record based on an external feed.

- Keep production and test credentials separate. External vendors must
  receive only the minimum data needed for the specific transaction.

## D9. Mobile app, devices and offline operation

- Require secure authentication and short-lived access tokens, with
  refresh-token rotation/revocation and remote session termination.
  Protect against insecure deep links, local data exposure and
  screenshots where platform controls permit.

- Minimise offline data to assigned visits and necessary care
  instructions. Encrypt local storage, define offline expiry,
  synchronise changes securely, resolve conflicts safely and preserve a
  record of who changed what and when.

- Do not store sensitive data in unprotected local databases, logs,
  notifications, analytics tools or crash reports. Redact personal
  information from diagnostics.

- Provide device-loss reporting and the ability to revoke a
  device/session. For organisation-managed devices, support mobile
  device management (MDM) policies such as screen lock, encryption,
  supported OS versions and remote wipe.

- Make offline and downtime procedures safe for care workers. Do not
  silently convert missing GPS, failed sync or absent check-in/out
  evidence into a confirmed visit, medication administration or payable
  shift.

## D10. NHS and adult social care assurance

- Assess whether each customer and each planned integration is in scope
  for the NHS Data Security and Protection Toolkit (DSPT). Organisations
  accessing NHS patient data or NHS systems may have DSPT requirements;
  applicability and the current submission standard must be confirmed
  for the relevant organisation and contract.

- Maintain a DSPT evidence pack for the supplier where requested by
  customers: security policies, risk assessments, incident process,
  business continuity, access control, staff training, penetration-test
  summary, supplier/subprocessor list, data-flow diagrams and relevant
  independent assurance.

- Assess Cyber Essentials or Cyber Essentials Plus as a baseline for the
  organisation and its devices; consider ISO/IEC 27001 certification as
  the product and customer base mature. These are planned assurance
  options unless certification has actually been awarded.

- If the software is intended to support clinical decisions or is
  treated as a health IT product by a customer, assess applicable NHS
  clinical safety standards and supplier requirements, including
  DCB0129/DCB0160 where in scope. Do not assume these apply to every
  administrative module; obtain specialist assessment.

- Provide customer-facing security documentation and a clear
  shared-responsibility matrix explaining what the cloud provider, 24
  HealthCareTech and the subscribing agency each must do.

## D11. Policies and operational procedures required before launch

- Information Security Policy and acceptable-use rules.

- Data Protection Policy, privacy notices, records of processing
  activities and DPIA.

- Data Processing Agreement, subprocessor register and
  international-transfer assessment.

- Access Control and Privileged Access Policy; joiner/mover/leaver
  procedure.

- Encryption, key management, secrets management and secure
  configuration standards.

- Secure Development, vulnerability management, patching and
  penetration-testing procedures.

- Security Incident and Personal Data Breach Response Plan, including
  customer escalation contacts and ICO-assessment workflow.

- Backup, disaster recovery, business continuity and downtime
  procedures, with test evidence.

- Data retention, subject-rights request, data export, correction and
  secure deletion procedures.

- Supplier due diligence, staff confidentiality, security awareness
  training and periodic access reviews.

## D12. Minimum go-live acceptance checklist

- [ ] Threat model, architecture diagram, data-flow map and risk
  register approved.

- [ ] DPIA and data-processing roles/lawful-basis responsibilities
  reviewed and signed off.

- [ ] Hosting region, backup region, support access locations and
  subprocessors documented and contractually checked.

- [ ] TLS, encryption at rest, secrets vault, MFA and least-privilege
  access verified.

- [ ] Tenant-isolation tests passed, including API, files, exports,
  background jobs, search and mobile sync.

- [ ] Audit logging, security alerts and incident escalation tested.

- [ ] Backup restore and disaster-recovery exercises passed against
  agreed RPO/RTO.

- [ ] Independent penetration test completed; critical/high findings
  fixed and retested or formally risk-accepted by an authorised owner.

- [ ] Data Processing Agreements, privacy notices, retention schedule
  and rights-request process ready.

- [ ] Breach response and customer notification process rehearsed.

- [ ] Mobile offline data, device-loss response and secure deletion
  tested.

- [ ] AI, WhatsApp/SMS, GP Connect and other vendors reviewed for data
  use, retention, locations and contract terms.

- [ ] Applicable DSPT/customer assurance requirements confirmed and
  evidence pack prepared.

- [ ] Named security owner, data protection lead/DPO decision, on-call
  contacts and review schedule documented.

## D13. Suggested service levels and security ownership

| Area                  | Proposed requirement                                                                               | Owner / evidence                         |
|-----------------------|----------------------------------------------------------------------------------------------------|------------------------------------------|
| Hosting/data location | UK primary region where supported; document every exception and transfer                           | Technical lead + hosting contract        |
| Availability          | Agree target with customers; monitor and report actual uptime                                      | Operations + monitoring reports          |
| Recovery              | Initial planning target RPO ≤15 minutes; RTO ≤4 hours for critical services, subject to validation | Technical lead + restore/DR tests        |
| Security testing      | Independent pre-launch penetration test and periodic retesting                                     | Security lead + test report              |
| Access review         | At least quarterly for privileged/high-risk roles; periodic review for all users                   | Customer admins + audit evidence         |
| Backups               | Automated, encrypted, isolated; restore test at least quarterly                                    | Cloud operations + test records          |
| Incident response     | 24/7 reporting route for critical incidents; notify affected customer without undue delay          | Incident lead + incident log             |
| Retention/deletion    | Customer-configurable schedule, contract-end export and deletion process                           | Data protection lead + deletion evidence |

## D14. Official reference sources

- **ICO — A guide to data security:**
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/

- **ICO — Security outcomes:**
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/security-outcomes/

- **ICO — Encryption:**
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/encryption/

- **NCSC — Cloud security principles:**
  https://www.ncsc.gov.uk/collection/cloud/the-cloud-security-principles

- **NHS Data Security and Protection Toolkit:**
  https://www.dsptoolkit.nhs.uk/

- **NHS Adult Social Care Standards Directory — DSPT:**
  https://adultsocialcare.standards.nhs.uk/published-standards/data-security-and-protection-toolkit

**Important implementation note:** The requirements in this appendix
must be validated against the actual architecture, supplier contracts,
current legislation and each customer's use case. The UK GDPR is
risk-based; no document alone makes a system compliant. Before live
deployment, obtain a competent security review and data-protection
review, and confirm the current legal position and applicable NHS
assurance requirements.

# Appendix E — Policy Assignment, Read Tracking and Staff Acknowledgement

**Purpose.** This module is a mandatory part of AI Policy Management and
must integrate with staff management, recruitment/onboarding, training,
branch management, notifications, audit trails and compliance reporting.

## E1. Policy assignment and targeting

- Allow authorised managers to assign a policy to all staff in an
  agency, selected branches, teams, job roles, employment types or named
  individuals.

- Support mandatory, role-specific and optional policies, with priority,
  effective date, due date, review date and responsible policy owner.

- Support assignment during recruitment and onboarding, role changes,
  branch transfers, policy updates and periodic re-acknowledgement.

- Prevent users from assigning or viewing policies outside their tenant
  and authorised branch scope.

## E2. Staff notifications and reminders

- Notify staff inside the platform and mobile app. Support optional
  email, SMS and WhatsApp reminders through approved, configured
  providers.

- Allow scheduled reminders before the due date and repeat reminders
  after the due date, with configurable escalation to the line manager
  or branch manager.

- Log each notification attempt, channel, timestamp and delivery status
  where the provider supplies it. A sent or delivered notification must
  not be treated as proof that the staff member read the policy.

- Minimise sensitive content in messages and notification previews; use
  a secure sign-in link to open the policy.

## E3. Reading, acknowledgement and understanding

- Track separate states: assigned, not opened, opened, in progress,
  viewed to completion where technically measurable, acknowledged,
  assessment required, assessment passed, overdue, exempted with reason,
  and withdrawn.

- Record the exact policy identifier and version, staff identifier,
  assignment date, first-opened time, completion/view event where
  available, acknowledgement time, and the relevant assessment outcome.

- Display a clear acknowledgement statement such as: 'I confirm that I
  have read this policy and know where to ask questions.' Do not
  describe a click as proof of comprehension.

- For designated high-risk or mandatory policies, require a short
  knowledge check, competency sign-off or manager discussion according
  to the policy's risk level. Record attempts, score, pass threshold,
  assessor and follow-up actions.

- Make clear that a policy acknowledgement is not a substitute for
  practical training, observed competency, supervision or professional
  judgement where these are required.

## E4. Policy version control and reassignment

- Maintain a version-controlled policy register with owner, approval
  status, publication/effective date, review date, change summary and
  superseded version.

- When a material revision is approved, identify affected roles and
  staff, assign the new version and require fresh acknowledgement or
  assessment where configured.

- Preserve the historical version and the evidence of each staff
  member's acknowledgement of that version. Never silently rewrite
  historical acknowledgement records.

- Support review reminders, expiry/review queues, withdrawal of obsolete
  policies and controlled emergency publication with a recorded reason.

## E5. Manager dashboards and escalation

- Provide organisation-wide and branch-level dashboards showing
  assignment totals, completion rates, not-opened, in-progress,
  acknowledged, assessment-pending, failed assessment and overdue
  counts.

- Allow managers to drill down to authorised staff and policies, filter
  by branch, role, policy, risk, due date and status, and export an
  auditable report.

- Escalate overdue high-risk policy acknowledgements to designated
  managers and record escalation history and resolution.

- Allow a manager to record a follow-up conversation, additional
  training, competency assessment, an approved exemption and its reason,
  or an agreed completion plan.

- Where policy non-completion may make a duty unsafe, provide
  configurable risk alerts and require an authorised human decision
  under agency procedures; do not automatically suspend employment or
  make an adverse employment decision solely from a dashboard status.

## E6. Audit integrity, permissions and data protection

- Acknowledgement and assessment evidence must be append-only or
  otherwise tamper-evident. Staff must not be able to delete or edit
  their own acknowledgement history.

- Corrections must be made through a new, attributable correction event
  retaining the original event, reason, timestamp and approver where
  applicable.

- Apply tenant and branch access controls to policy content, assignment
  lists, acknowledgements, assessments, reports and exports.

- Protect records in transit and at rest, log privileged access and
  exports, and apply documented retention and deletion rules consistent
  with the customer contract and applicable law.

- Provide a complete evidence export showing the policy/version,
  assignment scope, staff member, relevant timestamps, acknowledgement
  wording, notification history, assessment result, exceptions and
  follow-up actions.

## E7. Required workflow

- Policy owner drafts or updates a policy and submits it for approval.

- Authorised approver approves the exact version and sets the effective
  date, target staff and due date.

- The system assigns the version and sends notifications to affected
  staff.

- Staff open the policy, review it and acknowledge; designated policies
  also require an assessment or competency sign-off.

- The system tracks outstanding work, sends reminders and escalates
  overdue items.

- Managers resolve exceptions and arrange further training or competency
  checks where needed.

- Compliance staff review dashboard results and export version-specific
  evidence for internal audit or inspection.

## E8. Minimum acceptance tests before release

- A policy can be assigned to all staff, a single branch, a role and
  selected individuals without exposing other tenants' records.

- The system distinguishes opened, acknowledged and assessment-passed
  states.

- A material policy revision triggers reassignment to the configured
  affected staff and preserves the prior version's evidence.

- Reminder and escalation events are recorded accurately, and
  notification delivery is not treated as acknowledgement.

- Staff cannot alter or delete their own evidence; authorised
  corrections preserve the original event.

- Dashboard counts reconcile with individual staff records and exported
  reports.

- Permissions, mobile access, audit logs, exports and retention rules
  are tested before production launch.

**Implementation status.** These are product requirements for the
development team. They do not mean the functionality already exists or
that a staff member has actually read a policy. The live system must
only report events it has recorded.

# Appendix F — Integrated Staff Training, Policy Compliance and Care-Readiness

**Purpose.** Training, policy acknowledgement, competency assessment and
workforce compliance must operate as one integrated readiness system.
The platform must help a care provider evidence that each worker has
completed the requirements applicable to their role and is safe and
authorised for the particular duties and assignments allocated to them.
A dashboard status alone is not proof of compliance; every status must
link to dated, attributable evidence.

## F1. Individual staff readiness profile

- Create a single staff compliance profile linking identity and role,
  branch, employment/onboarding status, required checks, training
  records, qualifications, competency assessments, policy versions and
  acknowledgements, supervision/appraisal, and any role-specific
  restrictions.

- Configure requirements by role, service type, client group, branch,
  commissioner/contract, risk assessment and task. Do not assume every
  training course or policy applies identically to every worker.

- Show an overall readiness status and separate component statuses for
  recruitment checks, mandatory/role-specific training, policy
  acknowledgement, practical competency, qualifications/registration
  where applicable, and other configured pre-deployment requirements.

- Allow authorised managers to see the evidence, due/expiry date,
  source, verifier, exceptions and outstanding actions behind every
  status. The system must never mark a worker ready solely because a
  record has been entered without required verification.

## F2. Readiness statuses and rules

| Status                  | Meaning                                                                                                                           | System behaviour                                                                                              |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| Ready                   | All mandatory and applicable requirements are complete, in date and verified for the selected role/task.                          | May be considered for allocation within authorised scope; manager retains responsibility for safe deployment. |
| Ready with restrictions | Core requirements are met but a defined limitation applies, such as a task-specific competency not held.                          | Prevent allocation to restricted tasks; show the restriction and its reason.                                  |
| Not ready               | One or more required checks, training items, acknowledgements or competency sign-offs are missing, expired, failed or unverified. | Flag outstanding items and prevent relevant deployment where required by policy or law.                       |
| Pending verification    | Evidence has been submitted but has not been checked or approved by an authorised person.                                         | Do not treat unverified evidence as completed.                                                                |
| Review required         | A concern, incident, long absence, role change, policy change or competency expiry requires reassessment.                         | Notify the responsible manager and record the review outcome.                                                 |

## F3. Training completion and competency

- Maintain a role-based training matrix that identifies required,
  completed, overdue, expired, exempted and pending-verification
  training.

- Record course/provider, training type, completion date, expiry or
  review date where applicable, result, certificate/evidence, assessor,
  and whether practical competency is required.

- Distinguish attendance/completion of a course from successful
  assessment and observed workplace competence. For tasks requiring
  competency, require authorised sign-off before the worker is marked
  ready for that task.

- Include configurable requirements for induction, the Care Certificate
  where applicable, safeguarding, infection prevention and control,
  moving and handling, medication, health and safety, fire safety,
  information governance, MCA/consent, learning disability/autism
  awareness and other role- or contract-specific training.

- For medication-related duties, track medication training and the
  relevant competency assessment separately; restrict medication tasks
  until required authorisation and competency are confirmed.

- Support refresher/reassessment triggers after expiry, incident,
  observed concern, change of duties or a relevant policy/procedure
  update.

## F4. Policy compliance linked to training

- Map each policy to the roles, branches, services, tasks and
  training/competency requirements it affects.

- Track the exact policy version assigned, date opened/viewed where
  measurable, acknowledgement date, acknowledgement wording, assessment
  result where required and outstanding status.

- For high-risk policies, allow a knowledge check, discussion or
  practical competency requirement rather than relying only on a read
  receipt.

- When a policy changes, assess whether the change requires
  re-acknowledgement, a knowledge check, retraining or renewed
  competency sign-off; route the decision to the authorised policy
  owner.

- Do not treat a policy acknowledgement as proof of training or
  competence. Do not treat training attendance as proof that a worker
  has read and acknowledged a relevant policy.

## F5. Recruitment, onboarding and deployment workflow

32. Recruitment team creates the staff record and selects the intended
    role, branch, service and task scope.

33. System generates the applicable onboarding checklist and role-based
    training/policy requirements.

34. Staff submit evidence and complete required e-learning, training and
    policy acknowledgements.

35. Authorised staff verify identity, qualifications, checks,
    certificates and other evidence; unresolved items remain pending.

36. Relevant managers complete practical competency checks, supervision
    or sign-offs where required.

37. The system calculates readiness against the configured rules and
    shows the evidence and any restrictions.

38. Before allocating a visit or task, rostering checks the worker's
    current readiness for the duties involved and flags or blocks
    allocations where a required control is not met.

39. Changes in role, branch, client need, policy, training expiry,
    incident or absence can trigger reassessment and update the
    readiness status.

40. Managers review exceptions and make documented decisions; all
    overrides require permission, reason, scope, expiry where applicable
    and audit history.

## F6. Rostering and task-level safeguards

- Integrate staff readiness with rostering, ECM and care-task
  allocation. A worker may be generally employed but not cleared for a
  particular task, client group or medication duty.

- Apply configurable hard stops for requirements that must be met before
  a task can be assigned, and warnings for issues requiring manager
  review. The customer must configure these rules with competent
  compliance input.

- Check status at allocation time and again before the visit where
  practical, so newly expired training, revoked authorisation or a new
  restriction is not ignored.

- Provide a controlled exception process for urgent operational
  situations only where lawful and safe; require authorised approval,
  recorded rationale, limited scope and follow-up. Never use an override
  to bypass a legal requirement.

- Make readiness indicators available to authorised branch managers and
  coordinators without exposing unnecessary sensitive HR, health or
  disciplinary details to rostering users.

## F7. CQC evidence and reporting

- Provide an inspector-ready staff file report showing role, required
  checks, verified evidence, applicable training, certificates,
  competency sign-offs, policy versions and acknowledgements,
  supervision/appraisal, restrictions, due dates and outstanding
  actions.

- Provide organisation-wide and branch-level dashboards for fully ready
  staff, not-ready staff, pending verification, expired/overdue
  training, missing policy acknowledgements, failed assessments,
  competency gaps and upcoming renewals.

- Allow an authorised user to select a staff member, branch, date range
  or requirement and export a traceable evidence pack with the source
  record and audit trail.

- Record who verified or approved evidence, when they did so, any
  correction, the reason for an exception and the date of the last
  readiness review.

- Support trend reporting and action plans; do not present aggregate
  completion percentages as proof that individual workers are competent.

## F8. Data integrity, privacy and governance

- Protect training, policy, competency and readiness records using the
  same tenant/branch access controls, encryption, retention rules and
  audit requirements specified elsewhere in this document.

- Limit visibility of sensitive HR, occupational health, disciplinary
  and safeguarding information to authorised roles. Rostering users
  should receive the minimum status needed to allocate work safely.

- Keep historical evidence when a requirement changes or a certificate
  expires; do not overwrite historical completion records.

- Require authorised, attributable corrections and overrides. Log the
  original status, changed status, reason, user, timestamp and approval
  where required.

- Make readiness logic configurable and version-controlled, with a clear
  explanation of why a person is or is not ready. Test the rules before
  changing them.

## F9. Example readiness dashboard (illustrative only)

- Ready for assigned duties — all applicable requirements verified.

- Not ready — missing mandatory training, policy acknowledgement or
  required checks.

- Pending verification — evidence uploaded but not approved.

- Competency due — training may be complete, but observed sign-off or
  reassessment is outstanding.

- Restricted — general readiness may be acceptable, but one or more
  duties are not authorised.

- Due soon — training, certificate, policy review or competency expires
  within the configured warning period.

## F10. Minimum acceptance tests before release

- [ ] A worker cannot be shown as ready when a configured mandatory
  requirement is missing, expired, failed or unverified.

- [ ] The system distinguishes course completion, policy
  acknowledgement, knowledge assessment and practical competency.

- [ ] The readiness status changes when a required certificate expires,
  a policy is materially revised, a role changes or an authorisation is
  withdrawn.

- [ ] Rostering blocks or flags allocation according to the approved
  task-level rules and records any authorised exception.

- [ ] A manager can see the reason for a readiness status and export the
  supporting evidence without viewing unrelated restricted records.

- [ ] A branch manager cannot access staff evidence outside their
  authorised branch or tenant.

- [ ] Every approval, correction, exception and override is attributable
  and auditable.

- [ ] Dashboard totals reconcile with individual staff records and
  exported reports.

**Important.** This module is designed to help the provider evidence
compliance with applicable CQC requirements, including staffing,
training, support, development and safe care. It does not itself
guarantee CQC compliance or replace management judgement, supervision,
practical assessment, safeguarding duties or the provider's
responsibility to verify evidence and deploy staff safely.
