# Find Cover inside Missed Calls (phase 1, 1 Nov 2026)

> **2 Nov 2026:** Find Cover now opens the shared Find Replacement Cover panel, which adds a Contact & communication tab. See `REPLACEMENT_COVER.md`; the rules below still apply.

The owner's brief "Build smart replacement cover inside Missed Calls". Phase 1 is the single-visit workflow. Phase 2,
whole-day sickness cover, is **not built yet** (see the end of this page).

## What the coordinator does

1. On `/rota/missed` a missed call that can still be covered has a purple **Find Cover** button in the new Cover column
   (and on the phone cards). The same button is on the case page (`/rota/missed/[id]`), in step 2 and in the visit box.
2. A right-hand panel opens (540 px on desktop, full screen on a phone). The page behind keeps its filters, dates and
   search; the panel's state is in the URL (`cover=<case id>` and `fc*` parameters), so Close, Escape or the backdrop
   return to exactly the same list.
3. The panel shows the missed visit (service user, date, time and length, visit type, booked carer, reason, carers
   needed and still to cover, how long ago, and a priority: high risk, urgent within 2 hours, or standard).
4. Because the original window has passed, cover is a new **recovery visit**. The coordinator chooses its date and start
   time (default: the next quarter hour at least 15 minutes ahead; same length as the missed visit; within 48 hours).
5. **Recommended carers**: the top three carers the eligibility service allows for that time, labelled Best match,
   Suitable and Alternative, each with plain reasons (familiarity, area, weekly hours, gaps) and any warnings.
6. **Search Staff Manually** lists everyone the coordinator may book, searchable by name or area. Carers who fail a hard
   rule are shown greyed out with the reasons and cannot be chosen.
7. **More options**: staff availability (Advanced Rota for that date), other branches the coordinator may book from
   (only for members with more than one branch), Sickness & Holiday Cover, and Escalate to Manager.
8. **Review Replacement Cover** lists the details and the safety checks. Every warning has its own tick box and a reason
   is required; nothing is accepted through hidden fields.
9. **Confirm Cover** books the carer. The result shows what was saved, the recovery visit, whether the carer was told,
   links to the Daily Rota and the case, and the separate facts below. For a double-up, "Find the second carer" fills the
   second slot on the same recovery visit.

## Rules

- **Eligibility is a gate.** Ranking uses `slotCandidates` (the shared core of `visitCandidates`): `rankCarers` and the
  eligibility service judge everyone; `scoreMatch` orders only the people allowed. A score never makes anyone eligible.
- **The carer booked on the missed visit is not offered.** If they are on their way, it is a late arrival, recorded on
  the case. A visit whose carer has since clocked in shows "carer arrived late" and Find Cover is not offered.
- **The missed visit is never rewritten.** It keeps status MISSED, its time, clocks and case. The recovery visit is a
  new `Visit` with `recoveryOfId` pointing at it, its own reference, tasks copied from the missed visit, its own status,
  attendance and care records. It is published so the carer sees it in My Visits. It is never marked completed until
  the carer delivers it.
- **One path for bookings.** Confirm runs in one transaction: it locks the case row, re-reads the case and visit, checks
  the panel was looking at the same recovery visit (`seenRecoveryId`), re-runs the eligibility service, refuses any
  warning the coordinator did not tick and any blocking rule, creates the recovery visit (first carer) and books through
  `assignInTx`, which locks the visit and the carer and runs the eligibility service again. The database's no-overlap
  constraint is the final guard. Two coordinators confirming at once: one succeeds, the other is told cover was just
  booked.
- **Double-ups.** The recovery visit needs as many carers as the missed visit (1 or 2). Each slot is booked separately
  on the same recovery visit; no duplicate visits. Three- or four-carer visits are not supported by the data model.
- **Window.** Find Cover is offered for a missed call that started in the last 24 hours, whose case is New or
  Investigating, and where no other arrangement (family covered, not needed and so on) was recorded by hand. A cancelled
  recovery visit no longer counts, so cover can be found again.
- **Scope.** rota.edit is needed. The case and the staff list are limited to the member's organisation, branches and
  areas; another organisation's carer is "not found"; a branch-limited coordinator cannot book another branch's carer.
- **Not touched:** the sidebar, Sickness & Holiday Cover, templates, charging and pay rules.

## The investigation stays the record

Confirming sets the case's replacement care to "Replacement visit by another carer", adds a system comment and an audit
entry (`rota.missed.cover.confirmed`) and moves a New case to Investigating. It never closes the case. A `MissedCallCover`
row keeps: the method, recovery visit and slot, assignment, original carer, replacement, proposed time, recommended or
manual and its rank, the three carers suggested, the checks as judged at confirmation, accepted warnings and reason, who
confirmed and when, and the notification result.

The result and the case show these as separate facts, each from its own record:

| Fact | Where it comes from |
|---|---|
| Cover suggested | The carers shown when cover was confirmed |
| Cover confirmed | `MissedCallCover` while its recovery visit is live |
| Carer notified | An in-app notification was created for the carer's linked sign-in, and whether it has been opened |
| Carer accepted | The carer acknowledged the visit in My Visits (`VisitAssignment.acknowledgedAt`) |
| Recovery care started / delivered | The recovery visit's clock-in and completion |
| Service user informed | Recorded by the coordinator (told, representative told, not yet, could not reach) with who, how and when |
| Investigation signed off | The existing manager sign-off |

