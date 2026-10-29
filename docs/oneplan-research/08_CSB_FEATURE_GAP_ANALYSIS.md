# 08 · CSB feature gap analysis

Feature-by-feature mapping of OnePlan (as observed on 29 October 2026) to CSB-CARE on `main` at commit `a2abf2d`.

Legend: ✅ CSB has it · ⚠ partial · ❌ missing · ➖ not needed in CSB. "Evidence" is how well OnePlan's feature is known: **O** observed, **I** inferred, **U** unverified (not inspected).

## 1. Where CSB stands today

| CSB portal (`src/lib/portals.ts`) | State on main |
|---|---|
| Overview | Built. Module launcher with real figures for Policy and HR |
| Policy & Compliance | Built. Policy library, regulatory updates, change queue, audits, actions, evidence, staff sign-off, training records |
| HR & Workforce | Built as the CSB HR Hub (separate app, JSON document per organisation) |
| Reporting & Analytics | Built for policy and compliance reports |
| Administration | Built: business details, approval rules, services, platform configuration, audit trail, sources, jobs |
| Rota & Visits | **Planned (Stage D).** `/rota` shows an honest "not built yet" page |
| Service Users | **Planned (Stage D).** `/service-users` shows an honest "not built yet" page |
| Carer phone page | Listed under "Coming later" |
| Finance | Not in the portal list |

## 2. Mapping

### 2.1 Shell and dashboard

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| Date-driven operational dashboard | O | ❌ | Build Rota "Today" page | 02 |
| Call outcome tiles (complete, late, missed, missed meds) | O | ❌ | Outcome strip from `Visit` data; missed meds after eMAR | 02 |
| People lists on dashboard | O | ➖ | Deliberately not repeated (privacy) | 02 |
| Reminders widget | O | ⚠ | HR check reminders exist; general reminders missing | 07 |
| Conflicts and holidays-due counters | O | ❌ | "Coming up" panel | 02 |
| Area filter | O | ❌ | `Area` model + TitleBar selector | 04, 07 |
| Hide screen | O | ❌ | Shell control (no server change) | 02 |
| Badges: incidents, reminders, notifications | O | ⚠ | Notifications exist; incidents and reminders missing | 07 |
| Vendor banners, changelog, birthdays | O | ➖ | Not needed | 02 |

### 2.2 Rota & Visits

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| Templates on a 1–4 week cycle | O | ❌ | `VisitTemplate`, `RotaCycle` | 04 B2 |
| Add / edit template form | O | ❌ | Template form with zod | 04 B8 |
| Template bulk actions | O | ❌ | MVP subset | 04 B7 |
| Template planner board | O | ❌ | Shared board component | 04 B6 |
| Build Rota (week from templates) | O | ❌ | Build with preview, idempotent | 04 B10 |
| Forecast rota build | O (name) | ❌ | Same as preview | 04 B6 |
| Daily visit list | O | ❌ | `/rota/visits` | 04 B6 |
| Planner board (8 views) | O | ❌ | `/rota/planner`, carer/service-user/area/run views | 04 B6 |
| Drag-and-drop allocation | I | ❌ | Drag + keyboard "Move" dialog | 04 B6 |
| Unassigned row / uncovered filter | O | ❌ | Derived "unassigned" flag | 04 B4 |
| Double-up (two carers) | O | ❌ | `VisitAssignment.slot` 1/2 | 04 B2 |
| Shadow shifts | O | ❌ | Slot SHADOW | 04 B2 |
| Time lock / rota lock | O | ❌ | `timeLocked` | 04 B2 |
| Run routes (live and template) | O | ❌ | `RunRoute`, `RunRouteTemplate` | 04 B2 |
| Visit detail page | U | ❌ | Designed from first principles | 04 B6 |
| Add single visit | U | ❌ | Visit form | 04 B6 |
| Cancel / reinstate / delete visits | O (bulk names) | ❌ | Cancel with reason; no hard delete of delivered visits | 04 B4 |
| Clock in/out by app (NFC / QR / location) | I | ❌ | Phone page GPS + QR; NFC later | 04 B6 |
| Office clock in/out ("clock in scheduled") | O (bulk names) | ❌ | Only with reason, audited | 04 B7 |
| Carer acknowledgement of visits | O | ❌ | `acknowledgedAt` | 04 B2 |
| Live monitor | O | ❌ | `/rota/monitor` + JSON polling | 04 B6 |
| Late / early / missed / short rules | O | ❌ | `RotaSettings` + sweep job | 04 B3–B4 |
| Rota conflict prevention | O | ❌ | `checkAssignment` | 04 B9 |
| Carer preference minimum | O | ❌ | `CarerPreference` + check | 04 B9 |
| HR compliance check at allocation | – | ❌ (OnePlan lacks it too) | **CSB advantage** | 04 B9 |
| Doorstep cancel + welfare checklist | O (settings) | ❌ | NOT_DELIVERED flow | 04 B4 |
| Push messages, late/missed push | O (settings) | ❌ | Notifications in app first; push later | 04 B11 |
| Printable rotas | O | ❌ | PDF via `pdfkit` | 04 B6 |
| Mileage | O (names) | ❌ | Finance stage | 06 |
| Family / care portal | U | ❌ | Later stage | 07 |
| Carer mobile app | I | ❌ | Carer phone page (web) | 04 B6 |

