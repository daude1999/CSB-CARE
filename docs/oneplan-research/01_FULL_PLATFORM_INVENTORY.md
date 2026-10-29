# 01 · OnePlan full platform inventory

> **Status:** discovery only. No CSB application code was changed for this work.
> **Inspected:** 29 October 2026, read-only, in the owner's own logged-in browser session (System Admin permission).
> **Product inspected:** OnePlan care management, now branded "OneTouch Essentials" (version label "Bodhi 6.0/8.0"), at `care.oneplansoftware.co.uk`.
> **Purpose:** to record what the platform Care Solution Bureau CIC uses today does, so that CSB can provide equivalent functions in its own original software. No OnePlan code, branding, assets or wording is to be copied into CSB.

## How to read these documents

| Mark | Meaning |
|---|---|
| **[O]** | Observed on screen during the inspection. |
| **[I]** | Inferred from labels, help text, menus or vendor release notes. Not verified. Never treat as fact without checking. |
| ✅ | Page inspected. |
| 👁 | Partly inspected (layout or menu only). |
| ⛔ | Blocked to protect personal data. Not inspected. |
| ⏸ | Not opened: not reached in the time available, or opening it could change data (for example marking items read or changing a preference). |

### Rules that were followed

- Nothing was saved, added, deleted, assigned, dragged, clocked, exported, printed, sent or marked read. Forms were opened only to read their fields and were closed with Close, X, Back or Escape.
- No real personal data is recorded here. Field names are listed and values are not. The only real place name is the area label "Liverpool", which is the company's own branch area.
- Screens that show individual service users, staff or pay were not opened (⛔). The browser tool refused them, and that refusal was respected.

### Screenshots

21 screenshots were taken with names and personal details blacked out. They are referenced by file name (for example `02-rota-daily-rota.png`) throughout. Whether they are stored in this repository is the owner's decision, because the repository is public. Until that is decided they stay on the owner's laptop (`Documents\OnePlan-inspection\screenshots`). See [README](README.md).

## 1. Navigation hierarchy

```
Top bar (every page)
├─ Logged-in user and branch ("<user> In <branch>"), live clock         [O]
├─ Incidents (badge count) ......... /members/incidents/incidents.php    ⏸
├─ Reminders (badge count) ......... /members/remindersActive.php        ⏸
├─ Notifications (bell, badge) ..... in-page dropdown                    ⏸ may mark items read
└─ Settings (cogs) ................. /members/settings/                  ✅ see 07

Floating "Selected Areas" box (most pages): active area filter, e.g. "Liverpool", "No Area"   [O]

Sidebar
├─ Home ............................ /members/index.php                  ✅  → 02
│   ├─ Complete / Late / Missed / Missed-meds call lists  shifts-*.php?date=   👁 (Late only)
│   ├─ Switch Dash (?toggleDash) ..................................... ⏸ changes a preference
│   └─ Unverified Emails ............ /members/unverified-emails.php       ⏸
├─ Rota                                                                   → 04
│   ├─ Add Rota (in-page) ............................................ ⏸
│   ├─ Daily Rota ................... /members/welcomeAdvanced.php        ✅
│   │   └─ Visit detail (?rota&visit=<id>) .............................. ⛔
│   ├─ Advanced Rota (planner board)  /members/advanced-rota.php          ✅
│   ├─ Live Run Routes .............. /members/runroute_live.php          ✅ (+ add form read)
│   ├─ The Monitor (live calls) ..... /op/framework/views/the-monitor.php ✅
│   ├─ Printable Rota
│   │   ├─ Team Member .............. /members/rota/print/rota-print.php  ✅ (form only)
│   │   └─ Service User ............. /members/rota/print/client-rota-print.php ✅ (form only)
│   └─ Build Rota ................... /members/rota-builder.php           ✅ (+ build form read)
├─ Templates                                                              → 04
│   ├─ Daily Templates .............. /members/welcomeTemplate.php        ✅
│   │   └─ Add New Template (2 steps)  rota-add-service.php?template → rota-add-template.php?user=<id>  ✅ form read
│   ├─ Advanced Templates ........... /members/advanced-templates.php     👁
│   └─ Template Run Routes .......... /members/runroute_template.php      👁
├─ Users                                                                  → 03, 05
│   ├─ Team Members
│   │   ├─ View All ................. /members/staff                      ⛔
│   │   ├─ Holidays / Absences ...... /members/holidays.php?staff         ⏸
│   │   └─ Contracts ................ /members/settings/staff-contract-list.php 👁
│   ├─ Service Users
│   │   ├─ View All ................. /members/client/                    ⏸
│   │   ├─ Custom Forms ............. /members/settings/form.php          ⏸
│   │   ├─ New On Site .............. /members/client/create-careplan.php ⏸
│   │   └─ Holidays / Absences ...... /members/holidays.php?client        ⏸
│   ├─ Preference Manager ........... /members/pref-manager.php           ⏸
│   ├─ Location Tracking ............ /members/locations/                 ⏸
│   └─ Communication Log ............ /members/communicationLog/communicationLog.php ⏸
├─ Invoicing/Wages                                                        → 06
│   ├─ Invoicing .................... /members/invoices/invoice-all-main.php ⛔
│   ├─ Wages ........................ /members/wages/all-wage-groups.php  ⛔
│   ├─ Tariffs (setup) .............. /members/tariffs/tariff.php         👁 (Invoicing tab)
│   ├─ Funders ...................... /members/funders/funder.php         ✅ (rows blacked out)
│   ├─ Settings ..................... /members/setting-pay2.php           ✅
│   ├─ Bank Holidays ................ /op/framework/views/setting-bankhols.php ✅
│   └─ Holiday Report ............... /members/reports/general/holiday-report.php ⏸
├─ Reports ......................... /members/reports.php                ✅ list + 3 filter forms → 06
├─ Support                                                                → 07
│   ├─ Care Portal Support .......... /members/view-support-tickets.php   ⏸
│   ├─ Support (tickets) ............ /members/oneplan-support.php        ✅
│   ├─ Customer Ordering ............ /members/customerOrdering.php       ⏸
│   ├─ Training Videos, Bitesize Videos, Documentation ................. ⏸
│   └─ Updates (changelog) .......... /members/updates-2025.php           ⏸
├─ Hide Screen (privacy blank) ...................................... ⏸
└─ Sign Out ........................................................ never clicked

Settings (/members/settings/)                                             → 07
├─ Company · On Call · Logged In Users · System Logs · Care Portal Accounts/Permissions
│  · Legacy Care Portal Options · My Settings · Permissions · Forms · General
│  · Team Member Portal Settings · Medication Admin Types · Medication Time Ranges ...... ⏸
├─ Rota And App Settings ........... /members/settings/rota.php           ✅
└─ All Lists ....................... /members/settings/lists.php          ✅ (menu)
    ├─ Service List ✅ · Areas List ✅ · Tasks ✅ · Custom Holiday Types ✅ · Team Member Contracts 👁
    └─ Roles · Pharmacy · Doctors · Medication List (deprecated) · Qualifications · Reminders · Vaccine
       · Team Member References · Communication Log Reasons · Qualification Sub-Status · Tags
       · Document Category Manager · Programs Of Care · Banners ......... ⏸
```

