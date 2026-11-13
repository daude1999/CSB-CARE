# Build prompt: ClearCare "Harbour" redesign in the live app

Paste everything below the line into Claude Code, opened on the `daude1999/CSB-CARE` repository. Unzip `clearcare-design-reference` into the repo at `docs/design/harbour/` first, so the prompt can point at it.

---

You are implementing an approved visual redesign of ClearCare, the care-management app for Care Solution Bureau CIC, in this repository. The owner (Daude) has reviewed and approved the design. Your job is to make the live app look and behave like the reference. You must not change what the app does.

## 1. Reference material (read all of it before writing code)

Everything is in `docs/design/harbour/`:

- `screens/*.png`: the approved look. Match these.
  - `service-user-in-shell-1440.png` and `service-user-record-1440.png` are the master reference for the record layout.
  - `employee-record-1440.png` uses the same layout for HR.
  - `icon-rail-menu-open-1440.png` shows the shell, with the menu sliding out of the icon rail.
  - `rota-home-1440.png`, `needs-attention-queue-1440.png` and `list-page-1440.png` show module pages.
  - `overview-1180.png` shows the Overview, whose content and layout stay as they are now, with coloured title bars added.
  - `daily-rota-1180.png` shows that the Daily Rota layout stays the same and only gets restyled.
  - `records-phone-390.png` shows phone behaviour.
- `prototype/clearcare.css`: the prototype's complete stylesheet. It is the source of truth for every colour, size, spacing, radius and animation value. The later sections ("round 5" and "round 6") override earlier ones.
- `prototype/*.dc.html`: the prototype screens. Each has HTML plus a `class Component` block with simulated data.
  - Use them for structure, labels and order.
  - The data is fake: never copy names or numbers into the app.
  - `Main.dc.html` contains the full navigation tree with every route.
  - `Parity.dc.html` lists every existing feature and where it lives in the new design.

Then read `CLAUDE.md`, `src/server/auth/rbac.ts`, `src/lib/portals.ts`, `src/components/ui.tsx`, `src/app/layout.tsx`, `tailwind.config.ts`, `src/app/themes.css`, `src/lib/themes.ts`, `src/components/rota-board.tsx` and the current pages for each route below.

## 2. Hard rules (do not break any of these)

1. **Visual and layout changes only.** Do not change:
   - Prisma schema or migrations
   - API routes or server actions in `src/app/actions.ts`
   - anything in `src/server`
   - RBAC, roles or permission checks
   - tenant or organisation isolation
   - validation, or business rules
2. **Keep 100% of features.** Every route, button, form, filter, bulk action, drawer, tab, export and permission-gated element that exists today must still exist and work. If the design has no obvious place for something, put it in the nearest panel's tool row or the record's Menu. Never delete it. Use `Parity.dc.html` as a checklist.
3. **Never invent features.**
   - Each panel has a tool row: Add, Export, Edit selected, Remove selected, Pin, More. Show only the buttons that map to an action that already exists for that data. Hide the rest.
   - Do not fake Refresh: it re-fetches the same data.
   - "Open full screen" (the expand icon) is UI only: it opens the panel's existing full page, or a larger view of the same data.
   - If a timeline, count or panel in the reference has no real data source in the app, leave it out and list it in the PR description. Do not add queries to new tables.
4. **Sensitive data stays protected exactly as now.**
   - Date of birth, NHS number, home address and restricted documents stay masked until "Show", and only for users who already have sensitive access.
   - "Show code" for the key safe stays audited.
   - Do not render masked values into the HTML.
5. **Daily Rota keeps its layout:**
   - Board by default, with team-member rows and "Needs a carer" first.
   - Quiet hours folded, and drag to reassign through the eligibility service.
   - List view with all 18 bulk actions.
   - The same filters, Actions menu and Visit Details drawer.
   - Only colours, type and spacing change, plus the bar above the board in the Care colour.
6. **Git.**
   - Work on a new branch per phase.
   - Open a pull request per phase.
   - **Never merge to main and never deploy.** Daude merges after reviewing.
   - Do not force-push shared branches.
