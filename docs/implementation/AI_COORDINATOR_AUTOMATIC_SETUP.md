# Autonomous AI Care Coordinator: automatic setup (Phases 2–6)

Owner's brief of 7 Nov 2026, "CSB CARE – AUTONOMOUS AI CARE COORDINATOR". Phase 1 (one coordinator confirms, no
separate manager approval) is PR #117, merged. This change builds on it and does not replace the Care Coordinator:
it reuses the same intake, fact, section and review-item models and the same section savers (`apply.ts`).

## What changed for the coordinator

1. **Upload Support Plan → Upload and process.** The document is read in the background (as before). When reading
   finishes, CSB AI now carries on by itself and sets up the person. Nobody approves facts one by one.
2. **Setup summary** (`/rota/coordinator/<id>?step=setup`, the default step). It shows what was created, with links to
   the profile, care package, care plan, draft rota, exceptions and history. The fact list is now **Source facts**, a
   read-only reference (see "No routine approval" below). Old links (`?step=review`, `?step=save`, `?step=approval`)
   redirect.
3. **Care Coordinator dashboard queues:** Needs attention, Processing, Ready, Failed, History. The columns are intake,
   service user, document, status, records, open exceptions and started/finished.
4. **New profile tab "Audit & Exceptions"** (service user profile, before History). It shows the AI setup summary, the
   exceptions (filter by status and severity), corrections made since setup (the saved value against the value on the
   record now, plus who changed it), every item CSB AI saved with its source page and who or what decided it, and the
   audit history.

## Root cause of the old behaviour

The read job stopped at "Records prepared": every fact waited for a person, so a 70–100 fact plan needed 70–100 clicks.
Repeats (the same contact three times) and routine details were raised as if they were conflicts. There was no
severity, so a safeguarding concern looked the same as a preferred language.

## How CSB AI sorts each fact (`src/lib/coordinator-triage.ts`, pure and unit tested)

| Outcome | Examples | What happens |
|---|---|---|
| Routine | name, language, a care need, a contact, a visit row | Saved automatically (`decisionSource = AUTOMATION`) |
| Repeat | the same contact on three pages, phone written two ways | Kept once as `DUPLICATE`, both sources linked, nothing raised |
| Not used | an older document's value when a newer dated one exists; history | Kept for reference, not written to the current record |
| Follow-up (non-blocking) | temporary visit without an end date, unclear Frameworki number, words not found on the page | Set up where safe; a follow-up is raised |
| Review (material) | two different dates of birth, undated disagreement, hours that don't match the timetable, changes to care already arranged | Waits; one review item per disagreement |
| Urgent (safety) | a current safeguarding concern | Raised at once; managers get an in-app notification (nothing is sent outside) |

DNACPR is always "Review": no DNACPR status is recorded from a document. Medication only ever goes to restricted
reconciliation and never becomes a medication record. Incidents and skin findings stay restricted.

## Identity is never guessed

* Two different dates of birth (or names / NHS numbers): nobody is created. The setup summary shows both values with
  their sources and a person chooses one.
* Someone with the same name and date of birth or postcode already exists: nobody is created. The page offers "Open
  existing record" or "Confirm a new person". Nothing is ever merged automatically.
* A date of birth or NHS number a coordinator may not save (registered managers only) is **not** marked saved. It
  becomes a follow-up for a registered manager. Previously the fact was marked saved although the value had been
  dropped; that bug is fixed for the manual route too.

## Provenance

* Every decision CSB AI takes has `decisionSource = AUTOMATION`, and `decidedById` is the person who started it.
* Every audit entry written while CSB AI works (reading, setup and the section savers) carries
  `data.automation = { by: "CSB AI", initiatedById, run }` through an AsyncLocalStorage marker in `audit()`
  (`src/server/audit-log.ts`). Screens show "CSB AI (started by <name>)", never the person's own review.
* Older automatic acceptances ("Accepted for drafting by the AI CSB Coordinator…") are back-filled as AUTOMATION.

## Pipeline (`src/server/care/coordinator/auto-setup.ts`)

Stages are TRIAGE → IDENTITY → RECORDS → ROTA → EXCEPTIONS → VERIFIED, and `setupStatus` is PROCESSING / READY /
NEEDS_ATTENTION / FAILED.

* **Resumable and idempotent:** each stage touches only what is not done yet (facts already applied are skipped, review
  items are raised once per fact or per title and source). Running it again creates nothing twice.
* **One run at a time:** a 5-minute claim. A run cut off longer ago is taken over.
* **Partial failure:** a section that fails is reported, becomes a "Setup problem" exception, and the rest is kept.
  "Run setup again" finishes it.
* **Read-back verification:** contacts, package, plan, risks, templates, call notes and references are counted from the
  database. Any accepted fact not found on the record is reported as a failure.
* **Never:** approves a care plan or risk, activates care, publishes visits, notifies carers or sends anything outside.
  The rota is a proposed, unpublished draft.
* **Intakes from before this change** (CI-0004/5/6 on the live site) are not touched automatically. Their page offers
  "Run automatic setup". It keeps every decision people already made (a rejected fact stays rejected).

Intake modes: **NEW** sets up a new person. **EXISTING** (revised plan) applies routine details and proposes package
and visit changes as review items without saving them. **DOCUMENT** (supporting document) files the document and raises
only safety items.

## No routine approval (owner's brief "Remove redundant approval workflows", 7 Nov 2026)

