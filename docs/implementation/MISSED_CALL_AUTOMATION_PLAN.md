# Automated Missed Call Investigation: pre-build plan

**Status:** plan only. No application code has been changed. The build starts only when the owner explicitly authorises it.
**Brief:** "CSB Care – Automated Missed Call Investigation" (owner, 3 Nov 2026), section 29 deliverables.
**Repository inspected:** `daude1999/CSB-CARE`, `main` at `b269bb9` (after PR #70).
**Builds on:** Missed Calls (PR #31), Find Cover (PR #43), Find Replacement Cover (PR #54), Visits Needing Attention single queue (PR #59), multi-carer visits 1–20 (PR #60).

---

## 0. In one paragraph

When the call sweep marks a visit missed, it already opens one `MissedCallCase`. The plan adds an **automation layer beside that case**, never inside it. A background job collects the evidence the system already holds (the booking, the clocks, the notes, the office activity, the risk flags) into a dated snapshot and a timeline. It asks each carer who was booked, and who has a linked sign-in, what happened, through a new card on My Visits. A rules-based summary then suggests one of the existing `MISSED_REASONS` codes and a next step. The coordinator still records the reason (with findings), the replacement care and the outcome, and a different manager still signs off. The automation never writes to the visit, the clocks, the correction requests, payroll, invoicing or the case's own stage, reason or outcome.

---

## 1. Current-repository inspection (deliverable 1)

### 1.1 What exists today and how it behaves

| Area | File | What it does now | What matters for this build |
|---|---|---|---|
| Detection | `src/server/rota/monitor.ts` `sweepCalls()` | Every published visit still `SCHEDULED` at `missedAfterMin` (default 30) after its start is set to `MISSED` under a row lock. In the same transaction it writes a `VisitEvent`, calls `openMissedCase()` and raises the `MISSED` alert (`dedupeKey missed:<visitId>`). | The detection transaction must stay small. The only additions inside it are the booked-carer snapshot rows (§4.1). The job is enqueued after the commit. |
| Case | `src/server/rota/missed-calls.ts` `openMissedCase()` | One case per visit (unique `visitId`). It snapshots **one** carer (`staffId` = the PRIMARY slot, else the first booked). Deadline = detection + 30 min. Writes a SYSTEM comment. | **Gap:** a double-up (or 3–20 carer visit, PR #60) keeps only one name. The plan adds a full booked-carer snapshot without changing `staffId`, which the repeat-offender rules use. |
| Case workflow | `missed-calls.ts` | `assignCoordinator`, `recordReason` (needs a reason code and at least 10 characters of findings), `recordReplacement`, follow-ups, comments, evidence files, `escalateMissedCase`, `escalateOverdueCases` (automatic, once, when there is no reason by the deadline), `submitForSignOff` (needs a reason and replacement care), `signOffMissedCase` (needs `rota.missed.signoff`, and the investigator can't sign off), `reopenMissedCase`. All writes use `guardedUpdate()` with `lockVersion`. | Reused unchanged. "Accept suggested reason" calls `recordReason()`, so the same validation, lock and audit apply. |
| Reasons | `MISSED_REASONS` | 11 codes: CARER_SICKNESS, CARER_NO_SHOW, CARER_TRAVEL, CARER_LATE, ROTA_ERROR, UNASSIGNED, CLIENT_UNAVAILABLE, ACCESS, NOT_CLOCKED, CLIENT_CANCELLED, SYSTEM, OTHER. | The suggestion engine maps onto these codes only (§6.3). |
| Queue | `src/server/rota/attention-queue.ts`, `src/app/(app)/rota/attention/page.tsx` (`MissedDetail`) | Missed entries come from `missedCallRegister()`. The detail panel shows a 4-step checklist plus Record reason and Find recovery cover. | Add one compact "Automatic investigation" block to `MissedDetail`. The queue's grouping, ranking and layout are unchanged. |
| Case page | `src/app/(app)/rota/missed/[id]/page.tsx` | Visit header, timeline (from audit), then the numbered investigation steps, history and evidence. | Add an "Automated investigation" section above step 1. The existing steps stay as they are. |
| Carer portal | `src/server/rota/carer.ts` `myVisits()`, `src/app/(app)/carer/page.tsx` | The carer sees published visits with a **current** assignment (`removedAt: null`), from `carerDaysBack` (default 1) to `carerDaysForward`. | **Gap:** if the office removes the carer from the missed visit afterwards, or the visit is older than a day, the carer can no longer see it. Confirmation access must come from the detection snapshot, not the live rota (§5.2). |
| Identity | `src/server/workforce/link.ts` `myStaff()` | Needs the `visit.own` permission (CARER) and a staff record linked by hand. Refuses archived, suspended and HR-missing staff. | Reused as the only identity source. |
| Clocks | `src/server/rota/attendance.ts` | Clock rows are append-only (trigger). Corrections supersede. `effectiveClocks()` gives the rows in force. **A late clock-in on a MISSED visit moves it to IN_PROGRESS** and answers the LATE and MISSED alerts. | The evidence must show "clocked in late at hh:mm" correctly, and a new clock row triggers a refresh. |
| Corrections | `src/server/rota/corrections.ts` | A carer asks, and someone else decides (also enforced by a DB trigger). It needs a **current** assignment and a time within 24 h of the start. | "Forgot to clock in" offers this form prefilled. If the carer is no longer on the visit, the form isn't offered and the office is told why (§5.4). |
| Notifications | `Notification` model, bell | In-app only, with `dedupeKey` unique and `readAt`. | `readAt` is the only "seen" signal. It is shown as "opened the notification", never as proof the carer read the request. |
| Jobs | `src/server/jobs/queue.ts`, `src/worker/handlers.ts`, `src/server/jobs/inline.ts` | Postgres queue with idempotency keys, backoff, dead-letter and lock recovery. `rota.sweep` runs every minute with the worker. | New job types are added to `handlers`. See §7 for what happens on Vercel. |
| Medication | `src/server/care/medication.ts`, `MarRecord` | Only when `RotaSettings.medicationEnabledAt` is set. Viewing needs `medication.view`. | Shown as a status only ("doses recorded / not recorded for this visit"), and only when it is switched on and the viewer has permission. |
| Risk | `ServiceUser.riskLevel`, `ServiceUserRisk` (HIGH, ACTIVE), `isHighRisk()` | Already used by the register and the queue. | Reused as-is. **There is no care-plan "contingency" or "time-critical" field today** (care-plan sections are free text). The evidence says "not recorded" and nothing is inferred from text or AI. |
| Audit | `src/server/audit-log.ts`, `AuditLog` (immutable trigger) | Used by every state change. | All new actions are audited with new `rota.missed.auto.*` action names. |

### 1.2 Test baseline (run 3 Nov 2026, 22:15 UTC, local PostgreSQL 16, `csb_test`)

```
npx vitest run tests/integration/missed-calls.test.ts tests/integration/corrections.test.ts \
  tests/integration/attention-queue.test.ts tests/integration/monitoring.test.ts \
  tests/integration/attendance.test.ts tests/integration/multi-carer.test.ts \
  tests/integration/missed-cover.test.ts tests/unit/attention-queue.test.ts tests/unit/missed-cover.test.ts
Test Files  9 passed (9)   Tests  96 passed (96)
```

The full suite and Playwright were **not** run for this plan. They will be run and reported before and after the build. Known flaky item: `cutoff.test.ts` fails late in the evening London time (it is time-of-day dependent and not caused by this work).

---

## 2. Reusable components (deliverable 3)

- **Server:** `openMissedCase`, `caseScope`/`caseInScope`, `guardedUpdate`, `recordReason`, `escalateCase`/`escalateOverdueCases`, `notify` (pattern), `isHighRisk`, `MISSED_REASONS`, `effectiveClocks`, `requestClockCorrection`, `myStaff`, `rotaScope`/`visitWhere`, `rotaSettings`, `coverStates` (recovery cover), `outstandingCommunication` / `CoverContactAttempt` (contact records), `enqueue`/`drain`/`PermanentJobError`, `audit()`.
- **UI:** `Badge`, `Card`, `Flash`, `Empty` (`src/components/ui.tsx`), the `panel` and `Step` styles on the case page, `PRIMARY`/`OUTLINE`/`TEXT_LINK` button styles and the checklist row from `MissedDetail`, `VisitStatusBadge`, and the existing correction form on My Visits.
- **Tests:** `tests/support/missed-fixture.ts` `makeMissedCall()` (already supports `carersRequired` and `staffIds`), `tests/e2e/fixtures/missed-call.ts`, the existing `missed-calls` integration and e2e specs as regression.

---

## 3. File-by-file change plan (deliverable 2)

New domain folder `src/server/rota/missed-auto/` so the 724-line `missed-calls.ts` doesn't grow:

| File | New / changed | Purpose |
|---|---|---|
| `prisma/schema.prisma` + `prisma/migrations/2026110xxxxxxx_missed_call_automation/migration.sql` | new migration | The tables and settings in §4. Additive only, with append-only and immutability triggers. |
| `src/server/rota/missed-calls.ts` | changed (small) | `openMissedCase()` also writes the booked-carer snapshot rows (`MissedCallCarerConfirmation`, one per non-shadow carer). Its return value adds `created`. Nothing else changes. |
| `src/server/rota/monitor.ts` | changed (small) | After the detection transaction commits, `enqueue("missed.evidence", …)` for each newly opened case, wrapped in try/catch so a failed enqueue never stops the sweep. |
| `src/server/rota/missed-auto/evidence.ts` | new | `collectEvidence(caseId, reason)`. A pure-read, deterministic collector that returns typed `EvidenceItem[]` (§6.1). |
| `src/server/rota/missed-auto/timeline.ts` | new | `buildTimeline(items)`. Pure, sorted by event time, with "recorded at" kept separately. |
| `src/server/rota/missed-auto/suggest.ts` | new | `suggestReason(evidence, responses)`. A pure rules table returning a code or "unresolved", a confidence band, conflicts, missing items and a next action (§6.3). |
| `src/server/rota/missed-auto/runs.ts` | new | `runInvestigation(caseId, reason)`. Starts a run, collects, fingerprints, skips if nothing changed, stores the snapshot, writes a draft and audits. Also `refreshEvidence(ctx, caseId)` for the button, `automationState(caseIds)` for the queue and `automationDetail(ctx, caseId)` for the case page. |
| `src/server/rota/missed-auto/confirmations.ts` | new | `requestConfirmations(caseId)`, `checkDeadlines(now)`, and for the carer `myMissedConfirmations(ctx)`, `getMyConfirmation(ctx, id)`, `submitCarerResponse(ctx, id, input)` and `supplementCarerResponse(ctx, id, input)`. |
| `src/server/rota/missed-auto/review.ts` | new | `acceptSuggestedReason(ctx, caseId, draftId, findings, lockVersion)` (calls `recordReason`) and `dismissSuggestion(ctx, caseId, draftId, note)`. |
| `src/server/rota/missed-auto/settings.ts` | new | Reads the switches and deadlines from `RotaSettings`. |
| `src/worker/handlers.ts` | changed | New handlers `missed.evidence`, `missed.confirm.request`, `missed.summary` (folded into evidence, see §7) and, inside the existing `rota.sweep`, `checkDeadlines()` plus a catch-up for cases with no run. |
| `src/app/rota-actions.ts` | changed | `missedRefreshEvidenceAction`, `missedAcceptSuggestionAction`, `missedDismissSuggestionAction`, `carerMissedResponseAction`, `carerMissedSupplementAction`, all through the existing `handle()` wrapper with zod. |
| `src/app/(app)/rota/missed/[id]/page.tsx` | changed | New `<AutomatedInvestigation>` section above step 1 (status, timeline, carer responses, suggested reason with Accept / Choose another / Dismiss, missing evidence, Refresh). Steps 1–5 unchanged. |
| `src/components/missed-auto-ui.tsx` | new | Shared timeline list, evidence table, status badge and response card. |
| `src/app/(app)/rota/attention/page.tsx` | changed | `MissedDetail` gains one "Automatic investigation" block (status, carer confirmation, suggested reason, missing count, last updated, link). The queue rows get one small status chip. |
| `src/server/rota/attention-queue.ts` | changed | `MissedEntry.auto` filled from `automationState()` in one batched query. |
| `src/app/(app)/carer/page.tsx` | changed | A "Missed visit: please tell us what happened" action card at the top when a confirmation is open. |
| `src/app/(app)/carer/missed/[id]/page.tsx` | new | The mobile-first response form (§5.3) and the read-only history of the carer's own statements. |
| `src/app/(app)/rota/settings/page.tsx` + settings action | changed | The "Missed call automation" switches and response deadlines. |
| `prisma/seed*.ts` | changed | Demo: switches on for the demo org only, plus synthetic confirmations for screenshots. |
| `docs/implementation/MISSED_CALL_AUTOMATION.md`, `MASTER_BUILD_TRACKER.md`, `KNOWN_LIMITATIONS.md` | changed | Build record and limitations. |
| Tests | new | `tests/unit/missed-auto-*.test.ts`, `tests/integration/missed-auto-*.test.ts`, `tests/e2e/missed-auto.spec.ts` (§9). |

Not touched: `attendance.ts`, `corrections.ts` (reused through their public functions only), `link.ts`, the visit and clock tables, payroll/finance, `/rota` and `/rota/visits` (visually locked), the sidebar.

---

## 4. Database changes (deliverable 4)

All additive. No existing column is changed or removed.

### 4.1 `MissedCallCarerConfirmation`: the booked-carer snapshot and the request

One row per non-shadow carer booked **at detection**, written inside `openMissedCase()`. It is a cheap insert from the query it already runs. A later rota change can't rewrite it.

| Column | Notes |
|---|---|
| `id`, `organisationId`, `caseId` → `MissedCallCase` | |
| `staffId` → `StaffMember`, `assignmentId` (the `VisitAssignment` id), `slot`, `position` | The snapshot |
| `userIdAtDetection` | The linked sign-in at detection (null = none) |
| `status` | `NO_LOGIN` · `PENDING_REQUEST` · `REQUESTED` · `RESPONDED` · `NO_RESPONSE` · `WITHDRAWN` (case closed or feature switched off) |
| `requestedAt`, `notificationId`, `notificationOpenedAt` | `openedAt` is copied from `Notification.readAt` when seen |
| `responseDueAt`, `remindersSent` (int, capped), `lastReminderAt`, `escalatedAt` | |
| `createdAt`, `updatedAt` | |
| **Unique** `(caseId, staffId)`; **index** `(organisationId, staffId, status)` | |

### 4.2 `MissedCallCarerResponse`: append-only statements

| Column | Notes |
|---|---|
| `id`, `organisationId`, `confirmationId` → confirmation, `staffId`, `authorUserId` | The author must equal the confirmation's staff (checked on the server and by a DB trigger) |
| `answer` | `ATTENDED_NO_CLOCK` · `ARRIVED_LATE` · `UNABLE_TO_ATTEND` · `ACCESS_PROBLEM` · `SU_CANCELLED` · `PHONE_SYSTEM` · `ROTA_WRONG` · `OTHER` |
| `reportedArrival`, `reportedDeparture` (timestamps, nullable), `careDelivered` (`YES`/`PARTLY`/`NO`/null), `notifiedSomeone` (bool), `notifiedWho`, `notifiedAt`, `attemptedAt`, `contacted`, `explanation` (max 2000) | Only the fields the answer needs |
| `supplementsId` → an earlier response | A correction or addition. The original is never edited |
| `submissionKey` (unique) | A form nonce, so a double tap stores one row |
| `submittedAt` | Server time |
| Trigger: refuse UPDATE and DELETE | Same pattern as `CoverContactAttempt` |

### 4.3 `MissedCallInvestigationRun`: each evidence collection

| Column | Notes |
|---|---|
| `id`, `organisationId`, `caseId` | |
| `reason` | `DETECTED` · `CLOCK` · `CORRECTION` · `CARER_RESPONSE` · `ROTA_CHANGE` · `COVER` · `MANUAL` · `CATCH_UP` |
| `status` | `RUNNING` · `COMPLETED` · `UNCHANGED` (same fingerprint as the last run) · `FAILED` |
| `startedAt`, `finishedAt`, `requestedById` (manual only), `jobId` | |
| `evidence` (JSON), `timeline` (JSON), `sourceRefs` (JSON `[{type,id}]`), `fingerprint` (sha256 of the normalised evidence) | Minimised (§8.4) |
| `error` (500 characters, no tenant data), `processingVersion` (int) | |
| Index `(caseId, startedAt)`. Trigger: content frozen once COMPLETED or FAILED | |

### 4.4 `MissedCallInvestigationDraft`: the suggestion and its review

| Column | Notes |
|---|---|
| `id`, `organisationId`, `caseId`, `runId` → run | |
| `suggestedReason` (a `MISSED_REASONS` code or null), `classification` (`POSSIBLE_NOT_CLOCKED` · `POSSIBLE_LATE` · `POSSIBLE_UNASSIGNED` · `UNRESOLVED` · `CONFLICTING` · …), `support` (`SUPPORTED` · `WEAK` · `INSUFFICIENT`) | |
| `summary` (JSON: found / reported / unverified / conflicts / missing / nextActions) | Structured, not free narrative |
| `generator` (`rules-v1`) | Room for a later AI explanation (§10), with its own label |
| `reviewStatus` (`PENDING` · `ACCEPTED` · `DIFFERENT_REASON` · `DISMISSED` · `SUPERSEDED`), `reviewedById`, `reviewedAt`, `reviewNote` | Only the review fields change, once |
| Index `(caseId, createdAt)`. A partial unique index allows one `PENDING` draft per case | |

### 4.5 `RotaSettings` additions (organisation-level, set by the provider)

`missedAutoEvidenceAt/ById` (Release A switch), `missedAutoConfirmAt/ById` (Release B), `missedAutoSummaryAt/ById` (Release C). These follow the existing `medicationEnabledAt`/`careSummaryEnabledAt` pattern. All are off by default, and switching one off is the rollback.
`missedConfirmMinutes` (default **60**), `missedConfirmReminders` (default **1**, max 2), `missedConfirmReminderMinutes` (default **30**). See the open decision in §12.

No change to `MissedCallCase`, `Visit`, `VisitClock`, `ClockCorrectionRequest`, `AuditLog` or the existing triggers.

---

## 5. Security and permissions (deliverable 5)

### 5.1 Office side
- Viewing the automation data needs `rota.monitor` plus `caseScope()` (organisation and branch areas). It is the same gate as the case page, so a forbidden case still returns 404.
- Refresh Evidence, Accept, Choose another and Dismiss need `rota.edit`. Accept goes through `recordReason()` (same lock, validation and audit), so a suggestion becomes the official reason only when an authorised person submits it with their own findings.
- Sign-off is unchanged: it needs `rota.missed.signoff`, and the investigator can't sign off. Accepting a suggestion counts as recording the reason, so that person can't sign off either.
- Medication status shows only with `medication.view` and when medication is switched on.

### 5.2 Carer side
- Identity comes only from `myStaff(ctx)` (`visit.own` plus a hand-linked staff record, active).
- Every carer query is `MissedCallCarerConfirmation where { id, organisationId: staff.organisationId, staffId: staff.id }`. The case id or staff id from a form is never trusted. A wrong id returns 404.
- Access follows the **detection snapshot**, so a carer removed from the visit afterwards can still answer. A carer added afterwards can't.
- The carer sees only the visit date, time, call type, service user first name and last initial, and the status. They don't see the manager's findings, comments, other carers' answers, the risk or the history.
- A carer can't write to someone else's confirmation (server check plus a DB trigger on `staffId`).
- Responses are accepted only while the confirmation is `REQUESTED`, `NO_RESPONSE` or `RESPONDED` (for supplements) and the case is not CLOSED.
- **Abuse limits:** the unique `submissionKey` stops double submits. There are at most 5 statements per confirmation (an original plus 4 supplements) and at most 20 statements per carer per day, counted in the database because there is no generic rate-limit helper today. CSRF uses the existing Server Action same-origin protection. Text is length-capped and stored as plain text.

### 5.3 What the carer form asks
The eight answers in the brief, each with only its follow-up fields. Times use `hh:mm` on the visit's date, and an overnight time is rolled forward the way `recordReplacement` does. Future times are refused, and so are times more than 24 h from the start. The form has one Submit button, a success message and a "Your statement was recorded at hh:mm" receipt.

### 5.4 Clock-correction link
"Attended but forgot to clock in" and "Arrived late" show a button: **Ask the office to correct my clock times**. It opens the existing correction form prefilled with the reported times. The carer still submits it, and someone else still decides it. If the carer is no longer on the visit, or the visit is more than 24 h old, the correction rules refuse it. The card then says "Ask your office to enter the time", and the summary lists "No correction request possible" as missing evidence. Nothing creates a clock row.

### 5.5 Multi-tenant isolation
Every new table carries `organisationId`, and every query filters on the session's organisation. Background jobs load the case by id and then work only within `case.organisationId`. Tests cover another organisation's carer and coordinator (§9).

---

## 6. Evidence, timeline and suggestion rules

### 6.1 Evidence items
Each item: `{ source, sourceId, label, value, eventAt | null, collectedAt, availability: PRESENT | ABSENT | NOT_APPLICABLE | NOT_PERMITTED, kind: SYSTEM | OFFICE | CARER_REPORTED, verified: boolean }`.

| Group | Read from | Items |
|---|---|---|
| A. Visit | `Visit`, `CallType` | reference, scheduled start/end, care type, carers required, medication required, current status (and its `statusChangedAt`) |
| B. Booking | the confirmation snapshot, `VisitAssignment` history (assigned/removed/acknowledged), the assign audit, `StaffAbsence`/HR flags on the assignment (`reviewReason`) | who was booked at detection, changes before and after detection, acknowledgement, absence or review flag |
| C. Attendance | `VisitClock` (all rows, plus `effectiveClocks`), `ClockCorrectionRequest` | original and effective IN/OUT per carer, late clock-in after detection, pending/approved/rejected corrections, office entries |
| D. Visit record | `VisitNote`, `VisitTaskOutcome`, `VisitEvent`, handover notes, `MarRecord` status (if allowed) | counts and times only, with links. Notes are labelled "supporting, not proof of care" |
| E. Office | `RotaAlert` (MISSED/LATE), `MissedCallComment` (count and last time), `MissedCallCover` (recovery visit), `CoverContactAttempt`, escalation, reason, replacement | |
| F. Risk | `isHighRisk()`, active HIGH risks | high-risk yes/no. Contingency and time-critical show "not recorded in the system" |

### 6.2 Timeline
Built from items that have an `eventAt`. Each line shows the time, a description, the source (with a link where the viewer may open it), the staff member where relevant, and a **System recorded / Office recorded / Reported by carer** tag. When the system found the event at a different time from when it happened (for example a clock-in entered by the office later), the line says "recorded hh:mm". Nothing is added when evidence is absent. "No clock-in recorded" is shown as a state at the detection time, not as an event.

### 6.3 Suggestion rules (deterministic, first match wins, every rule cites its items)

| # | When | Classification | Suggested code | Next action |
|---|---|---|---|---|
| 1 | Nobody booked at detection | Possible unassigned visit | `UNASSIGNED` | Review the rota assignment |
| 2 | Carer statements disagree with each other, or with system evidence (for example "attended 09:05" while a clock-in elsewhere overlaps, or "SU cancelled" with no cancellation record) | Conflicting evidence, manual investigation required | none | Investigate manually |
| 3 | A late clock-in exists after detection | Possible late attendance | `CARER_LATE` | Compare the times and confirm the care delivered |
| 4 | Carer says attended, forgot to clock | Possible visit delivered without clock-in | `NOT_CLOCKED` (**requires verification**) | Verify the care was delivered, review the correction request |
| 5 | Carer says arrived late | Possible late attendance | `CARER_LATE` | Compare the reported time with the evidence |
| 6 | Carer says unable to attend | Possible non-attendance | `CARER_SICKNESS` / `CARER_TRAVEL` / `CARER_NO_SHOW` by sub-reason | Check that cover was arranged, refer to the care manager |
| 7 | Access problem | Possible access problem | `ACCESS` | Contact the SU or their representative using existing procedures |
| 8 | SU cancelled or declined | Possible cancellation, not recorded | `CLIENT_CANCELLED` | Verify with the SU or representative |
| 9 | Phone or system issue | Possible system failure | `SYSTEM` | Verify the care was delivered |
| 10 | Rota is wrong | Possible rota error | `ROTA_ERROR` | Review the rota assignment |
| 11 | No clock-in and no response by the deadline, or no login | Unresolved, attendance not confirmed | none | Contact the carer by phone, consider urgent contingency |

A high-risk SU adds "Consider urgent contingency action" to the top of every result, and the automation status becomes **Urgent review required**. In a multi-carer visit each carer is judged separately, and the summary shows each one. The engine never states that care was delivered, never names fault, and never writes safeguarding or contact text it didn't find.

### 6.4 Automation status (separate from the case stage)
`Collecting evidence` → `Awaiting carer` → `Ready for coordinator review`. Side states: `Urgent review required` (high risk, or no cover and the visit window has passed), `Evidence check failed` (the last run failed, with a Refresh button), `Reviewed` (the suggestion was accepted or dismissed), `Off` (switch off). The case stage (New → Investigating → Awaiting sign-off → Closed) is only ever changed by the existing functions.

---

## 7. Background jobs and the deployed environment (deliverable 7)

### 7.1 Jobs
| Job | Idempotency key | What it does |
|---|---|---|
| `missed.evidence` | `missed-ev:<caseId>:<reason>:<bucket>` (bucket = 1 minute, so a burst of clock events gives one run) | Runs the investigation. If the fingerprint is unchanged, it records `UNCHANGED` and adds no timeline entries or drafts. If changed, it stores a snapshot, supersedes the pending draft and writes a new one (when Release C is on). It enqueues `missed.confirm.request` the first time. |
| `missed.confirm.request` | `missed-conf:<caseId>` | For each snapshot row with a linked active login it sets `REQUESTED`, creates one notification (`dedupeKey missed-confirm:<confirmationId>`) and sets `responseDueAt`. Rows without a login are `NO_LOGIN`. |
| inside `rota.sweep` | n/a | `checkDeadlines(now)`: sends at most `missedConfirmReminders` reminders (`dedupeKey` per reminder number), then sets `NO_RESPONSE` and notifies the case coordinator (or the case workers) **once**. It skips cases that are already escalated or closed. Catch-up: it enqueues `missed.evidence` for open cases with no run (this covers a crash between commit and enqueue). |
| Refresh triggers | via `enqueue` after commit | Hooks in `clockFromRequest`/`applyClock` callers, `requestClockCorrection`, `decideClockCorrection`, `submitCarerResponse`, the assign/unassign paths and Find Cover booking. Each is one `enqueue` call **after** its own transaction, in a try/catch, and only when the visit has an open case. |

A case that is CLOSED stops all automation. Nothing reopens it, and its confirmations become `WITHDRAWN`.

### 7.2 What actually runs in production today (checked in code)
- **Vercel has no worker.** `vercel.json` has one cron: `/api/cron/tick` at **06:00 daily**. Otherwise the queue is drained only by `/api/jobs/kick`, which a signed-in browser calls after a page load (at most every 20 s per browser, 5 jobs each). The call sweep is enqueued at most every 5 minutes.
- **So on the live demo, when nobody is signed in (for example overnight), missed calls are not detected until someone opens the app or the 06:00 cron runs.** This is today's behaviour, not something this build causes, but it means evidence collection, carer requests and reminders would wait too.
- Mitigation inside the build: when the sweep opens a case it also drains that case's `missed.evidence` job in the same kick, so on Vercel the evidence appears within the same request cycle as detection. The latency (detection → evidence → request) is recorded on each run and shown on the case, so it can be measured rather than assumed.
- The real fix is a decision for the owner (§12, decision 1).

### 7.3 If the background work fails
The case, the alert and the existing deadline escalation are unaffected, because they are created before and separately from the job. The run is stored as `FAILED` with a short error, and the case shows "Evidence check failed: Refresh". The queue retries with backoff. Retries can't duplicate notifications (`dedupeKey`), responses (`submissionKey`) or runs (fingerprint).

---

## 8. Impact on existing workflows (deliverable 8)

| Workflow | Impact | Guard |
|---|---|---|
| Detection | One extra insert per booked carer inside the existing transaction, and one enqueue after it | Test: detection still creates exactly one case, and still does so when the enqueue throws |
| Case stages, reason, outcome, sign-off | None automatically. Accept calls the same `recordReason()` | Tests: the suggestion doesn't set `reasonCode`. Sign-off and separation of duties are unchanged |
| 30-minute auto-escalation | Unchanged: a carer response doesn't set a reason, so an un-investigated case still escalates on time | Test: escalation fires with a carer response present |
| Repeat-offender figures | Unchanged (`MissedCallCase.staffId` is kept) | Existing tests |
| Attendance and corrections | Read-only. The carer still submits, and someone else still decides | Test: no `VisitClock` or `ClockCorrectionRequest` row is written by automation |
| Payroll, invoicing, medication | Not touched | Test: timesheet and invoice figures are identical before and after a run |
| Visits Needing Attention | One block in the detail panel and a status chip. Grouping is unchanged | Screenshot before/after at 1672×941 |
| Notifications volume | One request per carer, at most 2 reminders, one escalation | Test for duplicates |
| Performance | The evidence query runs per case in the job, not in the sweep loop | Latency recorded per run |

### 8.4 Data minimisation in snapshots
Snapshots store ids, times, statuses, counts and short labels. They don't store note text, addresses, phone numbers, medication names, risk text or care-plan text. The case page shows those by linking to the source record, behind its own permission check.

---

## 9. Test fixtures and acceptance criteria (deliverable 6)

**Fixtures:** extend `tests/support/missed-fixture.ts` with `withLinkedLogin`, `twoCarers`, `noCarer`, `highRisk`, `lateClockAfter(min)` and `carerRemovedAfter`. There is a second synthetic organisation for isolation tests. All names are synthetic, and nothing runs against Supabase or the live demo.

**Unit (pure, no DB):** evidence ordering and the event vs recorded time; `effectiveClocks` with superseded rows; the snapshot vs live rota; each suggestion rule 1–11 and its precedence; conflict and missing-evidence detection; the fingerprint being stable; deadline and reminder decisions (none, one, cap, already escalated, closed).

**Integration (real `csb_test`):**
1. The sweep creates one case and one snapshot row per booked carer (1, 2 and 3 carers).
2. A failing evidence job doesn't stop case creation or the alert.
3. A notification goes only to carers with a linked active login. Others are `NO_LOGIN`.
4. The booked carer can respond. Another carer in the same org, a carer added after detection, and a carer in another org all get 404.
5. A double submit stores one row. A supplement links to the original. The original can't be edited (trigger).
6. A response triggers a refresh, and the draft is superseded, not deleted.
7. The suggestion never writes `reasonCode`. Accept writes it through `recordReason` with the user's findings, and the lock conflict surfaces as a `ConflictError`.
8. Sign-off is unchanged, including that the person who accepted the suggestion can't sign off.
9. No clock, correction, timesheet or invoice change from any automation path.
10. A closed case: no runs, the confirmation is withdrawn, the carer form is refused, and nothing reopens.
11. Reminders are capped, and the escalation notification is sent once, not again if already escalated.
12. Switches off means no runs and no notifications, and the existing behaviour is identical.

**End-to-end (Playwright, `csb_e2e`):** all 15 scenarios in the brief's table. Each one is a test that drives the coordinator screens and the carer's phone-width screen, with screenshots at 1672×941 (owner standard), 1440, 834 and 390.

**Pilot acceptance:** the brief's §27 list, plus measured figures: detection→evidence latency, the request→response rate, the reminder rate, evidence accuracy on manager-reviewed cases, and coordinator time per case. No time-saving claim is made until it is measured.

---

## 10. Future AI explanation (not in this release)
`suggest.ts` returns a structured result. A later optional `explain.ts` could add a labelled narrative through the existing `src/server/ai` provider with zod validation, citing the evidence ids. It could never change the rules' classification, the case or any record. When AI is off or unavailable, the rules summary is shown as now.

## 11. Delivery: three draft PRs, in release order
1. **Release A: evidence and timeline.** Migration (all tables, so later PRs need no schema change), the snapshot, jobs, the case-page section, the queue block, Refresh, settings switch A.
2. **Release B: carer confirmation.** The notification, the My Visits card and form, supplements, the correction link, deadlines and reminders, switch B.
3. **Release C: summary and suggestion.** The rules engine, the draft, Accept / Choose another / Dismiss, switch C.

Each PR is a draft with inline screenshots at 1672×941, before and after, a change list, test results, known limitations and rollback steps. **No merge until the owner approves.** Rollback: switch the release off in Rostering settings (instant, no deploy). The code can also be reverted, because the migration is additive and its tables can stay unused.

## 12. Open decisions for the owner
1. **Overnight processing on the live site** (§7.2). Options: (a) accept it for the demo; (b) an external scheduler calls the protected `/api/cron/tick` every 5 minutes (configuration only, no new code dependency); (c) upgrade the Vercel plan for frequent crons; (d) wait for the Azure worker. *Recommended: (b) for any pilot with real carers, (a) for the demo.*
2. **Response deadline defaults**: 60 minutes to answer, 1 reminder at 30 minutes, then the coordinator is told. These are editable per provider in Rostering settings.
3. **Who gets "no response" alerts**: the case's coordinator if one is assigned, otherwise all care coordinators and managers (the same list as `caseWorkers`). *Recommended as described.*