7. **Quality gates per phase:**
   - Type check, lint and the existing test suite all pass. Record the baseline before you start, and do not introduce new failures.
   - Take screenshots at 1440, 834 and 390 wide, using demo or seed data only, never real care records.
   - Attach the screenshots to the PR.
8. **Accessibility:**
   - Text contrast of at least 4.5:1 (white on the title-bar colours below passes).
   - Every icon-only button gets an `aria-label` and a `title`.
   - Visible focus rings and keyboard-reachable everything.
   - Respect `prefers-reduced-motion`.
9. **CLAUDE.md:** this is the one non-code file you change, in Phase 1. Replace the paragraph headed "ClearCare design system (owner's decision, 12 Nov 2026)" with the text in section 9 below. Change nothing else in CLAUDE.md.

## 3. Design tokens ("Harbour")

Add these as CSS variables in `src/app/themes.css`, and map them in `tailwind.config.ts`. Keep the existing theme mechanism working. If there is a theme switcher, Harbour becomes the default.

- **Canvas and lines:**
  - canvas `#F7F7F5`; record and module page background `#F4F6F9`; surface `#FFFFFF`; sunken `#F3F2EF`; hover `#F6F5F2`
  - line `#E6E4DF`, line-2 `#EFEEEA`, panel border `#DCE1E8`
- **Ink:** `#15181D`, ink-2 `#4A4F57`, ink-3 `#676C74`, ink-4 `#9A9EA5`
- **Brand:**
  - navy `#1F3A68`, hover `#29497F`, brand-50 `#EEF2F8`, brand-100 `#DCE3F0`
  - link blue `#1F4FB4`
  - header strip `#E9F0FA` with border `#D3DEEE`
- **"Now" accent (saffron):** `#E9A23B`, 50 `#FDF3E1`
- **Status:**

  | Status | Text | Fill | Tint |
  |---|---|---|---|
  | ok | `#16784A` | `#2E9A63` | `#E7F4EC` |
  | progress | `#5B3CC4` | `#7B5FDA` | `#F1EDFC` |
  | warn | `#8C5200` | `#D9901F` | `#FDF1DA` |
  | bad | `#B3261E` | `#D14336` | `#FCEBE9` |

- **Module colours**, used for the module icon, the page-header icon, sub-tab pills and the default panel bar:

  | Module | Colour | 50 | 100 | Ink |
  |---|---|---|---|---|
  | Care & Rostering | `#0F766E` | `#E9F5F2` | `#C9E7DF` | `#0B5D56` |
  | HR & Workforce | `#B4532A` | `#FCF1EA` | `#F3DBCA` | `#8F3E1C` |
  | Policy & Compliance | `#2E5BCF` | `#EFF3FD` | `#D6E1FA` | `#2448A6` |
  | Reporting | `#0E7490` | | | |
  | Administration | `#5B5E96` | | | |
  | Home | `#1F3A68` | | | |

- **Panel title-bar colours.** Pick by meaning, not at random. All of them take white text.

  | Colour | Hex | Use it for |
  |---|---|---|
  | blue | `#2E5BCF` | details, info |
  | rose | `#B8336A` | contacts, people |
  | red | `#B3261E` | risks, alerts, "what needs doing" |
  | amber | `#8C5200` | before you visit, due soon |
  | teal | `#0F766E` | care plans |
  | green | `#16784A` | completed, verified |
  | navy | `#1F3A68` | schedules, today, timelines |
  | cyan | `#0E7490` | documents, upcoming |
  | orange | `#B4532A` | funding, employment |
  | purple | `#5B3CC4` | team, dates |

- **Type:**
  - Instrument Sans for the UI (weights 400 to 700).
  - Newsreader for long document and policy text.
  - IBM Plex Mono for references and IDs.
  - Self-host them with `@fontsource`, the way `layout.tsx` already loads IBM Plex. Do not load from Google Fonts at runtime.
  - Body 13 to 13.5px; panel titles 13.5px semibold; page titles 20px semibold.
