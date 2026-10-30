# V1 audit — Rostering & Care Management, ECM, carer mobile, finance (29 Oct 2026, read-only)

Requirements: owner's V1 brief §6–8 and spec §9–11. All rota/care/finance server actions live in `src/app/rota-actions.ts` (through `handle()` in `src/app/action-kit.ts`).

## A. Classification (W working · I incomplete · B broken · M missing · D defer)

| Screen | Route / server | Tests | Class / note |
|---|---|---|---|
| Rota Dashboard | rota/page.tsx → rota/dashboard.ts | int rota-dashboard, e2e | W — "Visit Notes" counter links nowhere useful; no alerts list although Overview links here |
| Service Users | rota/service-users/* → care/service-users.ts | int, e2e | W — stale text at [id]/page.tsx:78 says care plans not built |
| Care Packages | model only (schema:1510); read-only card; only setPackageFunder writes | none | M |
| Care Plans | rota/care-plans, carer/care-plan → care/care-plans.ts | int, e2e | W |
| Daily Rota | rota/visits → queries.ts listVisits, visits.ts bulkVisits (16 kinds) | int rota-bulk, e2e | I — "Add visit" link dead (404) |
| Advanced Rota | rota/advanced; drag → assignCarerAction via timeline-board | e2e render/keyboard | I — no drag-to-time, bulk select, SU-by-week view |
| Recurring Templates | rota/templates/* → templates.ts | int | W — run-route select always empty |
| Template Planner | rota/templates/planner → setTemplateCarer | manual only | I (no automated test) |
| Build Rota | rota/build → build.ts preview/confirm/publish/delete | int, e2e | W |
| Staff Allocation | visits/[id] + staff/[id] → eligibility.ts, assign.ts | int, e2e | W — no travel/rest rules |
| Double-up | visits.ts setDoubleUp | int | W |
| Unassigned Visits | rota/unassigned | e2e | W |
| Live Run Routes | no page; RunRoute upserted by build; Visit.runOrder never written | none | M |
| Template Run Routes | no page; RunRouteTemplate never created | none | M |
| Printable Rotas | nothing | none | M |
| Live ECM Monitor | rota/monitor → monitor.ts | int attendance, e2e | W — overnight visits started yesterday drop off today's board |
| Visit Details | rota/visits/[id] → visits.ts getVisit | int, e2e | W |
| Carer Mobile | carer/page.tsx → carer.ts, attendance.ts clockMine/notDeliveredMine | int, e2e | I — no tasks/notes |
| Visit Tasks (carer) | read-only; VisitTaskOutcome never written | none | M |
| Visit Notes | only clock-out note | int (short note) | M (general) |
| Attendance Corrections | attendance.ts officeClock (direct, supersedes) | int | I — no request→review→decision; bug: office cannot add the required short-visit note |
| Exceptions | RotaAlert raised by sweep/attendance/impact; listAlerts/resolveAlert exist but **no page renders them** | sweep tests only | B (no screen; no owner/deadline/escalation) |
| Incidents | rota/incidents → care/incidents.ts | int, e2e | W |
| Timesheets | finance/timesheets.ts | int, e2e | W — no per-visit attendance approval; no cut-off segmentation |
| Pay and Charge Rates | finance/rates.ts | int, unit | W — rotaType ALTERNATE has no effect |
| Invoice Preparation | runs.ts prepare/approve/void, CSV | int, e2e | W — void reason dropped for invoice runs |
| Payroll Preparation | runs.ts preparePayRun | int, e2e | W — ADJUSTMENT never produced |
| Mileage | model only; no entry screen | none | M |
| Operational Reports | rota/reports.ts (5 kinds), CSV | int, e2e | W |
| Background process | worker/index.ts tick → maintenance.tick (sweep last, maxAttempts 1) | int | W with risk: a failure in a policy step skips the sweep |

## B. Ordered gap list

1. **Add-visit page** (B, S): build rota/visits/new posting to existing createVisitAction.
2. **Office clock-out note** (B, S): add `note` to officeSchema/applyClock and the visit page form.
3. **Exceptions register** (M): extend RotaAlert additively (ownerId, deadline, escalatedAt, escalationState, evidenceNote); page rota/exceptions with filters; assign/escalate/resolve actions; sweep sets deadline, tick escalates; fix Overview link.
4. **Correction requests + attendance verification** (L): ClockCorrectionRequest (requester ≠ decider trigger) raised from /carer, decided on the visit page, approval calls applyClock(supersedesId); officeClock creates an auto-approved request; TimesheetLine.verifiedById/At, submit refuses unverified exception lines.
5. **Carer tasks and notes** (M): care/visit-record.ts recordTaskOutcomes + addVisitNote; UI on /carer and visits/[id]; dashboard notes link.
6. **Care Packages CRUD** (S/M): care/packages.ts; Package tab on service user.
7. **Run routes, manual sequencing** (M): rota/routes.ts CRUD for RunRouteTemplate and RunRoute; setRouteOrder writes Visit.runOrder; bulk add/remove; pages; seed two templates.
8. **Printable rotas** (M): pdfkit; per carer / per service user; permission + audit for key safe.
9. **Mileage claims** (S/M): carer submits, manager approves, flows to pay run.
10. **Overnight / cut-off** (M): split TimesheetLine at period boundary (segment fields), unfinished-at-cut-off exception, PayLine ADJUSTMENT into next draft run.
11. rotaType ALTERNATE: implement or hide (S).
12. Eligibility travel buffer and 11-hour rest warnings (S/M).
13. Daily/Advanced Rota parity: multi-select filters, SU-by-week view, "Move to…" dialog.
14. Monitor: include yesterday's IN_PROGRESS visits (S).
15. Template planner automated test (S).

## C. Broken / fake / misleading

Dead "Add visit" links; office short clock-out impossible; alerts have no screen and Overview points to a page without them; sweep coupled to policy jobs; decorative run-route select; invoice void reason dropped; stale care-plan copy on service user page; rotaType has no effect. No hardcoded statistics; eMAR boxes and GPS/NFC/offline are plainly disclaimed.
