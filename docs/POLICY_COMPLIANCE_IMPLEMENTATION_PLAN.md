# Policy Library rebuild: plan for approval (v2)

Status: **waiting for the owner to reply "APPROVED — BUILD POLICY LIBRARY".** No application code has been changed.

Prepared 29 Oct 2026 against GitHub `main` at `6d4eb04` (confirmed with `git fetch`).

**Visual source of truth:** `docs/design/policy-library-reference.png` (1536 × 1024), supplied by the owner on 29 Oct 2026. It replaces the My Policies design assumed in v1 of this plan. Since the owner asked for no new schema purely for visuals, v1's proposed `PolicyReview` table is withdrawn.

This document is the required first response. Its sections are:
1. Repository audit
2. Screenshot design breakdown
3. Functional gap analysis
4. Architecture plan
5. Test-first plan
6. Proposed file-change list
7. Risks

§8 lists the decisions needed, and §9 records Phase 5 design planning for the other sections.

---

## 1. Repository audit

### 1.1 Stack and conventions (verified)
- Next.js 15.5 App Router, React 19, TypeScript 5.9 (strict), Tailwind 3.4 driven by CSS variables (`tailwind.config.ts`, `src/app/themes.css`), Prisma 6.19, PostgreSQL 16, Vitest 3, Playwright 1.63.
- Already installed and reusable: Phosphor icons, `pdfjs-dist` (assets copied to `public/pdfjs` by `postinstall`; used by `src/hr/components/pdf-preview.tsx`), `pdfkit` / `docx` (board-paper exports), `mammoth`, `zod`, Radix Dialog and Tabs, `@tanstack/react-table`, Source Serif 4 and Inter variable fonts. **No new dependencies are needed.**
- Mutations are server actions in `src/app/actions.ts` through `handle()`, which re-checks the session, catches `AppError`s and redirects with `?ok=` or `?error=`. Domain logic lives in `src/server/*`.

### 1.2 Files the brief named, as they actually are
| File | Today |
| --- | --- |
| `src/app/(app)/layout.tsx` (154 lines) | The shell. Navy 220 px sidebar with logo, "All in One Platform" and the organisation name, then **per-portal** side menus (`PortalSideNav`). A header with a **portal switcher button**, a global policy search (GET `/policies?q=`), the org switcher (only with more than one membership), a "Sample workspace" tag, help, reading list, notifications and a user menu with sign out. Also the setup banner and the inline-jobs kicker. |
| `src/components/portal-switcher.tsx` | Header portal menu, plus `PortalSideNav` and `PortalMobileNav`. HR opens as a full page load (`separateApp`). |
| `src/components/brand.tsx` | `<Logo>` renders `/csb-logo.svg` or `/csb-logo-light.svg` (the "CSB / Care Solution Bureau" lockup). The **original** CSB monogram (cyan "CSB") is in `public/brand/csb-monogram.png` and `csb-monogram-embedded.svg`, and the full original lockup is in `public/brand/csb-logo.png`. |
| `src/app/globals.css`, `src/app/themes.css` | Five themes (`board`, `care` [default], `govuk`, `carbon`, `zinc`) that change tokens only. `care` uses navy `#0f2a4f`, cyan `#0ea5d6`, **Roboto at an 18 px root size**, and `--font-display` set to sans. Components: `.panel`, `.btn-*`, `.input`, `.table`, `.rows`. |
| `src/app/(app)/policies/page.tsx` (177) | `?view=index` is the Policy Index (search, type and area filters, overdue, pagination 20). `?tab=templates` is the Template Library with **Adopt**. With no params it renders `areas.tsx`. |
| `src/app/(app)/policies/areas.tsx` (101) | "My Policies", the 26 Oct design: 9 area tabs (`src/lib/policy-areas.ts`), collapsible category groups and an "Updated" pill (published in the last 30 days). |
| `src/app/(app)/policies/[id]/page.tsx` (535) | The full policy record: 9 tile tabs (Review Sheet, Policy Text, Procedure, Forms, All Policy, Versions, Regulation Map, Read & Sign, Reg. Flags). Downloads, Log Read & Sign, Start revision, rollback, implementation confirmation. **Kept unchanged** (deep links and e2e tests use it). |
| `src/app/(app)/policies/new/page.tsx` | Titled "Upload Custom Policy", but it is really a text form (`## Heading` sections) that creates a draft and revision through `createPolicy`. **There is no file upload.** |
| `src/server/auth/rbac.ts` | `Ctx`, `ORG_PERMISSIONS`, `PLATFORM_PERMISSIONS`, `canOnPolicy`, `requireOnPolicy`, `visiblePolicyWhere` (own organisation plus `kind: MASTER`). |
| `src/server/auth/portals.ts` | `canUsePortal`, `portalsFor`, page guard. This is the single rule for portal access. |

### 1.3 How policy data is stored
- **`Policy`**: `kind` MASTER (CSB template, `organisationId` null) or CUSTOMER. Fields: `templateId`, `ref`, `docType`, `categoryCode` (flat `PolicyCategory`; the 9 "areas" are grouped in code by `POLICY_AREAS`), `serviceTypes[]`, `status` ACTIVE or ARCHIVED, `ownerId`, `reviewerId`, `approverId`, `reviewIntervalMonths`, `nextReviewDate`, `currentPublishedVersionId`, `lockVersion`, and `search_vector` (title and description only, via trigger `policy_tsv`).
- **`PolicyVersion` / `PolicySection`**: immutable once out of draft (triggers `policy_version_guard`, `policy_section_guard`). `origin` is SEED, MANUAL, AI_REGULATORY_REVISION, MASTER_SYNC or ROLLBACK. Section bodies are indexed for full-text search in `DocumentChunk`.
- **`PolicyRevision`** (draft, submitted, closed) → `ReviewAssignment`, `ApprovalDecision` (immutable), `RevisionComment`, `AiCitation`.
- **`PolicyPublication`** (scheduled or published, acknowledgement due date, implementation confirmation) → **`Acknowledgement`** (per user).
- Links: `RequirementPolicyLink` (customer policies inherit them from their template), `ChangePolicyCandidate` (regulatory flags), `ImpactAssessment`.

