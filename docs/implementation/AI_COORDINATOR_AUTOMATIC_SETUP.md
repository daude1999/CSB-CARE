# Autonomous AI Care Coordinator: automatic setup (Phases 2–6)

Owner's brief of 7 Nov 2026, "CSB CARE – AUTONOMOUS AI CARE COORDINATOR". Phase 1 (one coordinator confirms, no
separate manager approval) is PR #117, merged. This change builds on it and does not replace the Care Coordinator:
it reuses the same intake, fact, section and review-item models and the same section savers (`apply.ts`).

## What changed for the coordinator

1. **Upload Support Plan → Upload and process.** The document is read in the background (as before). When reading
   finishes, CSB AI now carries on by itself and sets up the person. Nobody approves facts one by one.
2. **Setup summary** (`/rota/coordinator/<id>?step=setup`, the default step). It shows what was created, with links to
   the profile, care package, draft care plan, draft rota, exceptions and history. The fact-by-fact review stays as
   "Detailed fact review (advanced)", and "Confirm & set up by hand" stays for people who prefer it.
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
* The existing coordinator suites were updated for the new wording ("Read and set up").

## Known limitations

* Ranking which of two **undated** documents is newer is not attempted; the disagreement is raised once for a person.
* Corrections are shown for personal details and contacts. Other sections link to their own tab and history.
* Safety detection is by wording (for example "safeguarding", "financial abuse", "DNACPR"), with stated absences ignored.
  It flags for a person and never decides.
* The live AI reader still needs `AI_PROVIDER=anthropic` and a key. Without it, reading falls back as before.
