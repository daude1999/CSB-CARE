# 07 · Administration and other modules

Settings, lists, support, the top bar and everything else that is not Rota, HR, Service Users or Finance. **[O]** observed, **[I]** inferred. Nothing in Settings was changed or saved.

## 1. Settings home (`/members/settings/`, screenshot `19`) [O]

| Tile | Inspected | Purpose |
|---|---|---|
| Company Settings | ⏸ | [I] Company name, address, logo, contact |
| On Call | ⏸ | [I] On-call manager rota and phone, receives late/missed/short alerts |
| Logged In Users | ⏸ | [I] Who is signed in now; probably force sign-out |
| Rota And App Settings | ✅ | See 04 §A5 |
| All Lists | ✅ menu | Reference lists (below) |
| System Logs | ⏸ | [I] Change log of who changed what |
| Care Portal Accounts / Permissions | ⏸ | [I] Family / commissioner portal logins and what they can see |
| Legacy Care Portal Options | ⏸ | Older version of the above |
| My Settings | ⏸ (changes a preference) | Personal display preferences |
| Permissions | ⏸ | [I] Permission levels and what each can do |
| Forms | ⏸ | [I] Custom form builder (assessments, care plan forms) |
| General Settings | ⏸ | [I] Organisation-wide options |
| Team Member Portal Settings | ⏸ | [I] What carers see in the app |
| Medication Admin Types, Medication Time Ranges | ⏸ | [I] eMAR set-up |

## 2. All Lists (`/members/settings/lists.php`) [O]

| List | Inspected | Fields seen | CSB home |
|---|---|---|---|
| Service List | ✅ (screenshot `21`) | Name, service level, description, status (Active/Inactive), monitored (Yes/No). Values: Bed / Lunch / Morning / Sitting / Tea Call Private, Domiciliary Care (inactive) | `CallType` (Rota settings) |
| Areas List | ✅ | Name, linked users count. Values: "No Area", "Liverpool" | `Area` (Admin → Organisation) |
| Tasks | ✅ | Name, description, active; bulk status update. Examples: personal care, repositioning, change bedding, change pad | `CareTask` (Rota settings) |
| Custom Holiday & Absence Types | ✅ | Type, used for (team member). Empty | `AbsenceType` (HR) |
| Team Member Contracts | 👁 | Contracts and unassigned staff | `StaffContract` (HR) |
| Roles | ⏸ | – | `JobRole` (HR) |
| Pharmacy, Doctors | ⏸ | – | Contacts of kind PHARMACY / GP (Service Users), optional shared directory |
| Medication List (deprecated) | ⏸ | – | eMAR stage |
| Qualification List, Qualifications Sub-Status | ⏸ | – | HR Hub requirement rules and checks |
| Reminders List | ⏸ | – | Reminder types (below) |
| Vaccine List | ⏸ | – | HR check category |
| Team Member References | ⏸ | – | HR Hub document category "References" |
| Communication Log Reasons | ⏸ | – | Communication log (below) |
| Tags | ⏸ | – | Tags on service users and staff |
| Document Category Manager | ⏸ | – | HR Hub document types; Evidence Library |
| Programs Of Care | ⏸ | – | [I] Named care programmes, e.g. reablement; Service Users |
| Banners | ⏸ | – | [I] Announcement banners; CSB uses Notifications instead |

## 3. Support [O]
Care Portal Support (tickets), Support (vendor tickets: Create Ticket, Open / Closed tabs, Ticket Details with vendor service hours Monday–Friday 9–5 and a 2–24 hour response), Customer Ordering, Training Videos, Bitesize Videos, Documentation, Updates (changelog). These are the vendor's own support channels.

**CSB:** no ticketing module is needed. A "Help" link in the shell to CSB's own guidance and a contact route is enough. CSB's release notes can reuse the Notifications system.

## 4. Top bar items

| Item | OnePlan [O] | CSB |
|---|---|---|
| Incidents (badge) | `/members/incidents/incidents.php` ⏸ | Incident register in Service Users (05 §B1), linked to Actions & Risks in Policy & Compliance |
| Reminders (badge) | `/members/remindersActive.php` ⏸; Home lists reminder, due, account, type (client/staff), days overdue | General `Reminder` (subject: staff or service user, due date, assignee, done) shown in Notifications. HR check reminders already exist |
| Notifications (bell) | Dropdown, not opened (might mark items read) | Existing `/notifications` |
| Settings | Settings home | Administration portal (`/settings`) |
| Hide Screen | Privacy blank | Shell control, see 02 |
| Area filter | Floating "Selected Areas" box | A proper area selector in the TitleBar, remembered per user |

## 5. Other functions found by name

| Function | Where | Notes | CSB |
|---|---|---|---|
| Preference Manager | Users | Carer–client ratings | `CarerPreference` (03, 04) |
| Location Tracking | Users | [I] Carer GPS at clock events | `VisitClock` lat/long, monitor view only |
| Communication Log | Users; reasons list; report | [I] Log of calls and messages with families, professionals | `CommunicationLogEntry` (subject, direction, reason, summary, follow-up), Service Users stage |
| Care Portal / family portal | Settings | [I] Families see visit times X days forward/back | Later stage; read-only portal with its own invite and consent |
| Welfare check | Rota settings, report | Checklist when the carer cannot get in | Doorstep "not delivered" flow (04 §B6) |
| Unverified emails | Home | Staff emails not confirmed | Email verification on `User` invite |
| Push messages | Rota bulk action | To carers' phones | Later, needs a messaging provider |
| Council report packs | Rota settings | Paid add-ons | Commissioner returns, later (06) |

## 6. CSB administration additions needed for these modules

| Setting area | Where in CSB | Contents |
|---|---|---|
| Organisation → Areas | `/settings` (Administration) | Areas per branch with colour; link staff and service users |
| Organisation → On call | `/settings` | On-call rota: who receives escalations, by date range |
| Roles and permissions | `/settings` | New roles `CARE_COORDINATOR` and `CARER`; area scoping on memberships |
| Rota settings | `/rota/settings` | 04 §B3, plus call types and care tasks |
| Finance settings | `/finance/settings` | 06 |
| Audit trail | `/settings` (exists) | Shows the new modules' events |
| Logged-in sessions | `/settings` | List and revoke sessions (the `Session` table already exists) |