### 1.4 Demo data facts that shape the design (from a local seed of the current code)
- The Care Solution Bureau demo organisation has **167 policies**. **Every one has `ownerId` set, none has `reviewerId`, and 166 of the 167 published versions are `SEED` starter text with no approval record.** So a truthful screen will mostly show "Starter text · not approved", not the screenshot's "Published / Approved" (see D4).
- No policies are archived. The 9 areas cover 27 categories. The branches are Liverpool, Portsmouth and Tower Hamlets. Memberships carry `branchId` for staff only.

### 1.5 What must be preserved
- Every existing address and deep link:
  - `/policies/[id]` (and its `?view=` tabs), `/policies/[id]/versions/[vid]` and `/revisions/[id]`
  - `/policies?tab=templates`, `?view=index`, `?q=` (header search), `?category=`, `?type=`, `?overdue=1` and `?area=`
  - `/policies/new` and `/api/policies/[id]/download`
- The workflows: adopt template, manual revision, AI-drafted revision, review and decide (separation of duties, configured number of approvers), immediate and scheduled publication with optimistic concurrency, rollback as a new version, master → customer sync, read & sign, implementation confirmation, reminders.
- Tenant isolation (`tests/integration/workflow.test.ts` "never exposes another organisation's…"), portal access rules, the HR Hub's own shell and CSS, and theme switching.

### 1.6 What a redesign could break
1. **The shell is shared by every non-HR page.** Restyling it changes the Dashboard, Regulatory Updates, Audits and so on. Portal navigation moves from the header button into the sidebar. `PortalMobileNav`, `pages.spec.ts` (which walks `aside` links) and the `portal-switcher` test id would all be affected.
2. `MainArea` decides the "wide" layout using `path === "/policies"` with only `area` params. That has to change.
3. The header search posts `q` to `/policies`, so the new page must honour `?q=`.
4. The dashboard links to `/policies` and `/policies/new`. The sidebar label "Upload Custom Policy" would be renamed.
5. Theme tokens: the screenshot is not the `care` theme (it uses a serif display face, a 16 px base and warmer neutrals). Changing `care` globally would restyle every page (see D2).
6. The `e2e/scenario.spec.ts` sign-in test opens `/policies`, and `pages.spec.ts` asserts that every reachable page returns a status below 400.

---

## 2. Screenshot design breakdown

Measurements are in screenshot pixels at 1536 × 1024 (CSS px at 1×). Colours were sampled from the image and will be fine-tuned in the overlay pass.

### 2.1 Regions
| Region | Box (x, y, w, h) | Notes |
| --- | --- | --- |
| Sidebar | 0, 0, 212, 1024 | `#092135` flat navy, full height, sticky |
| Top bar | 212, 0, 1324, 56 | warm off-white `#f6f5f3`, no bottom border, search box at 244–1020 × 13–43 |
| Hero | 212, 56, 1324, ~134 | `#f5f4f1`. Breadcrumb at y≈78, H1 baseline y≈140, subtitle y≈156. Decorative interior photo on the right (≈1000–1536). Three-line serif tagline at x≈1268. |
| Workspace card | 230, 190, 1290, 813 | white, radius ≈8, soft shadow, sits partly over the hero |
| Tabs row | 245–1504, 190–237 | tabs at x 245 / 340 / 447 / 548, active underline 3 px `#0369d5` |
| Filter row | 250–1500, 252–284 | search 238 w, Categories 186 w, Statuses 156 w, Owners 157 w, More Filters 120 w, kebab at 1487. Controls 32 h, radius 6. |
| Category Explorer | 245, 300, 229, 508 | panel `#fbfaf8`, 1 px border, radius 6 |
| Quick Filters | 245, 820, 229, 158 | separate panel |
| Policy Register | 486, 300, 512, ~690 | header 300–360, rows ≈118 h |
| Policy Inspector | 1010, 300, 494, ~690 | header 300–380, tabs 380–418, viewer 435–775, Key Information 788–912, action bar 935–967 |

Column gutters are 12 px. Grid: `229px | 512px | 494px` inside 24 px card padding, which scales as `minmax(220px,15%) minmax(440px,1fr) minmax(440px,32%)` above 1280 px.

### 2.2 Tokens (new and scoped; see D2)
| Token | Value | Used for |
| --- | --- | --- |
| `--pl-sidebar` | `#092135` | sidebar background |
| `--pl-sidebar-active` | `#17527b` | active portal row (radius 6) |
| `--pl-sidebar-sub-active` | `#0d385e` | active sub-item |
| `--pl-sidebar-text` / `-muted` | `#ffffff` / `#c9d6e3` | labels |
| `--pl-canvas` | `#f8f7f4` | page and top bar background (warm) |
| `--pl-hero` | `#f5f4f1` | hero band |
| `--pl-surface` | `#ffffff` | workspace card |
| `--pl-panel` | `#fbfaf8` | explorer, register and inspector panels |
| `--pl-border` | `#e7e4de` | hairlines (sampled ≈ `#e4e4e4`–`#ebe8e2`) |
| `--pl-ink` | `#0b1530` | titles and H1 |
| `--pl-ink-2` | `#2f3d52` | body |
| `--pl-ink-3` | `#646e7f` | meta and labels (the sampled `#6b7586` darkened slightly to pass AA on the panel tint) |
| `--pl-accent` | `#0369d5` | active tab underline and focus |
| `--pl-accent-ink` | `#0646b1` | active tab text, links |
| `--pl-primary` | `#013a72` | primary buttons (Create Policy, Assign for Review) |
| `--pl-secondary-bg` / `-ink` | `#ecf4f9` / `#143a87` | secondary tinted button |
| `--pl-selected` | `#f4f9fc` | selected register row and active tree node (`#e4effb`) |
| Status pills (background / text) | Published `#d6fcee` / `#157a3e` (the sampled `#1ca654` darkened to pass AA at 4.9:1), Under review `#e4f0fe` / `#0454d8`, Review due `#fef1d7` / `#b2510d`, Overdue `#fde4e4` / `#b42318`, Starter or not approved `#eef0f3` / `#4a5564`, Draft `#f1ecfb` / `#5b3fa8` | 20 h, radius 4, 12 px medium |
| Icon tiles | blue `#ebf2f7` + stroke `#154e96`. Amber `#fdf3e4` + stroke `#933f16` (used only when a review is due or overdue). | 48 px (inspector 56 px), radius 8 |