### 2.3 HR & Workforce

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| Staff record (personal, role, manager, start) | O (widget) | ✅ | Move to relational `StaffMember` (decision) | 03 §4 |
| App access and login code | O | ❌ | `appAccess`, carer `User` login | 03 §4 |
| Areas per staff member | O | ❌ | `StaffArea` | 03 §4 |
| Contracts | O | ❌ | `StaffContract` | 03 §4 |
| Holidays / absences, custom types | O / U | ❌ | `Absence`, `AbsenceType`, approval | 03 §4 |
| Holiday accrual 12.07% | I | ❌ | Calculation from clocked hours | 03 §4.3 |
| Bradford Factor | O (name) | ❌ | Report | 06 C1 |
| Availability | O (name) | ❌ | `StaffAvailability` | 03 §4 |
| Qualifications / sub-status | O (names) | ⚠ | HR Hub checks; add sub-status if needed | 03 §3 |
| DBS, right to work, training expiry | O (names) | ✅ | Stronger in CSB | 03 §2 |
| Documents | O (names) | ✅ | Stronger in CSB | 03 §2 |
| Onboarding states | I | ⚠ | Status exists; rota rule needed | 03 §4.3 |
| Unverified emails | O | ⚠ | User invite verification | 07 |

### 2.4 Service users and care

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| Service user record and identifiers | O (fields) | ❌ | `ServiceUser` | 05 B1 |
| Contacts (NOK, GP, pharmacy) | O (fields) | ❌ | `ServiceUserContact` | 05 B1 |
| Key safe, NFC tag, access | O (fields) | ❌ | Encrypted key safe, audited reveal | 05 B3 |
| Carer gender preference | O | ❌ | Field + allocation warning | 05 B1 |
| Client holidays / absences | U | ❌ | `ServiceUserAbsence` | 05 B1 |
| Care plan ("New On Site"), custom forms | U | ❌ | Versioned care plan | 05 B1 |
| Assessments, read assessments | O (names) | ❌ | Risk assessments + staff acknowledgement | 05 B1 |
| Waterlow | O (name) | ❌ | Risk assessment type | 05 B1 |
| Medication / MAR / controlled drugs | O (names) | ❌ | Separate eMAR stage | 05 B1 |
| Incidents | O (badge) | ❌ | `Incident` | 05 B1 |
| Communication log | U | ❌ | Later in Service Users | 07 |
| Programmes of care, tags | O (names) | ❌ | Later | 07 |

### 2.5 Finance

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| Funders (authority / direct) | O | ❌ | `Funder` | 06 B2 |
| Charge and pay tariffs with time bands | O / I | ❌ | `RateCard`, `RateBand` | 06 B2 |
| Bank holiday uplifts | O | ❌ | `BankHoliday` | 06 B2 |
| Invoice runs | U | ❌ | `InvoiceRun` with approval | 06 B4 |
| Wage runs | U | ❌ | `PayRun` with approval | 06 B4 |
| Minimum wage top-up | O (setting) | ❌ | Top-up including travel time | 06 B3 |
| Mileage | O (settings) | ❌ | `MileageClaim` | 06 B2 |
| Sage export / Xero report | O (names) | ❌ | CSV first, integrations later | 06 B3 |
| Invoice numbering, terms, rounding | O | ❌ | Finance settings | 06 B4 |

### 2.6 Reporting and administration

| OnePlan feature | Ev. | CSB | Gap / action | Spec |
|---|---|---|---|---|
| 60+ named reports | O (names) | ⚠ (policy reports only) | Catalogue by stage | 06 C1 |
| Advanced include/exclude filters | O | ❌ | Shared filter bar | 06 C |
| Council-specific report packs | O | ❌ | Later, on request | 06 C1 |
| Settings lists (services, areas, tasks, roles, …) | O | ⚠ (services exist for branches) | New lists per module | 07 §2 |
| Permissions | U | ⚠ | Add rota, service user and finance permissions and roles | 04 B5 |
| System logs | U | ✅ | Existing `AuditLog` | 07 |
| Logged-in users | U | ⚠ | `Session` exists; admin view missing | 07 |
| On call | U | ❌ | On-call rota | 07 |
| Support tickets, training videos | O | ➖ | Not needed | 07 |

## 3. Biggest gaps, in order

1. **No shared relational staff record.** Blocks everything else. HR Hub data must be readable with foreign keys (03 §4, decision needed).
2. **No service users.** Visits need someone to visit.
3. **No scheduling engine:** templates, build, visits, allocation checks.
4. **No visit delivery:** carer phone page, clocking, monitor.
5. **No finance:** funders, rates, invoices, pay.
6. **No care records:** care plans, risk assessments, medication.

## 4. Regression risks

| Risk | Mitigation |
|---|---|
| Moving HR Hub staff into tables breaks the HR Hub, which is out of scope and works today | Do it as its own stage with the HR Hub's 14 node tests plus new integration tests; keep `hrLegacyId`; run the migration on a copy of the demo data first |
| New `OrgRole` values change permissions for existing users | Additive enum values; existing roles keep their permissions; `portals.test.ts` extended |
| New portals change the Overview and sidebar | Overview e2e test already checks module banners against tiles; extend it |
| Background sweep job load on Vercel (no worker) | Daily cron plus on-demand sweep from the monitor page, as `inline.ts` does today |
| Demo seed grows and slows `vercel-build` | Rota demo seed is small (2 areas, 6 carers, 12 service users, 2 weeks) and behind `SEED_DEMO` |
| Personal data in demo or tests | Only invented names and addresses in seed and test data. Nothing is imported from OnePlan |
