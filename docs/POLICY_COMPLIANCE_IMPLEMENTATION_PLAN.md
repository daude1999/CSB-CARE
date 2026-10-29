# Policy & Compliance: Policy Library implementation plan

Status: **draft for owner approval**. No application code has been changed. Prepared 29 October 2026 against `main` at `6d4eb04` (PR #19 merged).

Scope: Policy & Compliance → Policy Library. That covers My Policies, the Policy Index, the CSB Template Library, the policy record page, creating a policy, review-due management and the hand-offs to the workflows the library depends on. Regulatory Updates, the Change Queue, Requirements, Audits, Actions, Staff Sign-off and Evidence come in only where the library links to them. They are planned separately.

---

## 1. Business purpose

The Policy Library is where a care provider keeps the policies, procedures, forms and tools its services operate under. It must let people:

1. **Find** the right document quickly, by area of care, type, reference or words in the text.
2. **Trust** what they see: whether the text is approved, which version is live, when it was last reviewed, when it is next due, and whether a change is in progress.
3. **Inspect** a document in context: its text, procedure and forms, the regulations it maps to, version history, sign-off records and any regulatory change that has flagged it.
4. **Act**:
   - adopt a CSB template
   - create a local policy
   - start a revision
   - record a review with no change
   - assign an owner
   - download it as a CSB board paper
   - read and sign it
   - archive it

   Each of these goes through the existing governed workflow (draft → review → approval → publication → acknowledgement), never around it.

Two audiences use it:
- **Managers and compliance leads**, who keep the library current and inspection-ready.
- **Care staff**, who need to read and sign what applies to them.

## 2. Visual source of truth

- **Reference:** the "My Policies" area-tab design that the owner approved on 26 Oct 2026 ("dashboard and my policies look perfect"). It is saved in the project files at `qcs-replica/my-policies-prototype-opened.png` and live at `/policies`. **To be confirmed by the owner (see §11, decision D1).**
- **Elements to keep from it:**
  - the navy title bar with Back
  - the row of area tabs with icon, label and update-count badge
  - collapsible category groups, each with an "Updates" ring and a document count
  - dense document rows (reference, title link, type, last-updated date, "Updated" pill)
  - the top search with a single field and a Search button
  - the "Policy Index" secondary action
- **Applies to:** the Policy Library pages only. Other modules keep the same craftsmanship (type scale, colour tokens, density, focus states) but get their own layouts.

## 3. What exists today (inventory)

### 3.1 Routes

| Route | File | What it does |
| --- | --- | --- |
| `/policies` (no filters) | `src/app/(app)/policies/areas.tsx` | **My Policies**: 9 area tabs (`src/lib/policy-areas.ts`). Each tab lists category groups in `<details>`, and each row shows ref, title, type, last published date and an "Updated" pill if published in the last 30 days. Customer policies only. |
| `/policies?view=index` | `src/app/(app)/policies/page.tsx` | **Policy Index**: search on title, ref and description (`ILIKE`). Filters for document type, area of care and "overdue for review". Paginated 20 per page. Shows version state (approved, starter text not approved, or no published version), review date and open revisions. |
| `/policies?tab=templates` | same | **Template Library** (CSB master templates) with an **Adopt** action. |
| `/policies/new` | `policies/new/page.tsx` | "Upload Custom Policy". In practice this is a Markdown-style textarea (`## Heading` sections) that creates a draft and a revision. |
| `/policies/[id]` | `policies/[id]/page.tsx` (535 lines) | **Policy record** with tile tabs: Review Sheet, Policy Text (personalised with business details), Procedure, Forms/Related, All Policy, Versions, Regulation Map, Read & Sign, Reg. Flags. Actions: Download Word/PDF, Log Read & Sign, Start revision (dialog), rollback, confirm implementation. |
| `/policies/[id]/versions/[vid]` | `versions/[vid]/page.tsx` | One historical version. |
| `/revisions/[id]` | `revisions/[id]/page.tsx` | Draft editing, comments, submit, decide, publish. |
| `/acknowledgements` | `acknowledgements/page.tsx` | "My Reading List" for the signed-in user. |
| `/api/policies/[id]/download` | route handler | Branded DOCX or PDF of the current published version, with an audit entry. |

### 3.2 Server logic (reuse, don't duplicate)

- `src/server/policies/library.ts`: `listPolicies`, `getPolicy`, `createPolicy`, `adoptTemplate`, `getRevision`.
- `src/server/policies/workflow.ts`: `createManualRevision`, `createRollbackRevision`, `editDraftSection`, `addComment`, `submitForReview`, `decide`, `publishRevision` / `performPublication` (sets `nextReviewDate` and uses the `lockVersion` concurrency check), `acknowledge`, `logReadAndSign`, `confirmImplementation`, `sendAcknowledgementReminders`, `publishDueScheduled`.
- `src/server/policies/versions.ts` (section hashing, diffs), `sync.ts` (master → customer three-way merge), `revise.ts` (AI drafting from an impact assessment).
- `src/server/documents/*`: board-paper Word and PDF rendering.
- `src/server/auth/rbac.ts`: `canOnPolicy`, `requireOnPolicy`, `visiblePolicyWhere`, and the `policy.read/author/review/approve/publish` permissions.
- `src/lib/business.ts`: personalises policy text with the organisation's business details.

### 3.3 Data (Prisma)

`Policy` (with `kind` MASTER or CUSTOMER, `organisationId`, `templateId`, `ref`, `docType`, `categoryCode`, `serviceTypes`, `status` ACTIVE or ARCHIVED, `ownerId`, `reviewerId`, `approverId`, `reviewIntervalMonths`, `nextReviewDate`, `currentPublishedVersionId`, `lockVersion`, and an **unused-by-the-library** `search_vector`) → `PolicyVersion` → `PolicySection` (`isLocal`, `masterKey`). Changes go through `PolicyRevision` → `ApprovalDecision` → `PolicyPublication` → `Acknowledgement`. `RequirementPolicyLink` and `ChangePolicyCandidate` connect policies to the regulatory side. Database triggers enforce immutability, the state machine and at most one published version.

### 3.4 Tests that cover the library today

- `tests/unit/library.test.ts` checks the integrity of the starter content (references, sections, citations, history).
- `tests/integration/workflow.test.ts` covers:
  - tenant isolation of policies, drafts, search, evidence and acknowledgements
  - separation of duties and illegal transitions
  - publish concurrency, scheduled publishing and rollback
  - acknowledgements and reminders, and master → customer sync
- `tests/e2e/scenario.spec.ts` runs the full change → draft → approve → publish → acknowledge flow in the browser. `tests/e2e/pages.spec.ts` renders every reachable page for seven roles.
- **Not covered:** library filters and search, the area view, adopting a template through the UI, creating a policy through the UI, download permissions, review-due behaviour, and phone or keyboard layout.

### 3.5 Baseline, run in an isolated container on 29 Oct 2026 (local Postgres 16, throwaway `csb_test` and `csb_e2e` databases)

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed (0 errors) |
| `npm run lint` | passed (0 problems) |
| `npm test` | 10 files, **93/93 passed** |
| `npm run test:hr` | **14/14 passed** |
| `npm run build` | passed |
| `npm run test:e2e` | **8 passed, 1 failed** (see below) |

Browser-test notes from that run:
- **Existing failure on `main`**: `pages.spec.ts` "all reachable pages render for admin@csb.demo" fails because the platform admin, who has no organisation, is sent to `/settings`, which returns 404. This isn't related to the Policy Library. It should be fixed in its own small PR, either by changing the `/settings` guard or the test's portal home, before P1 so the suite starts green.
- **Harness quirk**: the first run timed out because Playwright starts the web server before global setup migrates `csb_e2e`, and `/login` returns 500 on an empty database. Running `DATABASE_URL=…/csb_e2e npx prisma migrate deploy` once beforehand fixes it. P0 should make global setup handle this, or document it in the README.

## 4. Gaps and issues found

| # | Finding | Impact |
| --- | --- | --- |
| G1 | "Upload Custom Policy" doesn't upload anything. It is a Markdown textarea. | The label misleads. Providers expect to bring in their existing Word policies. `mammoth` is already installed (used in `sources/extract.ts`). |
| G2 | Library search uses `ILIKE` on title, ref and description only. The `Policy.search_vector` full-text column and `DocumentChunk` index exist but aren't used, so words in the policy body aren't searchable from the library. | Staff can't find "what do I do if…" content. |
| G3 | The pages query Prisma directly (`policies/page.tsx` group-bys, `areas.tsx` `findMany`) instead of going through `src/server/policies`. Scoping is correct today (`organisationId: ctx.organisationId`), but the logic is duplicated and untested. | Regression risk for tenant isolation, and hard to test. |
| G4 | "Updates" means "published in the last 30 days" for everyone. It doesn't mean "changed since *you* last signed". | The badge count isn't actionable for a given person. |
| G5 | There's no way to record "reviewed, no changes needed". "Last reviewed" on the Review Sheet is really the last *publication* date, so the only way to reset `nextReviewDate` is to publish a new version. | The annual review cycle can't be done properly, and the overdue list stays wrong. |
| G6 | `ownerId`, `reviewerId` and `approverId` exist, but there's no UI to set them. The Review Sheet falls back to the hard-coded text "Registered manager" when there's no owner. | Accountability isn't recorded, and the fallback shows an invented value. |
| G7 | `PolicyStatus.ARCHIVED` exists, but there's no archive or restore action. | Retired policies can't be removed from the library with an audit trail. |
| G8 | Read & Sign is self-service (`logReadAndSign`). The Policy Library can't assign reading to particular roles, branches or people, and shows no per-policy sign-off coverage (who is overdue) for managers. | Managers can't evidence that staff have read key policies. (Staff Sign-off is its own module; the library needs the per-policy view and a link to it.) |
| G9 | There are no `loading.tsx` files and no sort options (always ordered by reference). The 535-line policy page mixes data loading and presentation. | Perceived slowness and maintainability. |
| G10 | The area view hides master templates and doesn't show service-type applicability (care home, home care and so on). Care Solution Bureau is domiciliary care only. | It shows documents that don't apply to the service. |
| G11 | Server action inputs use ad-hoc `str()` parsing with no zod schemas. | Weaker validation on new inputs. |

## 5. Proposed design

The approved reference layout stays. Each change below is functional, not decorative.

### 5.1 My Policies (`/policies`)
- Keep the title bar, area tabs, category groups and dense rows exactly as approved.
- **Search bar** above the tabs. It uses full-text search over title, reference, summary and published section text (G2). Results show as a flat list with the matching snippet highlighted.
- The **"Updates" badge per person** counts documents with a publication the viewer hasn't acknowledged, or that changed since their last acknowledgement. Hovering the badge explains what it counts (G4).
- **Row status pills**, real states only: `Updated` (unread change), `Review overdue`, `Draft in progress`, `Not yet approved` (starter text).
- **Service filter**: a "Show only documents for my services" toggle, defaulting to on. It uses `Policy.serviceTypes` against the organisation's branch service types (G10).
- **Empty states**: an area with no documents links to the matching templates. With no search results, show "Clear search".
- **Phone**: area tabs become a horizontal scroller, and rows show ref, title and pill with type and date on a second line.

### 5.2 Policy Index (`/policies?view=index`)
- The management view: a sortable table (ref, title, type, area, owner, version state, last reviewed, next review, open revisions, sign-off coverage %).
- Filters: type, area, status (approved / starter / draft / archived), owner, "overdue", "due in 30/60/90 days" and "no owner".
- Bulk select, used only for *Assign owner* and *Export CSV*. There are no bulk publish or approve actions, because separation of duties applies to each policy.
- Filter state is kept in the URL so views can be shared and bookmarked.

### 5.3 Template Library (`/policies?tab=templates`)
- Same structure as the index, filtered to CSB masters. It shows "In your library", "Adopt" and "Newer CSB version available" (from `basedOnMasterVersionId` against the template's current version), which links to the existing master-sync draft.
- Before adopting, a preview panel shows the template's sections and marks which ones are local (filled in by the provider).

### 5.4 Policy record (`/policies/[id]`)
- Keep the tile tabs and Review Sheet design. Split the page into server-loaded sections (`getPolicyRecord` in `src/server/policies`) and small presentational components.
- **Review Sheet** changes:
  - "Last reviewed" uses the new review record (G5).
  - Owner, reviewer and approver can be edited by people with `policy.author`, and the "Registered manager" fallback is removed (G6).
  - A "Record review" action has two outcomes: *No changes needed*, which records a review and moves `nextReviewDate` on, or *Changes needed*, which starts a revision.
- **Read & Sign tab**: for managers, a sign-off coverage table (assigned, signed, overdue) for the current publication, with "Send reminder" (using the existing reminder job). Staff see only their own status.
- **Archive / restore** in an overflow menu with a required reason. It's blocked while a revision is open, it's audited, and archived policies are hidden from My Policies but appear in the index with the Archived filter (G7).
- The existing Start revision, rollback, confirm implementation, download and read & sign actions stay as they are.

### 5.5 Create policy (`/policies/new`)
- Rename it to **"Add a policy"**, with two routes:
  1. **Write**: the current section editor, with proper section rows instead of `## Heading` parsing.
  2. **Import Word document**: upload a `.docx`, which is converted with `mammoth` into sections the user checks before the draft is created. The original file is stored as evidence through the existing storage provider and malware-scan hook.
- Both routes create a draft and revision through `createPolicy`, so nothing is live until it's approved and published.

## 6. Requirements

### 6.1 Functional
- F1 Full-text search across title, ref, description and published section text, within the user's visible policies only.
- F2 Per-user unread or changed counts on area tabs, groups and rows.
- F3 Record a review with no change: stores who, when and a note, moves `nextReviewDate` on, audits it and doesn't create a version.
- F4 Assign or change owner, reviewer and approver (they must be members of the same organisation with suitable roles).
- F5 Archive and restore with a reason. Not allowed while a revision is open.
- F6 Sign-off coverage per publication, with reminders.
- F7 Import from .docx into a draft.
- F8 Filters for status, owner and due window. Sortable columns. CSV export of the current filter.
- F9 Service-type applicability filter.
- F10 All existing workflows keep working unchanged: adopt, revise, AI-drafted revision, review and approve, publish (immediate or scheduled), rollback, master sync, download, read & sign, implementation confirmation.

### 6.2 Non-functional
- Tenant isolation on every query, enforced in `src/server/policies` and covered by integration tests.
- Server-side permission checks on every action and download.
- zod schemas for every new action input.
- Library pages render in under 1 s with about 200 documents on the demo database. Queries are indexed (`organisationId`, `docType`, `search_vector`).
- WCAG 2.2 AA: keyboard access to tabs, groups and dialogs, visible focus, labelled controls, contrast checked.
- Responsive at 1440, 834 and 390 px with no horizontal scroll.
- Every state change is written to `AuditLog`.

## 7. Data model changes (to be approved, all additive)

| Change | Why it's needed | Migration safety |
| --- | --- | --- |
| New `PolicyReview` table (`id`, `policyId`, `organisationId`, `versionId`, `outcome` NO_CHANGE / CHANGE_REQUIRED, `note`, `reviewedById`, `reviewedAt`), immutable by trigger | F3 and G5. A review with no change must be recorded without creating a version. | New table only, with no backfill needed. "Last reviewed" falls back to the publication date when there are no reviews. |
| `Policy.archivedAt`, `archivedById`, `archiveReason` (nullable) | F5. Who archived a policy, when and why. | Nullable columns, no default rewrite. |
| Optional: `ReadingAssignment` (policy, role or branch or user, due date) | Only if the owner wants assigned reading in this phase (D4). Otherwise it's deferred to Staff Sign-off. | New table. |

No existing column is changed or removed. Full-text search uses the existing `search_vector` column and `DocumentChunk` index. The migration must also extend the immutability triggers to `PolicyReview`.

## 8. Implementation phases

Each phase is its own branch and PR, with tests, before/after screenshots and the owner's approval before merge.

| Phase | Content | Depends on |
| --- | --- | --- |
| **P0 Groundwork** | Move the library queries from pages into `src/server/policies/library.ts` (`listLibrary`, `libraryCounts`, `areaView`, `getPolicyRecord`). Add zod schemas for library actions. Add integration tests that pin current behaviour, including tenant isolation of the new functions. Split the policy page into components. **No visible change.** | none |
| **P1 Find** | Full-text search (F1), per-user updates (F2), service filter (F9), index sorting and filters (F8), loading and empty states. | P0 |
| **P2 Govern** | `PolicyReview` + "Record review" (F3), owner assignment (F4), archive and restore (F5), Review Sheet fixes. | P0, migration approval |
| **P3 Sign-off** | Per-publication coverage and reminders on the policy record (F6), and links to Staff Sign-off. | P0 |
| **P4 Add a policy** | Section editor and .docx import (F7). | P0 |
| **P5 Polish and proof** | Visual comparison with the reference at three widths, keyboard and accessibility pass, browser tests for every flow, updated demo seed. | P1–P4 |

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Breaking the approved look while refactoring | P0 makes no visual change. Playwright screenshots before and after are compared against the reference. |
| Tenant leakage through new aggregate queries (counts, search) | All queries live in server functions that take `ctx` and use `visiblePolicyWhere` / `organisationId`. A cross-tenant integration test is required for each one. |
| DB triggers rejecting new flows (archive during publication, reviews) | Design the transitions against the existing state machine. Integration tests run against real Postgres with the triggers in place. |
| `main` auto-deploys and `vercel-build` runs migrations on the live demo | Only additive migrations. Merge only with approval, and never just before a demo. |
| .docx import of untrusted files | Size and type limits, the existing malware hook, plain-text extraction only (no HTML injection), and the user checks the result before the draft is created. |
| Performance of full-text search on the free Supabase tier | Use the existing GIN index, limit to 20 results with pagination, and measure on the demo data. |
| The reference image is the wrong one | Owner to confirm (D1) before P1. |

## 10. Acceptance criteria and test strategy

### 10.1 Acceptance-test matrix

| ID | Scenario | Expected | Test level |
| --- | --- | --- | --- |
| A1 | Manager opens My Policies | Area tabs, groups and rows match the reference. Counts come from the database. | e2e + screenshot |
| A2 | Search "missing person" | Returns SAF-004 and FRM-014 with snippets. Never returns another organisation's policies. | integration + e2e |
| A3 | Org A user searches for a ref that exists only in Org B | No result, and the URL for that policy returns 404 | integration |
| A4 | Carer with an unread new publication | The area and group badges show 1, and the row shows "Updated". After Log Read & Sign the badges clear. | integration + e2e |
| A5 | Index filters: overdue, owner, status, due in 30 days, sorting | Correct subsets, with state kept in the URL | integration + e2e |
| A6 | Record review "no changes" | Review stored, `nextReviewDate` moved on, no new version, audit entry, Review Sheet updated | integration + e2e |
| A7 | Staff member tries to record a review or assign an owner, using a forged form post | Refused on the server, with no change in the database | integration |
| A8 | Assign an owner from another organisation (forged id) | Rejected with a ValidationError | integration |
| A9 | Archive a policy that has an open revision | Blocked with a clear message | integration |
| A10 | Archive and restore | Hidden from My Policies, shown under the Archived filter, audited both ways | integration + e2e |
| A11 | Coverage table | Assigned, signed and overdue counts match the acknowledgements. "Send reminder" doesn't create duplicates. | integration |
| A12 | Import a .docx | Sections extracted, user confirms, draft and revision created, nothing published | integration + e2e |
| A13 | Oversized or wrong-type file | Rejected with a message, nothing stored | integration |
| A14 | Existing flows (adopt, revise, AI draft, approve, publish, rollback, master sync, download, read & sign) | Unchanged. The existing suites stay green. | existing integration + e2e |
| A15 | Separation of duties | The author still can't approve their own draft, including drafts that started as imports | integration |
| A16 | Layout at 1440, 834 and 390 px | No horizontal scroll, all actions reachable | e2e screenshots |
| A17 | Keyboard only | Tabs, groups, filters, dialogs and row links can all be used, with focus visible | e2e |
| A18 | Area or search with no results | A helpful empty state with the next action | e2e |

### 10.2 Test layers
- **Unit (Vitest)**: zod schemas, due-window calculation, search query building, .docx-to-sections mapping.
- **Integration (Vitest + real Postgres `csb_test`)**: every new server function, including tenant isolation, permission refusal, concurrency (two people recording a review or archiving at once) and trigger behaviour.
- **Browser (Playwright, `csb_e2e`)**: a library spec covering A1, A2, A4, A5, A6, A10, A12, A16, A17 and A18, plus the existing scenario and every-page suites.
- **Visual**: Playwright screenshots at three widths, compared against the reference and attached to each PR.

### 10.3 Commands per PR
`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:hr`, `npm run build`, `npm run test:e2e`. Run them only against local throwaway databases, and report the actual results.

### 10.4 Baseline rule
§3.5 records the baseline at the time of planning: 1 browser test was already failing. Each phase PR states its own before and after results. If browser tests can't run in a given environment, the PR says so instead of assuming they pass.

## 11. Decisions needed before development starts

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Confirm the approved Policy Library reference image | The My Policies design approved on 26 Oct (`qcs-replica/my-policies-prototype-opened.png`) |
| D2 | Approve the additive schema changes in §7 (`PolicyReview`, archive fields) | Approve. They are needed for a real review cycle and an archive trail. |
| D3 | Approve the phase order and the rule of one PR per phase | P0 → P1 → P2 → P3 → P4 → P5 |
| D4 | Assigned reading: in the library now, or in the Staff Sign-off module later? | Later. The library shows coverage and reminders only. |
| D5 | Default the service filter to the organisation's services (domiciliary care for CSB)? | Yes |
| D6 | When can merges to `main` happen, given that it updates the live demo? | Only on your explicit "merge", and never on a demo day |
