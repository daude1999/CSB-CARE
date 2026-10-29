# Version 1 backlog — pilot go-live

Branch: `feature/v1-complete`. Brief: owner's "CSB-CARE — COMPLETE VERSION 1" (29 Oct 2026). Audit findings: `docs/implementation/v1-audit/`. Spec extract: `docs/architecture/HEALTHCARETECH_SPEC_V8_EXTRACT.md` (only Appendices C/E/F and §9–11 are in V1 scope).

Out of V1 (labelled "not built" in the app, never counted as done): WhatsApp/SMS/voice, medication/eMAR, GP Connect, Azure/subscription billing, recruitment/ATS, external payroll/accounting integrations, GPS/NFC/offline, route optimisation, NHS/commissioner training profiles.

## Order of work (dependency order)

| # | Item | Depends on | Size | Status |
|---|---|---|---|---|
| 0 | Local environment, baseline test run, README/Windows setup fixes | — | S | blocked: Prisma engine host unreachable from the build environment |
| 1 | Quick integrity fixes: audit completion rule + answer default + score; add-visit page; office clock-out note; monitor overnight rows; invoice void reason; stale copy; `?area=` bypass; org-wide alert count | 0 | S | |
| 2 | Unified branch scope: Ctx.branchIds, MembershipBranch, Area.branchId, Visit.branchId, shared scope helper, enforcement in finance/reports/exports/lists/search, HR branch mapping admin, isolation tests | 0 | L | |
| 3 | Staff readiness engine (App. C/F): requirements + scopes, training records with verification, competency assessments, restrictions, exceptions, acknowledgement link to staff, evaluate() with five statuses and evidence, snapshots, wiring into eligibility/publish/clock-in, readiness UI | 2 | L | |
| 4 | Policy assignment and acknowledgement (App. E): assignment rules, states, opened tracking, append-only events + triggers, material-revision reassignment, reminders/escalation, Staff Sign-off dashboard, evidence export | 2, 3 | L | |
| 5 | Exceptions register (owner, deadline, escalation, page), separate `rota.sweep` job | 1 | M | |
| 6 | Carer tasks and notes; visit notes list | 1 | M | |
| 7 | Care packages CRUD | 1 | S | |
| 8 | Attendance verification on timesheet lines; correction requests (carer → coordinator decision) | 5 | M | |
| 9 | Administration: users (invite/roles/branches/deactivate/reset), branches CRUD, audit log viewer; unlock built modules | 2 | M | |
| 10 | Reporting & Analytics: KPI registry with definitions, org-wide vs branch scope selector, delivery/workforce/compliance/finance tabs, CSV with `report.export` | 2, 3 | M | |
| 11 | Run routes (manual order) + template routes; printable rotas (PDF); mileage claims | 1 | M | candidate for V1.1 if time is short |
| 12 | Overnight/cut-off segmentation and linked pay adjustments | 8 | M | candidate for V1.1 |
| 13 | Design polish: loading states, page transition (reduced-motion), sidebar, DataTable, inline field errors | — | S/M | |
| 14 | 21-step end-to-end scenario (Vitest + Playwright), isolation/branch/permission/edge cases, screenshots of all five modules at 1440/834/390, completion matrix, handover | all | M | |

## Definition of done per item

CRUD with persistence; filters/navigation; zod validation and useful errors; server-side permissions and branch scope; audit history; empty/loading states; tests run and recorded in TEST_RESULTS.md. Anything not built is labelled "not built yet" in the app.