- **Radius:**
  - 4px: panels, tables, tiles.
  - 6px: buttons and inputs.
  - 999px: pills, chips and alert icons.
- **Shadow:**
  - `0 1px 2px rgba(21,24,29,.06)` on panels.
  - Menus and the flyout use `0 12px 32px -8px rgba(21,24,29,.25)`.
- **Icons:** keep Phosphor, regular weight, 16 to 20px, `currentColor`.

## 4. Motion (Daude loves this, so keep it exactly)

- `@keyframes pnIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`.
- Panels, tiles, board columns and the timeline use `pnIn .45s cubic-bezier(.2,.7,.2,1) both`.
- Stagger siblings by about 40ms each, to a maximum of 8.
- The menu flyout slides in from the rail with `transform .25s cubic-bezier(.2,.7,.2,1)` and has a scrim behind it.
- Alert icons scale to 1.12 on hover. Tiles and alert chips lift 1px on hover.
- Under `prefers-reduced-motion: reduce`, all of this is off.
- Motion must never delay interaction or hide content from screen readers.

## 5. Shared components

Build these once in `src/components/harbour/` and reuse them everywhere. Use the class names in `prototype/clearcare.css` as the spec for each.

1. **`AppShell`.** Desktop is 1024px and up.
   - **`IconRail`:** 76px wide, white, right border. From the top:
     - the logo square (navy, 40px, "CC");
     - Home, Alerts (unread badge), Rostering (Care, with a needs-attention badge), Staff (HR), Policies, Reporting, Admin and All pages;
     - then, pinned to the bottom: AI (opens the existing AI Coordinator panel) and Settings.
     - Each item is a 20px icon over a 10.5px label. The active item has a brand-50 background and navy text.
     - Only show modules the user's role can see. Use the existing `portals.ts` and RBAC logic, unchanged.
   - **`MenuFlyout`:** the full navigation tree, 288px wide, fixed beside the rail, closed by default. It contains:
     - the org switcher and "Search or jump to /";
     - Overview, Notifications and All pages;
     - the modules, with the clicked module expanded.
     - Clicking a rail module opens it. Picking a page, pressing Escape or clicking the scrim closes it.
   - **`TopBar`:** 48px high, white, 3px navy top border. It holds:
     - the breadcrumb (module icon, module name, page);
     - on the right: Demo data badge (demo orgs only, as now), Notifications, Search, Recent, Help, a divider, then avatar, name and "Organisation · Branch".
   - **Below 1024px:** the rail hides. The existing hamburger opens the same tree as a left drawer, and the existing phone bottom tab bar stays.
2. **`SubTabs`:** the pill strip under the top bar for grouped pages.
   - Background is the module 50 tint. A bold module-ink label sits on the left.
   - Pills are 34px. The active pill is filled with the module colour and white text.
   - It sticks to the top on scroll.
3. **`PageHeader`:** the band at the top of module pages.
   - Background `#E9F0FA`, padding 14px 20px.
   - A 40px icon tile in the module colour, the module name in small bold module ink, a 20px title, and one plain-English line saying what the page is for.
   - Primary and secondary actions on the right.
4. **`HowThisWorks`:** the tip box under the header, with a dismissible "Got it".
   - Remember the dismissal per user per page.
   - Use client storage only if there is no existing user-preference store; do not add a table.
   - Write the tip copy in plain English for coordinators and registered managers.
5. **`StatTiles`:** a row of clickable count tiles. Clicking one filters the main table, and "Show all" clears the filter.
   - Each tile has a 34px solid-colour icon square (white icon), a 22px number and a label.
   - Counts come from existing queries only.
6. **`Panel`:**
   - White, 1px `#DCE1E8` border, 4px radius.
   - **Title bar:** 34px, solid colour, white 13.5px semibold title with a 15px icon. After the title come an optional count pill (white at 22% opacity) and an optional text action button (white at 14%, 24px high). On the far right is an "Open full screen" square icon button with a 1.5px white border.
   - **Optional `PanelTools` row** under the title bar: icon buttons 30×28 with tooltips. "More" is pushed to the right. Remember rule 3.
   - **Optional filter row:** search plus filter chips, on `#FCFCFB`.
   - **Optional footer:** for example Refresh and Edit, right-aligned.
