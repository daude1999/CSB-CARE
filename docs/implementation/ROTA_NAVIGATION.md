# Rota navigation: nine destinations and Settings

Owner's brief of 1 November 2026 ("Complete Rota sidebar simplification & navigation restructure").
The aim is **simple on the surface, powerful underneath**. The brief changes navigation only.
No page, route, service, model, permission or eligibility rule was removed or changed.

## The new sidebar

1. Rota Home
2. Daily Rota
3. Visits Needing Attention
4. The Monitor
5. Daily Templates
6. Service Users
7. Staff & Workforce
8. Finance
9. Reports

**Settings** sits at the foot, behind a rule.

The menu has no groups, folded lists, "More" lists or Planned rows.

Each destination is a workspace. It opens the first page of that workspace the person may use. It stays lit on every page of the workspace, including detail pages such as `/rota/missed/<id>`. This uses the existing `match` mechanism in `src/lib/navigation.ts`.

On pages that are not protected designs, the workspace's other pages appear as a tab strip under the title bar (`RotaTabs`, using the same `.ws-tabs` style as Policy & Compliance). The tab strip is not added to the protected screens:

- Rota Dashboard
- Daily Rota
- Daily Templates
- Unassigned Visits and Coverage History
- Missed Calls

Their own buttons already lead to the other pages. A pixel check confirmed that all five are unchanged.

## Old to new mapping

| Old sidebar entry | Route | Permission the page checks | New home | How to reach it |
|---|---|---|---|---|
| Rota Home | `/rota` | rota.view | Rota Home | Sidebar |
| Add Visit | `/rota/visits/new` | rota.edit | Daily Rota | The "Add Visit" button on Daily Rota and Weekly Planner, and "Create Visit" on Unassigned Visits |
| Daily Rota | `/rota/visits` | rota.view | Daily Rota | Sidebar |
| Advanced Rota | `/rota/advanced` | rota.view | Daily Rota | The Daily Rota view switch, or the Daily Rota tabs |
| Live Run Routes | `/rota/routes` | rota.view | Daily Rota | The Daily Rota tabs |
| The Monitor | `/rota/monitor` | rota.monitor | The Monitor | Sidebar |
| Printable Rota | `/rota/print` | rota.view | Daily Rota | The Print button on Daily Rota, or the tabs |
| Build Rota | `/rota/build` | rota.build | Daily Rota | Daily Rota "Build Rota", the Daily Templates tabs, or the Daily Rota tabs |
| Weekly Planner | `/rota/planner` | rota.view | Daily Rota | Daily Rota "Weekly Planner", or the tabs |
| Unassigned Visits | `/rota/unassigned` | rota.view | Visits Needing Attention | The Unassigned section of the combined page |
| Sickness & Holiday Cover | `/rota/cover` | rota.view | Daily Rota | Daily Rota "Cover", or the tabs |
| Missed Calls | `/rota/missed` | rota.monitor | Visits Needing Attention | The Missed Calls section, and Monitor alerts |
| Exceptions | `/rota/exceptions` | rota.monitor | The Monitor | The Monitor's new "Exceptions" button, Rota Home "Exceptions", or the tabs on the Exceptions page |
| Visit Notes | `/rota/notes` | portal (listing scoped) | Service Users | The Service Users tabs, or the Rota Home "Visit notes" counter |
| Generate & Optimise | `/rota/optimise` | rota.view | Daily Rota | Daily Rota "Generate & Optimise", or the tabs |
| Daily Templates | `/rota/templates` | rota.view | Daily Templates | Sidebar |
| Advanced Templates | `/rota/templates/planner` | rota.view | Daily Templates | The Templates view switch |
| Template Run Routes | `/rota/routes/templates` | rota.view | Daily Templates | A link on Advanced Templates, the Live Run Routes button, or the tabs |
| Team Members | `/rota/staff` | staff.directory | Staff & Workforce | Sidebar (first tab) |
| Staff Time Off | `/workforce/absences` | HR portal and HR login | Staff & Workforce | The "Holidays & Sickness" tab (opens in HR) |
| Service Users | `/rota/service-users` | serviceUser.view | Service Users | Sidebar |
| Care Plans | `/rota/care-plans` | serviceUser.view | Service Users | The tabs, and each profile |
| Risk Assessments | `/rota/risks` | serviceUser.view | Service Users | The tabs, and each profile |
| Incidents | `/rota/incidents` | incident.report or manage | Service Users | The tabs. Carers see it as its own "Incidents" entry |
| Staff Readiness | `/rota/readiness` | readiness.view | Staff & Workforce | The tabs |
| Invoicing | `/rota/finance/invoices` | finance.view | Finance | The Finance tabs |
| Wages | `/rota/finance/payroll` | finance.view | Finance | The Finance tabs |
| Timesheets | `/rota/finance/timesheets` | finance.view | Finance | The Finance tabs |
| Mileage | `/rota/finance/mileage` | finance.view | Finance | The Finance tabs |
| Tariffs & Funders | `/rota/finance/rates` | finance.view | Finance | The Finance tabs |
| Bank Holidays | `/rota/finance/rates?tab=holidays` | finance.view | Finance | The Finance tabs |
| Finance Overview | `/rota/finance` | finance.view | Finance | Sidebar (first tab) |
| Rota Reports | `/rota/reports` | rota.view | Reports | Sidebar (first tab) |
| Rota Insights | `/rota/insights` | rota.view | Reports | The Reports tabs |
| Rota Settings | `/rota/settings` | rota.settings | Settings | Sidebar foot |
| My Visits (carers) | `/carer` | visit.own | Unchanged | Shown only to carers |

Added to Staff & Workforce: an **Availability** tab (`/workforce/availability`). It is the existing HR page, shown only to people with an HR login.

Removed: the five rows marked **Planned** (Service User Absences, Preference Manager, Communication Log, Holiday Report and Guides and videos). They were labels, not links, so no working feature is affected. They are added to the backlog in `MASTER_BUILD_TRACKER.md`.

Pages that were never in the menu are not affected. `/rota/activity`, `/rota/reminders` and `/rota/search` light Rota Home, as before.

## Visits Needing Attention (`/rota/attention`)

This is one page with two sections. They sit side by side from 1400px wide and stack on smaller screens.

- **Unassigned Visits**
  - Uses `unassignedBoard()` on "This Week", exactly as the Unassigned Visits page does.
  - Shows four counts: visits, urgent, partly staffed and empty places.
  - Lists the 8 most urgent visits with date, time, service user, call, area, reason, priority and carers booked out of carers needed.
  - **Find Cover** opens the Unassigned Visits panel on Recommended. **Manual** opens it on Manual. View-only roles get View instead.
  - Links lead to the full list and to Coverage History.
- **Missed Calls**
  - Uses `missedCallRegister()` with open cases over the last 30 days. The "Open Missed Calls" link applies the same filter, so the counts match.
  - Shows four counts: open, no reason recorded, past deadline and escalated.
  - Lists the 8 newest cases with date, due time, service user, care worker, visit status now, stage and warnings (past deadline, high risk, escalated, repeat carer, no coordinator).
  - **Investigate** opens the case. **Find Cover** opens the existing recovery-cover panel when cover is still possible.

The page writes nothing and has no rules of its own. A person needs `rota.view` or `rota.monitor` to see it, and each section appears only with its own permission.

## Limitation

Open missed-call cases older than 30 days are not counted on the combined page. They remain on Missed Calls, which offers a custom date range.
