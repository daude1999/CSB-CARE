# Missed Calls module (31 Oct 2026)

The owner's approved Missed Calls specification, built into Rostering & Care Management. Plan: the "Missed Calls module: build plan" doc in the project. Every item below is built, persisted and tested.

| # | Spec item | Where | Status |
|---|---|---|---|
| **Main filters** ||||
| 1 | All missed calls | /rota/missed (Rota menu → Missed Calls; also the Missed ring/box on the Monitor and Rota Dashboard) | Built |
| 2 | By care worker | Register filter "Care worker" | Built |
| 3 | By service user | Register filter "Service user" | Built |
| 4 | By branch | Register filter "Branch" (narrows the member's own branches, never widens) | Built |
| 5 | Date range | Day / Week / Month navigator, or Custom from–to (up to a year) | Built |
| 6 | Visit status | Register filter "Visit status now" (missed, carer arrived late, delivered late, not delivered, cancelled) | Built |
| 7 | Visit type | Register filter "Visit type" (call type) | Built |
| 8 | Reason for missed call | Register filter "Reason", including "Not recorded yet" | Built |
| 9 | Resolution status | Register filter "Resolution status": open, new, investigating, awaiting sign-off, closed, escalated, past deadline | Built |
| 10 | Responsible coordinator | Register filter "Coordinator", including "Nobody yet" | Built |
| **Smart filters** ||||
| 11 | Repeat Offenders | Chip; care workers with 3+ carer-attributable missed calls in 30 days (Rota Settings) | Built |
| 12 | High-Risk Service Users | Chip; service user risk level High or an active High risk assessment | Built |
| 13 | Uninvestigated Missed Calls | Chip; open cases with no reason recorded | Built |
| **Management features** ||||
| 14 | Search care workers and service users | Register search (also matches the visit reference) | Built |
| 15 | Individual missed-call histories | "Missed calls" section on each Team Member page and tab on each Service User page (one year); 90-day lists on each case | Built |
| 16 | Investigate and record reasons | Case step 1: reason list (12 reasons), detail, findings | Built |
| 17 | Assign follow-up actions to coordinators | Case step 3: action, owner, due date, mark done; owner told in-app. Responsible coordinator on step 1 and as a bulk action | Built |
| 18 | Escalate unresolved cases to managers | Escalate button (with a note) on the case and as a bulk action; automatic once, in-app, when a case has no reason 30 minutes after detection | Built |
| 19 | Record replacement care arrangements | Case step 2: replacement visit (carer checked by the eligibility service), carer arrived late, family covered, client declined, not needed, none possible (tells managers); who was told | Built |
| 20 | Management comments and supporting evidence | Case step 4: append-only comments; evidence files (PDF, Word, PNG, JPEG, text, 10 MB) in the secure store, downloaded only after a permission check | Built |
| 21 | Investigation outcomes and manager sign-off | Case step 4 outcome (6 outcomes, preventable, summary) → step 5 sign-off by a care manager or admin who did not investigate; send back with a note; reopen with a reason | Built |
| 22 | Export reports to Excel and PDF | Register Export Excel / Export PDF (filters kept; ticked rows only from Bulk Actions); every Rota Report now exports to Excel, PDF and CSV, including the new "Missed calls" report | Built |
| **Management dashboard** ||||
| 23 | Total missed calls (daily / weekly / monthly) | Figure for the chosen period, with today, this week and this month underneath | Built |
| 24 | Repeat offenders (number of workers) | Figure, opens the smart filter | Built |
| 25 | High-risk missed visits (number of cases) | Figure, opens the smart filter | Built |
| 26 | Uninvestigated (outstanding cases) | Figure with the number past deadline; also on the Rota Dashboard's Missed box | Built |
| 27 | Resolved (completed investigations) | Figure (signed off), opens the closed cases | Built |
| 28 | Repeat service-user incidents (number of clients) | Figure; clients missed 2+ times in 30 days (Rota Settings); badge on their rows | Built |

## How it works

- The call sweep marks a visit missed and, in the same transaction, opens its `MissedCallCase` with a snapshot of the booked carer, client, area, call type and time. Older missed visits get cases from the migration backfill and on first view.
- Stages: New → Investigating → Awaiting sign-off → Closed (reopen goes back to Investigating). Edits use optimistic locking.
- The Exceptions register keeps its MISSED alert in step: owner, escalation and resolution at sign-off. The sweep no longer escalates MISSED alerts on its own, so managers are not told twice.
- Permissions: view `rota.monitor`; work `rota.edit`; sign off and reopen `rota.missed.signoff` (care manager, admin); export `report.export`.
- Everything is audited. Notifications are in-app only.
- New dependency: `exceljs` 4.4 (the platform could only write CSV; Excel export needs real .xlsx files).
- Repeat counts leave out calls the investigation found were delivered, or were the office's doing or outside anyone's control.

## Known limits

- A replacement visit is recorded on the case. It does not create a second visit on the rota, change pay or charges, or reassign anyone.
- Evidence is virus-scanned only when `MALWARE_SCAN_URL` is set (as for all evidence); otherwise it is marked "not scanned".