7. **`DataTable`:**
   - 30px header row on `#F7F8FA`. Header labels are underlined, and clicking one sorts where the table already supports sorting.
   - Rows are 34 to 38px, 13px text.
   - A leading 14px tick box only where bulk actions already exist.
   - Status cells use `StatusPill`.
   - Rows open the record where the current app does.
   - Pagination: "Showing X of Y", then Previous and Next.
8. **`StatusPill`:** a tinted background with a ✓ or ! glyph for ok, warn and bad, so colour is never the only signal.
9. **`KeyValueList`:**
   - "Label: **value**" lines, 13px. The label is ink-3; the value is ink at medium weight.
   - Masked values show an inline "Show" link, behind the existing permission.
10. **Record components:**
    - **`RecordContextBar`:** 44px, white. It holds:
      - a back arrow, then a divider;
      - icon actions (edit, add note, report incident, add visit, more), each mapped to an existing action;
      - "Service user: **Name**";
      - on the right, the two most-used actions as real buttons.
    - **`RecordHeader`:** background `#E9F0FA`.
      - Left: a 40px avatar, then the name as a blue underlined link in the form `SURNAME, First (Title) (Ref: XXX)`, then the status pill. Under that, "Known as" and "Coordinator · Area".
      - Right: "Born: … (NN Years)", "First language", and "NHS No" masked with Show.
      - Under those, round 26px **alert icons**, each with a tooltip and aria-label. They come only from data that already exists: two-carer calls, falls risk, key safe, carer preference, care plan status. For employees: ready to work, DBS to verify, training due, app linked.
      - A collapse chevron.
    - **`RecordTabs`:** a "Menu" button, which opens the existing record actions menu (change status, update from a document, archive or delete), followed by the existing tabs in their existing order with counts. The active tab has a 3px `#1F4FB4` underline.
    - **`QuickLinks`:** a white box of blue links, each with a 20px coloured icon square and an optional count. A red count bubble means something needs action. Each link jumps to the matching tab.
    - **`Timeline`:** the tall panel on the right. Under the "Timeline" title and filter chips sits a bold month heading, for example "NOV 2026". Each entry has:
      - a 44px circle icon with a blue 2px ring, joined to the others by a vertical line;
      - the event title as a blue underlined link;
      - the time on the right ("Today at 08:14", "Yesterday at 15:20", otherwise "dd/mm/yyyy hh:mm");
      - a one-line description;
      - two small columns, "Completed by:" and "Date and time:".
      - Build it only from existing visit notes, call notes, incidents, care-plan reads and audit entries that the user is allowed to see. The panel scrolls inside itself and matches the height of the panels beside it.

## 6. Layouts

### Service user record (`/rota/service-users/[id]`), Overview tab

Copy `service-user-record-1440.png`. Use a 12-column grid with a 12px gap and 12px 16px padding. Use container queries on the record wrapper, not viewport media queries, because the record sits inside the shell.

- **Left area (7 columns), an inner 6-column grid:**
  - `QuickLinks` (2 columns) beside **Person details**, blue (4 columns): full name, known as, address, phone, date of birth (masked), NHS number (masked), first language, carer preference, status. It has Refresh and Edit in the footer.
  - **Key contacts**, rose (3 columns): table with Name, Relationship and Phone, and a "Next of kin" tag. Beside it, **Risks and safety**, red (3 columns): table with Risk, Level pill and Review date, from the existing risk assessments.
  - **Before you visit**, amber (3 columns): two-carer calls, falls risk, getting in and key safe with an audited "Show code" button, and preferences. Beside it, **Care plan**, teal (3 columns): version, review-due pill, approved date and source, a "Read by carers" meter, and section tags.
