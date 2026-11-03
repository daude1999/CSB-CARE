# Daily Rota bulk actions: repair and Complete Calls (2 Nov 2026)

Owner's brief: "Evantix Care – Daily Rota Bulk Actions: Complete Functional Repair" (2 Nov 2026, "Review and build").
The Daily Rota design is locked; only the bulk bar, the new review/confirm step and the results changed. The same bar
is used on Unassigned Visits.

## How a bulk action runs now

UI (`src/components/bulk-visit-bar.tsx`) → Go opens the review (`bulk-review-dialog.tsx`) →
`previewBulkVisitsAction` → `previewBulkVisits` runs **the real rules** for every ticked visit inside a transaction
that is rolled back, so the review shows exactly what will change, what is already as asked and what will be refused
and why → Confirm → `runBulkVisitsAction` → `bulkVisits` (`src/server/rota/visits.ts`) applies the action **one visit
per transaction** (row lock on the visit, eligibility service for carers, database state machine and double-booking
guard) → per-visit `VisitEvent` + audit entry, plus one `visit.bulk.<kind>` audit entry with the counts → the page
refreshes and the results dialog lists every visit not changed, with its reason and a link. "Keep the visits not
changed ticked" leaves only those ticked so they can be fixed and retried; the successful changes stay.

Only the visits the review said will change are sent on Confirm. Without JavaScript the form still posts to
`bulkVisitsAction`, which now reports "N updated, N already as asked, N not changed (reasons)".

Each result is one of: **updated** (the visit changed), **unchanged** (already as asked: nothing is written, no event,
no version bump), **refused** (a rule stopped it; the reason is shown), **error** (unexpected; nothing changed on that
visit; logged).

## Audit of the existing actions (what was wrong, what changed)

