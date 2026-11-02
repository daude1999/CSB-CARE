# Flexible multi-carer visits (PR 1 of 4)

Owner's brief of 2 November 2026 ("Consolidated CRM development requirements", Part 1). Owner's choices: custom maximum
of 20 carers; on the locked Rota Dashboard and Daily Rota only the carer-count text changes.

## What changed

- A visit or template needs any number of carers from 1 to 20. Add Visit, the template form, the visit page and the
  Daily Rota / Daily Templates bulk bars offer 1 to 6 and "Custom…" (an exact number up to 20).
- Each carer fills a numbered place: Carer 1, Carer 2, Carer 3 … A shadow is separate and never counts.
- The visit page shows Required / Allocated / Outstanding and Fully staffed, Partially staffed or Unassigned, with one
  row per place: assign, remove (with a reason, kept in history), Find replacement, Find Cover for an empty place.
- Lowering the number is refused while a higher place is filled, naming who to remove first. Nobody is removed silently.
- Templates keep a preferred carer per place; build, roll forward, Unassigned Visits (partly staffed visits show e.g.
  3/4 and "1 of 4 carers still needed (Carer 4)"), Missed Calls cover, Find Replacement Cover, the optimiser and bulk
  reassignment all work with any place.
- Every assignment still goes through the eligibility service, the one assignment path and the database's
  no-double-booking constraint.

## Data model (additive)

| Change | Why |
| --- | --- |
| `AssignmentSlot` gains `ADDITIONAL` | places 3+ (places 1 and 2 keep `PRIMARY` / `SECOND`, so older records read as before) |
| `VisitAssignment.position` | the place number (1, 2, 3 … ; 0 for a shadow), kept in step with `slot` by a trigger; one live carer per place (`visit_assignment_place_uniq`) |
| `VisitTemplate.extraPreferredStaffIds` | preferred carers for places 3+ |
| `RotaPlanChange.slotPosition`, `MissedCallCover.slotPosition` | which place an optimiser change or a recovery booking is for |
| `visit_values_chk`, `visit_template_values_chk` | were "1 or 2 carers"; now 1 to 20 with every other rule unchanged |

Migrations `20261102120000_assignment_slot_additional` and `20261102120100_multi_carer_places` were applied to a local
copy of the seeded demo database: all 819 existing bookings were numbered 1 or 2 correctly.

## Tests

`tests/integration/multi-carer.test.ts` (15) and `tests/unit/carer-places.test.ts` (6).