## 2. Module inventory

| # | Module | What it is for | Coverage | Spec |
|---|---|---|---|---|
| 1 | Shell and top bar | Logged-in identity, branch, area filter, incident, reminder and notification badges, privacy blank screen | [O] layout; badges' targets ⏸ | 02, 07 |
| 2 | Home dashboard | Daily operational overview: call outcomes, people lists, reminders, conflicts, holidays, unread notes | ✅ | 02 |
| 3 | Daily Rota | List of every visit on one day, with bulk actions | ✅ (visit detail ⛔) | 04 |
| 4 | Advanced Rota | Planner board (timeline) by carer, service user, area, week or run route | ✅ | 04 |
| 5 | Live Run Routes | Grouping visits into a carer's round for a week | ✅ | 04 |
| 6 | The Monitor | Live call monitoring: due, late, in progress, missed | ✅ | 04 |
| 7 | Printable Rota | Paper rotas per carer or per service user | ✅ (form only) | 04 |
| 8 | Build Rota | Generates a live week of visits from the 1–4 week template cycle | ✅ | 04 |
| 9 | Templates | The recurring weekly care pattern for each service user | ✅ | 04 |
| 10 | Team members | Staff records, holidays/absences, contracts, preferences, location | Mostly ⛔/⏸ | 03 |
| 11 | Service users | Client records, custom forms, new care plan, holidays | ⏸ | 05 |
| 12 | Communication Log | Contact log with reasons | ⏸ | 05, 07 |
| 13 | Invoicing | Invoice runs from delivered visits | ⛔ | 06 |
| 14 | Wages | Pay runs from delivered visits | ⛔ | 06 |
| 15 | Tariffs and funders | Charge and pay rates by time band, funders linked to services | 👁 | 06 |
| 16 | Invoice and wage settings | Invoice numbering, layout, rounding, mileage and minimum-wage rules | ✅ | 06 |
| 17 | Bank holidays | Bank holiday charge and pay uplifts | ✅ | 06 |
| 18 | Reports | 60+ named reports in three groups | ✅ list, 3 filter forms | 06 |
| 19 | Settings | Rota and app rules, lists (services, areas, tasks, holiday types …), permissions | ✅ rota settings and four lists; rest ⏸ | 07 |
| 20 | Support | Vendor support tickets, training videos, documentation, updates | 👁 | 07 |
| 21 | Incidents, Reminders | Incident register; reminder list for staff and clients | ⏸ | 07 |
| 22 | Care Portal / Family portal | Family or commissioner access to rota information | ⏸ (settings tiles only) | 07 |
| 23 | Carer mobile app | Clock in/out (NFC, QR, location), notes, tasks, medication, door-step cancels | [I] from settings only | 04 |

