# AI Care Coordinator

Branch `feature/ai-care-coordinator`, draft PR. Not merged and not deployed. All test data is invented ("Ada Fictional"); no real document content is in the repository.

## What it does

A coordinator uploads a referral's documents (support plan, hospital letters, GP letters and so on). The Coordinator reads every page, keeps each fact with the page and the exact words it came from, and proposes where each fact goes in the existing Service User profile. A coordinator checks every fact, a manager approves each profile section, and only then is anything saved into the profile. After the care plan and risk drafts are approved by a different person, a manager creates an unpublished draft rota through the existing Build Rota engine and sees suggested carers. A separate shift check reviews tomorrow's rota.

Screens (Rostering → Service Users → **Care Coordinator** tab):

| Address | Purpose |
| --- | --- |
| `/rota/coordinator` | Intakes (open, waiting for manager, completed, cancelled) and the start form with upload |
| `/rota/coordinator/[id]` | One intake in five steps: 1 Documents, 2 Check facts, 3 Manager approval, 4 Save to record, 5 Rota and carers, plus History |
| `/rota/coordinator/shift` | Whole-shift check for a day (tomorrow by default), printable handover |
| `/rota/risks/[id]` | Now also shows "Check and approve this draft" for AI-drafted risk assessments |
| `/rota/settings` | "Care Coordinator document reading (AI)" switch, off by default |
| `/api/care-coordinator/documents/[id]` | The original file, after a permission check; every opening is audited |

The old JSON-manifest import and its pages (`/rota/service-users/import/{reviews,risks,finalize}`) are removed. "Set up from support plan" (PR #74) is untouched and stays as the quick path.

## Flow and rules

1. **Upload.** Up to 12 files, 4 MB each, 11 MB per request. Originals are stored unchanged in private storage with a SHA-256 fingerprint (the database refuses changes to the storage key, fingerprint, size and filename). Each document is classified (support plan, discharge letter, GP letter...) from its letterhead and filed to Council Documents or Other Documents; NHS and GP documents are restricted automatically.
2. **Reading.** With the organisation's AI switch off (default) or no AI provider, documents are read on CSB's own server: labelled lines and timetable rows only, including tables continued on the next page and wrapped lines. Key safe codes are never copied; they are flagged. With the switch on and a real provider, the PDF goes to the provider, the answer must match a strict schema, and every quote is checked against the page text: a quote not found is marked "Check original". The AI never approves anything and never fills in missing information.
3. **Facts.** Each fact has a profile section, an exact destination (for example `ServiceUser.postcode`, `CarePlanSection "Mobility" (draft)`, `VisitTemplate + care tasks`), source document and page, quote, whether it is current or historical, and a comparison with other documents and the existing record (conflicts, duplicates, older documents). The reading itself is immutable in the database; the coordinator's value is kept beside it.
4. **Coordinator check.** Approve, edit (plain labelled fields per destination, never JSON), reject (reason required), ask a question and assign someone (they get a notification), mark as duplicate, undo, add a fact by hand, open the original at the page. "Approve checked facts" approves only facts whose words were found and that have no warning. A risk cannot be approved without a level (labelled provisional); a historical fact cannot be approved into personal details, the package or visits. Decisions save immediately with optimistic locking.
5. **Restricted information.** Medication, incident history, skin findings, date of birth, NHS number and anything from a restricted document are hidden from coordinators (shown as "Restricted") and decided by a manager with sensitive-records permission.
6. **Manager approval, per section.** Only a care manager or administrator. Not the person who sent the intake, and not anyone who decided or edited a fact in that section. Approve, return for correction, ask for information or reject (reason required). Returned sections reopen for the coordinator only; approved sections stay approved.
7. **Save to record.** In order: personal details, contacts, carer preferences, package, care plan, risks, medication, incident history, body map, visits. Each section is claimed under a lock, saved through the existing services, read back and marked; a failure is recorded with its message and can be retried; saved facts are never saved twice. New people start at Assessment.
   - Care plan: a DRAFT version through the existing care plan service; sections the documents do not cover say "Not documented, needs assessment".
   - Risks: DRAFT assessments, not visible to carers, review in 14 days unless the document says otherwise.
   - Medication: a discharge letter never overwrites current medication. Everything goes to a restricted reconciliation list; a DRAFT medicine is prepared only if medication records are switched on, the person may manage medication, and the item is current with a dose and times. A second person still approves it.
   - Incident history and skin findings: review items marked as history. No incident or body map observation is created.
   - Visits: only council-commissioned rows become repeating visit templates; family or informal rows become a "not scheduled" follow-up. Weekly minutes are checked against the authorised package and differences are flagged, never adjusted.
   - The originals are filed in the person's documents once they exist.
8. **Rota.** Gates: person on record, package saved, visits saved, care plan approved by a different person, no risk drafts waiting and at least one active assessment. A manager makes care Active, previews the weeks and creates them through Build Rota (same week locks, duplicate checks, absences and eligibility). Visits are always created **unpublished**; carers see nothing until the office publishes. Suggested carers come from the eligibility service, three per open place, carers who already visit first among equals. Suggestions only; assignment stays on the Daily Rota.
9. **Shift check.** For a chosen day: open places with suggestions, double bookings and tight travel, booked carers the rules now question (training, DBS, right to work, absence, availability, restrictions), approvals that block care, and a handover where every line is labelled Fact or Recommendation. It changes nothing.

Every step is in the intake history with the signed-in person's name, and in the audit log.

## Data model (migration `20261104130000_care_coordinator_intake`, additive)

`CareIntake`, `CareIntakeDocument`, `CareIntakeFact`, `CareIntakeSection`; `CareIntakeReviewItem` gains `intakeId`, `factId` (unique), `restricted`, `assignedToId`; `RotaSettings` gains the AI switch columns. Two triggers protect the reading and the stored originals. Superseded the branch's earlier `care_intake_review_queue` migration (never deployed).

## Code

- `src/lib/care-coordinator-rules.ts`: sections, destinations and their schemas, the basic reader, classification, quote checking, hours check.
- `src/lib/care-coordinator-forms.ts`: the plain edit form for each destination.
- `src/server/care/coordinator/`: `intake.ts` (documents, facts, decisions, submission, section approval, follow-ups, AI switch), `reader.ts`, `apply.ts` (saving), `rota.ts`, `shift.ts`.
- `src/app/coordinator-actions.ts`, `src/components/coordinator/*`, pages under `src/app/(app)/rota/coordinator/`.

## Limitations

- The basic reader only understands typed, labelled documents. Scanned pages need the AI switch or facts added by hand.
- Turning AI reading on sends whole documents, including health details, to the AI provider. Keep it off for real records until the data protection review is done; on Vercel it also needs `AI_PROVIDER` and a key.
- The demo has one care manager (Mohamed Mire). Separation of duties means a second manager login is needed to approve sections, care plans and risk drafts.
- Follow-ups (medication reconciliation and the rest) are listed on the intake, not yet in a separate queue across all people.
- Carer suggestions are not assigned automatically, by design.

## Test it on staging

1. Sign in as `coordinator@care-solution.demo`. Rostering → Service Users → Care Coordinator. Start an intake with an invented support plan (a PDF like `tests/support/coordinator-fixture.ts` produces).
2. Check facts section by section, edit one, reject one, ask a question, then Send for approval.
3. Sign in as a manager who did not decide those facts and approve each section; a manager who did will be refused.
4. Save to record; open the new person's profile and check each section.
5. Approve the care plan and risk drafts as a different manager, make care Active, preview and create the rota. Check the visits are unpublished.
6. Open the shift check for tomorrow.
