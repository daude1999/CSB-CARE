# 02 · Dashboard design reference

Source: OnePlan Home (`/members/index.php`) and the global shell, inspected read-only on 29 October 2026. Screenshot: `01-home-dashboard.png`. **[O]** observed, **[I]** inferred.

## 1. What OnePlan's dashboard does today

### 1.1 Global shell (every page) [O]

| Element | Detail |
|---|---|
| Top bar | Hamburger (collapse sidebar), map icon, "<user> In <branch>", live date and time, four badge icons: Incidents (red count), Reminders (orange count), Notifications (bell, orange count), Settings (cogs) |
| Sidebar | Icon rail: Home, Rota, Templates, Users, Invoicing/Wages, Reports, Support, Hide Screen, Sign Out. Each section has a fly-out submenu |
| Area filter | A floating "Selected Areas" box listing the active areas (e.g. "Liverpool", "No Area"). **[I]** Every list and figure is scoped to the selected areas |
| Hide Screen | Eye-slash button. **[I]** Blanks the screen instantly for privacy when someone walks past |

### 1.2 Home page layout, top to bottom [O]

1. **Header row:** "Switch Dash" toggle (**[I]** alternative dashboard layout; not clicked because it saves a preference), a large date title, previous/next day arrows and a date picker. Every figure on the page is for the chosen date.
2. **Vendor announcement carousel:** a wide coloured banner with vendor news. (CSB equivalent: none needed; see 1.4.)
3. **Four call-outcome tiles** for the chosen date, each linking to a filtered visit list:

   | Tile | Main figure | Sub-text | Opens |
   |---|---|---|---|
   | Complete calls | count | "% of N shifts" | Completed visits list |
   | Late calls | count | "% … N minutes late" (late threshold from settings, 10 min) | Late visits list |
   | Missed calls | count | "% Not clocked into" | Missed visits list |
   | Calls with missed meds | count | "N Missed Meds" | Visits with missed medication |

4. **People and reminder widgets** (three columns, each searchable and sortable):
   - **All Service Users:** row actions "Rota" (opens that person's live rota) and "Template" (their recurring pattern), plus an info pop-up. Columns: forename, surname, DOB, ethnicity, date added, address line 1, postcode, telephone, NFC tag, pharmacy, doctor, next of kin name and number, doctor telephone, email.
   - **All Team Members:** "Unverified Emails" button. Columns: forename, surname, status icon, permission (Field User / System Admin), 4-digit app login code, DOB, ethnicity, role, date started, manager, address line 1, postcode, telephone, reference number, email.
   - **All Active Reminders:** the 100 most recent, with "View All". Columns: reminder, due date, account (person), type (client or staff), days overdue.
5. **Counters:** Rota Conflicts, Template Conflicts, Holidays Due, Unread Notes.
6. **Upcoming birthdays:** service users and team members.
7. **Branch details:** name, address, phone, website.
8. **Latest updates:** vendor changelog.

### 1.3 Drill-down pages [O]

The Late Calls tile opens `shifts-late.php?date=`: the four tiles again as a carousel, Home / Export All / Export Late buttons, a date navigator, Bulk Actions, a search box and the same visit table as the Daily Rota, filtered to late visits, with total scheduled and clocked hours. A banner says "You are looking at late shifts only". **[I]** Completed, Missed and Missed-meds are the same page with a different filter.

### 1.4 What works and what doesn't

| Works well (keep the idea) | Weak (improve in CSB) |
|---|---|
| One date drives the whole page, with quick previous/next day | Vendor marketing banner takes the most valuable space on screen |
| The four call outcomes are the first thing a coordinator needs each morning | Tiles are large blocks of saturated colour, the generic dashboard pattern CLAUDE.md forbids |
| Every figure links to the exact list behind it | Percentages without the denominator in the main figure; "% of N shifts" is buried in sub-text |
| Area filter applies everywhere | Area filter is a floating box that covers the page title |
| Conflicts and holidays due are surfaced as counters | People tables on the dashboard show sensitive fields (DOB, ethnicity, addresses, NOK) to anyone who can see Home |
| Hide Screen privacy button | Upcoming birthdays and branch details use space that operational information needs |

## 2. Recommended CSB dashboard (Rota & Visits "Today")

The CSB Overview portal (`/overview`) stays as the cross-module launcher. The OnePlan-style operational dashboard belongs **inside Rota & Visits** as its home page (`/rota`), because it is about today's visits. Overview then shows a compact Rota tile linking to it, as it already does for HR.

### 2.1 Layout

Follow the CSB design system (CLAUDE.md "Product and design standards"): module colour purple `#6b46c9` in the TitleBar via `--module`, no gradients, no decorative icons, no stat-card rows. The page is built around the coordinator's job: *find visits at risk today and act on them*.

```
┌ TitleBar (purple): Rota & Visits · Today ─── [◀ Thu 29 Oct 2026 ▶] [Area: Liverpool ▾] ┐
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Call outcomes strip (one line, not tiles):                                           │
│  9 visits · 0 complete · 1 late (10 min+) · 0 missed · 0 missed medication · 2 unassigned │
│  each figure is a link that filters the table below                                  │
├───────────────────────────────────────────────┬──────────────────────────────────────┤
│ Needs attention now (table, sorted by risk)    │ Coming up                            │
│  time · service user · carer · state · action  │  Conflicts (rota / template) → list  │
│  e.g. 08:10 Late, not clocked in               │  Unassigned visits next 7 days       │
│       10:00 Unassigned double-up slot 2        │  Holidays starting this week         │
│       12:30 Carer's DBS expired                │  Carer checks expiring (from HR)     │
│                                               │  Reminders due (top 5, View all)     │
├───────────────────────────────────────────────┴──────────────────────────────────────┤
│ Today's visits (full table, same component as Daily Rota, filtered by the strip)      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Rules

- **Familiar to OnePlan users:** keep the date navigator, the four outcome names (complete, late, missed, missed medication), click-through from every figure, and the area filter.
- **Plain figures:** "1 late of 9" rather than "11.11%". Show percentages only alongside the count.
- **Real data only:** every figure is computed from `Visit` records for the chosen date and areas. No hardcoded numbers, and an honest empty state ("No visits on this date") when there are none.
- **Privacy:** no DOB, ethnicity, address or next-of-kin on the dashboard. People lists live in Service Users and HR, behind their own permissions.
- **HR link-up:** "Carer checks expiring" comes from the shared staff record and HR compliance (`checkStatus`), so a coordinator sees that a carer on today's rota has an overdue DBS or training. OnePlan has nothing like this, and it is CSB's main improvement.
- **Hide screen:** keep a keyboard-reachable "Hide screen" control in the shell (blank overlay; Escape or click to return). It changes nothing on the server.
- **Auto refresh:** optional 60-second refresh of the outcome strip and attention list, off by default, as in OnePlan's Advanced Rota.
- **Responsive:** on a phone the strip wraps to two lines, "Needs attention" comes first, and the full table becomes a card list.
- **Accessible:** state is shown in words and icon, never by row colour alone (OnePlan relies on pale yellow and blue rows).

### 2.3 Overview tile (cross-module)

When Rota is built, the Rota tile on `/overview` replaces "Not built yet" with two real figures for today in the user's areas: visits today and visits needing attention (late + missed + unassigned). It links to `/rota`.

## 3. Acceptance points for the dashboard

See [10_TEST_AND_ACCEPTANCE_MATRIX.md](10_TEST_AND_ACCEPTANCE_MATRIX.md), rows DASH-01 to DASH-10.