- **Right area (5 columns):** the `Timeline`, spanning the full height of the left area.
- **Below, full width, in two halves:**
  - **Completed visits with staff**, green: Date, Call, Staff, Times, Note pill.
  - **Visits for the next 14 days**, blue: Day, Calls, Carers pill. Its header has a "Daily Rota" button.
- **Then:**
  - **This week's visits**, navy (6 columns): the existing call-by-day grid.
  - **Funding and references**, orange (3 columns).
  - **Care team**, purple (3 columns): coordinator and carers who visit most in 28 days, with "Record absence" in the footer.
- **Other tabs:** use the same `Panel` and `DataTable` components for the existing content of each tab. Keep the 11 tabs in their current order.
- **Container below 1180px:** the left area and the timeline stack, and the timeline is capped at 560px with internal scroll.
- **Container below 760px:** one column. `QuickLinks` becomes a horizontal scrolling row, and the header's right side wraps under the name.

### Employee record (HR Hub)

Copy `employee-record-1440.png`. It uses the same frame: context bar ("Employee: Name", with Upload evidence and Verify buttons), header with alert icons, and tabs (Overview, Employment, Compliance, Training, Documents, Activity).

- **Left area:** `QuickLinks` beside **Employee details** (blue).
- **Under them:**
  - **Checks needing action** (red): only the items that are not in date.
  - **Contact** (rose): restricted fields masked.
  - **Time off** (teal): allowance bar and monthly chart.
- **Right:** the `Timeline`.
- **Full width:** **Checks and training** (navy): the existing compliance timeline, with every check as a row, a "Today" line and status pills.
- **Then:** **Documents** (cyan) and **Upcoming dates** (purple).

### Module pages (the roughly 80 pages)

Every page uses:

1. `SubTabs`, where the page is part of a group.
2. `PageHeader`.
3. `HowThisWorks`.
4. `StatTiles`, where counts exist.
5. The page body. Pick the body by the page's current purpose:

| The page is… | Use |
|---|---|
| a list | One `Panel`, coloured in the module colour, titled with the page name and row count. Inside: `PanelTools`, the filter row, then `DataTable` with pagination |
| a work queue (Needs attention, Unassigned, Exceptions, Regulatory Updates and similar) | A red `Panel`: a list on the left; on the right, the detail and the decision buttons that already exist |
| a status board (recruitment stages and similar) | Columns whose 34px title bar is coloured by status |
| a week grid (Weekly Planner, Advanced Rota, templates) | One module-coloured `Panel` with the week label in the title and the grid inside |
| a module home (Rota Home, HR Home, Compliance Home) | Red "What needs doing" panel on the left, navy "Go to" link panel on the right |
| settings | A section list on the left, and the selected section as a module-coloured `Panel` with "Save changes" in the title bar |
| a document library | One `Panel` per group, with groups in cycling colours |
| a compliance matrix | One `Panel` holding the ✓ ! ✕ … – matrix and its legend |

### Overview (`/overview`)

Keep the content and layout exactly as they are now. Only add coloured title bars:
- Today's care delivery: navy
- Needs action: red
- Notifications: blue
- This week: green
- Go to: teal

### Policy library and reader, and Users & Logins

- **Policy library:** the list becomes a blue `Panel` titled with the current category and its count.
- **Reader side panels:** Policy Actions (navy), Staff sign-off (green), Linked Forms & Resources (purple).
- **Users & Logins:** Office users (purple), Carer app logins (teal), and the roles table (navy).

## 7. Navigation regroup: Care & Rostering

In both the flyout and All pages, Care & Rostering becomes 9 entries. Entries with sub-pages show them as `SubTabs`.

**Every existing route keeps its URL.** This is grouping only: no redirects and no removed pages.

