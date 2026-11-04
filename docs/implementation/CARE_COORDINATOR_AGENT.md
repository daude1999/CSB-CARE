# AI Care Coordinator — Integration contract (feature branch, not deployed)

## Objective
Make Claude Code's project-local `care-coordinator` agent work against the **existing** CSB Care service-user records and rostering domain, with rigorous review before any live record creation. A separate `care-compliance-reviewer` validates fidelity and safety. This is a *development scaffold*, not an autonomous operational integration.

## Project-native command
`/complete-service-user-setup <support-plan-path> <discharge-letter-path> [scenario end date]`

The command must first output a confidential local review, including exact field mapping and human approval queue. It is not a magic import endpoint and cannot write to production.

## Source-to-destination mapping
| Source | Existing destination | Implementation |
| --- | --- | --- |
| Identity, address, language, communication | Service User → Personal details | `src/server/care/service-users.ts` |
| Emergency/next-of-kin/GP/family | Service User → Contacts & carers | `src/server/care/service-users.ts` |
| Council support plan | Documents → Council → `COUNCIL_SUPPORT_PLAN` | `src/server/care/su-documents.ts` |
| Hospital discharge letter | Documents → Other → `DISCHARGE_INFORMATION` (sensitive) | `src/server/care/su-documents.ts` |
| Clinical correspondence | Documents → Other → `MEDICAL_LETTER` or `GP_CORRESPONDENCE` (sensitive) | same |
| Person-centred support | Care Plans: `about_me`, `communication`, `personal_care`, `mobility`, `nutrition`, `medication`, `health`, `home`, `outcomes` | `src/server/care/care-plans.ts` |
| Risk assessment | Care → Risk Assessments | `src/server/care/risks.ts`; WARNING: `createRisk` makes record ACTIVE, so AI draft approval workflow required first |
| Current medications / MAR | Care → Medication | `src/server/care/medication.ts`; clinical reconciliation and second approval required |
| Council-authorised package | Care → Package | `src/server/care/packages.ts` |
| Recurring visits and care task lists | Rota → Templates, Care Tasks | `src/server/rota/templates.ts`, `src/server/rota/reference.ts` |
| Actual rota and carer allocation | Rota → Build, Visits, Assign | `src/server/rota/build.ts`, `src/server/rota/visits.ts`, `src/server/rota/assign.ts` |

## Dependencies and blockers
1. **Not built**: secure ingestion service to parse uploaded PDFs and emit a typed, source-page-provenanced extraction with processing status and confidence.
2. **Not built**: tenant-scoped import preview and confirmation workflow; clear opt-in scope for each field/document/action.
3. **Not built**: draft risk assessments, independent sign-off and policy for clinically generated risk text. Existing createRisk directly activates the record.
4. **Not built**: medication reconciliation tasks and support for verifying historical discharge changes against current prescriber information, without altering MAR.
5. **Not built**: idempotent execution API with per-operation approval, durable audit trail, duplicate prevention, retry handling and post-write readback.
6. **Not built**: end-to-end staging tests covering document categories, nine care-plan sections, risk review, authorised package totals, recurring templates, assignment and rota validation.
7. **Not built**: safe privacy-preserving extraction runtime; no care records in repository or git history.
8. **Existing limit**: document upload max 4 MiB; large source PDFs need an approved secure ingestion path or safe size-aware handling.

## Security and operations
- Keep real support plans and hospital letters OUT of GitHub, PRs, test fixtures and tracked files. Use approved private storage with role-based access.
- Require `serviceUser.sensitive` for restricted medical documents and appropriate organisation/area scoping everywhere.
- No self-approval, impersonation, direct SQL writes, bypassing domain validation or unattended production deployment.
- Never make a change to a prescription/MAR or resuscitation plan on the basis of an old discharge letter alone.
- Human confirmation of clinically material content, consent, contact preferences, staffing/handling controls and rota publication.
- Audit extraction sources, operator approvals, actions and verification; mask identifiers in diagnostic logs.

## Proposed milestone order
**M1** Project agent + source-to-field mapping + independent review (this branch).
**M2** Synthetic-document extraction + structured preview and provenance.
**M3** Safe read-only comparison to existing tenant-scoped records, dedupe and conflict resolution.
**M4** Approved draft care plan and draft risk workflows, document categorisation, clinical-review tasks.
**M5** Approved package/task/template preparation, roster preview and conflict detection.
**M6** Authorised write orchestration, post-save readback, Playwright/Vitest coverage and compliance review.

## Acceptance criteria for M1
- Claude Code detects the project agents when branch checked out.
- `/complete-service-user-setup` runs in review mode, maps to existing sections and identifies all page-spanning timetable records.
- No customer records committed or mutated.
- A care-compliance review is produced with missing/conflicting data and human approval gates.
