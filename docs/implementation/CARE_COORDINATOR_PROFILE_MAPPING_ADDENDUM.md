# Care Coordinator — full Service User mapping addendum (implementation matrix)

This document records the 4 Nov 2026 product requirement to **file every incoming fact in the correct existing Service User section**, not a generic AI note. The original attachments and source data must remain confidential. The implementation on this branch is partial and MUST NOT be described as fully production-ready.

## Navigation and responsibility

| Existing user-facing destination | Data from council/NHS correspondence | Branch status |
| --- | --- | --- |
| Overview | Concise current support summary, alerts, dates | Existing derived overview; no AI write |
| Personal details | Verified name, DOB, NHS number, address, language, contact preferences | Structured import + source review |
| Care → Care plans | Personal care, oral care, toileting, mobility, nutrition, skin, sleep, emotional support, cultural preference, outcomes | Nine standard section drafts + source review |
| Care → Risk assessments | Falls, moving/handling, pressure, nutrition, infection, medication, home, emotional risks | Non-active AI draft + independent manager review needed |
| Care → Care package | Commissioning, start/end, authorised visits and hours | Structured import; verify funder/commissioned hours separately |
| Care → Medication | Self-administering, prompting, assistance, administration, PRN, allergies, verified MAR | Review-only / clinical reconciliation; no automatic MAR |
| Health and Safety → Incidents | Original incident date, narrative and historic context | Review-only; must not fabricate a new incident |
| Health and Safety → Body map | Sourced wound/skin observation with exact location and date | Review-only; clinician/competent staff confirms current observation |
| Visits → Visits | Scheduled visits, timing, duration, care workers needed | One manager-controlled unpublished week after signoffs |
| Visits → Template | Recurring care-task checklists and instructions | Structured import of recurring visit templates |
| Visits → Rota | Staff suitability, availability and visit allocations | Publish and allocation remain manual |
| Visits → Visit notes | Existing historical visits and handovers | Review-only; never impersonate a carer |
| Visits → Missed calls | Historical missed visits | Review-only; never fabricate live monitored events |
| Documents → Council Documents | Original council-issued care packages, support plans, commissioning docs | Council Support Plan upload supported; broader upload taxonomy pending |
| Documents → Other Documents | Original NHS discharge, GP letters, ID, signed consent | Restricted NHS discharge upload supported; broader taxonomy pending |
| Contacts → Contact | Family, next of kin, GP, nurse, social worker, reps | Imported contacts with exact CRM contact types |
| Contacts → Carer preferences & carers | Gender, language, continuity and named staff preference | Gender preference imported; named carer preference remains manual |
| History | Sources, per-field decisions, changes and approvals | Import history + source field decision metadata; durable approval queue pending |

## Mandatory end-to-end flow

READ → EXTRACT → CLASSIFY → MAP → COMPARE → FLAG → COORDINATOR REVIEW → MANAGER APPROVAL → FILE INTO EXISTING PROFILE → UPDATE HISTORY.

The CRM import currently receives **already-extracted structured JSON** from Claude Code. It does **not** yet parse PDF documents autonomously inside the browser. Each populated structured field must include its own source-linked review row (document, page number, confidence, destination, exact field path, decision and reviewer attribution). A mismatch, unapproved value or missing review blocks saving.

Coordinator review supports edits and approve/reject/clarify/duplicate decisions **in the current browser state**, but it does not yet create a durable multi-user workflow. The final execution is restricted to an authorised manager role. An authenticated manager identity is recorded in existing audit logs, while unverified self-entered reviewer names must not be treated as signed electronic approval.

## Clinical and safety rules

- A hospital discharge letter may be historical. Changes to medicines must go to medication reconciliation, not live MAR.
- No staff MAR for self-administering medication. Prompting must not be misreported as administration. PRN and staff administration need fully verified instructions and explicit clinical approval.
- Historical incidents and body map observations must retain the original dates and cannot be entered as new events.
- No fabricated patient identity, capacity, next-of-kin legal authority, treatment, medication, risk rating, care-worker assignment or prior visit.
- Clinical risk drafts must remain non-active. A human authorised reviewer confirms assessments and moving/handling instructions. Do not interpret resuscitation documentation automatically.
- Every visit row must read all continued pages, count weekday checkmarks, convert decimal hours to minutes, and separate informal family care from funded agency care.
- All records and source files must obey organisation and service-user scope, access restrictions and audit policy.
- If no appropriate CRM field exists, record a mapping exception rather than putting data in Overview or arbitrary notes.

## Outstanding engineering work before live rollout

1. Secure PDF extraction and page provenance embedded in the CRM.
2. Persisted coordinator-review / manager-approval queue with true field- and section-level approve/reject/return, independent roles and auditable versions.
3. A configurable care-policy mapping engine, automated existing-record comparison and conflict resolution (current protection is limited to new-user duplicate checks and manifest review rows).
4. Draft clinical treatment and medication support models with proper clinical signoff; desktop/mobile/print MAR parity.
5. Historical incident/body map ingestion proposals without falsely creating current incidents.
6. Full document taxonomy, document extraction state and linked fact provenance.
7. Carer preferences, structured individual task descriptions and safety/readiness checks during actual staff allocation.
8. All-or-nothing or resumable, idempotent import execution to avoid partial creation/duplicate retries.
9. Automated staging E2E tests for all 22 acceptance cases in the supplied addendum, plus access-control, malicious file, clinical-fact and multi-tenant tests.

## Initial test coverage

`tests/unit/coordinator-field-review.test.ts` covers source-field approval, value mismatch, missing reviews, low confidence, wrong destinations, duplicates and review-only historical findings. These tests are **committed but not yet executed/verified**.

Before merging, execute `npm ci`, `npx prisma validate`, `npm run typecheck`, `npm test -- --run tests/unit/coordinator-field-review.test.ts`, all repository tests and Playwright against fictional staged data only.
