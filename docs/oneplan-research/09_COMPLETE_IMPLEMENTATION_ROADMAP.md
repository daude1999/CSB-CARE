# 09 · Implementation roadmap

How to build the missing capabilities in CSB-CARE, in an order where each stage is usable on its own and nothing is presented as working before it works.

**Every stage follows CLAUDE.md "How to work":** a written plan and mock-up screenshots first, the owner's approval, a feature branch, tests with the feature, Playwright screenshots at 1440 / 834 / 390, and no merge to `main` without the owner's explicit approval. CLAUDE.md currently limits scope to the Policy Library; the owner must lift that for each stage below.

## Dependencies

```
 W  Shared workforce record ──┐
 S1 Service users (core) ─────┼──► R1 Templates & build ──► R2 Allocation board ──► R3 Visit delivery & monitor
 A  Areas, roles, permissions ┘                                                         │
                                                         H2 Absences & availability ◄───┤
                                                                                        ▼
                                                         F  Finance (rates, invoices, pay)
                                                         S2 Care plans & risk ──► M eMAR (separate)
                                                         Reports grow with every stage
```

## Stages

### Stage A · Foundations (areas, roles, permissions)
- `Area` model and admin screen; area on memberships (scoping).
- New `OrgRole`s `CARE_COORDINATOR`, `CARER`; permissions `rota.*`, `serviceUser.*` (04 B5).
- TitleBar area selector component.
- **Done when:** an admin can create areas and give a coordinator access to specific areas; permissions tests pass.
- **Size:** small.

### Stage W · Shared workforce record (decision needed: 03 §4.1 Option A)
- `StaffMember`, `JobRole`, `StaffArea`; migration from the HR Hub JSON (`hrLegacyId`), HR Hub reads and writes through `src/server/workforce`.
- HR compliance summary per staff member exposed as a server function for Rota (`complianceFor(staffId)` using `checkStatus`).
- **Done when:** the HR Hub works exactly as before (its tests and e2e pass) and staff are queryable relationally.
- **Risk:** highest of all stages; touches the out-of-scope HR Hub. Needs separate approval.
- **Size:** medium–large.

### Stage S1 · Service users (core)
- `ServiceUser`, `ServiceUserContact`, `ServiceUserAbsence`, `CarePackage` (without funder).
- Register, new person, profile tabs: Summary, Contacts, Absences, Visits (placeholder that says "Rota not built yet" until R1), History.
- **Done when:** coordinators can manage service users with permissions, audit and validation.
- **Size:** medium.

### Stage R1 · Templates and weekly build
- `CallType`, `CareTask`, `RotaCycle`, `RotaSettings`, `VisitTemplate`, `TemplateSlot`, `TemplateTask`, `RotaBuild`, `Visit`, `VisitAssignment`.
- Templates list and form, template board (read-only first), build week with preview, daily visits list, visit page (read + edit times + cancel/reinstate).
- `checkAssignment` with conflict, absence (once H2 exists), compliance and preference rules.
- Rota "Today" page with outcome strip using scheduled data (no clocking yet, so late/missed are not shown and the page says so).
- **Done when:** a coordinator can set up a 1–4 week pattern, build next week, see and adjust the visits.
- **Size:** large.

### Stage R2 · Allocation board and run routes
- Planner board views (carer/day, carer/week, service user/day, service user/week, area, run route), drag + keyboard move, unassigned row, bulk actions (04 B7).
- Run routes (live and template).
- Printable rotas (PDF).
- **Done when:** every allocation change goes through the same checks, with clear refusal reasons.
- **Size:** large.

### Stage R3 · Visit delivery and live monitor
- Carer phone page (`/carer`): my visits, acknowledge, clock in/out with GPS (simulated in the demo, labelled), QR fallback, tasks, notes, doorstep "not delivered".
- `VisitClock`, `VisitTaskOutcome`, `VisitNote`; status machine and DB triggers; sweep job for missed visits; notifications.
- Live monitor page and JSON route; "Today" page gains late / missed / short.
- **Done when:** a visit moves from scheduled to completed by a carer on a phone, and the office sees late and missed visits within a minute.
- **Size:** large.

### Stage H2 · Absences, availability, contracts
- `AbsenceType`, `Absence` with approval, `StaffAvailability`, `StaffContract`, `CarerPreference` editor.
- Absence approval shows affected visits and offers unassign / reassign.
- Holiday accrual and Bradford Factor reports.
- **Size:** medium.

### Stage F · Finance
- `Funder`, `RateCard`, `RateBand`, `FunderRate`, `StaffPayRate`, `BankHoliday`, `MileageClaim`, `InvoiceRun`, `Invoice`, `InvoiceLine`, `PayRun`, `PayLine`.
- Invoice and pay runs with two-person approval, PDF invoices, CSV pay export, minimum wage top-up.
- **Size:** large.

### Stage S2 · Care plans, risk assessments, incidents
- Versioned care plans with review and approval, risk assessments (including Waterlow), incidents, staff read-and-sign.
- **Size:** large.

### Stage M · Medication (eMAR) — separate design
- Medication list, schedules, MAR per visit, missed medication alerts ("calls with missed meds"), controlled drugs. Clinical-safety review before build.
- **Size:** large.

### Later
Family / care portal, communication log, push notifications or SMS, NFC tags, travel time and route optimisation, Sage / Xero integrations, council report packs.

## Suggested first build slice for the CEO demo

If the owner wants something to show soon, the smallest honest slice is **A + S1 (minimal) + R1** with the Stage W decision taken as Option B *temporarily* (read-only sync of HR staff into `StaffMember`) and replaced by Option A straight after. That gives: areas, a handful of service users, templates, a built week, the daily visit list and the Today page with scheduled figures, all real records. The screen says plainly that clocking and the live monitor arrive in R3.

## Per-stage checklist (copy into each stage's plan)

- [ ] Business purpose, existing functions, dependencies
- [ ] Functional and non-functional requirements, gaps, regression risks
- [ ] Prisma schema change with justification; additive migration; triggers updated in a new migration where invariants apply
- [ ] Server functions in `src/server/<domain>` with `ctx` scoping; Server Actions through `handle()`
- [ ] zod validation on every input; ValidationError / ForbiddenError / NotFoundError / ConflictError handled
- [ ] AuditLog on every state change; notifications where relevant
- [ ] Empty, loading and error states; responsive at 1440 / 834 / 390; keyboard and contrast checks
- [ ] Vitest unit + integration, Playwright e2e, screenshots compared with the approved mock-ups
- [ ] Owner approval before merge
