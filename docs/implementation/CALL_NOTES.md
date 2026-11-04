# Service user Call Notes (4 Nov 2026)

Owner's brief: "CSB CARE – Service User Call Notes & AI Coordinator Integration" (Mohamed Mire, CEO). Draft PR only;
no merge or deploy until the owner approves the screenshots.

## Where it is

Rostering → Service Users → a person → **Call Notes** (`/rota/service-users/[id]?tab=call-notes`), a new main group
between Contacts & carers and History. Visit Notes stay under Visits, unchanged.

## What it does

| Step | How |
|---|---|
| Receive | Add Call Note (inline form, no modal): date, time, method (Telephone, Face-to-face, Email, Meeting, Video call, Other), person contacted, relationship or role, contact on record, summary, detailed notes, clarification, follow-up (owner, due date), related document, restricted. Person and recorder come from the session. |
| Extract / classify | **Organise** (AI when the Care Coordinator AI switch is on and a real provider is configured; otherwise the basic organiser on CSB's own server, labelled "no AI"). Each bullet gets a kind (confirmed fact, third-party report, unverified, preference or request, professional advice, formal authorised instruction) and a destination (Call Notes, Care Plans, Risk Assessments, Medication reconciliation, Care Package / Rota, Visits, Incidents / Body Map, Safeguarding, Contacts & Carers, Personal Details, Documents). |
| Never invent | Every bullet must quote the original text. A bullet whose quote is not in the text is shown, marked, and left out by default. The original text and the proposal are frozen once saved (database trigger). |
| Compare | Duplicate check against previous Call Notes, Visit Notes (90 days), current and historical care plans, risks, medication (with medication access), incidents (incident visibility), contacts, personal details, Care Coordinator intake facts and documents — each read with the viewer's own permissions. Findings: New, Exact duplicate (suggest Link), Possible duplicate, Update to existing, Conflict requiring review. Nothing is merged or deleted. |
| Review | The coordinator checks every bullet (text, kind, destination, decision: keep / send to its record / link to existing / leave out), follow-ups and clarifications, then saves. AI-assisted notes and coordinators' notes wait for a manager who did not write them (Approve, Request clarification, Reject). A manager's own typed note without AI is recorded as approved. |
| Save / route | On approval, each "send to its record" item becomes an item in the existing Care Coordinator review queue (`CareIntakeReviewItem`) for that destination, linked from the note. Medication, incident and safeguarding items are restricted. Nothing in the care plan, risks, medication, rota, contacts or personal details changes from a Call Note; a person with that record's permission does it through its own workflow and closes the item with what was done. |
| Link | Links to care plans, risks, visits, incidents, contacts, documents, intakes, other notes and review items; shown only when the viewer may open the destination. |
| Follow-up | Tasks with description, assignee, priority, due date, status, completion notes and evidence (a document of this person). In-app notification on assignment, listed in Active Reminders (Rota Dashboard and /rota/reminders), daily in-app reminder when overdue (maintenance tick). Closed only by the assignee or a manager, with a note; never automatically. |
| Urgent | Safeguarding, medication and safety concerns are flagged by the server's own rules as well as the AI, shown in a red banner with the link to the incident and safeguarding workflow, make the note restricted (safeguarding), and notify managers in-app (no e-mail). A manager records the action taken and can link the incident. |
| Corrections | Correct keeps the previous summary, notes and clarification as an immutable revision; the corrected note goes back for review. Superseded marks a note as replaced by a later one. Drafts can be withdrawn. Notes are never deleted. |
| Audit | Every step writes the audit log (`entityType: CallNote`): created, organised (reader, items, unquoted), submitted (human edits vs the proposal), reviewed, routed, linked, tasks, corrections, escalation. Shown in each note's History. |

References are `CALL-<year>-<6 digits>` from a per-organisation, per-year counter (`CallNoteReferenceCounter`), never
reused. Each form carries a one-time key, so a repeated or retried submission returns the first note.

## AI Care Coordinator

A new intake section **Call Notes** (destination `callnote`). The AI reading schema has an optional `communications`
list, and the basic reader recognises labelled lines such as "Telephone call with social worker: …". The coordinator can
also add a meeting or conversation note by hand. After a manager approves the section, Save to record creates an
approved Call Note linked to the intake, with its source document and page. Structured information keeps going to its
own sections, so the two sets of proposals stay separate. Existing intakes get the new section in the migration.

No telephone recordings or e-mail inboxes are connected: notes come from what staff type and from uploaded documents.

## Permissions

`callNote.view` (admin, care manager, coordinator, compliance lead), `callNote.record` (admin, care manager,
coordinator), `callNote.review` (admin, care manager). Restricted notes: author and `serviceUser.sensitive` only;
others see a count of hidden notes. All reads go through the person's organisation, branch and area scope.

## Data (migration `20261104220000_call_notes`, additive)

`CallNote`, `CallNoteItem`, `CallNoteRevision` (append-only trigger), `CallNoteLink`, `CallNoteTask`,
`CallNoteReferenceCounter`; trigger `call_note_guard` (no delete; original text, proposal, reference, person and author
frozen after draft); back-fill of the `CALL_NOTES` section for existing intakes. No existing table or column changed.

## Known limits

- The basic organiser uses keyword rules; it copies clauses and does not rephrase. The AI organiser needs
  `AI_PROVIDER=anthropic` and the Care Coordinator AI switch on in Rota Settings.
- Follow-up tasks are their own table (`CallNoteTask`), connected to the existing Active Reminders list, notifications
  and maintenance tick; the body map's and compliance actions' task tables were not reused because both are tied to
  their own records and permissions.
- Urgent notes from an intake are flagged on the note but do not send the immediate manager notification.
