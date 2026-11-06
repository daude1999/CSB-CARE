# Direct publishing and the CSB central library

Owner's brief of 5 November 2026: "Remove mandatory approvals and implement a centrally managed policy library".
This replaces the earlier rule that every policy change needed a second-person approval before publication.

## What changed

| Area | Before | Now |
| --- | --- | --- |
| Lifecycle | Draft → Under review → Approved → Published | Draft → Published → Superseded / Archived (optional schedule) |
| Who publishes an organisation document | Anyone with `policy.publish`, only after approval | `policy.publish` (ORG_ADMIN, POLICY_APPROVER) directly from a draft |
| Who publishes CSB central content | `master.publish`, only after approval | `master.publish` (REGULATORY_REVIEWER, CONTENT_EDITOR, PLATFORM_ADMIN) directly |
| Policy authors | Draft and submit | Draft and save; told who can publish |
| CSB central update | A draft per organisation copy, waiting for that organisation's approval | Merged and published into every organisation copy automatically |
| Central documents an organisation has not copied | Only in Templates; had to be adopted | In the organisation's library straight away (by service type), read-only |
| Library statuses | Published, Not yet approved, Under review, Approved… | Current, Updated, Draft, Due for Review, Review Overdue, Archived |
| Review & Approval Queue | Three approval steps | **Drafts** (my drafts, other drafts, scheduled) |
| New | — | **Monthly Updates** register (`/policies/updates`) |
| Settings | "Approvals required" (1–3) | Explanation of publishing rules (no setting) |

## Database

Migration `20261106010000_direct_policy_publishing` replaces `evx_policy_version_guard`. It only adds transitions:
DRAFT/CHANGES_REQUESTED → PUBLISHED or SCHEDULED, UNDER_REVIEW/CHANGES_REQUESTED → DRAFT, SCHEDULED → DRAFT.
Every old transition is still allowed. Content stays frozen outside DRAFT/CHANGES_REQUESTED, the one-published-version
index and the immutability of approval decisions and the audit log are unchanged. No rows are rewritten.

## Server (`src/server/policies`)

- `workflow.ts` `publishRevision`: checks permission, active policy, open draft, publishable state, stale base (and
  again under a row lock in `performPublication`), content integrity (fingerprint), not identical to the current
  version, no `[REVIEW REQUIRED]` markers in generated drafts, no local sections changed by an automatic revision, a
  summary of changes when replacing a version, and the generator's pre-publication confirmations. A legacy
  UNDER_REVIEW draft is moved to DRAFT first; pending review assignments are closed (status `CLOSED`), never deleted.
- New: `cancelScheduledPublication`, `returnToDraft`, `discardDraft`. A cancelled publication row is reused on the next
  publish (one publication per version). Old schedule jobs do nothing before the current scheduled time.
- `sync.ts` `syncCustomersFromMaster`: three-way merge per organisation copy, published straight away through the same
  locked publication step; conflicts (sections the organisation customised that CSB also changed) keep the
  organisation's wording and notify its policy people. Idempotent; one organisation's failure doesn't stop the others.
  Editable drafts in progress are carried forward onto the new version.
- `library-view.ts` `centralWhere`: published central documents matching the organisation's branch service types
  (or with no service types), excluding any it has copied.
- `updates.ts`: the Monthly Updates register (own documents, copies and central documents; UK calendar months).

## Unchanged on purpose

- AI and regulatory drafts are never published automatically; a person publishes them.
- Staff reading and acknowledgement are separate from publishing and work as before.
- Completed form records (`src/server/forms/records.ts`) keep submit → review → approve, never by the person who filled
  them in. Care plans, HR, medication, incidents, CQC and RCA approvals are untouched.
- `submitForReview` and `decide` remain for optional review and for drafts already in review; separation of duties
  still applies there.

## Known limitations

- Central documents used as published (no organisation copy) cannot carry an organisation's own read-and-sign
  assignment; make an organisation copy ("Customise for us") to assign it to staff.
- The Policy Library list now includes eligible central documents, so the "My Policies" count can be higher than
  before for organisations that had not adopted every relevant document.
