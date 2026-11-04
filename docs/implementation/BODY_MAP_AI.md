# Enhanced Digital Body Map with AI-Assisted Recommendations (3 Nov 2026)

Branch `claude/project-thread-erdzrz`, draft PR. Builds on the body map from PR #63. The approved layout is
`docs/design/body-map-reference.png`.

## What works

- **Screen to the approved layout.** Outline with view switch (front, back, left, right), tool rail (select, zoom in,
  zoom out, reset) and an Observation Types list (a filter when browsing, the category when recording). Record
  Observation form in the centre. Details card on the right with tabs Details, Photos, History, Linked Records,
  Follow-up, AI suggestions and Audit Trail.
- **Recording.** Up to 5 photos per save, an optional reviewer, and a follow-up switch. An unsaved draft is kept in
  the browser tab (sessionStorage) and cleared after the save.
- **Notes and updates.** These are append-only, and the database refuses edits. Each can carry an optional photo.
  The author and time are recorded automatically.
- **History.** A timeline of the observation, its notes and its follow-ups, with recorded measurements and photos
  side by side. Nothing ever says a wound has "improved". Staff judge that.
- **Follow-up and review.** You can assign a reviewer and create review tasks (follow-up, care plan review, risk
  review, incident assessment, manager review), each needing its own permission. Assignees get an in-app bell
  notification. Closing a task needs an outcome.
- **Linked records.** The incident, open incidents, care plan sections about skin and personal care, and matching
  risk assessments. When medication is switched on, also medicine application sites on the same area. Each is
  read through its own permissions.
- **Medicine application sites.** Only for approved creams and patches (TOPICAL / TRANSDERMAL). Recording one
  needs `medication.manage` and the medication switch to be on. A new patch site ends the old one. Sites show as
  square "M" markers. A site is information only and never creates a MAR record.
- **AI-assisted recommendations.**
  - Off by default. It needs `AI_PROVIDER` and an admin switch in Rota Settings, with an "authorised by" note.
  - It runs automatically after a save, using `after()`, so a save is never blocked or failed by it. There is
    also a Generate / Refresh button.
  - Suggestions fall into 6 categories and carry citations to the record ids they are based on. Gaps are listed
    and nothing is made up.
  - Statuses are New, Under Review, Accepted, Dismissed and Action Created. A dismissal needs a reason for
    safeguarding and medication suggestions.
  - Run inputs are hashed, so an unchanged record is not re-run. A new run supersedes older runs and never
    rewrites them.
  - No photos and no names are sent. The simulated provider is labelled "[SIMULATED]".
  - A guard drops any suggestion that cites nothing real or uses diagnosis, grading, prescribing or abuse-conclusion
    wording.
- **Escalation prompts.** These are deterministic and not AI. They cover severe pain, burns, pressure damage, open
  skin, unexplained marks (safeguarding) and repeated marks on the same area within 30 days. They always show the
  disclaimer.
- **Management.** Profile counts for recommendations awaiting review, open tasks and overdue tasks.
- **Audit.** Every save, note, reviewer change, task, decision, run and site writes an audit entry. These are shown
  in the Audit Trail tab.

## Permissions

`bodyMap.record` is needed to record, add notes, and view and generate suggestions. The new `bodyMap.review`
(ORG_ADMIN, CARE_MANAGER) is needed to accept, dismiss or create tasks from suggestions. Medication sites need
`medication.manage`. Everything is scoped to `ctx.organisationId`.

## Schema

The schema change is one additive migration, `20261103230000_body_map_notes_recommendations`. It adds:

- tables `BodyMapNote`, `BodyMapRecommendationRun`, `BodyMapRecommendation`, `BodyMapTask` and
  `MedicationApplicationSite`
- columns `BodyMapObservation.reviewerId`, `BodyMapPhoto.noteId` and `RotaSettings.bodyMapAi*`
- triggers: notes are immutable; on a run only `supersededAt` can be set, once; suggestion text is immutable and
  its status follows a state machine
- CHECK constraints
- a partial unique index on the run basis hash

## Needs the owner's decision

- **The escalation rule list and wording** (`ESCALATION_RULES` in `src/server/care/body-map-ai.ts`). It should be
  reviewed by a clinical lead before live use.
- **Switching the AI on for Care Solution Bureau.** It stays off until someone authorises it in Rota Settings.

## Known limitations

- There is no Export button from the reference image. Use Print instead. "Add Area" opens Record Observation at the spot you click.
- The management view is the profile counts and bell notifications. There is no cross-person dashboard yet.
- Demo screenshots were taken with medication and the AI switched on in a local database only.
- Headless Chromium shows date inputs as mm/dd/yyyy in screenshots. Real UK browsers show dd/mm/yyyy.
