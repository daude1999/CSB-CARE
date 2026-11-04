---
description: Review supplied care support plan, hospital letters and related records; map all content to CSB Care and prepare complete service-user and rota setup for human approval. Does not touch production data.
argument-hint: "[paths to support plan and related documents] [optional example end date]"
---
# Complete Service User Setup — review-first workflow

You are operating in CSB-CARE. Use the **care-coordinator** and **care-compliance-reviewer** project agents where available. Inputs: $ARGUMENTS.

**Default: REVIEW ONLY. Do not upload files, create service users, create active risk records, change medication, schedule visits, assign carers, publish rotas, or modify the database. Never commit real care documents or extracted personal data to Git.**

1. Verify inputs exist and can be read in full. For scanned PDFs, use a secure local extraction/visual review workflow; mark unreadable facts BLOCKED, never guess.
2. Read current repository data models and screens, particularly `src/server/care/{service-users,care-plans,risks,su-documents,packages,medication}.ts`, `src/server/rota/{templates,visits,build}.ts`, and related user profile UI.
3. Prepare a confidential, local-only **source→destination mapping** for:
   - identity/communication/access details;
   - family, next of kin, contacts, GP and informal carers;
   - Council Support Plan under Council Documents;
   - restricted hospital/GP/discharge correspondence under Other Documents;
   - care plan's nine standard sections;
   - distinct risk assessment drafts and required clinical reviews;
   - medication reconciliation (no active MAR changes);
   - funding/package and individual care tasks;
   - recurrence templates and future visit creation.
4. Parse all timetable rows and continuation pages. Convert decimal hours to minutes; record day flags, start/end, carers required, detailed visit tasks, agency/family classification. Cross-check total minutes with funded hours. Treat any user-specified end date as a **scenario override**, not as a statement in the original source.
5. Produce a report with:
   A. Existing target screen/model/function and exact field names;
   B. Value/evidence/page/date and verification status;
   C. Draft risk items including controls only where sourced, plus questions for clinical staff;
   D. Proposed rota templates and weekly totals;
   E. Duplicate/conflicting/obsolete facts and missing authorisations;
   F. Required code enhancements and QA tests;
   G. An explicit **approval queue**, with no false claims of completion.
6. Ask the independent care-compliance-reviewer to check the proposed report for missed records, clinical assumptions and unsafe scheduling. Fix issues and disclose remaining limitations.
7. With operator approval, implement *code changes only* on a dedicated feature branch, using synthetic fixtures and tests. Actual record entry requires separate authorised action and live integration.

Use `docs/implementation/CARE_COORDINATOR_AGENT.md` for the repository-specific integration contract.