## 3. Core domain concepts

| Concept | OnePlan term | Description | Evidence |
|---|---|---|---|
| Branch | Branch | The organisation's location, shown in the top bar and in Branch Details on Home | [O] |
| Area | Area | A geographic patch inside a branch. Lists filter by selected areas, and users are linked to areas | [O] Areas list and "Selected Areas" box |
| Service user | Service User / Client | A person receiving care | [O] |
| Team member | Team Member | A staff member. Permission level "Field User" (carer) or "System Admin" | [O] |
| Service | Service List entry | The type of call, e.g. "Morning Call Private", "Tea Call Private". Has a service level, active flag and "monitored" flag | [O] |
| Task | Task | A care task to complete on a visit (e.g. personal care, repositioning) | [O] |
| Template | Template | A recurring visit on a given weekday in Week 1–4 of a rolling cycle | [O] |
| Rota (build) | Rota / Week N Rota | One live week built from the templates for that week number | [O] |
| Visit | Visit / Shift / Call | One dated appointment. Scheduled and clocked times, status, carer(s) | [O] |
| Double-up | Link Up | A visit that needs two carers (slot 1 and slot 2) | [O] |
| Run route | Run Route | A named, coloured round of visits for one carer, per week | [O] |
| Shadow shift | Shadow | An extra carer shadowing a visit, e.g. for induction. Excluded from some reports | [O] options, [I] meaning |
| Rota lock / time lock | Lock | Stops a visit's time or carer being changed | [O] options, [I] behaviour |
| Alternate rota type | Rota Type: Alternate | Visits paid from alternative wage tariffs, e.g. waking nights | [O] note, [I] use |
| Preference | Pref | A 1–5 star rating of a carer for a service user, plus the client's carer gender preference | [O] settings, [I] behaviour |
| Funder | Authority / Direct funder | Who pays: a council or NHS body (authority), or the client privately (direct) | [O] |
| Tariff | Charge / wage tariff | Rate per time band, linked to a funder and a service | [O] panels, [I] detail |
| Contract | Team Member Contract | Staff contract. Some features need one | [O] help text |
| NFC tag | NFC | A tag at the client's home that the carer scans to clock in | [O] field, [I] use |

## 4. Status values seen

| Object | Values | Evidence |
|---|---|---|
| Visit | Due, Late, In Progress | [O] |
| Visit | Complete, Missed, Cancelled, Uncovered (no carer), Short | [I] from tiles, filters and settings |
| Visit acknowledgement | Acknowledged / not acknowledged by the carer | [O] icon |
| Template | Enabled / Disabled, "New" | [O] |
| Rota build | Built (tick), Current week Yes/No | [O] |
| Service | Active / Inactive, Monitored Yes/No | [O] |
| Team member | Pending (onboarding sub-statuses), Active | [I] vendor notes |

## 5. Everything not inspected

| Area | Why | What it would add |
|---|---|---|
| Visit detail page and tabs | ⛔ personal and medical data | Notes, tasks done, medication record, clock-in method and location, history |
| Staff list and staff record tabs | ⛔ personal data | Full staff fields, documents, qualifications, availability |
| Service user list and record tabs, Custom Forms, New On Site (care plan) | ⏸ same privacy rule | Care plan structure, assessments, medication, contacts |
| Holidays / Absences (staff and client) | ⏸ | Absence fields and how the rota is replaced |
| Preference Manager, Location Tracking, Communication Log | ⏸ | Preference editing, GPS trail, contact log fields |
| Invoicing and Wages runs | ⛔ billing and pay data | Run workflow, statuses, exports (Sage, Xero) |
| Tariff tabs other than Invoicing; Holiday Report | ⏸ | Time-band structure for pay |
| Add Visit form, Add Rota, Advanced Rota Settings, the Monitor settings, View Deleted, View Holidays, conflict pages | ⏸ | Single-visit fields, conflict rules |
| Other Settings pages (Company, On Call, Logged In Users, System Logs, Care Portal, Permissions, Forms, General, My Settings, Team Member Portal, Medication) and the other Lists | ⏸ | Role/permission model, medication setup, forms builder |
| Incidents, Reminders, Notifications | ⏸ (Notifications might mark items read) | Incident fields and workflow |
| Carer mobile app | Not available in the browser | Carer journey end to end |
| Filter forms of reports other than the three listed | ⏸ | Report parameters |

To fill these gaps safely, the owner can either show the screens with demo or test records, or give explicit permission to view personal data, which would still be kept out of the notes and screenshots.
