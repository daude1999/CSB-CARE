# 06 · Finance and reporting specification

> **Coverage warning.** OnePlan's Invoicing and Wages pages (the actual runs) were **blocked** (⛔, billing and pay data) and not inspected. Tariffs (Invoicing tab only), Funders (rows blacked out), Invoice/Wage Settings and Bank Holidays were inspected. No report was run or exported. **[O]** observed, **[I]** inferred.

## Part A · OnePlan finance

### A1. Menu [O]
Invoicing/Wages → Invoicing, Wages, Tariffs, Funders, Settings, Bank Holidays, Holiday Report.

### A2. Tariffs ("Invoicing And Wages Setup", screenshot `14`) [O]
Tabs: Invoicing, Wages, Wage Master Costs, Invoice Master Costs, Alternative Wage Tariffs. The Invoicing tab has two panels, both empty in this account:
- **Charge Tariffs** (+ Add).
- **Link Funders To Charge Tariffs And Service Types** (+ Add).

**[I]** Model: a tariff is a set of rates by time band (e.g. weekday, evening, weekend, bank holiday); a funder + service type is linked to a charge tariff; each delivered visit is priced from that link. Wages mirror this with pay tariffs; visits with rota type "Alternate" use Alternative Wage Tariffs (e.g. sleep-ins or waking nights). "Master costs" are **[I]** defaults when no specific link exists.

### A3. Funders (screenshot `15`) [O]
- Authority List button; **Authority Funders** (+ Add, none yet); **Direct Funders** (+ Add) with a table: funder name "(Direct) <client name>", client name, address, reference.
- **[I]** Every privately paying client is automatically their own direct funder. Councils and NHS bodies are authority funders.

### A4. Invoice and wage settings (screenshot `16`) [O]
- Invoice logo, global terms.
- **Global invoice settings** (private clients): default payment name, invoice prefix, next invoice number, include terms / banking info / notes, show full service-user name, invoice breakdown on/off, breakdown table on invoice, breakdown on week/day layout, show staff in breakdown, show amount/rate breakdown, pay within N days (30), hours format, full tariff names, round visit cost after each visit, round down if 5, show email, show icons, show service-user address on authority invoices.
- **Global wage settings:** show amount/rate breakdown, gross pay breakdown, individual shift breakdown, full service-user name, **Sage export**, hours format, **minimum wage top-up**, round visit pay after each visit, round down if 5, group tariffs by time band/rate, deduct mileage from wage totals, pay mileage on clocked or scheduled hours (Clocked).

### A5. Bank holidays (screenshot `17`) [O]
Add Bank Holiday; "Client Bank Holiday Charges" and "Staff Bank Holiday Payments (Wages)" panels (both empty).

### A6. Visit-level finance flags [O from rota bulk actions]
Update Pay Status, Update Chargeable Status, Rota Type (Normal / Alternate), Shadow shifts (**[I]** usually unpaid to the client).

### A7. Reports (screenshot `18`) [O, names only]

| Team member | Service user | General |
|---|---|---|
| Availability, Bradford Factor, Cancelled, Deleted Calls, Handback, Key Contacts, Late / Early, Live Hours, Mileage, Missed, Note, Requested Hours vs Live Hours, Shadow Shift, Short Visit, Task List, Team Member DBS, Team Member Report, Template Hours, Visit Location, Wage Report | Active Medication, Client Funder, Continuity, Controlled Medication, Invoice, Key Contacts, Legacy Medication, Live Hours, MARChart, Medication, Mileage, Notes, Programs Of Care, Service User Report, Task List, Task Outcome, Template Hours, Waterlow, Xero | Assessments Logs, Birthday, Care Portal, Communication Log, CQC Contact List, Document, Holiday, Incident List, Manual Vs App Clocking, Programs Of Care, Qualification, Read Assessments, Reminder List, Rota Duration, Run Route, Tags, Task List, User Dates List, Vaccine, Visit Note, Welfare Check, Working Hours |

Filter forms inspected [O] (Run never clicked; * required):
- **Team Member Late/Early:** user status*, team members* (multi), start date, end date, late/early value in minutes* (10), service names* (multi).
- **Rota Duration:** search by* (service user …), service users*, durations in minutes* (multi), start*, end*. "Shadow shifts will not be included."
- **Team Member Live Hours:** type (active team members …), team members*, start*, end*, Print. Advanced filters, each include / exclude / only: status, area, day(s), risk, service, auto clock-out, short visit, medication, alertable, alternate, cancelled, clock type, shadow, shift type, has run route, lock status. Clicking a name gives a full breakdown.
- Settings → Rota → "Enable Reports" offers paid council-specific report packs (e.g. Blackpool, St Helens, Lancashire, Rochdale, Doncaster). **[I]** Commissioner returns in each council's format.

---

## Part B · CSB finance specification (stage F, after Rota)

### B1. Principle
Finance never re-keys hours. Invoices and pay are calculated from **delivered visits** (`Visit` with clock events) and the rate tables, and a run is a frozen snapshot: once approved, lines are immutable (as with published policy versions), and corrections are credit notes or adjustment lines.

### B2. Data model

