# Duplication clean-up (2 November 2026)

The owner asked for every job to have one place, and for staff to do each job once ("wash, dry, iron once"). The audit
is in the project files (`duplication-check/duplication-report.md`). This change carries out the fixes that fit the
platform rules. Old addresses still work, so bookmarks, notification links and server actions are unchanged.

## What changed

| Area | Before | After |
| --- | --- | --- |
| Reports | Four menus. Two different pages were both called "Compliance Reports" (`/reports` and `/compliance/reports`). | Reporting & Analytics lists every report once: Analytics, Rota Reports, Rota Insights, Compliance Reports and AI Assistant. `/rota/reports`, `/rota/insights` and `/compliance/reports` belong to that portal (`src/lib/portals.ts`). The older `/reports` page redirects to the matching Compliance Report, or to Regulatory Updates for its change log. It stays only for CSB staff outside an organisation. The Rota "Reports" and Policy "Compliance Reports" menu entries are shortcuts to the same pages. |
| Reporting access | Only report or analytics roles. | Also anyone with `rota.view`, because Rota Reports lives here. Each page and menu entry still checks its own permission. |
| Settings | System Settings, Rostering, HR and Recruitment settings each had to be found separately. The audit trail was shown on System Settings and on the Audit Log. | `/settings` is "Settings", with an **All settings** list of every settings screen the person may open (`src/components/settings-directory.tsx`). The module gear icons still open their own screens. The audit trail table was removed from Settings because the Activity Log is the one place for it. |
| Users and logins | "Users" and "Workforce Sync & Logins" were separate menu entries. | One entry, **Users & Logins**, with two tabs: Office users and Carer app logins & HR sync (`src/components/admin-tabs.tsx`). |
| Branches and areas | Two menu entries. | One entry, **Branches & Areas**, with two tabs. Rostering Settings already only linked to Areas. |
| Visit problems | Five places: Visits Needing Attention, Unassigned Visits, Missed Calls, Exceptions and Sickness & Holiday Cover. Exceptions sat under The Monitor and Cover under Daily Rota. | Visits Needing Attention is the one to-do list. It now also lists **Carer off** bookings (from Sickness & Holiday Cover, next 7 days) and **Visit problems** (open exceptions on visits). Missed calls and visits left unassigned after a build are not listed twice. The full registers are its tabs: Unassigned Visits, Sickness & Holiday Cover, Missed Calls and Exceptions. The Monitor is the live view only. The approved designs of Unassigned Visits, Missed Calls and the attention page's tiles are unchanged. |
| Names | "Risk Register" and "Risk Assessments"; "Staff Sign-off"; "Audit Log"; "Staff Readiness Matrix". | "Organisational Risk Register" and "Service User Risk Assessments"; "Policy Sign-off"; "Activity Log"; "Staff Readiness Rules". |
| Visit note to incident | Office staff retyped a worrying note into a blank incident form. | "Make this an incident" on each note (Visit Notes and the visit page) opens the incident form with the person, visit, time and the note's words filled in (`incidentDraftFromNote`). The reporter still chooses the category and how serious it was, and sends it. |
| Absence to cover | After approving time off, someone had to find the clashing visits. | Each live absence shows "N booked visits clash" with **Find cover now** (Visits Needing Attention, Carer off). Nothing is moved automatically, and choosing the replacement still goes through the eligibility check. |

## Deliberately left as they are

- **Working patterns.** HR and the rota staff page edit the same single record (PR #53 gave coordinators this on purpose). Nothing is typed twice.
- **HR Hub screens.** HR settings (including its own branch list and authorised accounts) are inside the HR Hub, which is out of scope for restructuring. The All settings list links to them.
- **Carer app login.** The rota staff page already has a "Sign-in links" button. Linking stays a manual step by rule.
- **Staff readiness.** HR records the evidence, the rules live in Settings (Staff Readiness Rules), and the rota shows the result. These are three different jobs.
- **Body map to incident.** This waits for the body map build. It should reuse the same pattern (`/rota/incidents/new?…` filled in on the server).
