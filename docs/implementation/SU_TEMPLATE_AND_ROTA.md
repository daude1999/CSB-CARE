# Service User Template & Rota

Owner's brief of 3 November 2026 ("CSB Care – Service User Template & Rota Management" and "Quick Visit Time Adjustment"),
approved on 4 November 2026 ("APPROVE, BUILD AND MERGE") together with the six recommendations in the plan
(https://claude.ai/artifact/EaBTJpg8UDs8g7KpXwNFKB). Delivered in three PRs.

## PR A – Template and Rota tabs (this change)

Service User Profile → **Visits** now has five sub-tabs: Visits | Template | Rota | Visit notes | Missed calls.

- **Template** (`?tab=template&weeks=1,3&days=1,3`): this person's repeating visits from the shared `VisitTemplate`
  rows (`listTemplates` with the new `weeks[]` / `days[]` "any of" filters). Week options follow
  `rotaSettings.cycleLength`. One row per template, so a two-carer visit is one row naming Carer 1 and Carer 2.
  Actions reuse the existing ones: View (Daily Templates panel), Edit (template page, Back returns to the profile),
  Duplicate, Activate / Deactivate (with an inline confirmation), History. Add Template opens the form with the
  service user already chosen (`/rota/templates/new?su=`; ignored unless the member may see that person).
- **Rota** (`?tab=rota&week=YYYY-MM-DD&status=`): the person's `Visit` rows for one week (`serviceUserRota` in
  `src/server/rota/su-rota.ts`, scoped by `visitWhere`). Previous / This / Next week and a date picker; filters All,
  Scheduled, In Progress, Completed, Missed, Unassigned (open carer places), Cancelled, each with a count. Planned and
  actual (clock) times are separate columns. Warnings: Manual change, Time locked, Not published, Needs review, open
  places. Open / Edit goes to the existing Visit Details page, where edit, reassign, carers required and cancel
  already live; a missed call links to its investigation.

Nothing is copied: an edit anywhere shows in these tabs on the next page load, and vice versa.

Permissions: the tabs need `rota.view` (as Visit notes already did); Add / Edit / Duplicate / Activate need
`rota.edit`, re-checked on the server by the existing actions.

## Still to come

- PR B: Confirm Template Changes on every template save (Template Only / Template + Future Rota), proposed-change
  preview, one-transaction apply, Create Future Rota for one service user.
- PR C: Adjust Visit Time, and Roll Forward handling of one-off time changes (after PRs #68 and #71).

## Rollback

Revert the PR. No schema change in PR A.
