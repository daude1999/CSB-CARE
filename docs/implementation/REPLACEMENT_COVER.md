# Find Replacement Cover and Contact & Communication (2 Nov 2026, draft PR)

The owner's brief of 1 Nov 2026 (23:43): one Find Replacement Cover panel and service for every kind of cover, a
Contact & Communication section that records how the service user (or their representative) was told, and compact
Back/Forward controls in the platform header (a separate commit).

## What the coordinator sees

One slide-out panel, **Find Replacement Cover**, opened from the screens that already had a Find Cover button:

| Entry point | Opens | Default kind |
| --- | --- | --- |
| Unassigned Visits (`/rota/unassigned`) | the visit's empty place | fill |
| Visits Needing Attention (`/rota/attention`): Find Cover and Manual | the visit's empty place | fill |
| Missed Calls register and case (`/rota/missed`, `/rota/missed/[id]`) | a recovery visit for the case | recovery |
| Daily Rota (`/rota/visits`): visit inspector footer | the visit | fill, or replace if no place is empty |
| Visit page (`/rota/visits/[id]`): per carer place | that place | fill (empty) or replace (booked) |
| Sickness & Holiday Cover (`/rota/cover`): Find replacement | the absent carer's place | replace |

No new sidebar items, pages or modules. The Rota Dashboard and the Daily Rota layout are unchanged; the Daily Rota only
gained the panel (opened with `?cover=`) and one link in the existing inspector footer.

The panel has two tabs.

- **Cover**: the visit summary, then recommended carers (top three who pass every hard rule), a manual search of
  everyone the coordinator may book (with the reason a carer is greyed out), a review step with every safety check,
  then Confirm. A double-up shows the two places; the coordinator picks which one to fill or replace.
- **Contact & communication**: the state of communication for this visit, the service user's own details, then their
  contacts, a form to record an attempt, and the history.

Booking and recording communication are separate actions. Booking never records that anyone was told, and recording
communication never books cover. After booking, the panel says the communication is still outstanding and links to it.

## Three kinds of cover, one service

`src/server/rota/replacement-cover.ts`

- `coverWorkspace(ctx, target, input)` builds what the panel shows for `fill`, `replace` or `recovery`.
  - fill and replace rank carers with the same `slotCandidates` the rest of the rota uses. The carer being replaced is
    listed but cannot be chosen.
  - recovery wraps the existing missed-call `findCoverView`, so its rules stay as they were. The missed visit is never
    changed; a recovery visit is created and linked to it.
- `bookCover(ctx, input)` books fill and replace in one transaction:
  - It locks the visit row, then checks that the place still holds the carer the coordinator saw (`expectStaffId`) and
    that the visit version is unchanged (`lockVersion`).
  - It checks eligibility again. Every current warning must have been ticked, with a reason.
  - The booking goes through `assignInTx`, the single assignment path, which locks the carer and checks once more. The
    database's no-overlap constraint is the last guard.
  - A replace needs a reason, which is kept on the removed assignment and in the visit history. Only the chosen place
    changes; the other carer on a double-up stays as booked.
  - A repeated submission for the same carer is not booked twice.
- Recovery booking still uses `confirmCover` in `missed-cover.ts`.

## Contact & Communication

`src/server/rota/cover-communication.ts`, with the UI in `src/components/cover-communication.tsx` and
`cover-contact-form.tsx`.

**Contacts.**

- The service user's own details are shown first: phone, alternative phone, email, preferred method and communication
  needs.
- Then their contacts, primary first. Each shows relationship, both phones, email, preferred method, the primary-contact
  badge, whether they may receive updates, and any recorded authority with its scope.
- Authority is shown only when it is recorded, as a lasting power of attorney contact type or the new authority fields.
  It is never inferred from being next of kin.
- Phone numbers have `tel:` links and Copy buttons, and a missing number or email is flagged. Clicking a phone link
  records nothing.
- Users who may edit service users get an "Edit contact details" link to the profile's People tab.

**Attempts.** Each attempt is a new row in `CoverContactAttempt`. It records:

- who was contacted, as a snapshot of the recipient's name, relationship, number or address and authority at the time;
- the method (phone, SMS, email, other) and the outcome (informed, no answer, message left, contact unsuccessful, or
  not applicable with a reason);
- notes, and an optional follow-up with an owner and due time;
- the acting user from the session, a server timestamp, and a separate time of contact for something that happened
  earlier;
- a snapshot of the arrangements (who is coming, and when) the person was told about.

A form token stops a double submission from saving twice.

