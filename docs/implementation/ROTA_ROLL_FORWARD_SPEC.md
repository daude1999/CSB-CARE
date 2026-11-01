# One-Click Roll Forward

Status: built on branch `claude/project-thread-v3f4gj` (PR #33). Code: `src/server/rota/roll-forward.ts`, the Roll Forward dialog on `/rota/build`, `rollForwardAction` in `src/app/rota-actions.ts`. Tests: `tests/integration/roll-forward.test.ts`.

## Purpose

Build Rota creates a week from the regular-call templates. Offices also change a week by hand (a call moved 20 minutes, a carer swapped, an extra visit). Roll Forward copies a built week **as it is now** into the next 1, 2, 3 or 4 weeks, so those changes are not lost, and re-checks every carer for the new dates.

## How it works

1. The coordinator opens **Build Rota → Roll Forward** (or "Roll forward" on a built week's row), chooses the week to copy, the first new week and 1, 2, 3 or 4 weeks, and optionally some areas.
2. **Preview** (nothing saved) shows, per visit, the previous carers next to the proposed carers, with one of three outcomes per slot:
   - **Kept**: the same carer passes every eligibility check on the new date.
   - **Review**: the same carer is allowed but has warnings to read (for example a DBS review due).
   - **Uncovered**: the carer cannot take it (absence, clash, HR block, outside the member's branch) or the slot was empty. The reason is shown.
   It also shows visits to create, visits already in place, skipped visits with reasons, care hours, double-ups that will be short, and an estimated basic pay figure from pay rate cards (slots without a rate are counted and left out, never guessed).
3. **Save N visits as drafts** creates one unpublished Rota Build per week (`summary.source = "roll-forward"`). Drafts are published, reviewed or deleted exactly like a template build.

## Rules

| Rule | How it is enforced |
|---|---|
| Never duplicate a call | A visit is skipped as "already in place" if the same template exists on that date, or the same service user has a visit at the same start. The database's one-visit-per-template-per-day index is the final guard. Saving twice is refused. |
| Every carer goes through the eligibility service | Each copied carer is re-evaluated with `evaluate()` for the new times, booking them in memory as the plan proceeds so later visits see earlier bookings. Not eligible means the slot is left empty, never booked. |
| Nothing in the past | Visits whose start has passed are skipped. The new week cannot be in the past and must come after the source week. |
| Inactive or away service users | Skipped with "Care is paused/ended" or "Service user away (reason)". |
| Branch and area limits | The source visits are read through `visitWhere(scope)`. Carers outside the member's branch are dropped with a reason. A branch coordinator's drafts contain only their branch's visits and carers. |
| Concurrency | `pg_advisory_xact_lock` per organisation and week; the plan is recalculated inside the saving transaction. |
| Audit | `rota.rolled_forward` audit entry, `CREATED` visit events with `source: "roll-forward"`, an in-app alert for unassigned slots. No outbound messages. |

## Inputs (validated)

`sourceWeek` and `targetWeek` are ISO Monday dates; `weeks` is 1, 2, 3 or 4; `areaIds` are limited to the member's areas. Invalid input gives a readable `ValidationError`.

## Known limits

- Pay estimates are basic pay from rate cards only, not payroll (no mileage, enhancements outside bands, or holiday accrual).
- The preview table shows the first 500 rows; the counts cover everything.
- Run routes are copied by name into the new week (an existing route of the same name that week is reused). The route keeps its original carer even if that carer was dropped from the visits, so check routes after a roll forward with many uncovered slots.
