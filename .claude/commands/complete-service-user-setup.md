---
description: Extract support plans and hospital records, review every destination, then use the built-in Care Coordinator import screen to create approved draft records and recurring rotas.
argument-hint: "[local support plan PDF] [local discharge PDF] [approved scenario end date]"
---
# Complete Service User Setup — inspect, verify, execute

You are running inside CSB-CARE on `feature/ai-care-coordinator`. Use the `care-coordinator` and `care-compliance-reviewer` project agents. Read `docs/implementation/CARE_COORDINATOR_AGENT.md`. Inputs: $ARGUMENTS.

**This command can prepare a real CRM import, but does not by itself have permission to bypass authentication, human approval, clinical sign-off or rota publication.**

## Step 1: Read and map the source
Read every page of the support plan and discharge letter in a secure local session, including continuation tables. Do not copy any personal medical data into a commit, tracked file, PR or log. Preserve exact source/page and dates; flag illegible data. Identify existing service user matches before attempting creation.

Locate the CRM service user, contacts, care plans, risk, package, document categories, medication and visit template code. Describe how each fact maps to the existing destination. Keep medication and resuscitation information out of routine plain-text notes where a restricted review record is needed.

## Step 2: Prepare a typed import manifest locally
Read `src/server/care/coordinator-import.ts` for the **actual** intakeSchema. Build a JSON manifest matching that schema only. Do not invent fields. Locate valid areaId and callTypeId via the authorised CRM UI; these are existing per-organisation record IDs, never made-up strings.

- `serviceUser`: first/last name, verified contact/address/language and area ID.
- `contacts`: true relationship/emergency details only, do not assume consent to updates.
- `carePlan`: write all nine PLAN_SECTIONS. Use sourced facts and identify missing clinical details clearly. Set future reviewDue for staff confirmation.
- `package`: official commissioning dates and hours; a user-directed example extension should be labelled as an override, not a historical council authorisation.
- `visits`: agency-funded visits only. Parse all weekdays, 24h times (startMinute since midnight), decimal duration * 60, carersRequired, detailed continued task text, valid callTypeId, and medicationRequired only where clinically appropriate.
- `clinicalReviewNotes` and `riskReviewNotes`: explicitly list missing checks. These remain review reminders, **not** active care instructions.
- `draftWeekStart`: optional future Monday (staging only; the initial intake creates templates, not visits).

Do not automatically set a commissioned total that contradicts the sourced visit pattern. Flag the inconsistency for review.

## Step 3: Independent QA + review
Have care-compliance-reviewer compare every proposed field against the source documents, paying special attention to approved vs informal care, resuscitation documents, medicines, transfers and risk controls. Show the human operator the exact proposed records and unresolved items; **request approval before writing**.

## Step 4: Execute through authenticated CRM
When explicitly approved, open `/rota/service-users/import` in the correct CRM organisation, using browser automation only if available and with an authenticated authorised session. Supply the locally prepared JSON manifest and upload original PDFs using secure file inputs. First click **Validate without saving**. If validation fails, resolve conflicts; do not bypass it.

After explicit creation approval, click **Create approved draft records**. Capture the returned serviceUserId and verify in the CRM: profile, contacts, council/other documents, care-plan DRAFT, package and recurring templates. Check every source destination; report failures and avoid blind resubmission (partial saves require inspection).

## Step 5: Clinical approvals and rota
A separate qualified human reviewer must complete medication reconciliation and risk assessment; a different authorised care-plan approver must approve the plan. The intake deliberately cannot create ACTIVE risk records or change MAR.

After these steps are completed, a manager may use `/rota/service-users/import/finalize?id=<serviceUserId>` to create **unpublished** visits for one selected future week. Verify daily rota, staffing requirements, unassigned slots and conflicts. Actual carer assignment and publication are separate human-approved actions.

## Required output
- Source-to-destination inventory (all documents/pages)
- Proposed manifest validation and exceptions
- Executed items with CRM record IDs / verified existence
- Unexecuted items (risk/medication/approvals/roster)
- Rota completeness and reconciliation report
- Human sign-off record (do not pretend AI is a licensed clinician or the approving manager)

Never deploy, publish rota, notify carers, fabricate data, or access another tenant's records without authorisation.