```
Funder             id, organisationId, kind AUTHORITY | NHS | DIRECT | OTHER, name, reference?, billingAddress,
                   email?, paymentTermsDays, invoiceGrouping PER_CLIENT | PER_FUNDER, active
                   (DIRECT funders are created with the service user when "self-funding" is chosen)
RateCard           id, organisationId, kind CHARGE | PAY, name, effectiveFrom, effectiveTo?
RateBand           id, rateCardId, label (Weekday day, Evening, Weekend, Bank holiday, Sleep-in…),
                   weekdays[], fromMinute, toMinute, bankHoliday: boolean, ratePence, unit PER_HOUR | PER_VISIT,
                   minimumMinutes?, roundingMinutes?
FunderRate         funderId, callTypeId?, rateCardId (CHARGE)               (funder + call type → charge card)
StaffPayRate       staffId? | jobRoleId?, rateCardId (PAY), effectiveFrom   (carer or role → pay card)
BankHoliday        organisationId, date, name, chargeMultiplier, payMultiplier  (England & Wales list seeded from GOV.UK, editable)
MileageClaim       visitId?, staffId, miles, pencePerMile, source CALCULATED | MANUAL
InvoiceRun         id, organisationId, periodStart, periodEnd, status DRAFT | APPROVED | ISSUED | VOID,
                   createdById, approvedById? (≠ createdById), approvedAt?, nextNumber snapshot
Invoice            id, invoiceRunId, funderId, number (prefix + sequence, unique), issueDate, dueDate,
                   totalPence, status, pdfFileId?
InvoiceLine        id, invoiceId, visitId?, serviceUserId, description, minutes, ratePence, amountPence, bandLabel
PayRun             id, organisationId, periodStart, periodEnd, status DRAFT | APPROVED | EXPORTED, approvedById?
PayLine            id, payRunId, staffId, visitId?, kind VISIT | MILEAGE | TOP_UP | ADJUSTMENT, minutes?, ratePence, amountPence
```

Money is stored in integer pence. Rounding rules (round per visit or per invoice, round half down or half up) are organisation settings, as in OnePlan.

### B3. Calculations
- **Charge:** for each completed or chargeable visit in the period, minutes = scheduled duration (commissioners usually pay planned time) or clocked duration (setting per funder), split across rate bands it overlaps, × band rate, with minimum-visit rules and bank holiday multiplier. Cancelled visits charge only if the funder's short-notice cancellation rule says so.
- **Pay:** clocked minutes (setting: clocked or scheduled) × the carer's pay band, plus mileage between consecutive visits, plus **minimum wage top-up** so that total pay ÷ (paid hours including travel time between visits) is never below the National Minimum Wage / National Living Wage for the worker's age band. The top-up rule exists because UK law counts travel time between visits as working time.
- **Exports:** CSV in a documented column layout first; Sage and Xero formats as later integrations (OnePlan has a Sage export and a Xero report).

### B4. Screens (Finance portal; the module list in `src/lib/portals.ts` gains a "Finance" portal, colour to be chosen to meet WCAG AA like the others)

| Route | Purpose |
|---|---|
| `/finance/funders` | Funders and their rate links |
| `/finance/rates` | Charge and pay rate cards with bands and effective dates |
| `/finance/invoices` | Invoice runs: create draft for a period → review exceptions (visits with no rate, unclocked visits) → approve (second person) → issue (PDF per invoice via `pdfkit`) |
| `/finance/pay` | Pay runs: draft → exceptions → approve → export CSV |
| `/finance/settings` | Numbering, terms, rounding, mileage rate, bank holidays |

Permissions: `finance.view`, `finance.manage`, `finance.approve` (never the creator of the run).

## Part C · Reporting specification

The existing Reporting portal (`/reports`, `src/server/reports`) gains Rota, Service User and Finance report families as each stage lands. Every report:
- is a real query over persisted records, scoped to the organisation and the user's areas or branches;
- has the same filter bar (date range, areas, carers, service users, call types, status include/exclude) borrowed from OnePlan's advanced filters;
- shows on screen first; CSV export is a separate permission (`report.export`) and every export is audited;
- states its definition in plain English under the title (for example "Late: clocked in more than 10 minutes after the scheduled start").

### C1. Report catalogue by stage

| Stage | Reports |
|---|---|
| R (Rota) | Late / early, missed, cancelled, short visits, scheduled vs clocked hours (carer, service user), unassigned visits, continuity of care, office vs app clocking, template vs built hours, run route sheets, visit notes, task outcomes |
| H (HR link-up) | Absence and Bradford Factor, availability vs booked hours, staff compliance at allocation (warnings overridden), DBS / right to work / training expiry (exists in the HR Hub) |
| S (Service users) | Care plan reviews due, risk assessments due, incidents, contacts (key contacts), package hours vs delivered hours |
| F (Finance) | Invoice register, funder summary, pay summary, mileage, minimum wage top-ups, bank holiday uplifts |
| M (Medication, later) | MAR chart, missed medication, controlled drugs |
| C (Commissioners, later) | Council-specific returns, only where a council asks for a format |

Not carried over from OnePlan: birthday lists, ethnicity in operational reports, and any report that lists personal data without a clear operational purpose.
