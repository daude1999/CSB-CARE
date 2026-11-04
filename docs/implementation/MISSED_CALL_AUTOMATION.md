# Automated missed call investigation (built 4 Nov 2026)

Plan: `MISSED_CALL_AUTOMATION_PLAN.md`. This file records what was built, how to switch it on, its limits and how to roll it back.

## What it does

Three switches in **Rostering settings → Missed call automation** (organisation admin only). All three are **off by default**. Switches 2 and 3 need switch 1.

1. **Evidence and timeline.** When the call sweep marks a visit missed, a background job collects what the records already say: the booked carers, their clock-ins and corrections, visit notes, task outcomes, medication records (shown only to people allowed to see medication), absences, alerts, cover and contact attempts. It builds a timeline in the order things happened. Each collection is an investigation run with a fingerprint. If nothing has changed, the run is marked "No change" and no new suggestion is made. Clock-ins, clock corrections and carer answers queue a refresh. The coordinator can press **Refresh evidence**.
2. **Carer confirmation.** Each booked carer with a linked sign-in and a carer role gets an in-app notification and a red card on their home screen: "Tell us what happened". They choose one of 8 answers and fill in only the questions for that answer. Answers are kept as unverified statements and can never be edited; a later answer is added as a further statement. Limits are 5 statements per request and 20 per day. Carers with no sign-in are listed as "No sign-in: contact by phone". When the answer time runs out (default 60 minutes, with up to 2 reminders), the coordinator is told in-app. Nothing is sent outside the platform.
3. **Suggested reason.** Fixed rules (no AI) suggest one of the existing missed call reasons, with what the system found, what the carer reported, any conflicts, what is still unverified, and the next step. The suggestion is limited to "weak" while any carer has not answered, and is marked **Urgent review** when the service user is high risk, or when no one attended and no cover has been arranged. The coordinator can accept it (with their own findings), choose another reason in step 1, or dismiss it with a note.

## What it never does

It never marks a visit completed, records or approves a clock correction, closes or moves a case on, assigns blame, decides safeguarding, or changes medication, pay or invoicing. It never invents a clock time: a carer's reported times are labelled "Not verified". The case stage, outcome and sign-off only change when a person records them. The database enforces this: statements cannot be updated, who was booked cannot change after detection, a finished run cannot change, and a suggestion can be reviewed once and never edited.

## Where it shows

- Missed call case page: an "Automated investigation" section above the steps (status, suggestion, carer confirmation, timeline, the full evidence table).
- Visits Needing Attention: a short block in the missed call panel (carer confirmation, suggested reason, missing information, last updated, View investigation). The queue rows are unchanged to keep the approved design.
- Carer app: the red action card and the two-step answer screen at `/carer/missed/[id]`, with links to ask for a clock correction.
- The case audit history lists every automated step.

## Data

Migration `20261104010000_missed_call_automation` (additive): six columns on `RotaSettings`, four new tables (`MissedCallCarerConfirmation`, `MissedCallCarerResponse`, `MissedCallInvestigationRun`, `MissedCallInvestigationDraft`) and four guard triggers. Code in `src/server/rota/missed-auto/`.

## Limitations

- On Vercel there is no worker, so jobs run when a page kicks the queue or on the daily cron. Pressing **Refresh evidence** always runs straight away.
- Rota and cover changes are picked up by the 10-minute catch-up in the sweep, not instantly.
- Carers are only asked within a day of detection. Older cases still get evidence but no carer request.
- When carers on a double-up give different answers, the suggestion is "Conflicting evidence: manual investigation required".
- The spec's contingency-plan and time-critical fields do not exist in the platform yet, so they are not used.

## Roll back

Switch the three settings off. Pending carer requests are withdrawn and nothing else runs. The tables can stay; removing them needs a new migration.

## Tests

`tests/unit/missed-auto.test.ts` (rules), `tests/integration/missed-auto.test.ts` (detection, idempotency, confirmation limits and permissions, deadlines, failures, review, triggers), `tests/e2e/missed-auto.spec.ts` (case page, carer phone flow, refresh and accept, attention panel, settings).