**States**, worked out from the effective entries against the visit's arrangements as they stand now:

- Not yet contacted
- Attempted — awaiting confirmation (no answer, message left, unsuccessful). A message left is never "informed".
- Informed
- Not applicable
- Updated arrangements need communicating: the carer, time or cancellation changed after the person was told.

**History is protected.** The `csb_cover_attempt_guard` trigger:

- makes attempts append-only (only a follow-up can be closed, once);
- refuses a visit, contact, case or correction from another organisation or service user.

A correction is a new entry that points at the one it corrects, with a reason. The original stays and is shown as
corrected. Only the latest version can be corrected. There is no delete. Audit entries hold ids and outcomes only, never
numbers, names or notes.

**Outstanding communication** is listed on Visits Needing Attention ("Communication Outstanding") for visits whose cover
was arranged through Find Cover (or that already have attempts), from 24 hours ago to 14 days ahead. Each row shows the
coordinator responsible (the follow-up owner, else whoever booked) and the time it is due (the follow-up time, else the
visit start). It never blocks booking.

**Missed calls.** An attempt made from a recovery records against the case too. It updates the case's "service user
informed" fields and adds a system comment, so the existing case screen stays accurate.

## Unsaved work

- The communication form keeps a draft in session storage while it is being typed. The draft comes back if a save fails
  or the panel is reopened, and is cleared after a successful save.
- Leaving with unsaved entries asks first: on links, on closing the tab, and on the header Back/Forward buttons.

## Schema (additive migration `20261102000000_cover_communication`)

- `ServiceUser`: `altPhone` and `preferredContactMethod`. The profile form has no other way to hold a second number or a
  preferred method.
- `ServiceUserContact`: `isPrimary`, `altPhone`, `preferredContactMethod`, `authorityType` and `authorityScope`.
  Authority must be recorded explicitly and never inferred.
- New `CoverContactAttempt` table with the guard trigger.

Every new column is nullable or defaulted, so no existing row changes. Nothing is dropped.

## Header Back and Forward (separate commit)

`src/lib/app-history.ts` (pure rules) and `src/components/history-nav.tsx`.

- Each history entry Next.js creates is tagged with its position in `history.state`, beside Next.js's own fields. Back
  is offered when a platform page is behind; Forward when one is known to be ahead.
- Neither button ever leads to another site. Availability never comes from `history.length`.
- A direct link, a bookmark or an address typed in starts with both disabled.
- Refresh keeps the position.
- Full page loads into or out of the HR Hub, and plain GET forms, carry the position through session storage.
- Coming back from another site never offers Forward to that site.
- Filters are kept because they are in the address. Scroll position is restored after Back/Forward inside the app.
  Pages that use unsaved-change markers (`data-unsaved="true"`) ask before leaving.
- The buttons are in the shared top bar from tablet width up. The approved Overview header is not changed; tracking still
  runs there so its pages count.

## Tests

- Unit:
  - `tests/unit/cover-communication.test.ts`: states, arrangements, tel links, authority, link parsing.
  - `tests/unit/app-history.test.ts`: Back/Forward rules.
  - `tests/unit/coverage-rules.test.ts`: review checks.
- Integration:
  - `tests/integration/replacement-cover.test.ts`: contacts; snapshots and order; message left ≠ informed; duplicate
    submissions; corrections and the trigger; follow-ups; booking with communication outstanding; arrangement change
    flags an update; two coordinators booking at once; stale version; double-up replace; recovery keeps the missed
    visit; other organisation, branch and role.
  - `tests/integration/unassigned-coverage.test.ts`: ported to the shared service.
- Browser: `tests/e2e/unassigned.spec.ts`, `rota.spec.ts`, `navigation.spec.ts` and `missed-cover.spec.ts` were updated
  for the shared panel. `tests/e2e/replacement-cover.spec.ts` covers communication; `tests/e2e/header-history.spec.ts` covers the header controls.

## Limitations

- Travel time between visits is not calculated (unchanged).
- SMS, email and other methods are recorded only; nothing is sent from the platform.
- Retention follows the service user record (deleting a service user deletes their attempts). No separate retention
  schedule has been added, and nothing is kept indefinitely beyond the record.
- On Unassigned Visits the inline panel is now the shared slide-out panel. On Sickness & Holiday Cover, the inline
  one-click recommendation list is replaced by a Find replacement button that opens the same panel.
- The browser's own Back button cannot be intercepted for unsaved changes inside the app; the header buttons and links
  ask first, and the communication draft survives in session storage.
