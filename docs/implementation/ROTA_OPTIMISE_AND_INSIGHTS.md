# Generate & Optimise, Rota Insights and the run route time-gap check

Added on 31 October 2026, branch `claude/project-thread-v3f4gj`.

## Generate & Optimise (`/rota/optimise`)

**Purpose.** Fill the open carer slots in a date range (1 to 7 days) with as little hand work as possible, without
giving up any safety rule. The coordinator reviews every change before anything happens to the rota.

**How a plan is made** (`src/server/rota/optimise.ts` → `optimiser.ts`):

1. Load the scheduled, future visits in the range that the member can see (`visitWhere`), and their open slots (lead,
   plus second on a double-up).
2. For each open slot, ask the eligibility service for carers (`visitCandidatesMany`). `NOT_ELIGIBLE` carers are dropped
   before the optimiser sees them, so a score can never override a hard rule.
3. The optimiser runs three bounded, deterministic passes (budget: 50,000 fit checks):
   - **Pass 1, booked times.** Hardest slots first (fewest allowed carers, then earliest). For each slot it picks the
     best carer who fits: clean passes before carers with warnings, then by match score, then by name.
   - **Pass 2, time adjustments.** For slots still open, it tries moving the visit by 5, 10 and 15 minutes (up to the
     limit you set), earlier before later and smallest change first. It never moves a time-locked visit or one that
     already has a carer.
   - **Pass 3, one-step swaps.** A carer who is blocked only by a booking this plan proposed can take the slot, if that
     other booking can go to someone else at its own time.
4. "Fits" means three things: there is no clash with live bookings or the plan's own proposals, the time gap is kept,
   and the carer stays within their weekly hours limit (unless you turn that off).
5. Every proposed time change is checked again by the eligibility service at the new time. Any that fail are dropped
   and listed with the reason.
6. The plan is saved as a draft (`RotaPlan`, `RotaPlanChange`) with an audit entry. **The rota is not changed.**

**Travel.** Gaps go through a `TravelTimeProvider` interface. The only provider is **time-gap mode**: a fixed minimum
number of minutes between one visit ending and the next starting (none between back-to-back visits for the same
person). The platform has no routing service, so it never shows distances or driving times. A real provider can be
added behind the same interface later.

**Review and apply.**
- Each change can be accepted or rejected on its own. You can also accept every clean match (passes every check, no
  warnings, no time change), accept all, or reject all.
- A carer change on a moved visit is accepted or rejected together with the time change.
- Accepting a change with warnings records that the coordinator read them, exactly as on the visit page.
- **Apply** takes each visit in its own transaction, through `updateVisitInTx` for the time and then `assignInTx` for the
  carer. All the eligibility, scope, row-lock and no-double-booking rules run again at that moment.
- If a visit was edited after the plan was made (its `lockVersion` changed), that change is refused and marked "Not
  applied" with the reason. Other visits still go ahead.
- A plan can be applied once. After that, **Publish** makes the changed draft visits visible to carers.

**Permissions.** Viewing needs `rota.view`. Generating, deciding, applying, discarding and publishing need
`rota.build`. Plans are scoped to the organisation, and changes are shown only for visits the member can see.

## Rota Insights (`/rota/insights`)

These are the week's figures, worked out on read from the visits, bookings, absences, staff profiles and rate cards
(`src/server/rota/insights.ts`). Each figure links to the matching records.

- **Visits:** scheduled, fully allocated (rota completion %), unallocated, double-ups with one carer, completed, in
  progress, still to come, late, missed, not delivered and cancelled.
- **Workforce:** active staff; available, booked, on leave and off sick today; absences in the next 14 days; open
  slots; bookings allowed with warnings; hours booked; utilisation against weekly limits; and carers over their limit.
- **Care hours:** scheduled care hours, scheduled carer hours (double-ups count twice) and completed hours (clocked
  time where it was recorded).
- **Needs action:** open and overdue exceptions, uncovered visits still to come, visits flagged after an HR change, and
  draft visits not yet published.
- **Money (estimate):** shown only to `finance.view` roles (`src/server/finance/estimates.ts`).
  - Revenue comes from the funder's charge card on the service user's active package, multiplied by the number of
    carers.
  - Cost comes from each carer's pay card, or the default card. Open slots are priced at the default card.
  - On top of pay, the organisation's **employer on-cost %** is added (Finance → Rates → Settings, default 0).
  - Missed visits are not charged. Cancelled and not-delivered visits count as zero.
  - Margin uses only visits that have both a charge and a cost, so a missing rate never inflates it.
  - Missing funders and rates are listed as finance exceptions.
  - The money section also shows margin by branch, by funder and by service user (the lowest ten).
  - Verified figures (approved invoice and pay runs for the week) are shown separately and are never mixed with the
    estimates.

## Run route time-gap check (`/rota/routes/[id]`)

Each day of a live route compares the scheduled times of consecutive stops, in route order (`routeGaps`). It flags:
- overlaps;
- gaps under 10 minutes;
- waits over 2 hours;
- stops that start before the stop above them.

Cancelled stops are skipped. **Put in time order** re-numbers that day's stops by start time, and the change is
audited. Travel time is never worked out.

## Schema changes (additive)

- `20261031200000_rota_plans`: `RotaPlan`, `RotaPlanChange` and three enums. This is new storage for draft plans. No
  existing table is changed.
- `20261031210000_estimate_on_costs`: `FinanceSettings.estimateOnCostPercent INTEGER NOT NULL DEFAULT 0`. This is the
  stated assumption that the estimates need.

## Tests

- Unit:
  - `tests/unit/optimiser.test.ts` checks eligibility-only candidates, gaps, existing bookings, weekly limits, time
    changes, swaps, determinism and the budget.
  - `tests/unit/estimates-routes.test.ts` checks pricing, double-ups, open slots, missing rates, missed and cancelled
    visits, and the route gap kinds.
- Integration:
  - `tests/integration/rota-optimise.test.ts` checks that every proposal is eligible, that there is no double booking,
    that generating leaves the rota unchanged, tenancy, that a visit edited since the plan is refused, the audit
    entries and discarding.
  - `tests/integration/rota-insights.test.ts` checks that the figures reconcile with `listVisits`, that money is shown
    only to finance roles, that the on-cost changes only the estimate, and route ordering with tenancy.
- E2E (`tests/e2e/rota.spec.ts`): a plan from the dashboard through accept all and apply; Insights for a manager and a
  coordinator.

On the full three-branch UAT data, a 7-day plan filled 57 of 57 open slots in 1.6 s (73 fit checks), and Insights
loaded in about 0.46 s.

## Not built

- In-app shift offers and anything else in the carer app: left out on the owner's instruction of 31 October.
- Real travel times or distances: these need a routing provider.