### 2.3 Typography
- **Display (serif):** Source Serif 4 Variable (already installed), the closest licensed match to the screenshot's transitional serif. H1 44/48 weight 600 tracking −0.01em, register heading 20 weight 600, row title 16.5 weight 600, inspector title 19 weight 600, "Key Information" 15 weight 600, tagline 20/26 weight 400.
- **UI (sans):** Inter Variable (installed). 14 px base for controls, 13 px row meta, 12 px descriptions and pills, sidebar 14.5 px with 13.5 px sub-items.
- Page scale: **16 px root inside this page** (the `care` theme uses 18 px, so sizes are set in px on the scoped wrapper).

### 2.4 Component structure
```
AppShell (restyled)
├─ Sidebar: Logo (original monogram) · "Care Solution Bureau CIC" · collapse button
│   ├─ Portal rows (Overview, Policy & Compliance▾, HR & Workforce, Service Users, Rota & Visits, Reporting & Analytics, Administration)
│   │   └─ Policy & Compliance sub-nav (vertical guide line): Compliance Dashboard, Policy Library, Regulatory Updates,
│   │      Requirements Register, Policy Change Queue, Staff Sign-off, Audits & Inspections, Actions & Risks,
│   │      Evidence Library, Compliance Reports
│   ├─ Organisation card ("Switch Organisation", org/branch name)
│   └─ User block (initials, name, job title) · Sign out
├─ TopBar: global search (⌘K) · notifications bell (badge) · Help
└─ PolicyLibraryPage
    ├─ Hero: Breadcrumb · H1 · subtitle · decorative image + tagline
    └─ WorkspaceCard
        ├─ LibraryTabs (Policies · Templates · Archived · Review Calendar) + [Upload Policy] [Create Policy]
        ├─ FilterBar (search · category · status · owner · More filters · ⋮)
        ├─ CategoryExplorer (tree) + QuickFilters
        ├─ PolicyRegister (header: count, sort, list/grid) → PolicyRow × n → Pagination
        └─ PolicyInspector (header · tabs · DocumentViewer | Overview | History | SignOff | LinkedItems · KeyInformation · ActionBar)
```

---

## 3. Functional gap analysis

Legend: ✅ supported today · 🟡 data exists, UI needed (no schema change) · 🔴 not supported (smallest safe option proposed, or shown truthfully).

