# Service User Management and All Service Users (add and update)

Owner's brief, 7 Nov 2026: "All Service Users page redesign: Add New Service User and Update Existing Service User".

## What was built

| Screen | Address | What it has |
| --- | --- | --- |
| Service User Management (new workspace, first tab of Service Users) | `/rota/service-users/manage` | Three cards: Add New (Upload Support Plan, Add Manually), Update Existing (Upload Revised Support Plan, Hospital Discharge, Update Manually), View All. The full directory below. |
| All Service Users (same address as before) | `/rota/service-users` | Title, real count on the right, **Add New Service User** and **Update Existing Service User** above the search, the existing filters and table, View and Update on every row, pages of 25. |

The sidebar is unchanged ("Service Users" now opens the workspace and stays lit on every page under it).

## One workflow per action (nothing duplicated)

| Choice | Goes to | Existing workflow reused |
| --- | --- | --- |
| Upload Support Plan | `/rota/coordinator?mode=NEW#start` | Care Coordinator intake, new person |
| Add Manually | `/rota/service-users/new` | `ServiceUserForm` + `createServiceUserAction` (redirects to the new profile) |
| Upload Revised Support Plan | `/rota/coordinator?mode=EXISTING&person=<id>#start` | Care Coordinator intake, existing person (compare, version the plan, keep history) |
| Hospital Discharge / New Medical Information | `/rota/coordinator?mode=EXISTING&person=<id>&doc=discharge#start` | Same intake for the same person. The letter is classified as a discharge letter when read (or set under Documents); filing it opens the post-discharge review (`discharge-review.ts`). Medicines are reconciled, never changed from the letter. |
| Update Manually | `/rota/service-users/<id>?tab=details` | Profile, Personal details tab |

The only change on the Care Coordinator page: when it is opened with a person chosen, it says who is being updated (no new person is created), suggests an intake name, and for `doc=discharge` explains the discharge review. Intake internals are untouched.

The shared choices live in `src/components/service-user-actions.tsx`; the directory in `src/components/service-user-directory.tsx` is used by both pages.

## Search

The Update Existing picker calls `GET /api/service-users/search?q=` → `findServiceUsersToUpdate()` (in `src/server/care/service-users.ts`), which uses the same `serviceUserMatchWhere` and `lookUpReferences` as the directory and top bar: names (each word, partial), full names, postcodes, CSB and legacy SU numbers, exact council/Frameworki/package references from the encrypted register, and NHS numbers only for `serviceUser.sensitive`. Every status is searched, at most 20 results, branch and area limits always apply.

## Permissions (all checked on the server)

- Directory and workspace: `serviceUser.view` (unchanged).
- Add New / Add Manually / Update Manually / the picker API: `serviceUser.edit`.
- Upload options: `serviceUser.edit` + `rota.edit` + `serviceUser.documents` (the Care Coordinator's own `coordinatorAccess`).
- A choice the member may not use is not shown, and each destination checks again.

## Count and pages

`serviceUserDirectory(ctx, { page })` now returns `total`, `page`, `pages` and 25 rows a page; without `page` it returns every row as before. The count is the number of people the member may see who match the search and filters. The table was not reduced: name with CSB/legacy/matched reference, status, area (and branch), postcode, risk, commissioned hours, repeating visits, carer preference, plus Actions.

## Known limits

- The Care Coordinator's person list leaves out people whose care has ended, so an ended person chosen in Update Existing must be picked again there (or restarted first).
- Council/Frameworki numbers are not shown as a column: they are encrypted and are only found by exact search (unchanged rule).
- No new sorting options were added (the directory still sorts by surname, then first name).
