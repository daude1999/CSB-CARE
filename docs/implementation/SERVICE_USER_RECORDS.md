# Service user profile records (2 Nov 2026)

Part 3 of the consolidated requirements, together with Part 7 (visit notes), Part 8 (compliance overview) and the incident prompt from Part 9. This work includes PR #58, which first added Care Plans, Risk Assessments and Incidents tabs to the profile. Council and Other Documents and the Digital Body Map (Parts 4 to 6) are built separately and slot into the groups below as `documents` and `bodymap`.

## Profile sections

The bar has eight groups, each opening its first section. A group with more than one section shows a second row:

| Group | Sections (`?tab=`) |
|---|---|
| Overview | `overview` |
| Personal details | `details` |
| Care | `care-plans`, `risks`, `package`, `medication` |
| Health and safety | `incidents`, `bodymap` (separate build) |
| Visits | `visits`, `notes`, `missed` |
| Documents | `documents` (separate build) |
| Contacts & carers | `people` |
| History | `history` |

A group is hidden when the viewer can't open any of its sections. Incidents need `incident.report`, and visit notes need `rota.view`. Old links such as `?tab=risks` still work.

## Records and compliance (Overview)

"Records and compliance" replaces the old "Care at a glance" card and keeps its test id. It has one line per kind of record, each counted from real records (`serviceUserCompliance` in `src/server/care/su-records.ts`):

- **Care plan:** in use, review due within 30 days, review overdue, or no plan in use. It also notes any version that is awaiting approval or in draft.
- **Risk assessments:** past review date, due within 30 days, or all in date, with the active and high-risk counts.
- **Incidents:** open incidents, with the number of safeguarding concerns. A reporter without `incident.manage` sees only their own reports, as elsewhere.
- **Visit notes, last 30 days:** concerns, with the total number of notes.

## Risk assessments

- New fields on each assessment:
  - **actions still required**
  - **who is responsible** (required when actions are listed)
- Every create, review and archive saves a permanent row in `RiskAssessmentVersion`. A database trigger stops these rows being edited, and stops them being deleted while the assessment exists.
- The assessment page lists every version, and `?v=N` opens an earlier version read-only.
- Assessments that existed before this change get their current content as the first version. The audit log still holds their earlier changes.
- The profile list shows a review marker for each assessment: **Review overdue**, **Review due soon** (within 30 days) or **In date**. It also shows actions and the version number, and lists archived assessments separately.

## Incidents

- **Who was told** is recorded when an incident is reported and can be updated during review. Each change is kept in the incident timeline, showing the old and new values.
- An incident about a person prompts managers to review that person's risk assessments. This applies to a fall, injury, medication error, health deterioration or behaviour incident, and to any high or critical incident. The prompt is an in-app notification that links to the person's Risk Assessments. It never changes an assessment, and nothing is sent outside the CRM.
- The organisation-wide incident register stays in the People menu. Each profile lists that person's incidents and can report a new one with the person already filled in.

## Visit notes

The person's visit notes are listed newest first, over 30 days, 90 days or 12 months. They can be filtered by kind and searched. Each note shows:

- its visit and planned time;
- the actual time where clock times exist;
- who wrote it, and whether it came from the office.

Notes stay append-only. No visit monitoring was added.

## Menu

Care Plans and Risk Assessments are no longer tabs in the People menu, because they are now opened from the person. Their old addresses still work and still light up Service Users in the menu.

## Tests

- `tests/integration/su-records.test.ts` (9 tests):
  - versions on create, review and archive, frozen in the database;
  - a stale review is refused;
  - the responsible person is required when actions are listed;
  - review markers;
  - lists show only this person's records;
  - who was told, and changes to it in the timeline;
  - the risk review prompt, and no prompt when the incident isn't about a person;
  - visit notes for this person only;
  - the summary counts;
  - another organisation sees nothing.
- `tests/e2e/su-records.spec.ts` (3 tests):
  - grouped sections and sub-sections;
  - recording and reviewing a risk assessment, then reading version 1;
  - reporting an incident from the profile with who was told.
- Updated for the menu change: `tests/unit/rota-nav.test.ts`, `tests/e2e/navigation.spec.ts`, `tests/e2e/platform-quality.spec.ts`.

Screenshots (synthetic local data) are in `screenshots/service-user-records/`.