## Notifications

In-app only. A carer with a linked sign-in gets "You have been booked to cover a visit" with the date, time and visit
reference (no service-user details), linking to My Visits. A carer without a linked sign-in is not notified, and the
panel says so ("phone them"). No text, call, WhatsApp or email is sent, and the panel never says one was.

## Figures

The missed visit stays counted as missed. Where a recovery visit and the missed visit it recovers are in the same list,
the recovery visit is not counted again in the scheduled and completed totals (`countedOnce` in `overview.ts`, used by
the Daily Rota and Rota Dashboard figures and the Missed Calls call rings). Rota Reports and Rota Insights still count
every visit; that is listed below.

## Database

Migration `20261101020000_missed_call_cover` (additive): `Visit.recoveryOfId` (self relation, indexed, trigger keeps it
in the same organisation and never self-referencing), four `MissedCallCase.suInformed*` columns, and the
`MissedCallCover` table. Justification: the brief requires a reliable database link between the recovery visit and the
missed visit, and a durable record of each confirmation.

## Tests

| # | Brief item | Test |
|---|---|---|
| 1 | Opening Find Cover from Missed Calls | e2e `missed-cover.spec.ts` "opens from the register" |
| 2 | Closing without losing filters | e2e same test (Escape and the close button) |
| 3 | Opening from an investigation | e2e "Find Cover from a case" |
| 4 | Ranking eligible carers | integration "shows up to three carers, best first" |
| 5 | Rejecting non-eligible carers | integration (leave, restriction, training, block, original carer); e2e manual search |
| 6 | Reviewable warnings | integration "needs every warning ticked and a reason" |
| 7 | Manual staff selection | e2e manual search; integration confirms with source MANUAL go through the same checks |
| 8 | Real assignment persistence | integration "books a linked recovery visit" |
| 9 | Linked recovery visit | same |
| 10 | Original MISSED status preserved | same |
| 11 | Late arrival without duplicate booking | integration "does not book cover when the booked carer arrived late"; unit coverState |
| 12–14 | Single carer, double-up missing one, missing both | integration double-up tests; e2e books both slots |
| 15–16 | Sickness and annual leave | integration "excludes carers on approved sickness or annual leave" |
| 17 | Overlapping appointments | integration "never double-books a carer" |
| 18–20 | Training, readiness, service-user preferences | integration "blocks a readiness restriction, a training failure…, and a service user's block" |
| 21 | Stale recommendations | integration "refuses a stale choice" and the unticked-warning check |
| 22 | Concurrent coordinators | integration "lets only one of two coordinators book" |
| 23 | Notification results | integration "tells a carer with a linked sign-in in-app…" |
| 24 | Manager escalation | integration "escalates to the managers when nobody can cover" |
| 25 | Audit history | integration "books a linked recovery visit" (audit, comment, visit event) |
| 26 | Branch and organisation isolation | integration "never books another organisation's staff…", "branch-limited coordinator", "needs rota.edit" |
| 27–28 | Daily Rota and Weekly Planner | integration "shows the recovery visit on the Daily Rota and Weekly Planner"; e2e opens the Daily Rota |
| 29 | Accurate missed-call figures | same integration test; unit "counting a care need once" |
| 30 | No regression to investigations | existing `missed-calls.test.ts` and `missed-calls.spec.ts`, plus "keeps the existing investigation working" |

Test data is synthetic: `tests/support/missed-fixture.ts` makes a one-off visit an hour ago and lets the real call sweep
mark it missed.

## Reusing it elsewhere (for example Unassigned Visits)

- `src/components/drawer-shell.tsx`: the right-hand panel (URL state, Escape, focus trap, full screen on a phone).
- `src/components/cover-ui.tsx`: the panel header, `CarerOption` (a selectable carer from the ranking, greyed out with
  reasons when not eligible), `SafetyChecks`, and the button styles.
- `slotCandidates` (`src/server/rota/queries.ts`): the ranking for one slot of any visit, existing or proposed.
- `coverChecks` (`src/server/rota/missed-cover.ts`): turns an eligibility result into the labelled safety checks.
- For an upcoming unassigned visit, book through the existing `assignInTx` path, not `confirmCover` (which creates a
  recovery visit and is only for a missed call).

## Known limits

- Travel time is not calculated. Gaps next to other bookings are shown as time gaps, never as journeys, and nobody is
  called "nearest".
- Cover is for a missed visit only. An upcoming visit whose carer has called in sick still uses the existing reassignment
  path (the visit page's carer picker and Sickness & Holiday Cover), which keeps the visit and changes only that slot.
- The recovery visit follows the normal charging and pay rules for a visit. Finance should check it, as for any extra
  visit.
- Rota Reports and Rota Insights count the recovery visit as its own visit.
- Whether the carer received a notification is only known when they open it in the platform.

## Phase 2: whole-day sickness cover (not built yet)

Planned on top of Sickness & Holiday Cover: choose a carer who has reported sick, list all their affected upcoming visits
with a recommended replacement each, let the coordinator change any of them, check the whole plan for clashes, then
apply the safe changes with a transaction per visit and report failures. Nothing changes when HR records an absence.
