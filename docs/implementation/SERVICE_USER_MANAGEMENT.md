# All Service Users: one central service-user workspace

Owner's briefs:
- 7 Nov 2026 16:12, "All Service Users page redesign: Add New Service User and Update Existing Service User" (PR #119, merged).
- 7 Nov 2026 20:06, "Approved Visual Design – One Central Service User Management Workspace" (this design, built to the owner's approved screenshot).

## The page

There is one page, `/rota/service-users`. The separate Service User Management page and its three cards are gone. `/rota/service-users/manage` redirects here and keeps `q`, `status`, `area`, `branch` and `page`.

From top to bottom:

1. **Tabs:** All Service Users | Care Coordinator | Incidents | Visit Notes.
2. **Title and actions:** "All Service Users", with the description "Manage service users, add new referrals and update existing records." On the right are **+ Add New Service User ▾** (purple) and **✎ Update Existing Service User ▾** (white, purple border).
3. **Toolbar:** Search | Branch | Area | Status | Apply | Clear. It is a GET form, so the filters live in the URL and work with pages and Back.
   - The branch and area values are checked against the member's own lookups, and anything else is ignored.
   - The branch filter is ANDed with `serviceUserWhere(scope)`, so it can only narrow what the member may already see.
4. **Table columns:**
   - Service User: initials, name, and date of birth only with `serviceUser.sensitive`.
   - CSB Reference: the legacy reference sits underneath it.
   - Council / Frameworki Ref
   - Area
   - Care Package: real commissioned hours a week.
   - Status: a lifecycle pill.
   - Next Visit: UK date and time.
   - Actions: View, Update ▾ and ⋮ details.
5. **Count and pages:** "Showing X to Y of N service users" from the real count, 20 a page, with Previous, page numbers and Next.

Postcode, risk, repeating visits, carer preference and branch stay available in each row's ⋮ details panel. On narrower screens the table drops columns in this order:

| Column | Hidden below |
| --- | --- |
| Council ref | 1536px |
| Next Visit | 1420px |
| Area and Care Package | 1280px |

Name, reference, status and actions always stay. Every value remains in ⋮ details. The page never scrolls sideways (checked at 390, 834, 1024, 1280, 1366, 1440 and 1672 wide).

## One workflow per action (nothing duplicated)

| Choice | Goes to | Existing workflow reused |
| --- | --- | --- |
| Upload Support Plan | `/rota/coordinator?mode=NEW#start` | Care Coordinator intake, new person |
| Add Manually | `/rota/service-users/new` | `ServiceUserForm` + `createServiceUserAction` |
| Upload Revised Support Plan | `/rota/coordinator?mode=EXISTING&person=<id>#start` | Care Coordinator intake, existing person |
| Hospital Discharge / New Medical Information | `/rota/coordinator?mode=EXISTING&person=<id>&doc=discharge#start` | Same intake; filing the letter opens the post-discharge review |
| Update Manually | `/rota/service-users/<id>?tab=details` | Profile, Personal details tab |

How Update Existing chooses the person:
- **From the header button:** it first shows a compact search (`GET /api/service-users/search`, the same matching as the directory). Once a person is picked, it offers the three choices, and every link carries that person's id.
- **From a row's Update:** the person is already chosen.

How the dropdowns behave:
- They open above the table and are never clipped by it.
- They close on Escape, returning focus to the button, or on a click outside.
- They follow the button when the page scrolls.

Shared code:
- The choices live in `src/components/service-user-actions.tsx`.
- The page body is `src/components/service-user-directory.tsx`.

## Data (no per-row queries)

`serviceUserDirectory(ctx, { q, status, areaId, branchId, page })` returns `total`, `page`, `pages` and 20 rows. For the page's rows only:

- **Next visit:** one `visit.groupBy` with the earliest future SCHEDULED visit, limited by `visitWhere(scope)`.
- **Council / Frameworki ref:** one query plus decryption through `councilReferencesFor()` in `external-references.ts`.
  - It returns only active council client, council package and other external references.
  - NHS numbers and shared framework IDs are never shown as a person's reference.
  - Ranking: client, then package, then other. Verified comes first, then oldest.
  - "Unverified" is labelled.
  - "+N" shows when a person has more references.
  - If `CSB_REFERENCE_SECRET` is missing, the column says so in an amber notice and the rest of the page works.

## Permissions (all checked on the server)

| What | Needs |
| --- | --- |
| The page | `serviceUser.view` |
| Add New, Add Manually, Update Manually and the picker API | `serviceUser.edit` |
| Upload options | `serviceUser.edit` + `rota.edit` + `serviceUser.documents` |
| Date of birth and NHS search | `serviceUser.sensitive` |

A choice the member may not use is not shown, and each destination checks again. Branch and area limits always apply.

## Known limits

- The default Status is "Current (not ended)", as before. The approved image shows "All Statuses", which is one click away. "Review Required" in the image is not a lifecycle status, so it is not shown as one.
- The Care Coordinator's person list leaves out people whose care has ended, so an ended person chosen in Update Existing must be picked again there.
- Council/Frameworki numbers are encrypted. They show in the column but are found by search only when the whole number is typed.
- Sorting is unchanged: surname, then first name.