* **Removed from the upload journey:** Approve buttons, "Approve checked facts", "Approved by" badges, "Waiting for
  approval", the Confirm & Set Up step, "N/159 still to check" counters, and saving section by section. The server
  actions behind them (`decideFactAction`, `approveVerifiedAction`, `confirmAndSetUpAction`, `applySectionAction`,
  `addManualFactAction`, `acceptRoutineChangesAction`, `fileIntakeDocumentsAction`) are gone. Facts and their provenance
  are kept, and are shown read-only under **Source facts** with what CSB AI did with each one.
* **Workflow:** Upload → CSB AI processing → CRM populated → Profile → edit later on each record's own tab. A failed
  section keeps the sections already saved. If the name cannot be read, a short form on the setup summary asks for it
  and setup carries on.
* **Care plans:** an authorised council plan is imported and put **in use** straight away (`putPlanInUse`,
  `origin = DOCUMENT`, `sourceIntakeId`, `sourceNote` with the intake reference and pages). No approver is recorded,
  because nobody approved it inside CSB; the audit action is `careplan.imported`. CSB AI's questions are written as
  "(CSB AI's question, not a council instruction)". Later edits are new versions (the old one is superseded, never
  rewritten) by anyone with `care.plan.edit`, using **Save and put in use**. "Send for review" is optional.
* **Risk assessments:** saved and in use automatically. A risk with a stated level and stated controls is
  `origin = DOCUMENT` ("From the council support plan"). Otherwise it is `AI_INFERRED`, shown with an **AI-generated**
  badge and "AI-generated assessment information (not a completed clinical assessment)", and one follow-up exception
  ("Set the risk levels the plan does not state") is raised. Editing is a new version through `reviewRisk`.
* **Still controlled (not removed):** activating care for a person (manager), restricted items (DNACPR,
  safeguarding, DOB and NHS number) shown only to a registered manager, medication (never activated from a plan:
  items go to reconciliation), rota visits created unpublished, and genuine disagreements raised as exceptions.

### Who can do what (`src/server/auth/rbac.ts`)

| Action | Roles |
|---|---|
| Upload a plan and let CSB AI set up records (`rota.build`) | Org admin, care manager, care coordinator |
| Edit a care plan or risk and put it in use (`care.plan.edit`) | Org admin, care manager, care coordinator |
| Optional review and approve (`care.plan.approve`) | Org admin, care manager |
| See restricted details (`serviceUser.sensitive`) | Org admin, care manager |
| Carers | Read the care plan in use on their visits; cannot edit |

Migration `20261107210000_imported_care_records` (additive) adds `origin`, `sourceIntakeId` and `sourceNote` to
`CarePlan` and `RiskAssessment`.

## Database (migration `20261107180000_coordinator_automatic_setup`, additive)

* `CareIntake`: `setupStatus`, `setupStage`, `setupStartedAt`, `setupFinishedAt`, `setupById`, `setupReport` (JSON).
* `CareIntakeFact`: `decisionSource` (`HUMAN` default, or `AUTOMATION`).
* `CareIntakeReviewItem`: `severity`, `title`, `recordTab`, `automated`.

## Settling exceptions

On the exception list (profile tab or setup summary): **Resolve** with a note, **Use this value** for a disagreement,
**Leave out**, or choose the reference type for an unclear number. Medication items need medication permission, and
restricted items are hidden from people without restricted access (they see a count only). Corrections to records are
made on the record's own tab with its usual permissions and version checks. The Audit & Exceptions tab then shows the
saved value, the current value and who changed it.

## Tests

* `tests/unit/coordinator-triage.test.ts`: 14 sorting and safety rules.
* `tests/integration/coordinator-auto-setup.test.ts`: 15 scenarios on a fictional 5-page, 74-fact council support plan
  (`tests/support/long-support-plan.ts`): automatic profile, structured records once each, genuine exceptions only with
  the right severity, honest provenance, completion summary, idempotent rerun, settling and correcting, organisation
  isolation, identity conflict, possible duplicate, failed section and retry, stale-claim takeover, an old intake
  resumed, revised plan, supporting document.
* `tests/integration/coordinator-scanned-plan.test.ts`: a fictional **scanned** (image-only, 6-page) support plan
  with 108 facts (`tests/support/scanned-support-plan.ts`, PDF built by `tests/support/make-scanned-plan.ts`). No human
  decision, no approval audit entries, every record populated, original kept byte for byte, DNACPR restricted,
  carer and other organisation refused, staff corrections versioned, rerun idempotent.
* `tests/e2e/care-coordinator.spec.ts`: the browser journey has no Approve buttons or counters, and the imported care
  plan shows as in use.
* The existing coordinator suites were updated for the new wording ("Read and set up").

## Known limitations

* Ranking which of two **undated** documents is newer is not attempted; the disagreement is raised once for a person.
* Corrections are shown for personal details and contacts. Other sections link to their own tab and history.
* Safety detection is by wording (for example "safeguarding", "financial abuse", "DNACPR"), with stated absences ignored.
  It flags for a person and never decides.
* Scanned pages are not OCR'd by CSB; the AI reader reads the images. Quotes from a scanned page cannot be matched
  to text automatically, which is said on each fact.
* The old server functions `approveAndSave`, `prepareDrafts` and `decideFact` remain for tests and internal use; no
  screen calls the approval path.
* The live AI reader still needs `AI_PROVIDER=anthropic` and a key. Without it, reading falls back as before.
