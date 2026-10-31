# Carer matching engine

Status: built (PR #33). Code: `src/server/rota/matching.ts`, wired into `visitCandidates` / `visitCandidatesMany` in `src/server/rota/queries.ts`. Shown on the visit page ("Recommended carers"), Unassigned Visits and Sickness & Holiday Cover. Tests: `tests/unit/matching.test.ts`, `tests/integration/rota-cover.test.ts`.

## Two layers

1. **Eligibility (hard rules)** — the shared service in `src/server/workforce/eligibility.ts` decides who **may** do a visit: HR status and checks, readiness, approved or requested absence, clashes and rest, competencies for the visit's tasks, blocked carers and gender preferences. Result: Eligible, Requires review, or Not eligible.
2. **Suitability score (ordering only)** — `scoreMatch()` orders the people layer 1 allows. **Not eligible carers get no score** and are listed last. A score can never make a blocked carer bookable, and every booking still goes through `assignInTx`, which re-runs layer 1 under row locks.

## Score

The score is 0–100, the sum of the points below, each shown to the coordinator in plain words.

| Factor | Points | Fact used |
|---|---|---|
| Passes every check | +50 | Eligibility state Eligible |
| Allowed with warnings | +25 | Eligibility state Requires review |
| Continuity | +3 per visit, up to +24 | Visits with this service user in the last 8 weeks |
| Works in this area | +10 | Staff area matches the visit's area |
| Service user's rating | (rating − 3) × 4 | Carer preference rating 1–5 |
| Within weekly hours | +6 | Booked minutes this week plus this visit ≤ the carer's weekly limit |
| Over weekly hours | −15 | The visit would take them over their weekly limit |
| Tight gap | −8 | Under 15 minutes between this and another booking that day |

Ties are broken by eligibility state, then name. Weights are constants in `MATCH_WEIGHTS` so they can be reviewed and changed in one place.

## Travel

The platform has no routing provider, so it does not score or display journey times or distances. The only travel-related fact is the **time gap** between bookings, always labelled "time gap, not a travel time".

## Safety

- No AI model writes rota changes. The score is deterministic arithmetic on recorded facts.
- Choosing a "check first" carer from a recommendation records that the warnings were accepted, as the manual picker does.
- Branch-limited coordinators only see and book their own branch's carers (`allocatableStaffIds`, `assignInTx`).