| Entry | Sub-pages (route) |
|---|---|
| Rota Home | Today (`/rota`), The Monitor (`/rota/monitor`) |
| Daily Rota | (`/rota/visits`) |
| Needs attention, with an existing count badge | Visits Needing Attention (`/rota/attention`), Unassigned Visits (`/rota/unassigned`), Sickness & Holiday Cover (`/rota/cover`), Missed Calls (`/rota/missed`), Exceptions (`/rota/exceptions`) |
| Plan the rota | Weekly Planner (`/rota/planner`), Advanced Rota (`/rota/advanced`), Build Rota (`/rota/build`), Generate & Optimise (`/rota/optimise`), Printable Rota (`/rota/print`) |
| Templates & runs | Daily Templates (`/rota/templates`), Advanced Templates (`/rota/templates/planner`), Live Run Routes (`/rota/routes`), Template Run Routes (`/rota/routes/templates`) |
| Service users | All service users (`/rota/service-users`), Care Coordinator (`/rota/coordinator`), Care Plans (`/rota/care-plans`), Risk Assessments (`/rota/risks`), Incidents (`/rota/incidents`), Visit Notes (`/rota/notes`) |
| Carers | Staff & Eligibility (`/rota/staff`), Staff Readiness (`/rota/readiness`), Carer app (`/carer`) |
| Finance | This week (`/rota/finance`), Invoicing (`/rota/finance/invoices`), Wages (`/rota/finance/payroll`), Timesheets (`/rota/finance/timesheets`), Mileage (`/rota/finance/mileage`), Tariffs & Funders (`/rota/finance/rates`) |
| Rota Settings | (`/rota/settings`) |

The prototype's routes were read from the code. **Verify each one against the real `src/app` routes.** Where the real route differs, keep the real one and note it in the PR. Leave the other modules' menus in their current order. The HR Hub lives in `src/hr` with prebuilt Tailwind 4 CSS: apply the same tokens and components there without breaking its build.

## 8. Phases (one PR each; stop after each for Daude's review)

1. **Foundations:**
   - tokens, fonts and motion;
   - `AppShell` (rail, flyout, top bar), `SubTabs`, `PageHeader`, `HowThisWorks`, `StatTiles`, `Panel`, `PanelTools`, `DataTable`, `StatusPill`;
   - the Care & Rostering regroup;
   - the Daily Rota restyle;
   - the CLAUDE.md paragraph.
2. **Records:** service user record (all 11 tabs) and employee record (all 6 sections), including `RecordContextBar`, `RecordHeader`, `RecordTabs`, `QuickLinks` and `Timeline`.
3. **Overview, policy library and reader, Users & Logins.**
4. **All remaining module pages,** a module at a time: Care, then HR, Policy & Compliance, Reporting, Admin.

**PR description for each phase must include:**
- what changed;
- the parity checklist for the affected pages: each existing feature and where it now is, with nothing removed;
- anything from the reference that was left out because no data source exists;
- the baseline and after results for type check, lint and tests;
- screenshots at 1440, 834 and 390.

**Before opening each PR, check:**
- Every route in the phase still loads for each role: ORG_ADMIN, CARE_MANAGER, CARE_COORDINATOR, CARER, FINANCE_OFFICER, COMPLIANCE_LEAD and STAFF.
- Each role still sees only what it saw before.
- There is no horizontal scrolling at 390px except inside tables and grids.
- No console errors.

## 9. Replacement text for the CLAUDE.md design paragraph

> **ClearCare design system: Harbour (owner's decision, 13 Nov 2026).** The approved visual source of truth is `docs/design/harbour/` (screens, `prototype/clearcare.css` and the prototype screens). It replaces the earlier "Recommended mix" and the Policy Library reference image.
>
> The look is a panel dashboard:
> - a 76px icon rail with a slide-out menu;
> - light blue page and record headers;
> - white panels with solid coloured title bars, picked by meaning (blue details, rose contacts, red risks and alerts, amber before-you-visit, teal care plans, green completed, navy schedules, cyan documents, orange funding, purple team);
> - tool rows and tick-box tables;
> - record pages with quick links, key-value details and a timeline on the right;
> - the `pnIn` entrance animation, with reduced motion respected.
>
> Daily Rota keeps its existing layout. Build with the shared components in `src/components/harbour/`. Design work never changes data, APIs, permissions or business rules, and never removes a feature.
