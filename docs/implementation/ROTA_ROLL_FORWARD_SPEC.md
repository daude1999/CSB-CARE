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

## Preview fix and simpler workflow (3 Nov 2026)

**What was wrong with Preview.** The Preview button submitted a plain GET form, so every press reloaded the whole Build
Rota page and worked the plan out again with no sign inside the dialog that anything was happening (the page's progress
bar sits under the dialog's backdrop). The comparison table also listed only the visits to be created. With the owner's
week (1,206 visits copied, 1,204 already in the destination, 2 new) the table showed the same 2 rows whatever was
chosen, so a finished preview looked exactly like the one before it.

**What changed.**
- Preview Rota now asks the server for a fresh plan in place (`router.replace`, or `router.refresh` for the same
  choices) inside a React transition. The dialog stays open, the choices stay as chosen, the old results are dimmed with
  "Updating the preview…", and "Preview updated at hh:mm:ss" confirms the new plan. The form still works as a plain GET
  without JavaScript.
- The preview shows the whole destination rota: every visit already there (never changed), every new visit and every
  skipped one, labelled Already exists, New visit, Different from source, Carer retained, Needs review, Uncovered and
  Skipped, with a Weekly view (grouped by day) and a Daily view, a week picker for 2 to 4 weeks, and a search.
- Each plan carries a fingerprint (a digest of the choices, every proposed visit and carer, skips and matches). Save as
  Draft sends the fingerprint of the preview on screen and the server refuses with a clear message if the plan worked out
  at save time differs, so only the reviewed plan is ever saved. Save is paused while the choices on screen differ from
  the previewed ones.
- Simpler steps: Copy Rota From, Copy Rota To (the week after is suggested), Preview Rota, Save as Draft, then Roll
  Forward Next Week (after saving, the week just saved becomes the source and the following week the target). How many
  weeks and Areas are under More options. Every earlier capability (1 to 4 weeks, any dates, areas, eligibility checks,
  multi-carer places, medication leads, routes, tasks, duplicate prevention, estimates, drafts, publishing, audit) is
  unchanged.

**Tests.** `tests/integration/roll-forward.test.ts` (preview writes nothing; same answer for the same rota; stale preview
refused; whole destination listed) and `tests/e2e/roll-forward-preview.spec.ts`, which builds the owner's scenario from
synthetic data with `tests/e2e/fixtures/roll-forward-scenario.ts` and changes each field in turn.
