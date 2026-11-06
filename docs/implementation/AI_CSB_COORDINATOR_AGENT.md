# AI CSB Coordinator agent (owner's brief of 6 Nov 2026)

Goal: one support plan upload → CRM draft records across the existing modules → editable draft rota → exception
review → controlled activation. Built in six phases, one draft PR each. No merge or deploy without the owner's
explicit instruction (the earlier blanket approvals do not cover this build).

| Phase | Scope | State |
|---|---|---|
| 1 | Fix document reading: root cause, retries, fallback, Read again | Draft PR |
| 2 | Complete structured extraction (personal, contacts, package, care plan detail, risks, medication, all visits) | Not started |
| 3 | CRM population orchestration through existing services (drafts, provenance) | Not started |
| 4 | Draft rota separated from activation | Not started |
| 5 | Chat actions on the orchestration service | Not started |
| 6 | Resumable jobs, dedupe, security regression, end-to-end tests | Not started |

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
