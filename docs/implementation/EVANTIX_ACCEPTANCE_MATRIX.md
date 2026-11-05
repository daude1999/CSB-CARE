# Acceptance matrix (P0 Care Coordinator, no-API)

Run with no AI provider (`AI_PROVIDER=none`; tests set no provider at all). Fictional documents only.

| # | Check (brief 3.12) | Automated evidence | Result 5 Nov | Human check |
|---|---|---|---|---|
| 1 | Four commissioned templates (09:00 60, 12:00 45, 16:30 30, 20:00 60) | `care-coordinator-no-api.test.ts`, `care-coordinator.test.ts` | Pass | Owner to confirm on screen |
| 2 | 1,365 minutes a week (22 h 45 m) | both, plus unit test | Pass | |
| 3 | Family shopping visit separate, not counted, not scheduled | both | Pass | |
| 4 | All nine care-plan sections represented | both | Pass | |
| 5 | Source pages correct; quotes word for word on the page | unit "keeps every fact's quote word for word" | Pass | |
| 6 | Missing facts not invented (no end date, no risk level) | integration + unit | Pass | |
| 7 | Draft risks reviewable; never approved without a level | integration | Pass | |
| 8 | Identifiers correctly typed (Frameworki client reference) | unit + integration | Pass | |
| 9 | Approvals enforced (coordinator, manager per section, second person for plan and risk) | integration | Pass | |
| 10 | No visits published | integration (28 visits, 0 published) | Pass | |
| 11 | Re-running saves nothing new | integration | Pass | |
| 12 | Missing values | unit | Pass | |
| 13 | Contradictory pages | unit | Pass | |
| 14 | Overnight visits | unit | Pass | |
| 15 | Split timetables | unit + integration | Pass | |
| 16 | Discontinued services | unit | Pass | |
| 17 | Funding ambiguity | unit | Pass | |
| 18 | 20-carer visits (and over 20 flagged) | unit | Pass | |
| 19 | Partially unreadable files | unit | Pass | |
| 20 | Word documents read | — | Not built | Manual entry |

Human user acceptance in the no-API configuration has **not** happened yet. P0 Care Coordinator is not complete until it has.
