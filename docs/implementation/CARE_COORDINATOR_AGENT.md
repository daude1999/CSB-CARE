# CSB Care — AI Care Coordinator import (feature branch, 4 November 2026)

**Branch:** `feature/ai-care-coordinator`. **Production:** unchanged. **Current state:** implementation code added, NOT end-to-end tested, NOT deployed. This document is a technical handover, not confirmation of clinical safety.

## Purpose
Transform an operator-reviewed support plan and related confidential documents into real CSB Care records through authenticated, existing domain services. The agent may extract data and operate the authenticated import UI when the authorised operator approves; it may not impersonate staff, make clinical decisions or silently publish visits.

## Entry points
- Claude Code project command: `/complete-service-user-setup`, in `.claude/commands/complete-service-user-setup.md`.
- Project agents: `care-coordinator` and `care-compliance-reviewer`.
- Service Users → **Care Coordinator Import**: `/rota/service-users/import`.
- Confidential clinical/risk follow-ups: `/rota/service-users/import/reviews?id=<serviceUserId>`.
- Non-active AI risk proposals: `/rota/service-users/import/risks?id=<serviceUserId>`.
- After independently approved care plan and appropriate risk assessments, manager's unpublished week: `/rota/service-users/import/finalize?id=<serviceUserId>`.

## Implemented record creation (subject to testing)
1. Read and schema-validate a bounded JSON manifest with consent-aware contacts, personal details, dates, nine care-plan sections, a care package and recurring agency visit templates. Validates existing area/call type/task IDs, duplicate proposed visits, total weekly duration, risk review dates, basic identity duplicates and permissions.
2. Authenticated explicit human approval of record creation, not an unattended LLM write. Reuses `createServiceUser`, `addContact`, `startDraft`, `saveDraft`, `createPackage` and `createTemplate`.
3. Optional PDF uploads: Council Support Plan to Council Documents and Hospital Discharge Letter to restricted Other Documents, via existing private document storage. Total attachments capped below the platform's request size; no public media URLs.
4. Risk proposals stored as **DRAFT**, excluded from active risk registers. `RiskAssessment` and its version enum now support DRAFT through additive Prisma migration.
5. Clinical and risk reconciliation questions are stored in a restricted `CareIntakeReviewItem` table, with separate migration. No automatic medication entries or DNACPR interpretation.
6. Existing general care-task IDs may attach to templates; person-specific instructions remain in visit notes.
7. After independent approval, a manager may explicitly activate the service user and generate **one week of unpublished, unassigned visit records**. It checks duplicates and attaches existing template tasks, never publishes automatically.

## Not yet implemented or confirmed
- Automated PDF-to-JSON extraction inside the CRM itself. Claude Code may prepare the manifest locally; inputs still require secure file transfer, operator review and browser tool access.
- Safe idempotent all-or-nothing import orchestration. Domain functions use separate transactions; partial failure must be reconciled using the returned serviceUserId. Never blindly retry.
- Full professional risk approval through the AI flow: the draft queue is read-only until a reviewed/validated manager workflow is enabled. Existing manual risk creation remains available.
- Medication reconciliation or active MAR creation: competent clinical review and independent approval required.
- Service-user-specific, verified carer assignment; availability, skills, travel and role restrictions require separate checking.
- Batch generation of the entire care-package date range; current controlled build handles one week. Recurring templates remain effective through their end date.
- Full source-page provenance fields and automatic conflict-detection across multiple dated clinical records.
- Tested browser execution, Prisma migration validation, TypeScript compilation, isolated database integration tests and accessibility/security regression tests.

## Safety
- Source PDFs and data are not stored in source control. Keep them in authenticated, tenant-scoped private storage.
- Do not use a historical discharge medication list as the active medication record.
- AI-created care plans remain DRAFT; an independent authorised manager must approve them.
- AI risk drafts are never ACTIVE by default. No false clinical sign-offs.
- The operator must verify commissioning, paid versus informal visits, carer counts, times and risks.
- Do not run on real patient records until migrations and end-to-end tests pass in staging.
- The first example uses **30 December 2026 as an operator-specified scenario end date**; the original source date remains unchanged.
- Once an import partially succeeds, reconcile manually rather than resubmitting a duplicate.

## Safe test sequence for Claude Code
1. Check out branch, never merge to main automatically.
2. Run `npm ci`, `npx prisma generate`, `npm run typecheck`, `npm run lint`, and existing test suite in the project's usual secure development environment.
3. Run Prisma migrations on **disposable staging database only**. Never on live production without a reviewed deployment plan.
4. Use entirely fictional documents and staff/service-user identities in Playwright tests. Verify profile, contacts, private documents, care draft, risk drafts, follow-ups, package, templates and unpublished visits.
5. Verify role-scoped access, second-person approval, duplicate prevention, partial failure and no visible confidential material outside authorised roles.
6. After independent QA and clinical governance review, obtain explicit operator sign-off before creating any live records.

## Known issue tracker
- Risk approval server action is not included in this branch. The draft review screen intentionally does not approve proposals.
- The import may partially create data if downstream validation fails. The UI returns a record ID where possible; a robust persistent import job/idempotency key is needed before production.
- Full automation of medical-document interpretation requires a human verification queue and source-by-page evidence.