| Screenshot element | Today | Proposal (truthful label) |
| --- | --- | --- |
| Sidebar with portals and expanded P&C sub-nav | 🟡 Same routes, but a different shell pattern | Rebuild `PortalSideNav` as the screenshot's hierarchy using `portalsFor(ctx)`. Planned portals (Service Users, Rota) appear with a "Planned" tag and open their honest placeholder pages. |
| Original CSB logo, "Care Solution Bureau CIC" | ✅ Assets exist | Use `public/brand/csb-monogram-embedded.svg` (original cyan monogram) plus the "Care Solution Bureau CIC" text. A white monogram isn't in the repo and won't be invented (D3). |
| P&C items: Compliance Dashboard `/`, Policy Library `/policies`, Regulatory Updates `/changes`, Requirements Register `/requirements`, Change Queue `/queue`, Staff Sign-off `/staff`, Audits `/audits`, Actions `/actions`, Evidence `/evidence`, Compliance Reports `/reports` | ✅ All exist | Same permission conditions as today. Template Library moves to the page's Templates tab. Reading List, Resource Centre and Interview Prep aren't in the screenshot, so they move under Overview / Resources and stay reachable (D5). |
| "Switch Organisation · CSB Liverpool" | 🟡 Org switching exists. Branch is on the membership. | The card shows the current organisation and, where set, the member's branch. It opens the existing org switch when the user has more than one membership, and otherwise is a static label with no fake control. **Branch switching isn't supported**, so it isn't offered. |
| User block (name, role), Sign out | ✅ | Name from `ctx`, job title from `Membership.jobTitle`, falling back to the role name. Existing `logoutAction`. |
| Global search with ⌘K | 🟡 Header search exists | Keep GET `/policies?q=`. ⌘K / Ctrl+K focuses the field (small client hook). |
| Bell with badge, Help | ✅ | Existing notifications count and `/assistant`. |
| Breadcrumb, H1, subtitle | ✅ (static) | As shown. |
| Hero photo and tagline "Safe People / Safer Care / Stronger Communities" | 🔴 No image asset. Tagline not verified as CSB's. | Needs an owner-supplied, licensed photo and confirmation of the tagline (D6). Until then: the hero band, a decorative CSS botanical line-art SVG drawn in-house, and the tagline only once confirmed. |
| Tab **Policies** | ✅ | The organisation's CUSTOMER policies (ACTIVE). |
| Tab **Templates** | ✅ | CSB MASTER templates with Adopt (existing `adoptTemplateAction`, permission `policy.author`). The inspector works for templates too (read-only, through `visiblePolicyWhere`). |
| Tab **Archived** | 🟡 `PolicyStatus.ARCHIVED` exists with no action | Lists real ARCHIVED policies. **Archive / restore** is the smallest safe addition: no schema change, `status` update + `AuditLog` entry (reason in `data`), blocked while a revision is open, permission `policy.author` + `org.manage`. Optional in this phase (D7). Without it, the tab shows an honest empty state. |
| Tab **Review Calendar** | 🟡 `nextReviewDate` exists | Month-by-month agenda of reviews due (overdue first), each opening the inspector. Read-only and real. |
| **Upload Policy** button | 🔴 No file import | Either leave it out in this phase, or build `.docx` import (mammoth, already installed: upload → sections preview → draft through `createPolicy`, with the original stored through the existing storage provider and malware hook). Recommendation: **leave it out now and add it as a follow-up with tests** (D8). It must never link to the text form. |
| **Create Policy** button | ✅ | `/policies/new`, renamed "Create Policy" everywhere (page title, sidebar action, dashboard link). |
| Search policies (in workspace) | 🟡 `ILIKE` on title, ref, description | Title, ref and description, plus published section text through `DocumentChunk` full-text search (already indexed), scoped by `visiblePolicyWhere`. |
| All Categories | ✅ | Area → category select (same taxonomy as the explorer). |
| All Statuses | 🟡 Derived | **Published** (approved version live), **Not yet approved** (starter text), **Draft** (no published version), **Under review** (revision submitted, awaiting decision), **Review due** (next review within 60 days, see D9), **Overdue**. |
| All Owners | 🟡 `ownerId` set, no filter | Members of the organisation who own at least one policy. **Changing an owner is not in this phase.** The data has owners but no UI to change them (follow-up). |
| More Filters | 🟡 | Document type (`DOC_TYPES`) and service type (`serviceTypes`). |
| ⋮ (filter row) | ✅ | "Export current list (CSV)", which reuses `reportRows(ctx, "policies")` filtered. Shown only with `report.view`. |
| Category tree with nested subcategories and counts | 🟡 | Level 1 = the 9 `POLICY_AREAS`, level 2 = their `PolicyCategory` rows. Counts come from one `groupBy` per tab and status. Only areas and categories with documents are shown. **No new taxonomy** (the screenshot's "Adults / Children / Prevent" don't exist in our data). |
| Quick Filters (Due for review, Overdue, Recently updated, Awaiting approval) with counts | 🟡 | Due = next review in the coming 60 days. Overdue = `nextReviewDate < now`. Recently updated = published in the last 30 days. Awaiting approval = open revision with `submittedAt` set and not closed. All counted on the server. |
| "Policies (n)", Sort | 🟡 | Sort: Last updated (latest publication, else `updatedAt`), Title, Reference, Next review. |
| List / grid toggle | 🟡 | Both are real views of the same records (rows or cards). The choice is kept in the URL. |
| Row: icon, title, ref, version, Area > Category, description, status pill, owner, review date, ⋮ | 🟡 / ✅ | All from data. Owner shown as initials (no photos stored). The row ⋮ menu offers Open full record, Download Word, Download PDF and, with permission, Create revision. |
| Selected row | 🟡 | `?selected=<id>` in the URL. The link uses `scroll={false}` so the register keeps its place. |
| Inspector header: icon, title, ref, status pill, version, close ✕, ⋯ | ✅ | ✕ removes `selected`. The ⋯ menu offers Open full record, Download Word or PDF, Print, and Archive (if D7). |
| **Document** tab with page viewer (outline, page n / N, zoom, fit, download, print, fullscreen) | 🟡 PDF render exists (`renderPdf`), pdf.js exists | Render the **real board-paper PDF** of the current published version with pdf.js (pattern from `src/hr/components/pdf-preview.tsx`) and its text layer for selection and screen readers. The outline lists the sections and jumps to their pages. Download and print use the same file, and fullscreen uses the Fullscreen API. The route gains `?disposition=inline`. An "Open accessible text" link goes to `/policies/[id]?view=text`. No published version means an honest empty state. |
| **Overview** tab | ✅ | Purpose (description + "Purpose" section), document type, area and category, services, template origin, owner, review interval, next review, open revisions. |
| **History** tab | ✅ | Published and superseded versions: label, date, origin, change summary, reason, approvers, with links to `/policies/[id]/versions/[vid]`. |
| **Sign-off** tab | ✅ | With `staff.view`: coverage for the latest publication (assigned, signed, outstanding, overdue, with names and dates). Others see **only their own** status and the existing **Log Read & Sign**. |
| **Linked Items** tab | ✅ | Mapped requirements (inherited from the template when the organisation has none), regulatory change flags (`ChangePolicyCandidate`), impact assessments, related forms and policies (from the `related` section), and the source template. Each links to its existing page. |
| Key Information (Owner, Category, Last Updated, Next Review (+ months), Approval Status, Applicable To) | 🟡 | "Approval status" = Approved / Not yet approved / Awaiting approval. **"Applicable To" shows the policy's service types** (that is the recorded fact; we don't record staff audiences). |
| **Assign for Review** | 🟡 `reviewerId` exists, no UI | The smallest truthful version: "Assign reviewer" dialog. Choose a member with a review role, which sets `Policy.reviewerId`, writes an audit entry and sends a notification. Server-checked (`policy.author` or `org.manage`), with the member validated against the organisation. Label "Assign for Review" kept if D10 is approved, otherwise "Assign reviewer". |
| **Create Revision** | ✅ | The existing `newRevisionAction` dialog (reason required). |
| **Manage Sign-off** | ✅ | Opens the Sign-off tab. For managers it links to `/staff` (Staff Sign-off). |
| Action bar ⋯ | ✅ | Open full record, Restore previous version (links to the full record's Versions tab, where rollback exists today). |

**No new database tables or columns are needed.** The only data writes added are: `Policy.reviewerId` (assign reviewer), and `Policy.status` (archive / restore, if D7 is approved), each with an `AuditLog` entry and a notification.

---

## 4. Architecture plan

### 4.1 Routing and URL state
- `/policies` becomes the Policy Library workspace. All state is in the URL, so it can be shared, survives refresh and works with Back:
  `tab` (policies | templates | archived | calendar), `q`, `area`, `category`, `status`, `owner`, `type`, `service`, `quick` (due | overdue | recent | awaiting), `sort`, `layout` (list | grid), `page`, `selected`, `pane` (document | overview | history | signoff | linked).
- **Legacy params are mapped on the server, with no redirects needed:**
  - `view=index` → default
  - `tab=templates` → templates
  - `overdue=1` → `quick=overdue`
  - `type` and `category` → as before
  - `area` → area node
  - `q` (header search) → `q`
- `/policies/[id]`, `/policies/[id]/versions/[vid]`, `/policies/new` and `/revisions/[id]` are **unchanged**, apart from renaming the `/policies/new` title to "Create Policy".

### 4.2 Data flow
```
page.tsx (server component)
  ├─ requireCtx() ─────────────────────────────────────────── session → Ctx (organisationId from session only)
  ├─ parseLibraryQuery(searchParams)  zod → LibraryQuery (unknown values dropped, never trusted for tenancy)
  ├─ src/server/policies/library-view.ts
  │    ├─ libraryTree(ctx, q)        groupBy counts per area/category within visiblePolicyWhere + tab filter
  │    ├─ quickFilterCounts(ctx, q)  4 counts, same scope
  │    ├─ listLibrary(ctx, q)        page of rows + derived status + owner names (one query + 2 lookups)
  │    ├─ ownerOptions(ctx)          members of ctx.organisationId who own policies
  │    └─ reviewCalendar(ctx, q)     for tab=calendar
  └─ <Suspense> PolicyInspector(selected)
       └─ inspectPolicy(ctx, id, pane)   uses getPolicy (canOnPolicy "read") → 404 if not visible
             └─ client <DocumentViewer src="/api/policies/{id}/download?format=pdf&disposition=inline">
Server actions (src/app/actions.ts → handle()):
  assignReviewerAction  → assignPolicyReviewer(ctx, policyId, userId)   [zod; same-org member check; audit; notify]
  archivePolicyAction / restorePolicyAction (if D7) → setPolicyArchived(ctx, policyId, reason)
  newRevisionAction, adoptTemplateAction, logReadAndSignAction — existing, unchanged
```
- All queries take `ctx` and start from `visiblePolicyWhere(ctx)`, or `organisationId: ctx.organisationId` for organisation-only data (owners, acknowledgements, coverage). A template from another organisation can't exist (masters have `organisationId: null`). Customer policies of other organisations never match.
- Status is derived in one pure function `policyStatus(policy, now)` (unit-tested), so the register, inspector, filters and counts always agree.
- Page queries move out of the page into `src/server/policies/library-view.ts`. That closes v1 finding G3, where pages queried Prisma directly.

### 4.3 Client and server split
- Server components: shell, hero, tabs, filters (GET forms and links), explorer, register, inspector panes.
- Client islands only where needed: `DocumentViewer` (pdf.js), the ⌘K hook, explorer expand/collapse with keyboard (roving tabindex, `aria-expanded`, tree semantics), dropdown menus (Radix-free `<details>` pattern or the existing Radix Dialog for modal actions), and the inspector close/Escape.
- Loading: `src/app/(app)/policies/loading.tsx` for the whole page, plus a `<Suspense>` skeleton for the inspector. Errors: a segment `error.tsx` with retry. The viewer shows "Couldn't load the document. Download it instead." when the PDF fails.

### 4.4 Styling
- New tokens are scoped to `[data-surface="policy-library"]` and the restyled shell. That keeps the five existing themes working for other pages and avoids a global 18 px → 16 px change (D2).
- Fonts: Source Serif 4 for display and Inter for UI (both already loaded in `src/app/layout.tsx`).
- No new UI kit. Small local components go in `src/components/library/*`.

### 4.5 Responsive behaviour
| Width | Layout |
| --- | --- |
| ≥ 1440 | As the screenshot: three columns |
| 1280–1439 | Three columns, narrower explorer (200 px), inspector 40% |
| 1024–1279 (laptop 1366 × 768 uses three columns at a reduced height, with the inspector viewer scrolling) | Explorer collapses into a "Categories" button (drawer). Register + inspector. |
| 768–1023 (tablet) | Register full width. The inspector opens as a right-hand sheet over the register, and ✕ or Escape returns you to the same place. Sidebar becomes an off-canvas menu. |
| < 768 (phone 390 × 844) | Filters in a sheet. Rows are stacked cards. Selecting a policy opens `/policies/[id]` (the existing full record). Top bar shows the logo, a search button and a menu button. |

---

## 5. Test-first plan

### 5.1 How to run locally (verified in this container)
```bash
cp .env.example .env
npm ci
# PostgreSQL 16 running locally with user postgres/postgres; create throwaway DBs:
createdb csb_test && createdb csb_e2e
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public npx prisma migrate deploy   # once, see note
npm run typecheck && npm run lint && npm run test:hr
npm test            # resets csb_test only
npm run build && npm run test:e2e   # resets csb_e2e only
```
`npm test` and `npm run test:e2e` reset **only** the dedicated local test databases through their global setup. That is the repository's designed behaviour, and it is never pointed at Supabase or any shared database. No `db:reset` was run.

### 5.2 Baseline (29 Oct 2026, `main` 6d4eb04, this container, local PostgreSQL 16)
| Command | Result |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm run test:hr` | ✅ 14 / 14 |
| `npm test` | ✅ 93 / 93 (10 files) |
| `npm run build` | ✅ pass |
| `npm run test:e2e` | ❌ **8 passed, 1 failed (already failing on `main`)**: `pages.spec.ts` "all reachable pages render for admin@csb.demo" because `/settings` returns 404 for the platform admin, who has no organisation. The first attempt timed out because Playwright starts the server before global setup migrates an empty `csb_e2e`. Migrating once beforehand fixes it. |

The pre-existing failure gets a separate small fix PR first (D11) so the library work starts from green.

### 5.3 Functional acceptance tests (expected outcomes)
"Int" = Vitest integration against `csb_test` with real triggers. "E2E" = Playwright against `csb_e2e`.

| # | Test | Expected outcome | Level |
| --- | --- | --- | --- |
| 1 | Manager views organisation-owned policies | Policies tab lists only their organisation's ACTIVE customer policies. The total matches the DB count. Tree and quick-filter counts equal the filtered totals. | Int + E2E |
| 2 | Access authorised master templates | Templates tab lists MASTER templates. "In your library" shows for adopted ones. Adopt is visible only with `policy.author`, and adopting creates a draft + revision (existing flow). A carer sees templates read-only. | Int + E2E |
| 3 | Search and filter | `q` matches title, ref, description and published body text. Category, status, owner, type, service, quick filters and sort each return the right subset and order. Combined filters intersect. Unknown values are ignored without an error. The header search lands on the same results. | Int + E2E |
| 4 | Open a selected policy | Clicking a row sets `selected`, highlights it (`aria-current`) and shows the inspector, while the register keeps its scroll position. ✕ or Escape closes it and focus returns to the row. | E2E |
| 5 | Switch inspector tabs | Each pane shows its data (§3). Tabs follow the ARIA tabs pattern (arrow keys, Home/End) and the pane is in the URL. | E2E |
| 6 | Real version history | History lists exactly the PUBLISHED and SUPERSEDED versions in descending order, with labels, dates, change summaries and approvers. After the scenario's publish, the new version appears at the top. | Int + E2E |
| 7 | Acknowledgement status | A manager sees signed and outstanding counts and names for the latest publication. A carer sees only their own status, and after **Log Read & Sign** it shows "Signed {date}". A carer cannot see other staff (and a forged `pane=signoff` reveals nothing extra). | Int + E2E |
| 8 | Existing routes and deep links | `/policies/[id]` (all `?view=` tabs), `/policies/[id]/versions/[vid]`, `/revisions/[id]`, `/policies/new`, downloads, and the legacy `/policies?view=index`, `?tab=templates`, `?overdue=1`, `?type=`, `?category=`, `?area=` and `?q=` all return 200 and show the equivalent state. | E2E |
| 9 | Permissions for creating, revising and assigning | Create Policy, Create Revision and Assign for Review show only for permitted roles. **Forged server-action posts** by a carer are refused (`ForbiddenError`) with no DB change and no audit row. | Int + E2E |
| 10 | Tenant isolation | An Oakridge user: (a) never sees CSB policies in lists, counts, search, owners or calendar; (b) `?selected=<CSB id>` shows a "not found" inspector; (c) `/api/policies/<CSB id>/download` (both dispositions) → 404; (d) `assignReviewer` with a CSB policy, or with a CSB user as reviewer, → refused. | Int + E2E |
| 11 | Empty library, invalid references, backend errors | A new organisation sees a "no policies yet" state with Create and Templates actions. `?selected=garbage` gives an inspector "not found" while the register still works. A forced PDF render failure shows the viewer error with a Download fallback. DB unavailable gives the segment error page with retry. | Int + E2E |
| 12 | Approval and publication preserved | The existing `workflow.test.ts` and `scenario.spec.ts` pass unchanged. Starting a revision from the inspector produces the same draft as from the full record. Separation of duties is still enforced. | Int + E2E |
| 13 | Assign reviewer | Sets `reviewerId`, audit `policy.reviewer_assigned`, notifies the reviewer, and Key Information shows the name. Assigning a STAFF-only member is rejected. Concurrent assignment: the last write wins and both are audited. | Int |
| 14 | Archive / restore (only if D7) | Blocked with an open revision. Archived policies leave Policies and appear in Archived. Restore reverses it. Both are audited with a reason. | Int + E2E |
| 15 | Derived status | `policyStatus()` returns the right state for each combination (seed, approved, draft only, submitted revision, due, overdue), with a priority order. | Unit |
| 16 | Query parsing | `parseLibraryQuery` (zod) accepts valid params, drops unknown ones, caps the page at 1–500, and never reads organisation or tenant ids. | Unit |

### 5.4 Visual comparison
- **Fixtures:** a test-only seed (`tests/e2e/fixtures/policy-library.ts`, run from e2e global setup into `csb_e2e` only) creates a deterministic "Care Solution Bureau CIC" visual organisation. It has 48 policies whose titles, owners, refs and statuses mirror the screenshot (for example Safeguarding Adults Policy, owner Sarah Wilson, Published v2.1). It uses the real taxonomy, so the tree shows "Safeguarding > Safeguarding" rather than "Adults" (an expected, documented difference). Dates are relative to the run, and date text is masked in the diff. Production screens never use fixtures.
- **Capture:** Playwright, Chromium, `deviceScaleFactor: 1`, fonts loaded, animations off, at 1536 × 1024 (comparison), 1366 × 768, 768 × 1024 and 390 × 844 (review).
- **Compare:** `scripts/visual/compare-policy-library.mjs` (dev-only, no new dependency, using a Playwright page with canvas) produces:
  1. side-by-side PNG
  2. 50% overlay PNG
  3. per-pixel difference heat map
  4. a region report: the boxes in §2.1 measured from the DOM against the reference, giving Δx, Δy and Δw per region, and font-size and colour checks for H1, tabs, row title and pills
- **Threshold:** each major region's position and size within ±4 px, and token colours within ΔE ≤ 3. Remaining differences (photo, record text, taxonomy names) are listed with reasons. Material discrepancies are fixed **before** asking for design approval.
- The outputs are attached to the PR and saved to the project files.

### 5.5 Accessibility and regression
- Automated checks: keyboard-only walk of the shell, tabs, tree (arrow keys), filters, register, inspector tabs and dialogs. Visible focus everywhere (3 px `--pl-accent`). Landmarks and names (`nav`, `search`, `main`, `aside`, `role=tree`, `role=tablist`). Contrast for pills and meta text at AA (≥ 4.5:1; `#646e7f` on the `#fbfaf8` panel is 4.9:1, and every status pill is ≥ 4.6:1). No horizontal overflow at 390 px. Reduced-motion respected.
- Loading and error states are captured in the screenshots.
- Role sweep: the existing `pages.spec.ts` for all seven roles, plus the new library spec run as manager, author, approver, carer and Oakridge manager.

### 5.6 Definition of done
1. The overlay report meets §5.4 at 1536 × 1024, and screenshots exist at all four sizes.
2. Every visible control does something real, or isn't shown.
3. All data comes from authorised records.
4. Tests 1–16 pass, and the existing suites are at baseline or better.
5. `typecheck` and `lint` are clean.
6. No changes outside the files listed in §6.
7. Nothing is merged without the owner's approval.

---

## 6. Proposed file-change list

| File | Change | Why |
| --- | --- | --- |
| `src/app/(app)/layout.tsx` | Restyle the shell to the screenshot: sidebar with portal rows and P&C sub-nav, org card, user block and sign out in the sidebar; slim top bar (search ⌘K, bell, help). The org switch and setup banner stay. | Shell fidelity |
| `src/components/portal-switcher.tsx` | `PortalSideNav` renders the portal hierarchy, and `PortalMobileNav` becomes an off-canvas menu. The header `PortalSwitcher` is retired (portals now live in the sidebar). The `data-testid` values are kept where tests use them. | Shell |
| `src/components/side-nav.tsx` | Sub-nav guide-line styling and active state | Shell |
| `src/components/brand.tsx` | Add a `Monogram` export (original `csb-monogram-embedded.svg`) | Original logo |
| `src/components/main-area.tsx` | "Wide" (no grey canvas) for the new `/policies` workspace | Layout |
| `src/app/globals.css` | Scoped `[data-surface="policy-library"]` and shell tokens and classes (§2.2) | Tokens without a global theme change |
| `src/app/(app)/policies/page.tsx` | Replaced by the workspace page (hero, tabs, filters, explorer, register, inspector). It reads the URL via zod and maps legacy params. | Main deliverable |
| `src/app/(app)/policies/areas.tsx` | **Removed** (superseded by the explorer). `src/lib/policy-areas.ts` is kept as the taxonomy source. | Replaced design |
| `src/app/(app)/policies/loading.tsx`, `error.tsx` (new) | Loading skeleton and error with retry | States |
| `src/components/library/*` (new, about 10 small files) | `Hero`, `LibraryTabs`, `FilterBar`, `CategoryTree` (client), `QuickFilters`, `PolicyRegister`, `PolicyRow`/`PolicyCard`, `StatusPill`, `PolicyInspector` + panes, `KeyInformation`, `ActionBar`, `DocumentViewer` (client), `ReviewCalendar` | Small, testable components |
| `src/server/policies/library-view.ts` (new) | `parseLibraryQuery`, `policyStatus`, `libraryTree`, `quickFilterCounts`, `listLibrary`, `ownerOptions`, `reviewCalendar`, `inspectPolicy` | Server-side scoping and reuse |
| `src/server/policies/library.ts` | Add `assignPolicyReviewer` (and `setPolicyArchived` if D7). `listPolicies` is kept for other callers. | New governed writes |
| `src/server/search/index-chunks.ts` | Small exported helper to find policy ids matching the body text, scoped to visible policies | Body-text search |
| `src/app/actions.ts` | `assignReviewerAction` (+ archive/restore if D7), with zod parsing | Mutations |
| `src/app/api/policies/[id]/download/route.ts` | Accept `disposition=inline` for the viewer, and keep `attachment` as the default. Audit only for downloads, not previews. | Document viewer |
| `src/app/(app)/policies/new/page.tsx` | Title becomes "Create Policy". Copy explains that it creates a draft from text. | Truthful label |
| `src/app/(app)/page.tsx` | Dashboard link text "Create a policy" (already). Check its links to `/policies?…` still map. | Deep links |
| `tests/unit/library-view.test.ts` (new) | Tests 15–16 | Unit |
| `tests/integration/library.test.ts` (new) | Tests 1–3, 6–7, 9–14 | Integration |
| `tests/e2e/library.spec.ts` (new), `tests/e2e/fixtures/policy-library.ts` (new), `tests/e2e/global-setup.ts` | Tests 1–14 in the browser, the visual fixture org, and migrate-before-server fix | E2E |
| `tests/e2e/pages.spec.ts` | Update the sidebar locator if the shell's markup changes (same coverage) | Shell change |
| `scripts/visual/compare-policy-library.mjs` (new) | Side-by-side, overlay, diff and region report | Visual check |
| `docs/design/policy-library-reference.png` | Already added (reference) | Baseline |
| `public/brand/policy-library-hero.*` (only after D6) | Owner-supplied licensed image | Hero |

**Not touched:** `src/hr/**`, `src/app/hr/**`, Service Users, Rota, `prisma/schema.prisma` (no schema change), migrations, other Policy & Compliance pages (apart from inheriting the shell), `src/app/themes.css`.

---

## 7. Risks

| Area | Risk | Mitigation |
| --- | --- | --- |
| Security | New aggregate queries (tree counts, quick filters, owners, calendar, body search) leak other tenants' data | Every function takes `ctx` and composes `visiblePolicyWhere`. Owner and coverage queries also pin `organisationId: ctx.organisationId`. Test 10 covers every function. |
| Security | The inline PDF route exposes a document without permission | It reuses `buildDocModel(ctx, id)`, which already checks `canOnPolicy` read. `Cache-Control: private, no-store`. 404 for any failure. |
| Security | Forged form posts (assign reviewer, archive) | zod parsing. `policyId` ownership is re-checked on the server. The reviewer must be a member of `ctx.organisationId` with a review role. Organisation ids are never read from input. |
| Data integrity | Archive while a revision or publication is in flight | Refuse while there is an open revision or a scheduled publication. Single transaction plus audit. No version rows touched (immutability triggers stay intact). |
| Data integrity | Status labels that overstate approval | One `policyStatus()` with the rule "Published" only when the live version has an approval record. Starter text always says "Not yet approved". |
| Regression | The shell restyle changes every non-HR page | It is a shell-only change (no page markup), with screenshots of the Dashboard, Regulatory Updates, Queue, Audits and Settings before and after. `pages.spec.ts` covers all roles, and the HR shell is unaffected (separate layout). |
| Regression | Legacy `/policies` params and the header search | Explicit mapping plus test 8. |
| Regression | Removing the 26 Oct My Policies design | It's superseded by owner instruction. The area taxonomy is kept in the explorer. |
| Accessibility | A canvas PDF viewer is unreadable for screen readers | pdf.js text layer, an outline with real headings, and an "Open accessible text" link to the HTML record. |
| Accessibility | A three-column density that's too small | 12 px minimum text, AA contrast, 32 px minimum targets (44 px on touch), zoom to 200% without loss. |
| Performance | PDF rendered on every inspector open (pdfkit) | Rendered only when the Document pane is active, `no-store`, measured on the demo data. Caching per version id is a follow-up if it's slow. |
| Performance | Free-tier Supabase with several group-bys per request | Indexed columns, parallel queries, about 6 queries per page view, measured with 200 policies. |
| Visual | The hero photo and tagline can't be matched without an asset | D6. The difference is documented in the comparison report. |
| Delivery | `main` auto-deploys to the live demo | Feature branch `feature/policy-library`, PR only, merge only on the owner's word. |

---

## 8. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Reference image | ✅ Resolved: `docs/design/policy-library-reference.png` |
| D2 | Apply the screenshot's look to the shell for **all** non-HR pages, keeping other pages' content unchanged? | Yes, with tokens scoped to the shell and library so other themes and pages don't shift |
| D3 | Logo: use the original cyan CSB monogram from the repo (no white version exists) | Yes, use the original. Supply a white version if you prefer it on navy. |
| D4 | Demo data: 166 of 167 demo policies are unapproved starter text, so most rows will honestly show "Not yet approved". OK, or should the demo seed record real approvals by the demo approver for a subset? | Keep it truthful. Optionally seed approvals for about 20 policies through the real workflow (labelled demo). |
| D5 | Reading List, Resource Centre and Interview Prep aren't in the screenshot's sidebar | Keep them reachable under Overview (Reading List) and a "Resources" row |
| D6 | Hero photo and tagline "Safe People, Safer Care, Stronger Communities": supply a licensed photo and confirm the tagline | Until supplied: a plain hero band with an in-house line-art accent, and no tagline |
| D7 | Include archive / restore now (no schema change, audited)? | Yes. It makes the Archived tab real. |
| D8 | Upload Policy (.docx import) now, or a follow-up? | Follow-up. Hide the button until it's built and tested. |
| D9 | "Due for review" window | 60 days |
| D10 | "Assign for Review" means "assign the policy's reviewer" (sets `reviewerId` and notifies) | Yes |
| D11 | Fix the existing `/settings` 404 e2e failure in a separate small PR first | Yes |

---

## 9. Phase 5: future Policy & Compliance sections (design planning only)

Each section gets its own layout built around its job. None reuses the three-column library layout.

| Section | Primary job | Proposed structure |
| --- | --- | --- |
| Regulatory Updates `/changes` | Understand a source change and record an applicability decision | A two-pane review desk: a change queue on the left (source, detected date, classification, status), and the change workspace with a section-level redline of source vX→vY, the AI analysis with verified quotes, and an "Applies to us?" decision form with reason. |
| Requirements Register `/requirements` | Traceability | A matrix: requirements as rows (legal status, source) against columns for linked policies, audit questions and evidence, with coverage gaps highlighted. A detail drawer shows the requirement text history. |
| Policy Change Queue `/queue` | Move drafts through review, approval and publication | A board by stage (Drafting → In review → Approved → Scheduled → Published), filtered to "my work". Cards show due dates, urgency and assigned people. |
| Audits & Inspections `/audits` | Conduct a structured assessment | A guided runner: a question list with progress, an answer panel, finding capture with severity, evidence attach, and a summary with actions raised. |
| Actions & Risks `/actions` | Accountability | A register by owner and deadline with severity, overdue escalation, and completion evidence with **independent verification** as a separate step. |
| Staff Sign-off `/staff` | Acknowledgement coverage | A coverage grid of policies × staff (or roles and branches), overdue lists, reminders, and per-person reading history. |
| Evidence Library `/evidence` | Secure evidence management | A file register with scan status, retention, and "supports" links to requirements, audits and actions. Preview with access logging. |