| # | Action | Rules and path | Problem found | Fixed |
|---|---|---|---|---|
| 1 | Cancel Visits | reason (3+) and Charge / Don't charge → `cancelVisitInTx` | Cancelling an already-cancelled visit rewrote its reason, charge and time and reported "updated" (the state machine lets a status "change" to itself) | Already cancelled = unchanged; only scheduled or missed visits can be cancelled |
| 2 | Activate Visits | reason → shared `reinstateInTx` (same as the visit page's Reinstate) | Activating a scheduled visit wrote a status event and reported "updated"; it did not clear the cancellation charge decision | Scheduled = unchanged; missed visits are refused and pointed to Complete Calls; past visits refused; charge decision cleared |
| 3 | Reassign Visits | carer, place, accept warnings → `assignInTx` (eligibility service, row locks, no double-booking) | Re-assigning the same carer reported "updated" | Same carer in that place = unchanged |
| 4 | Unassign Visits | place, optional reason → `unassignInTx` | An empty place failed with "Assignment not found" | Empty place = unchanged "Nobody is booked as Carer 2" |
| 5/6 | Add / Remove Rota Lock(s) | `updateVisitInTx` | Locking a locked visit rewrote it, marked it changed by hand and reported "updated" | Already locked/unlocked = unchanged |
| 7 | Edit Times | new start, same length; locks, eligibility of every booked carer, template-day rule | Same time reported "updated" | Same time = unchanged |
| 8 | Edit Duration | 5–1440 minutes | Same length reported "updated"; the bar accepted 3 minutes until the server refused | Same length = unchanged; bar checks 5–1440 |
| 9 | Edit Service Name | active service call of the organisation | Same call reported "updated" | Same call = unchanged |
| 10/11 | Add / Remove Alerts | late alert on or off | Already on/off reported "updated" | unchanged |
| 12 | Add Shadow Shifts | carer → SHADOW place through `assignInTx` | none beyond the repeat case | Shadow never counts towards carers needed (tested) |
| 13/14 | Convert To Double Up / Revert To Single | | Both set the number to 2 or 1 regardless: "Convert to double up" on a 4-carer visit silently **lowered** it to 2 | Convert only goes 1→2 and Revert 2→1; a visit needing 3+ carers is refused and pointed to Change Carers Needed; repeats = unchanged |
| 15 | Change Carers Needed | 1–6 or Custom (up to 20); lowering refused while a higher place is filled | Same number reported "updated" | unchanged |
| 16 | Nudge Times | ±1–240 minutes; locks and eligibility | Bar let 0 through to the server | Bar checks the range |
| 17 | Publish to Carers | `rota.build` permission | Already-published visits were counted as "updated"; booked carers were not told (publishing a rota build tells them in the app); no per-visit audit; cancelled visits could be "published" | Already published = unchanged; cancelled/not delivered refused; in-app (bell) notice to booked carers as Build publish does, no email or text; per-visit audit |
| 18 | Complete Calls | new, see below | | |

Other fixes: the same visit ticked twice is processed once; a visit outside the caller's organisation or branches is
reported as "not found" without its reference; unexpected errors are logged and never shown raw; the overall audit
entry records updated / unchanged / refused / error counts.

**Selection.** The count is recounted on every tick, on Select all and whenever the rows change (refresh after an
action, a filter, another page), so it is never stale. Select all now shows part-ticked when some rows are ticked and
unticks itself when one row is unticked. Select all only ever covers the rows on the page in view (the label says so);
there is no cross-page selection. Go stays off until there is a selection, an action and every detail it needs, and
says what is missing. Enter in a field opens the review rather than applying anything.

## Complete Calls

Permission: `rota.clockCorrect` (organisation admin, care manager, care coordinator), the same people who may correct
attendance. Works on any date, past or today.

- Needs a reason (5+ letters), who confirmed the care was delivered (name and role) and, on the review, the tick "I
  confirm the care on these visits was delivered". Actual start and end times can be entered per visit, only if known
  (checked: end after start, not in the future, within 12 hours of the plan).
- Can complete: Scheduled (started), In progress and Missed visits with at least one carer booked.
- Refused with a reason: Cancelled and Not delivered (need a separate, authorised correction, not built in bulk),
  visits not yet started, and visits with nobody booked ("book the carer who delivered it first").
- Already completed (by clocks or the office) = unchanged, never completed twice. A visit changed after the review
  (its version differs) is refused for a fresh review. Two coordinators at once: each visit is completed exactly once
  (row lock + status check; tested).
- Warnings, not refusals: partly staffed ("Only 1 of 2 carers were booked"), medication support (no medicine record is
  created), no clock record, previously missed.
- What it writes: status → Completed (Scheduled passes through In progress inside the same transaction, as the
  database state machine requires), `completionSource = OFFICE_CONFIRMED`, reason, confirmed by, who and when,
  `completedFromStatus`, actual times only if entered or already clocked. One STATUS event from the original status,
  one `visit.completed.office` audit entry with before and after. A late alert is answered.
- What it never writes: clock-in or clock-out rows, MAR or other medicine records, task outcomes, invoices or pay.
- Missed visits: the missed STATUS event, the missed-call case and its investigation stay; the case gets a system
  comment and still needs its outcome and manager sign-off. Visits Needing Attention, the Missed Calls register, the
  case page and exports now say "Completed by the office (confirmed delivered)" instead of "Delivered late".
- Shown as office confirmed: Daily Rota status "Completed · office confirmed", the Visit Details panel ("Completed by
  the office … no clock record"), the visit page (reason, who confirmed, original status, no clock or medicine record).
- Finance: invoice runs follow their existing rules (a completed visit is chargeable; with actual-time charging and no
  actual times it is charged at the planned length and flagged "no actual times"). Timesheets add the exception
  "Completed by the office with no clock record: check the hours before paying" and pay nothing automatically for it,
  as for any unclocked visit.

Schema (additive, `20261102233000_visit_office_completion`): enum `VisitCompletionSource`, six nullable `Visit`
columns, and a check constraint that an office completion is only on a completed visit and always has its reason, who
confirmed it, who did it, when and the original status. Existing visits are unchanged (null = completed from attendance).

## Tests

`tests/integration/rota-bulk-actions.test.ts` (24 tests): every action updates, reports unchanged on repeat and
refuses with a reason; per-visit transactions; review saves nothing; permissions and tenant isolation; Complete Calls
with one, many (40), historical, missed, already completed, cancelled, not delivered, future, unstaffed, partly
staffed, mixed, actual times, today's in-progress visit, stale review and two coordinators at once.
`tests/e2e/bulk-actions.spec.ts`: all 18 options listed; count, keyboard, Select all part-ticked, Go rules, Enter opens
review; Complete Calls end to end with results, keep-failed-ticked, list refresh, repeat = no change, Visit Details;
Cancel with charge decision. `tests/e2e/rota.spec.ts` updated for the review step.

## Limits

- No cross-page selection: Select all covers the rows on the page in view.
- The review loads every selected visit's checks before Confirm; very large selections (up to 500) take a few seconds.
- Correcting a wrongly cancelled or not-delivered past visit is not part of this work.
