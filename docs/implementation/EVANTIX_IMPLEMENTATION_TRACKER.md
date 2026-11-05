# Implementation tracker (P0 and P1 brief, 5 Nov 2026)

One line per delivery. Nothing is merged or deployed without the owner writing "I approve the screenshots. Merge the PR."

| Delivery | Priority | Branch | State | Notes |
|---|---|---|---|---|
| PR 0 Baseline audit | P0 | `claude/project-thread-ctnclm` | Draft PR (combined with PR 1) | `EVANTIX_DELIVERY_AUDIT.md` |
| PR 1 No-API document reader | P0 | `claude/project-thread-ctnclm` | Draft PR | Card-layout reader brought over from `feature/ai-care-coordinator` (7 commits), crash fixed, edge cases flagged |
| PR 2 Coordinator integration | P0 | `claude/project-thread-ctnclm-pr2` (stacked on PR 1) | Draft PR | Full upload → draft rota flow passes for both layouts (database tests). Assistant now answers: who is unavailable today/tomorrow, why a named carer cannot be booked on the open visit (same eligibility service as the picker), what is missing from the open person's care package, unassigned visits tomorrow. Read only. Word reading still needs a dependency decision |
| PR 3 Security and reliability | P0 | — | Not started | MFA/SSO, RLS evaluation, governance checklist |
| PR 4 Production deployment preparation | P0 | — | Not started | Azure runbook, worker heartbeat, backup and restore exercise |
| PR 5 Replacement cover completion | P1 | — | Not started | |
| PR 6 Carer mobile | P1 | — | Not started | |
| PR 7 Finance completion | P1 | — | Not started | |
| PR 8 Recruitment and Action Centre | P2 | — | Not started | Waits for P0 acceptance |

## Decisions taken in this branch
- PR 0 and PR 1 share one draft PR because the audit found the reader defect that PR 1 fixes; they are separate commits.
- A visit card's "Provided by" names who delivers the visit (often the agency), so it does not change who pays; "Funded by" does.
- A visit with unclear or non-council funding is kept out of the council total and flagged, never counted.
- More than 20 carers is flagged rather than silently capped.
