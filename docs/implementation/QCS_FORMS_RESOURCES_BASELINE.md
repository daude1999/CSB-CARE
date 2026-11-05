# Evantix Care — QCS-informed Forms & Resources implementation baseline

**Source:** owner-provided *QCS Policy & Procedure Audit and Evantix Care Build Specification* (5 November 2026), checked against `main` source before this branch.
**Scope of first PR:** original CSB resource discovery using the **existing Policy model** and approved Policy Library styling. No database migration, content duplication or production deployment.

## Evidence and limits

- The QCS account showed nine policy areas, sectioned policy/procedure records, a separate Resource Centre, policy/resource monthly updates, reading lists, a review sheet and an optional Resources panel.
- QCS trial access **blocked the full text and fields of representative forms**, so QCS digital completion, signature, submit/review/approve and saved-record storage were **not verified**. Do not represent these as copied or verified QCS capabilities.
- One QCS policy (AB41) was deeply inspected; full catalogue coverage was not established.
- Evantix already has document versioning, publication, staff acknowledgement, audits, corrective actions, evidence and a continuous Policy Reader. Do not rebuild or re-style those components.
- `prisma/seed-data/library/forms.ts` contains **20 original CSB forms** and **9 original CSB templates**. Form/template content is original CSB seed material, **not copied QCS text**, and is not itself evidence of clinical/legal approval.
- Seed `policies` metadata expresses intended associations, but runtime reader links are still inferred from `related` section text, not a normalized procedure-step relation.
- Existing care operations (e.g. body maps, incidents, care plans, medication records and evidence) may already implement more suitable domain-specific data capture. Any future generic form engine must link to them instead of creating duplicate person or incident records.

## Source-form inventory

| Reference | Original CSB resource | Category | Related policy refs from source seed | Current status |
|---|---|---|---|---|
| `CSB-FRM-001` | Safeguarding Concern Record | SAFEGUARDING | `CSB-SAF-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-002` | Body Map | SAFEGUARDING | `CSB-SAF-001`, `CSB-INC-001`, `CSB-CLN-002` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-003` | Incident and Accident Report | INCIDENTS | `CSB-INC-001`, `CSB-INC-002`, `CSB-DOC-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-004` | Mental Capacity Assessment Record | CONSENT | `CSB-MCA-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-005` | Best Interests Decision Record | CONSENT | `CSB-MCA-001`, `CSB-MCA-004` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-006` | Complaint Record | COMPLAINTS | `CSB-COM-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-007` | Medication Error Report | MEDICINES | `CSB-MED-001`, `CSB-INC-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-008` | PRN Protocol | MEDICINES | `CSB-MED-004` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-009` | Controlled Drugs Register Check | MEDICINES | `CSB-MED-003` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-010` | Supervision Record | TRAINING | `CSB-TRN-002` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-011` | Return to Work Interview | WORKFORCE | `CSB-WF-004`, `CSB-IPC-004` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-012` | Data Breach Report | DATA_PROTECTION | `CSB-DP-002` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-013` | Subject Access Request Log | DATA_PROTECTION | `CSB-DP-003` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-014` | Missing Person Profile | SAFEGUARDING | `CSB-SAF-004` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-015` | Fluid and Food Intake Chart | FOOD | `CSB-FOOD-001` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-016` | Repositioning Chart | CLINICAL | `CSB-CLN-002` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-017` | Post-Fall Observation Record | CLINICAL | `CSB-CLN-001`, `CSB-CLN-003` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-018` | Hospital Transfer Information | CARE | `CSB-CP-006` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-019` | Key Holding Agreement | HOME_CARE | `CSB-HC-002` | Existing document resource; digital lifecycle not verified |
| `CSB-FRM-020` | Staff Disclosure and Declaration of Interests | RECRUITMENT | `CSB-REC-001`, `CSB-WF-001`, `CSB-WF-010` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-001` | Person-Centred Care Plan | CARE | `CSB-CP-001`, `CSB-CP-003` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-002` | Pre-Admission and Initial Assessment | CARE | `CSB-CP-002`, `CSB-CP-001` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-003` | Positive Behaviour Support Plan | LEARNING_DISABILITY | `CSB-SAF-003`, `CSB-LDA-001`, `CSB-LDA-002`, `CSB-DEM-002` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-004` | Advance Care Plan | END_OF_LIFE | `CSB-MCA-003`, `CSB-EOL-001` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-005` | Statement of Purpose | GOVERNANCE | `CSB-GOV-005` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-006` | Business Continuity Plan | GOVERNANCE | `CSB-GOV-003` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-007` | Personal Emergency Evacuation Plan (PEEP) | HEALTH_SAFETY | `CSB-HS-003` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-008` | Duty of Candour Letter | CANDOUR | `CSB-DOC-001` | Existing document resource; digital lifecycle not verified |
| `CSB-TPL-009` | Health Action Plan and Hospital Passport | LEARNING_DISABILITY | `CSB-LDA-004`, `CSB-CP-006` | Existing document resource; digital lifecycle not verified |

**Classification:** all above are *existing resource documents*. Do **not** describe them as digitally fillable or as having saved submission records merely because they render or download. Workflow ownership, review requirements and which forms should be digitised require a separate mapping and owner/compliance decision.

## What this PR adds

- A **Forms & Resources** tab inside the existing Policy Library workspace at `/policies/forms`.
- Search by reference/title/description, filter by resource type and category, with URL-persisted filters and pagination.
- Source/version/approval labelling: master CSB starter documents are explicitly **not approved by the organisation**; a customer document is approved only where an approval exists.
- Existing authorised reader and PDF endpoints are reused, subject to their original server-side policy access checks.
- Resources are loaded under the existing tenant policy visibility boundary. Only active resources with a published version are listed.
- Existing Overview, Policy Reader, dashboards, content and service-user workflows are unchanged.

**This is a functioning discoverability increment, not a complete digital Forms engine.** No fabricated form fields, signatures or completed records have been introduced.

## Subsequent PR acceptance contract (not yet implemented)

1. **Explicit links:** introduce an additive normalized relation for policy version/section/step to form/resource, with optional use-when, required/optional, branch scope, order and audit history. Backfill confirmed original-CSB links, retain the current text-reference fallback, prevent cross-tenant links and never silently link an ambiguous reference.
2. **Definition and version:** separate reusable `FormDefinition` and immutable approved `FormVersion` from a downloaded document; schema fields validated with fixed types, reviewed content and separation of duties.
3. **Completed records:** immutable version pin and answers, draft/save/submit/return/review/approve/void events, typed subject links (service user, staff, incident, audit, evidence), authorised export and explicit correction history. Pilot only 2–3 vetted forms after mapping existing domain workflows.
4. **Procedure contextual links:** retain the continuous reader and sticky strip; add relevant “Use this form” callouts at the exact documented step, with direct links to current domain workflows where they exist.
5. **Compliance integration:** outstanding forms/reviews into existing queues, regulatory reference validity, permission-safe exports and deterministic section/form search; no paid AI key needed.
6. **Quality gates:** migration tests, role/branch/tenant isolation, source and version locks, security and accessibility, Playwright at 1440/834/390 widths, clinical sign-off as applicable.

## Checks and release boundaries

- New register must be verified against real **fictional test** database records; avoid real staff/service-user data.
- `npm run typecheck`, `npm run lint`, relevant unit/integration tests and `npm run build` must pass. CI is evidence only when a run is actually reported.
- Never merge automatically into `main`; `main` triggers Vercel and database migrations/seeds.
- **No QCS copyrighted content, page assets or form text is imported.**
