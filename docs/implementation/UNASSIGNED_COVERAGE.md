# Unassigned Visits, Find Cover and Coverage History (1 Nov 2026)

> **2 Nov 2026:** Find Cover now opens the shared Find Replacement Cover panel, which adds a Contact & communication tab. See `REPLACEMENT_COVER.md`; the rules below still apply.

Owner's brief "CSB-CARE — UNASSIGNED VISITS REDESIGN + SMART COVER + COVERAGE HISTORY". The screen at `/rota/unassigned`
now matches the Daily Rota (`/rota/visits`) in type, colour, tables, filters, inspector and pagination. The sidebar is unchanged.
The concept image was a guide only; the written brief wins where they differ.

## Where things live

| Piece | File |
|---|---|
| Page and tabs (`?tab=live`, `?tab=history`) | `src/app/(app)/rota/unassigned/page.tsx` |
| Live list (summary, filters, bulk bar, table) | `src/components/unassigned-live.tsx`, service `src/server/rota/unassigned.ts` |
| Find Cover panel (Recommended, Manual, Review) | `src/components/unassigned-cover.tsx`, service `src/server/rota/unassigned-cover.ts` |
| Booking | `confirmCoverAction` in `src/app/rota-actions.ts` → `assignCarer` (`src/server/rota/assign.ts`) |
| Coverage History | `src/components/coverage-history.tsx`, service `src/server/rota/coverage.ts` |
| Exports | `GET /api/rota/coverage?format=xlsx|pdf` (same filters as the screen) |
| Shared list pieces | `src/components/rota-list-ui.tsx` |

## Live tab rules

- A visit is listed when it is SCHEDULED or MISSED, has not ended, and has fewer live (non-shadow) carers than it needs (capped at 2).
  Past missed visits stay in Missed Calls and Coverage History.
- Priority: **Urgent** if it starts within 2 hours (or has started), **High** within 24 hours, otherwise **Normal**.
- The summary shows only: unassigned visits, urgent, partially staffed, and empty carer places. No figure cards.
- Old links (`?from=&days=`) still work and become a custom range (at most 28 days).
- One bounded SQL query finds the short visits (limit 2,000, with a "showing the first 2,000" note), then one paged query loads them. There are no per-row queries.

## Find Cover

- Recommended and Manual both come from the same ranked candidate list (`visitCandidates` → eligibility service). Recommended is the top 3 that the rules allow. Manual searches the same list by name, so a hand-picked carer gets exactly the same checks. Ineligible carers are shown greyed out with their reasons and cannot be selected.
- Names only. No photos or avatars, and no travel or GPS figures. A time gap between bookings is labelled as a gap, not a journey time.
- **Review Assignment** runs eligibility again and shows each check (employment, DBS, right to work, training, readiness, absence and availability, bookings, weekly hours, preferences, area). Any warnings must be acknowledged with a checkbox.
- **Confirm Assignment** books through `assignCarer`, which locks the rows, checks `lockVersion`, runs eligibility a third time and keeps the other carer on a double-up. If a new warning has appeared since the review, the booking is refused with "Something changed since you reviewed this carer" (`acceptedWarnings`).
- The confirmation only says what is recorded: who was booked, and whether the visit is published to carers. It never says a carer accepted or was notified.
- **Suggested cover plan** (Actions menu, rota.build only) uses the existing Generate & Optimise service for the chosen days. It opens a review screen and changes nothing until each proposal is accepted.

## Coverage History definitions

- The period defaults to the last 7 completed London days ending yesterday. Ranges of 7, 14, 30 or 90 days are available, or custom dates (up to 92 days, ending today at the latest). A range that includes today is marked as partial, and visits not yet due today are counted separately.
- **Attended:** at least one effective clock-in (superseded clocks are ignored) or a completed status.
- **Without recorded attendance:** missed, not delivered, or past its end with no clock record.
- **Cancelled:** in the total, but left out of the attendance rate.
- The figures always reconcile: attended + without recorded attendance + cancelled (+ not yet due) = total. The screen prints the sum.
- **Reassigned:** the visit's carers changed after it was first staffed (from `VisitAssignment` rows kept with `removedAt`). It is a **late reassignment** when the change came less than the threshold (15/30/60/120 minutes, default 30) before the start.
- Each visit row shows the original versus the actual carer, per-carer attendance on double-ups, and effective clock times. The View History panel shows a timeline from stored assignments, events, clocks and the missed-call case.
- **Branch comparison** is shown only to people with `rota.settings` or `rota.missed.signoff`.
- **Exports** apply the same permission and filter checks. The Excel file has Summary, Daily and Visits sheets. The PDF is a sectioned report. Exports are capped at 5,000 visit rows (and say so).

## Limitations (stated plainly)

- Notifications to carers are not listed in the timeline, because the platform does not record their delivery. "Acknowledged" is shown only where `acknowledgedAt` is stored.
- Linking a recovery visit to a missed-call case belongs to Missed Calls Find Cover (a separate thread). The Coverage History links to the case instead.
- Find Cover here uses its own panel and check grouping. When Missed Calls Find Cover is merged, the two should share the drawer and check components (`cover-ui.tsx`, `coverChecks`) as a follow-up.

## Tests

- Unit: `tests/unit/coverage-rules.test.ts` (classification, reconciliation, staffing history, per-carer attendance, periods incl. DST, priority, reasons, legacy links, check grouping).
- Integration: `tests/integration/unassigned-coverage.test.ts` (scope, board, Find Cover options, booking with stale-warning refusal, double-up preserved, coverage report, timeline, exports).
- Browser: `tests/e2e/unassigned.spec.ts`, plus the updated booking flow in `tests/e2e/rota.spec.ts`.
