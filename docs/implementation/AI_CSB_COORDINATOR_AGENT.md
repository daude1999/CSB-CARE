# AI CSB Coordinator agent (owner's brief of 6 Nov 2026)

Goal: one support plan upload → CRM draft records across the existing modules → editable draft rota → exception
review → controlled activation. Built in six phases, one draft PR each. No merge or deploy without the owner's
explicit instruction. The owner wrote "Once complete please merge." on 6 Nov 2026 at 15:03, which covers each phase PR
once its tests pass.

| Phase | Scope | State |
|---|---|---|
| 1 | Fix document reading: root cause, retries, fallback, Read again | Merged (#108) |
| 2 | Complete structured extraction (personal, contacts, package, care plan detail, risks, medication, all visits) | Not started |
| 3 | CRM population orchestration through existing services (drafts, provenance) | PR (with 4-6) |
| 4 | Draft rota separated from activation | PR (with 3, 5, 6) |
| 5 | Chat actions on the orchestration service | PR (with 3, 4, 6) |
| 6 | Resumable jobs, dedupe, security regression, end-to-end tests | Partly, see limits |

## Phase 1: document reading

### Root cause of "The document could not be read by the AI service just now"

The AI reading asks the Anthropic API for structured output in `CareDocumentExtractionSchema`. The API compiles that
schema into a grammar and refuses a schema with more than 16 parameters that use a union (every `.nullable()` field
is `anyOf [x, null]`) or more than 24 optional parameters, with HTTP 400 "Schema is too complex for compilation". The
care document schema had **32** union parameters (the support plan import schema of #74 had 24), so every AI reading
was refused before the model saw the document. `structured()` re-threw the 400 as a plain error, and `reader.ts`
replaced it with the generic message. The chat worked because it does not use structured output.

This was established from the published limits and by counting the schema the SDK sends
(`tests/unit/coordinator-reading-recovery.test.ts` asserts the original is over the limit). It was not reproduced
against the live API: the build environment has no API key.

### What changed

- `src/server/ai/wire-schema.ts`: every structured-output schema is sent in a "wire" form without unions ("" for not
  written, an extra "" enum option, a 0-or-1 item list for a nullable object) and turned back and validated against the
  real schema on our server. A unit test checks every schema in `schemas.ts` stays within the limits.
- `src/server/ai/anthropic.ts`: document reading streams with `max_tokens` 64000 (no cut-off answers), effort medium,
  the PDF block cached, and an optional page range. Every failure becomes an `AiUnavailableError` with a reason
  (`busy`, `timeout`, `rejected`, `invalid-output`, `truncated`, ...).
- `src/server/care/coordinator/reader.ts`: documents over 10 pages are read in parts of 8 pages, 3 at a time, and
  merged by page range. Each part is retried up to 3 times with growing waits for failures that may pass. Pages the AI
  could not read are read by the basic reader; if the AI read nothing, the basic reader reads the whole document. A flag
  on the document says which pages and why. Nothing is invented for unreadable pages. Budget 210 s
  (`COORDINATOR_READ_BUDGET_MS`).
- `CareIntakeDocument.readMethod`, `readFailure`, `readAt` (migration `20261106140000_care_intake_read_recovery`,
  additive). The Documents step shows "Read by AI", "AI failed, basic reader used" or "AI and basic reader" next to the
  status, and a FAILED document reads "Stored, not read yet". Read again is the primary button when the AI failed.
- The chat paperclip says "The upload worked, but the AI reading failed (reason) ... press Read again" instead of
  "could not be read".
- App pages' `maxDuration` raised from 60 to 300 seconds (same as the cron route) so a long AI reading can finish.

### Recovering the failed live document

Open the intake → Documents → **Read again**. The stored original is read again; nothing is uploaded again. A document
left as FAILED by the old reader is re-classified on that read.

### Limits still open

- Reading still runs inside the request (up to about 3.5 minutes for a long plan). Background, resumable reading is
  Phase 6.
- Image-only PDFs: the AI sees page images, so scanned pages can be read by the AI, but its quotes cannot be checked
  against a text layer and stay UNVERIFIED. Without AI, scanned pages are listed as needing manual review. No OCR
  service is configured.
- A chat message that triggers a reading through the agent's tools still shares the chat's time budget.

## Phase 2: structured extraction

What the reading now produces, all as facts the coordinator checks against the page:

- **Care plan topics.** 21 topics (`CARE_PLAN_TOPICS` in `src/lib/care-coordinator-rules.ts`): about me, daily routine,
  independence and choice, culture and religion, community, communication, cognition and memory, personal care,
  washing and dressing, toileting and continence, mobility and transfers, eating and drinking, nutrition and hydration,
  medication support arrangements, documented long-term conditions, emotional wellbeing, sleep and night support,
  household tasks, home and safety, emergency considerations, outcomes. Each topic belongs to one of the nine existing
  care plan sections and is written into that section under its own heading ("How staff should support me", "My
  preferences"), so the care plan screens are unchanged. The topic decides the section, so a topic cannot be filed
  under the wrong heading. The basic reader recognises the same headings.
- **Risks.** Documented hazard, who is affected, existing controls, mitigation (saved as recommended actions on the
  risk draft) and what a qualified assessor still has to establish (saved as open questions). A risk level is never
  invented: with no stated level the assessor must set one before the fact can be approved.
- **Visits.** Days, start time, duration, carers, tasks, type of visit, special instructions, start and end dates and
  whether the visit is temporary. A temporary visit with no end date is flagged ("Confirm the end date with the
  commissioner") and is not bulk-approved. The type, instructions and temporary status go into the visit template's
  notes.
- **Medication.** The prompt now asks the AI to keep current medication apart from historical (discharge) lists.
  Medication stays a review item; nothing is activated.

The schema sent to the AI still fits the API's limits (checked by a unit test). Every new field is optional, so older
readings still load.

Fixed on the way: reader notes (such as the temporary-visit warning) were overwritten when facts were compared; the
comparison now adds that warning itself.

## Phases 3 to 6: one upload fills the CRM as drafts (built together at the owner's request, 6 Nov 2026 15:58)

**Prepare records and draft rota** (`src/server/care/coordinator/prepare.ts`, `prepareDrafts`). It runs automatically
after an upload (intake screen and chat paperclip) and from a button on Check facts, and it can be run again:

1. Facts whose words were found on the page, with no warning, are accepted for drafting and marked with who ran it.
   **Scanned council plans** (Tower Hamlets and most councils send page images with no text layer) cannot be checked
   word for word, so facts the AI read from a scanned page are also accepted for drafting, with the decision note
   "from a scanned page ... compare with the original before relying on it", and they stay marked unverified. A quote
   missing from a page that does have text is never accepted (that is a misreading). Contradicted, historical or
   restricted facts stay for a person.
2. Identity first. A new person is created only with a first and last name, and not when someone with the same name
   (and date of birth or postcode) is on record, unless the coordinator confirms it is a different person. Until then
   nothing is written and the intake stays a prospective intake.
3. The draft-safe sections are saved through the same `applySection` code a manager-approved section uses, with
   `prepare: true`: the person at **Assessment**, contacts, carer preferences, the care package, the care plan as a
   **DRAFT**, risks as **DRAFTs** (a risk with no stated level is saved with a clearly labelled placeholder; the
   assessor must set it), visit templates and call notes. The section is marked `DRAFTED`. Medication, incident history
   and skin findings always go to a manager. For someone already receiving care, package and visit changes also go to a
   manager.
4. **Proposed rota.** `createProposedRota` (in `src/server/rota/build.ts`) builds the next two weeks for that person
   with the normal Build Rota rules, also while the person is at Assessment. The visits are unpublished.
   Publishing is refused for anyone whose care is not active (`publishBuild` and the visit Publish action), so carers
   are never told, and nothing is delivered, paid or invoiced. Whole-organisation builds still skip people who are not
   active. Activation keeps every existing check (care plan approved by a different person, risks reviewed).
5. The report gives the counts read back from the database.

**Chat actions** (`agent-tools.ts`): `prepare_records` (only when the employee asked; "different person" only when the
employee said so), `get_prepared_records` (person, contacts, package, care plan, risks, templates with ids, proposed
visits, open facts) and `correct_draft_visit` (a template's start time or length for someone not yet active, only with
the time the employee typed; its proposed visits move through Template + Future Rota).

**Duplicates and resuming.** The same PDF uploaded twice to an intake is kept once (SHA-256). Every step records what
each fact became, so running Prepare again carries on from where it stopped and never creates anything twice; a failed
section is retried on the next run.

### Limits still open

- Reading and preparing still run inside the request (the page allows up to 5 minutes). A background, resumable job
  with live progress is not built yet.
- No separate DRAFT status for the care package: the package is saved for a person at Assessment, and it only matters
  operationally once care is activated.
- No browser (Playwright) test for the whole flow yet; it is covered by integration tests and screenshots.
- No OCR. A scanned plan is read only by the AI (Rota Settings switch on, `AI_PROVIDER=anthropic`). With the AI off,
  CSB's own reader finds nothing on a scanned plan and the pages are listed for a person to read. Adding OCR (for
  example Tesseract) would be a new dependency and needs the owner's approval.
- Tested with a real Tower Hamlets "One Off Service Request" layout only locally, never committed; the tests and
  screenshots use fictional people. The real AI reading of it is still to be checked on the live site.

## Live reading failure and background reading (6 Nov 2026, evening)

**What failed on live.** The owner's Tower Hamlets plan (12 scanned pages) was stored, but every AI reading
returned HTTP 400 ("the AI service rejected the request"). The basic reader was used instead, and it finds nothing on
scanned pages. So the failing stage was the Anthropic request itself, refused before any reading. It was not a
timeout, a storage problem or a database problem. The service's own reason was never kept, and Vercel's runtime logs
cannot be reached from the build environment, so the exact refused field is not confirmed.

**PR #111.**
- A refused request is sent once more in its plainest form: no beta features, no caching marks, no structured-output
  grammar (the JSON shape is asked for in words and validated against the same zod schema), and a 32k answer limit.
- If that is refused too, the service's own short reason is stored and shown on the document in brackets. It is
  cleaned to one line, key-like strings removed, at most 200 characters.

**Background reading** (`src/server/care/coordinator/read-jobs.ts`). An upload, a chat attachment or "Read again"
stores the original and records a `coordinator.read` job in the Postgres queue, then returns at once. The job does
three things:
1. Reads the document.
2. Saves the facts.
3. Prepares the drafts and the proposed rota (`prepareDrafts`).

Its stage is kept on the document (`readStage`: QUEUED, READING, PREPARING, RETRYING, DONE or FAILED, with
`readStageNote` and `readJobId`) and shown on the Documents step. The page refreshes itself while a reading is in
progress.

- **Who runs it.** The worker runs it where there is one. On Vercel it is started straight after the response
  (`after()`), and the intake page asks `/api/care-coordinator/reads/run` (5 minutes allowed) while a document waits.
  The general page ping (`/api/jobs/kick`, 60 seconds) never claims a reading job.
- **Resume.** A run that is cut off is picked up again once its lock lapses (5.5 minutes). A reading that already
  finished is not repeated when only the preparation failed, and preparation never creates anything twice.
- **Failures.** A failure is retried up to 3 times with a growing wait, then shown as "Reading stopped" with the reason
  in plain words. Pressing "Read again" again joins the job in progress instead of starting a second one.

Still open:
- Within one reading, the AI's page parts are not saved separately. A cut-off reading starts that document's AI
  reading again from the first part.
- There is no OCR, so a scanned plan still needs the AI.

## Visit-specific care-worker tasks (phase 5)

- **Short tasks.** `src/server/care/coordinator/visit-tasks.ts` splits each timetable row's task text into short tasks (at most 80 characters, at most 30 per visit, in the order written, no duplicates). The full wording stays in the visit template's notes. Each task is linked to the visit template through the organisation's care task list, so Build Rota copies it onto every visit.
- **No medication tasks from a document.** Any task about medicines (tablets, blister packs, insulin, eye drops, inhalers, patches and similar) is kept off the carer's list. It becomes a restricted "Medication to reconcile" follow-up until the medication record is authorised. Nothing switches on eMAR.
- **Tasks that may not fit.** A rough, cautious estimate of each task's minutes is compared with the visit length. When the tasks plainly need more time, a "Visit tasks to check" follow-up is raised. Neither the tasks nor the visit length is changed.
- **Carer outcomes.** A carer records each task as Completed, Not completed, Refused, Unable to complete, Not applicable or Concern identified. Anything other than Completed needs an explanation. A concern raises an in-app alert for the office (the same exception queue as a concern note). No outbound message is sent. Not completed, refused, unable and concern outcomes count as missed tasks in the KPIs and care summary.

## One way in for care documents (phase 3)

Every upload of care documents starts on the Care Coordinator's "Start an intake" form, with three choices:

- **A. New service user** (`mode: NEW`): a referral or support plan for someone not on the system. Their records are drafted for checking, as before.
- **B. Updated or revised plan** (`mode: EXISTING`): new documents for someone already on the system. Changes are shown for acceptance. Package and visit changes go to a manager.
- **C. Supporting document** (`mode: DOCUMENT`): a letter, assessment or report for someone already on the system. It is read so its facts can be seen, and filed in the person's documents in the category it was classified into. No facts are accepted automatically and no other record changes.

Entry points:

- Service Users list: "Upload support plan" opens choice A.
- A person's page: "Upload documents" opens choice B with the person chosen.
- "Add service user" links to the Coordinator.
- The chat paperclip creates the same intakes, and the agent's start-intake tool accepts all three modes.
- The older "Set up from support plan" form stays reachable for typing a plan in by hand, with a note pointing to the Coordinator.

## Revised support plans (phase 6)

For an "Updated or revised plan" intake (B), the Check facts step opens with **What the revised plan changes** (`src/server/care/coordinator/compare.ts`, `src/components/coordinator/revision.tsx`). Every detail read from the new documents is set against the person's current record, field by field:

- **New:** not on the record.
- **Unchanged:** same as the record. Text is compared ignoring case and spacing. A visit counts as the same when its time, length and carers match.
- **Changed:** different from the record.
- **Conflicting:** the documents disagree with each other, or a value comes from an older document.
- **Removed or superseded:** a repeating visit on record that the revised timetable no longer has. This is only shown when the documents give a timetable.
- **Missing:** a key detail (date of birth, address, postcode, NHS number) that neither the documents nor the record gives.

**Accept all routine** approves only non-clinical values that match the record, and new personal, contact or carer-preference details read word for word from a page. Care plan, risk, medication, incident and skin details are always decided one by one, even when unchanged. **Keep current** rejects a changed or conflicting detail with the note "Kept the current record". Accept, edit, reject and clarify stay on each fact's own row.

The comparison itself writes nothing. Package and visit changes still go to a manager, and completed visits are never rewritten.

**Limitation.** A removed or superseded visit is shown, but it is not ended automatically. The coordinator changes or ends it on the Templates screen once the council confirms.
