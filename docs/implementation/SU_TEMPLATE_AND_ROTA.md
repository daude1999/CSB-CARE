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

## PR B – Confirm Template Changes and Create Future Rota

### Confirm Template Changes (every template save)

Saving an edited template no longer saves straight away. `TemplateEditForm` (`src/components/template-save-confirm.tsx`)
asks the server for the changes first (`previewTemplateEdit` in `src/server/rota/template-impact.ts`):

1. **Confirm Template Changes**: the changed fields, Previous and New (Start, Finish, Duration, Days, Weeks, Carers
   required, each carer place, Shadow, Area, Time locked, Medication prompt, Alert if late, Run route, From, Until,
   Care tasks, Notes, Rota type). Nothing changed shows "No changes to save." and saves nothing. **Template only** is
   chosen by default; Cancel saves nothing.
2. **Template + future rota** opens **Review Changes to Future Rota**: every built visit of this template from today,
   with its result: Can update, Needs review, Manual change – protected, Time locked – protected, Started or finished –
   history kept, No longer in the template, Already matches. Every carer is re-checked by the eligibility service at
   the new time; a carer who cannot do it means Needs review, and nobody is swapped in. A carer place is only changed
   when it still holds the template's old carer or is empty (cover carers are never replaced). Tasks are replaced
   only before any task outcome is recorded; notes only when they still equal the old template note.
3. **Confirm Future Rota Changes**: the final check, then Confirm & Apply.

Saving (`saveTemplateEdit`) runs in one transaction with the template row locked. It needs the confirmation token
for exactly the values confirmed (a different value or an old version is refused), and for Template + Future Rota
re-plans and compares the review's fingerprint: if anything changed since the review, nothing is saved. Any visit
the visit service refuses rolls the whole save back with the visit reference and reason. Carers of changed published
visits get an in-app notice (`notifyVisitsChanged`, type `rota.visit.changed`, deduplicated); drafts are not announced.
The audit entry `template.updated` records the choice, each change and the counts.

Recommendation 4 (approved): added days are never built automatically. They are listed ("not built yet: use Create
Future Rota"). Visits on a removed day are kept unless ticked to cancel, with a reason.

Bulk template actions on Daily Templates (except Duplicate and Activate) and moving a template's carer on the
Template Planner ask for the same confirmation first, and say the change is Template only. The server refuses them
without it (`confirmed=1`).

### Create Future Rota (one service user)

Service User Profile → Visits → Rota (and Template) → **Create Future Rota** (`?tab=rota&future=1&from=&nweeks=`,
needs `rota.build`). Choose the first week (this week or later) and 1–8 weeks, then Preview. The preview uses the
Build Rota planner limited to this person's active templates (`previewServiceUserRota` in `src/server/rota/build.ts`):
one visit per template and date (an existing visit is never duplicated or changed), absences and past times skipped,
every carer checked, refused places left open. Create re-plans under the same week locks as Build Rota and refuses if
anything changed since the preview. Visits are created unpublished in one `RotaBuild` per week with
`serviceUserId` set; tick "Publish to carers now" to publish straight away (linked carers are told in the app),
otherwise publish from All Rotas. These builds are labelled "<name> only" in All Rotas and do not count as the whole
week being built (Build Rota still offers the week, and building it adds only what is missing).

Schema: `RotaBuild.serviceUserId` (nullable, additive; migration `20261104090000_rota_build_service_user`).

## Still to come

- PR C: Adjust Visit Time, and Roll Forward handling of one-off time changes.

## Rollback

PR A: revert the PR. PR B: revert the PR; the nullable `RotaBuild.serviceUserId` column can stay (nothing else reads
it), or drop it with `ALTER TABLE "RotaBuild" DROP COLUMN "serviceUserId";`.
